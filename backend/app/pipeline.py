"""The transcription pipeline as a single async function.

Shared between two callers:
    1. main.py — runs inline inside /upload when CELERY_ENABLED=false (dev).
    2. tasks.py — runs inside a Celery worker when CELERY_ENABLED=true (prod).

The job state document is persisted to disk between each phase so any frontend
poll of GET /jobs/{id} sees the live status (`extracting` → `transcribing` →
`ready` / `failed`).

Segment LENGTH and TIMING are decided by the ASR provider — the Gemini prompt
instructs the model to drive boundaries from the audio's own rhythm and to
return per-word timestamps. After ASR, this pipeline re-chunks each segment at
**natural boundaries** using two data-driven signals:

  (a) punctuation at word endings (`, . ? ! ; ।`), with digit and
      short-prefix-abbreviation guards so `1.4`, `10,000`, `Mr.`, `U.S.` stay
      inside one chunk.
  (b) **inter-word gaps** that are unusually long for the speaker's pace —
      defined adaptively as max(1.5× the segment's median word gap, 0.2 sec).
      The multiplier scales with the speaker; the floor prevents splits on
      micro-variations in tight speech.

Sub-segment start/end times come directly from real word timestamps — no
proportional approximation. Segments lacking word-level data (non-Gemini ASR)
fall back to text-only punctuation splitting with proportional timing.
"""

import statistics
from pathlib import Path

from .storage import read_job, write_job
from .video_worker import extract_audio, probe_duration
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
        extract_audio(str(src), str(audio_path), start_offset=state.get("start_offset", 0.0))

        state["status"] = "transcribing"
        write_job(state)
        audio_duration = probe_duration(str(audio_path))
        result = await transcribe(
            str(audio_path),
            language=state["language"],
            prompt=state.get("prompt"),
            user_key=user_key,
            user_provider=user_provider,
            user_model=user_model,
        )

        # Re-chunk at natural boundaries (punctuation + adaptive word-gap)
        # for speech; pass songs through. Then extend each song segment's end
        # to the next segment's start (or to audio end for the last) so the
        # held vowel / aalaap stays on screen — Gemini under-reports song
        # segment.end despite prompt guidance.
        segments = _split_at_natural_boundaries(result["segments"])
        segments = _fill_song_aalaap_gaps(segments, audio_duration)
        offset = float(state.get("start_offset") or 0.0)
        if offset:
            segments = [
                {**s, "start": s["start"] + offset, "end": s["end"] + offset}
                for s in segments
            ]

        state["status"] = "ready"
        state["language"] = result["language"]
        state["segments"] = segments
        write_job(state)
    except Exception as e:
        # Re-read state in case write_job above succeeded for the failure point.
        state = read_job(job_id) or state
        state["status"] = "failed"
        state["error"] = str(e)
        write_job(state)
        raise


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


def _fill_song_aalaap_gaps(segments: list[dict], audio_end: float) -> list[dict]:
    """Extend each `is_song` segment's `end` to the next segment's `start`
    (or to `audio_end` for the last segment), so a held vowel / aalaap after
    the last word remains on screen until the next line begins.

    No threshold — every gap after a song segment is filled. Speech segments
    are untouched: their end times reflect actual speaking and a real pause
    between speech segments is correctly shown as no subtitle. This is a
    content rule keyed on the `is_song` flag, not a numeric heuristic.
    """
    if not segments:
        return segments
    out = [dict(s) for s in segments]
    for i, s in enumerate(out):
        if not s.get("is_song"):
            continue
        next_start = out[i + 1]["start"] if i + 1 < len(out) else audio_end
        if next_start > s["end"]:
            s["end"] = next_start
    return out


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
