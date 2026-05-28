"""The transcription pipeline as a single async function.

Shared between two callers:
    1. main.py — runs inline inside /upload when CELERY_ENABLED=false (dev).
    2. tasks.py — runs inside a Celery worker when CELERY_ENABLED=true (prod).

The job state document is persisted to disk between each phase so any frontend
poll of GET /jobs/{id} sees the live status (`extracting` → `transcribing` →
`ready` / `failed`).

## Segmentation architecture

Gemini returns a FLAT word list — text, start, end, speaker, is_song per
word. Python builds subtitle segments from those words here. This split
exists because Gemini's word-level timestamps are accurate (grounded in
audio frames) while its segment-level timestamps are unreliable for songs
(it sometimes compresses an entire song into < 1 sec of segment time).

Building segments from words involves three passes:

  1. **Region grouping** — split the word stream by speaker change and by
     speech↔song transitions. Each region is one speaker × one mode.

  2. **Region → segments**:
     - Song region → one segment containing all its words (no chunking).
     - Speech region → chunk by:
       (a) word-end punctuation `, . ? ! ; ।` (digit & abbreviation guarded),
       (b) coordinating conjunctions (and / or / but / because + Indic),
       (c) **inter-word gaps** above max(1.5× this region's median, 0.2s),
       (d) stylistic 3-word cap (TikTok-style brevity, not a heuristic).

  3. **Aalaap fill** — for each is_song segment that's followed by another
     segment, extend its end to the next segment's start, so held vowels at
     line ends remain on screen until the next lyric begins. The LAST song
     segment is NOT extended (its end is the last word's actual end —
     trusting Gemini's word timing rather than audio duration).

Non-Gemini providers (Groq, OpenAI, Sarvam) return `segments` directly;
they go through a legacy path that splits at punctuation with proportional
time distribution.
"""

import asyncio
import statistics
from pathlib import Path

from .storage import read_job, write_job
from .video_worker import extract_audio, extract_thumbnail, probe_duration
from .whisper_client import (
    _is_abbreviation_period,
    distribute_phrases,
    split_transcript,
    transcribe,
)


# Punctuation marks that end a phrase when found at the end of a word.
_END_PUNCT = "।.?!,;"

# Adaptive gap-detection parameters. Both apply RELATIVE to each segment's
# own median word gap — there is no absolute "if pause > N seconds" threshold.
#   GAP_MULTIPLIER: a pause that is this many times the median counts as
#                   a natural break (1.5 = upper-tail outliers).
#   GAP_FLOOR_SEC:  smallest pause length we'd ever consider a break, to
#                   avoid splitting on micro-variations in fast tight speech.
_GAP_MULTIPLIER = 1.5
_GAP_FLOOR_SEC = 0.20

# Coordinating conjunctions that mark clause boundaries. We split BEFORE
# any of these when they appear mid-segment, to handle long fluent sentences
# where the speaker did not pause (so the gap detector has no signal). The
# list is intentionally short and language-aware — these are real linguistic
# markers, the same kind of content-rule as the digit and abbreviation
# guards, not a numeric threshold.
_CONJUNCTIONS_LATIN = {"and", "or", "but", "because"}
_CONJUNCTIONS_INDIC = {"और", "या", "लेकिन", "क्योंकि", "અને", "અથવા", "પણ", "કેમકે"}

# Stylistic creator preference: max words per displayed subtitle. This is
# NOT a heuristic about what speech "should" look like — it's a TikTok-style
# brevity cap, like font size or color. Applied AFTER all natural-boundary
# rules (punctuation, conjunctions, adaptive gaps) and only to non-song
# segments. Songs pass through untouched.
_MAX_WORDS_PER_CHUNK = 3

# Gemini occasionally returns per-word timestamps that collapse into a tiny
# window at the start of the audio (e.g., a 67-second song with every word
# stamped between 0.14s and 0.41s). When that happens the subtitle overlay
# flashes and is gone before playback advances a half-second. Detect by
# comparing the model-reported word span to the actual audio length; below
# this ratio we treat the timestamps as untrusted and redistribute words
# uniformly across the real duration. 0.5 is a generous threshold — any
# song with vocals filling >50% of the audio remains above it.
_COLLAPSED_SPAN_RATIO = 0.5


async def run_pipeline(
    job_id: str,
    source_path: str,
    user_key: str | None,
    user_provider: str | None,
    user_model: str | None,
) -> None:
    """Extract audio, call cloud ASR, persist segments. Idempotent across
    crashes — re-reads state from disk so a retried task sees current values.
    Marks the job 'failed' on any exception and re-raises.
    """
    state = read_job(job_id)
    if not state:
        raise RuntimeError(f"Job '{job_id}' not found.")
    src = Path(source_path)

    try:
        state["status"] = "extracting"
        write_job(state)
        audio_path = src.parent / "audio.wav"
        thumb_path = src.parent / "thumb.jpg"

        # Audio + thumbnail are independent FFmpeg subprocesses — run them
        # concurrently via to_thread so the second one doesn't add wall-clock
        # time. Thumbnail is best-effort: if it fails, the rest of the pipeline
        # still completes; the Projects card just falls back to a status badge.
        def _safe_thumb():
            try:
                extract_thumbnail(str(src), str(thumb_path), at_seconds=1.0)
            except Exception as e:
                print(f"[pipeline] thumbnail extraction failed for {job_id}: {e}", flush=True)

        await asyncio.gather(
            asyncio.to_thread(
                extract_audio,
                str(src),
                str(audio_path),
                state.get("start_offset", 0.0),
            ),
            asyncio.to_thread(_safe_thumb),
        )
        audio_duration = probe_duration(str(audio_path))

        state["status"] = "transcribing"
        write_job(state)
        result = await transcribe(
            str(audio_path),
            language=state["language"],
            prompt=state.get("prompt"),
            user_key=user_key,
            user_provider=user_provider,
            user_model=user_model,
        )

        # Build subtitle segments. Gemini returns flat words → build from
        # scratch; other providers return native segments → use the legacy
        # punctuation splitter with proportional timing.
        if "words" in result:
            words = _repair_collapsed_word_timestamps(result["words"], audio_duration)
            segments = _build_segments_from_words(words)
        else:
            segments = _split_at_natural_boundaries(result.get("segments", []))
        offset = float(state.get("start_offset") or 0.0)
        if offset:
            segments = [
                {**s, "start": s["start"] + offset, "end": s["end"] + offset}
                for s in segments
            ]

        state["status"] = "ready"
        state["language"] = result["language"]
        state["segments"] = segments
        # segments_original holds the Gemini-pristine values for the
        # "Reset all" affordance in the sidebar. Only written once, here;
        # PATCH /jobs/{id} never touches it. If we're re-running the
        # pipeline on an existing job, preserve any prior original so
        # earlier edits can still be reverted to the true first cut.
        if "segments_original" not in state:
            state["segments_original"] = segments
        write_job(state)

        # audio.wav was a transcription scratchpad — Gemini got its own mp3,
        # other providers consumed the wav directly. After success it's dead
        # weight (~2 MB/min of audio). Safe to drop now. Best-effort delete:
        # ignore if it was never written or was already cleaned.
        try:
            audio_path.unlink(missing_ok=True)
        except OSError:
            pass
    except Exception as e:
        # Re-read state in case write_job above succeeded for the failure point.
        state = read_job(job_id) or state
        state["status"] = "failed"
        state["error"] = str(e)
        write_job(state)
        raise


def _repair_collapsed_word_timestamps(
    words: list[dict],
    audio_duration: float,
) -> list[dict]:
    """When Gemini returns per-word timestamps clustered into a tiny window
    (a known failure mode for sung audio), redistribute word timings
    uniformly across the real audio duration. Word order, text, speaker,
    is_song, and phrase_end are preserved — only `start` and `end` change.

    No-op when timestamps already span a reasonable fraction of the audio.
    """
    if not words or audio_duration <= 0:
        return words
    span = max(w["end"] for w in words) - min(w["start"] for w in words)
    if span >= audio_duration * _COLLAPSED_SPAN_RATIO:
        return words

    # Collapsed — redistribute. Each word gets an equal slot. We keep all
    # other fields (speaker, is_song, phrase_end) verbatim.
    n = len(words)
    slot = audio_duration / n
    repaired: list[dict] = []
    for i, w in enumerate(words):
        nw = dict(w)
        nw["start"] = round(i * slot, 3)
        nw["end"] = round((i + 1) * slot, 3)
        repaired.append(nw)
    print(
        f"[pipeline] collapsed timestamps detected "
        f"(model span={span:.2f}s, audio={audio_duration:.2f}s); "
        f"redistributed {n} words uniformly.",
        flush=True,
    )
    return repaired


def _build_segments_from_words(words: list[dict]) -> list[dict]:
    """Build subtitle segments from a flat word list (Gemini's output shape).

    Steps:
      1. Group consecutive words by (speaker, is_song) into regions.
      2. Convert each region: songs stay whole; speech gets chunked by
         `_chunk_words` (punctuation, conjunctions, adaptive gap, 3-word cap).
      3. Aalaap-fill between consecutive is_song segments — extend each
         song segment's `end` to the next segment's `start` so held vowels
         remain on screen. The final song segment is NOT extended; its end
         is the last word's actual `end` (trusting Gemini's per-word timing).
    """
    if not words:
        return []

    # 1. Region grouping
    regions: list[dict] = []
    current: dict | None = None
    for w in words:
        key = (w.get("speaker"), bool(w.get("is_song")))
        if current is None or key != (current["speaker"], current["is_song"]):
            current = {"speaker": key[0], "is_song": key[1], "words": [w]}
            regions.append(current)
        else:
            current["words"].append(w)

    # 2. Region → segments
    out: list[dict] = []
    for region in regions:
        ws = region["words"]
        # Songs: gap-only chunking (one segment per lyrical line). No
        # punctuation/conjunction/word-cap rules — lyrics flow as whole
        # lines and held vowels are inside word end times. Speech: full
        # natural-boundary rules + 3-word cap.
        chunks = _chunk_words_by_phrase_end(ws) if region["is_song"] else _chunk_words(ws)
        for chunk in chunks:
            out.append({
                "start": chunk[0]["start"],
                "end": chunk[-1]["end"],
                "text": " ".join(w["text"] for w in chunk).strip(),
                "speaker": region["speaker"],
                "is_song": region["is_song"],
                "words": chunk,
            })

    # 3. Aalaap fill — extend ONLY line-end song chunks (those whose final
    # word has phrase_end=true). Intra-line sub-chunks keep their natural
    # tight end-times so they flow into the next sub-chunk without lingering
    # past the next subtitle's appearance.
    for i in range(len(out) - 1):
        if not out[i].get("is_song"):
            continue
        last_word = out[i]["words"][-1] if out[i].get("words") else None
        if not (last_word and last_word.get("phrase_end")):
            continue
        if out[i + 1]["start"] > out[i]["end"]:
            out[i]["end"] = out[i + 1]["start"]
    return out


def _balanced_cap_split(line: list[dict], cap: int) -> list[list[dict]]:
    """Split a single line into ceil(N/cap) balanced sub-chunks of <= `cap`
    words. Earlier chunks absorb the remainder so we never produce orphan
    tail words: 5 → 3+2, 7 → 3+2+2, 8 → 3+3+2.
    """
    n = len(line)
    if n <= cap:
        return [line]
    num_chunks = (n + cap - 1) // cap   # ceil(n / cap)
    base, extra = divmod(n, num_chunks)
    sub: list[list[dict]] = []
    i = 0
    for k in range(num_chunks):
        size = base + (1 if k < extra else 0)
        sub.append(line[i : i + size])
        i += size
    return sub


def _split_at_natural_boundaries(segments: list[dict]) -> list[dict]:
    """Re-chunk each segment at boundaries detected from real word timing.

    For each segment that carries a `words` array, group words into chunks at:
      (a) word-end punctuation `, . ? ! ; ।` (digit / abbreviation guarded), or
      (b) inter-word gaps above max(GAP_MULTIPLIER × median, GAP_FLOOR_SEC).

    Sub-segment timing is taken directly from word timestamps. Segments
    without a `words` array fall back to proportional punctuation splitting.
    """
    out: list[dict] = []
    for s in segments:
        if not (s.get("text") or "").strip():
            continue
        # Song segments pass through untouched — Gemini handles musical-line
        # boundaries and aalaap/melisma end times. Splitting a sung lyric at
        # a punctuation mark or word gap would break musical phrasing.
        if s.get("is_song"):
            out.append(s)
            continue
        words = s.get("words") or []
        if not words:
            out.extend(_split_at_punctuation_proportional(s))
            continue
        chunks = _chunk_words(words)
        if len(chunks) <= 1:
            out.append(s)
            continue
        speaker = s.get("speaker")
        for chunk in chunks:
            sub = {
                "start": chunk[0]["start"],
                "end": chunk[-1]["end"],
                "text": " ".join(w["text"] for w in chunk).strip(),
                "words": chunk,
            }
            if speaker:
                sub["speaker"] = speaker
            out.append(sub)
    return out


def _chunk_words_by_phrase_end(words: list[dict]) -> list[list[dict]]:
    """Chunk words at Gemini-emitted lyrical-line boundaries, then subdivide
    each line into balanced sub-chunks of at most `_MAX_WORDS_PER_CHUNK`
    words so a long line displays as multiple subtitles.

    Gemini marks `phrase_end=true` on the last word of each natural display
    phrase (lyrical line). Inside each such line, we apply a balanced cap:
    a 5-word line becomes 3+2 (not 5 at once); a 7-word line becomes 3+2+2
    (not 3+3+1 — front-loaded balanced split avoids orphan tail words).
    Falls back to adaptive gap detection if Gemini omitted phrase_end on
    every word (e.g., older model response).
    """
    if len(words) <= 1:
        return [words]
    has_phrase_end = any(w.get("phrase_end") for w in words)
    if has_phrase_end:
        chunks: list[list[dict]] = []
        bucket: list[dict] = []
        for w in words:
            bucket.append(w)
            if w.get("phrase_end"):
                chunks.extend(_balanced_cap_split(bucket, _MAX_WORDS_PER_CHUNK))
                bucket = []
        if bucket:
            chunks.extend(_balanced_cap_split(bucket, _MAX_WORDS_PER_CHUNK))
        return chunks

    # Fallback: adaptive gap detection — held-vowel pauses between lines
    # create gaps well above the song's median intra-line word gap.
    gaps = [
        max(0.0, words[i + 1]["start"] - words[i]["end"])
        for i in range(len(words) - 1)
    ]
    nonzero = [g for g in gaps if g > 0]
    median_gap = statistics.median(nonzero) if nonzero else 0.0
    threshold = max(median_gap * _GAP_MULTIPLIER, _GAP_FLOOR_SEC)

    split_after = {i for i, g in enumerate(gaps) if g > threshold}
    if not split_after:
        return [words]
    chunks = []
    start = 0
    for end_idx in sorted(split_after):
        chunks.append(words[start : end_idx + 1])
        start = end_idx + 1
    if start < len(words):
        chunks.append(words[start:])
    return chunks


def _chunk_words(words: list[dict]) -> list[list[dict]]:
    """Group consecutive words into sub-chunks. Splits AFTER word i when:
      - word i ends in a phrase-ending punctuation (with guards), OR
      - the gap to word i+1 is unusually long for this segment.
    """
    if len(words) <= 1:
        return [words]

    # Inter-word gaps (clamped at 0 — Gemini sometimes returns slightly
    # overlapping word boundaries).
    gaps = [
        max(0.0, words[i + 1]["start"] - words[i]["end"])
        for i in range(len(words) - 1)
    ]
    nonzero = [g for g in gaps if g > 0]
    median_gap = statistics.median(nonzero) if nonzero else 0.0
    threshold = max(median_gap * _GAP_MULTIPLIER, _GAP_FLOOR_SEC)

    split_after: set[int] = set()
    for i in range(len(words) - 1):
        if words[i].get("phrase_end"):
            split_after.add(i)
            continue
        if _word_ends_phrase(words[i]["text"], words[i + 1]["text"]):
            split_after.add(i)
            continue
        if _is_conjunction(words[i + 1]["text"]):
            split_after.add(i)
            continue
        if gaps[i] > threshold:
            split_after.add(i)

    # Stylistic cap: walk each natural chunk and add an intermediate split
    # every _MAX_WORDS_PER_CHUNK words so no displayed subtitle exceeds the
    # cap. We snapshot the natural split points and the final-word index,
    # then sub-divide any chunk longer than the cap. Mutating split_after
    # during this loop is safe because we iterate the snapshot.
    natural_breaks = sorted(split_after) + [len(words) - 1]
    chunk_start = 0
    for break_at in natural_breaks:
        pos = chunk_start
        while break_at - pos >= _MAX_WORDS_PER_CHUNK:
            split_after.add(pos + _MAX_WORDS_PER_CHUNK - 1)
            pos += _MAX_WORDS_PER_CHUNK
        chunk_start = break_at + 1

    if not split_after:
        return [words]

    chunks: list[list[dict]] = []
    start = 0
    for end_idx in sorted(split_after):
        chunks.append(words[start : end_idx + 1])
        start = end_idx + 1
    if start < len(words):
        chunks.append(words[start:])
    return chunks


def _word_ends_phrase(word_text: str, next_word_text: str) -> bool:
    """True if `word_text` ends with phrase-ending punctuation that should
    split the phrase. Applies two content-based guards:
      - numeric continuation: `,` / `.` followed by a next word starting
        with a digit (e.g., "10," → "000") — don't split.
      - short-prefix abbreviation: trailing `.` after a letter run of 1-3
        ASCII alpha chars (e.g., "Mr.", "U.S.") — don't split.
    """
    text = word_text.rstrip()
    if not text:
        return False
    last = text[-1]
    if last not in _END_PUNCT:
        return False
    if last in ".,":
        nxt = (next_word_text or "").lstrip()
        if nxt and nxt[0].isdigit():
            return False
    if last == "." and _is_abbreviation_period(text, len(text) - 1):
        return False
    return True


def _is_conjunction(word_text: str) -> bool:
    """True if `word_text` (stripped of attached punctuation) matches a
    coordinating conjunction in any supported language. Used to force a
    split BEFORE such words when the speaker delivered a long fluent
    sentence without an internal pause for the gap detector to catch.
    """
    bare = (word_text or "").strip().strip(".,?!;।").strip()
    if not bare:
        return False
    return bare.lower() in _CONJUNCTIONS_LATIN or bare in _CONJUNCTIONS_INDIC


def _split_at_punctuation_proportional(segment: dict) -> list[dict]:
    """Fallback for ASR providers that do not return word-level timing.
    Splits the segment's text at punctuation and distributes time
    proportionally across the resulting phrases by grapheme count.
    """
    text = (segment.get("text") or "").strip()
    if not text:
        return []
    phrases = split_transcript(text, max_words=10**9)
    if len(phrases) <= 1:
        return [segment]
    return distribute_phrases(phrases, float(segment["start"]), float(segment["end"]))
