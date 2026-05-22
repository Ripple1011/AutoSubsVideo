"""Cloud ASR client — single entry point for transcription.

Hybrid key resolution (per CLAUDE.md §4.3):
    user header > server .env > 400 error.

Supported providers:
    groq, openai   — OpenAI-compatible /audio/transcriptions endpoint.
    sarvam         — India-specific ASR, best for Hindi / Gujarati / Indic.

No local model inference. No torch. Cloud only.
"""

import asyncio
from pathlib import Path

import httpx
from fastapi import HTTPException

from .config import get_settings
from .video_worker import chunk_audio

VALID_PROVIDERS = {"groq", "openai", "sarvam", "gemini"}

# Provider-scoped model whitelist. Frontend dropdown is filtered by this.
# Gemini: 2.5-flash is the default; 2.5-pro is highest accuracy; flash-lite is cheapest.
# Sarvam: `saarika:v2.5` is current best; `saarika:flash` is faster/cheaper.
PROVIDER_MODELS: dict[str, list[str]] = {
    "groq": ["whisper-large-v3", "whisper-large-v3-turbo"],
    "openai": ["whisper-1"],
    "sarvam": ["saarika:v2.5", "saarika:v2", "saarika:flash"],
    "gemini": [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.5-flash-lite",
        "gemini-3.1-flash-lite",
    ],
}

# Whisper-style providers share the OpenAI-compatible contract.
WHISPER_ENDPOINTS = {
    "groq": "https://api.groq.com/openai/v1/audio/transcriptions",
    "openai": "https://api.openai.com/v1/audio/transcriptions",
}
SARVAM_ENDPOINT = "https://api.sarvam.ai/speech-to-text"
GEMINI_GENERATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
GEMINI_UPLOAD = "https://generativelanguage.googleapis.com/upload/v1beta/files"

# Sarvam expects BCP-47 codes; UI uses 2-letter ISO. Map across.
# 'unknown' tells Sarvam to auto-detect.
SARVAM_LANG_MAP = {
    "auto": "unknown",
    "en": "en-IN",
    "hi": "hi-IN",
    "gu": "gu-IN",
}


def resolve_credentials(
    user_key: str | None,
    user_provider: str | None,
    user_model: str | None,
) -> tuple[str, str, str]:
    """Return (provider, model, api_key) using BYOK→env precedence.

    Raises HTTPException(400) when neither side supplies a usable key,
    or when the requested provider/model pairing is invalid.
    """
    settings = get_settings()

    provider = (user_provider or settings.asr_provider or "").lower()
    if provider not in VALID_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown ASR provider '{provider}'. Expected one of {sorted(VALID_PROVIDERS)}.",
        )

    model = user_model or settings.asr_model
    if model not in PROVIDER_MODELS[provider]:
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model}' is not valid for provider '{provider}'. "
                   f"Choose one of {PROVIDER_MODELS[provider]}.",
        )

    if user_key:
        api_key = user_key
    elif provider == "groq":
        api_key = settings.groq_api_key
    elif provider == "openai":
        api_key = settings.openai_api_key
    elif provider == "sarvam":
        api_key = settings.sarvam_api_key
    else:  # gemini
        api_key = settings.gemini_api_key

    if not api_key:
        raise HTTPException(
            status_code=400,
            detail=f"No API key available for provider '{provider}'. "
                   "Supply X-User-ASR-Key header or set the server .env key.",
        )

    return provider, model, api_key


async def transcribe(
    audio_path: str,
    language: str = "auto",
    prompt: str | None = None,
    user_key: str | None = None,
    user_provider: str | None = None,
    user_model: str | None = None,
) -> dict:
    """Dispatch to the resolved provider's transcription endpoint.

    Output shape varies by provider:
      • Gemini → { language, words: [{ text, start, end, speaker, is_song }] }
        Flat word list — pipeline.py builds subtitle segments from this.
      • Groq / OpenAI / Sarvam → { language, segments: [{ start, end, text }] }
        Native segment shape — pipeline.py uses these directly.

    The caller (pipeline.run_pipeline) detects which shape is present.
    """
    provider, model, api_key = resolve_credentials(user_key, user_provider, user_model)

    if provider in WHISPER_ENDPOINTS:
        return await _transcribe_whisper(provider, model, api_key, audio_path, language, prompt)
    if provider == "sarvam":
        return await _transcribe_sarvam(model, api_key, audio_path, language, prompt)
    if provider == "gemini":
        return await _transcribe_gemini(model, api_key, audio_path, language, prompt)
    raise HTTPException(status_code=500, detail=f"No dispatcher for provider '{provider}'.")


async def _transcribe_whisper(
    provider: str,
    model: str,
    api_key: str,
    audio_path: str,
    language: str,
    prompt: str | None,
) -> dict:
    """OpenAI-compatible multipart call (Groq + OpenAI)."""
    data = {
        "model": model,
        "response_format": "verbose_json",
        "timestamp_granularities[]": "segment",
    }
    if language and language != "auto":
        data["language"] = language
    if prompt:
        data["prompt"] = prompt

    path = Path(audio_path)
    with path.open("rb") as fh:
        files = {"file": (path.name, fh, "audio/wav")}
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                WHISPER_ENDPOINTS[provider],
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files=files,
            )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"{provider} transcription failed ({resp.status_code}): {resp.text[:400]}",
        )
    payload = resp.json()
    segments = [
        {
            "start": float(seg.get("start", 0.0)),
            "end": float(seg.get("end", 0.0)),
            "text": (seg.get("text") or "").strip(),
        }
        for seg in payload.get("segments", [])
    ]
    return {"language": payload.get("language", language), "segments": segments}


async def _transcribe_sarvam(
    model: str,
    api_key: str,
    audio_path: str,
    language: str,
    prompt: str | None,
) -> dict:
    """Sarvam /speech-to-text with client-side chunking.

    Sarvam's sync endpoint caps at 30s. We split the audio into 25s chunks,
    dispatch them in parallel via asyncio.gather, and stitch the per-chunk
    segments back with the chunk's time offset added.

    `prompt` is unused by Sarvam — included only for API parity.
    """
    del prompt
    lang_code = SARVAM_LANG_MAP.get(language, "unknown")
    chunks = chunk_audio(audio_path)

    async with httpx.AsyncClient(timeout=180.0) as client:
        # Parallel dispatch — Sarvam rate limits are generous for trial keys;
        # if we hit one, we'll surface the 429 directly to the user.
        tasks = [
            _sarvam_chunk_call(client, api_key, model, lang_code, path, offset)
            for path, offset in chunks
        ]
        results = await asyncio.gather(*tasks)

    # Hard-boundary chunks: each second of audio appears in exactly one chunk,
    # so we just concatenate per-chunk segments in order. No dedup needed.
    segments: list[dict] = []
    for chunk_segments in results:
        segments.extend(chunk_segments)
    return {"language": lang_code, "segments": segments}


async def _transcribe_gemini(
    model: str,
    api_key: str,
    audio_path: str,
    language: str,
    prompt: str | None,
) -> dict:
    """Gemini multimodal transcription with structured JSON output.

    Two HTTP calls: (1) raw-bytes upload to the Files API; (2) generateContent
    referencing the uploaded file. Times each step to stderr for diagnosis.
    """
    import subprocess
    import time
    from imageio_ffmpeg import get_ffmpeg_exe

    ffmpeg = get_ffmpeg_exe()
    src = Path(audio_path)
    mp3_path = src.with_suffix(".mp3")

    t0 = time.perf_counter()
    result = subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", str(src),
         "-vn", "-c:a", "libmp3lame", "-q:a", "9", str(mp3_path)],
        capture_output=True, text=True,
    )
    t1 = time.perf_counter()
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"ffmpeg mp3 encode failed: {result.stderr.strip()[:300]}",
        )

    mp3_size = mp3_path.stat().st_size
    print(f"[gemini] mp3 encode={t1-t0:.2f}s  mp3_size={mp3_size/1024:.0f}KB", flush=True)

    async with httpx.AsyncClient(timeout=180.0) as client:
        t2 = time.perf_counter()
        file_uri, mime = await _gemini_upload_file(client, api_key, mp3_path)
        t3 = time.perf_counter()
        print(f"[gemini] files-api upload={t3-t2:.2f}s", flush=True)

        out = await _gemini_generate(
            client, api_key, model, file_uri, mime, language, prompt,
        )
        t4 = time.perf_counter()
        print(f"[gemini] generateContent={t4-t3:.2f}s  total={t4-t0:.2f}s", flush=True)
        return out


async def _gemini_upload_file(
    client: httpx.AsyncClient, api_key: str, path: Path,
) -> tuple[str, str]:
    """Upload bytes to Gemini Files API via the resumable protocol's simple
    single-request form. Returns (file_uri, mime_type) for use in
    generateContent's fileData parts.
    """
    data = path.read_bytes()
    size = len(data)
    mime = "audio/mp3"

    # Step 1: start upload session, declare metadata.
    start = await client.post(
        GEMINI_UPLOAD,
        params={"key": api_key},
        headers={
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(size),
            "X-Goog-Upload-Header-Content-Type": mime,
            "Content-Type": "application/json",
        },
        json={"file": {"display_name": path.name}},
    )
    if start.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"gemini upload init failed ({start.status_code}): {start.text[:300]}",
        )
    upload_url = start.headers.get("X-Goog-Upload-URL") or start.headers.get("x-goog-upload-url")
    if not upload_url:
        raise HTTPException(
            status_code=502,
            detail=f"gemini upload init missing X-Goog-Upload-URL header.",
        )

    # Step 2: send the bytes + finalize.
    finalize = await client.post(
        upload_url,
        headers={
            "Content-Length": str(size),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
        },
        content=data,
    )
    if finalize.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"gemini upload bytes failed ({finalize.status_code}): {finalize.text[:300]}",
        )
    info = finalize.json().get("file", {})
    uri = info.get("uri")
    if not uri:
        raise HTTPException(
            status_code=502,
            detail=f"gemini upload returned no file uri: {finalize.text[:300]}",
        )
    return uri, info.get("mimeType", mime)


async def _gemini_generate(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    file_uri: str,
    file_mime: str,
    language: str,
    prompt: str | None,
) -> dict:
    """Call generateContent with a file reference (no inline audio bytes)."""
    import json as _json

    lang_instruction = (
        "The audio language is unspecified — detect it."
        if language in ("auto", "", None) else
        f"The audio is in {LANG_FOR_PROMPT.get(language, language)}."
    )
    extra_context = f" Context hint: {prompt}." if prompt else ""

    instruction = (
        "Transcribe this audio at the WORD level. Return a flat list of every "
        "spoken or sung word, each with its acoustic timing and speaker tag. "
        "Do NOT group words into sentences or segments — downstream code does "
        "that. " + lang_instruction + extra_context +
        "\n\nFor each word, provide:\n"
        "  • `text` — the word in the ORIGINAL script (Devanagari for Hindi, "
        "Gujarati script for Gujarati). Do NOT translate. Punctuation that "
        "naturally attaches to a word (e.g., a trailing comma or period) "
        "stays inside that word's `text` field — emit `'Modi,'` and `'sir.'` "
        "rather than separate tokens.\n"
        "  • `start` — acoustic time in seconds when the word's voicing "
        "begins, measured from the start of the audio. Timestamps MUST "
        "be grounded in real audio frames and span the FULL audio duration "
        "(do not cluster all words in the first second).\n"
        "  • `end` — acoustic time in seconds when the word's voicing STOPS. "
        "For sung words with a held vowel / sustained note / aalaap / "
        "melisma at the end, `end` must mark when the singer stops "
        "vocalizing — NOT when the last consonant is pronounced. A sung "
        "word with a 2-second held vowel has `end - start ≈ 2 seconds`.\n"
        "  • `speaker` — stable label like 'Speaker 1', 'Speaker 2', "
        "assigned in the order each distinct voice first appears. Same "
        "voice across the audio MUST get the same label. Single-voice "
        "audio: every word is 'Speaker 1'. Base it on voice timbre / "
        "pitch only, not content cues.\n"
        "  • `is_song` — `true` if the word is SUNG (melody, sustained "
        "notes, rhythm tied to a beat or musical accompaniment); `false` "
        "if SPOKEN. Be liberal — even short sung phrases or chants count.\n"
        "  • `phrase_end` — `true` if this word completes a natural display "
        "phrase. For SONGS, set true on the last word of each lyrical line "
        "(the word immediately before the singer pauses, takes a breath, or "
        "starts a held vowel before the next line). For SPEECH, set true on "
        "the last word of a sentence, clause, or major breath group "
        "(typically before a period, comma, or audible pause). The VERY LAST "
        "word in the audio MUST have `phrase_end = true`. Every other word "
        "is `false`.\n"
        "\nNumeric literals like '1.4', '10,000', '$3.99', '2025' are ONE "
        "word each — never emit them as multiple tokens split on the digit "
        "boundary."
        "\n\nSkip non-speech (opening aalaap before any lyric, instrumental "
        "passages, pure silence, breath-only) — emit NO word for these "
        "regions. The first word emitted for a song should be the first "
        "audible LYRIC, never an opening hum or vocalization."
    )

    body = {
        "contents": [{
            "parts": [
                {"text": instruction},
                {"file_data": {"mime_type": file_mime, "file_uri": file_uri}},
            ],
        }],
        "generationConfig": {
            "response_mime_type": "application/json",
            "response_schema": {
                "type": "object",
                "properties": {
                    "language": {"type": "string"},
                    "words": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string"},
                                "start": {"type": "number"},
                                "end": {"type": "number"},
                                "speaker": {"type": "string"},
                                "is_song": {"type": "boolean"},
                                "phrase_end": {"type": "boolean"},
                            },
                            "required": ["text", "start", "end", "speaker", "is_song", "phrase_end"],
                        },
                    },
                },
                "required": ["words"],
            },
            "temperature": 0.1,
        },
    }

    resp = await client.post(
        GEMINI_GENERATE.format(model=model),
        params={"key": api_key},
        json=body,
    )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"gemini transcription failed ({resp.status_code}): {resp.text[:400]}",
        )

    data = resp.json()
    try:
        text_blob = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = _json.loads(text_blob)
    except (KeyError, IndexError, _json.JSONDecodeError) as e:
        raise HTTPException(
            status_code=502,
            detail=f"gemini returned unexpected shape: {e} | preview: {str(data)[:300]}",
        )

    words = []
    for w in parsed.get("words", []):
        text = (w.get("text") or "").strip()
        if not text:
            continue
        words.append({
            "text": text,
            "start": float(w.get("start", 0.0)),
            "end": float(w.get("end", 0.0)),
            "speaker": (w.get("speaker") or "Speaker 1").strip() or "Speaker 1",
            "is_song": bool(w.get("is_song", False)),
            "phrase_end": bool(w.get("phrase_end", False)),
        })
    return {
        "language": parsed.get("language", language),
        "words": words,
    }


# Pretty names for Gemini prompts.
LANG_FOR_PROMPT = {
    "en": "English",
    "hi": "Hindi",
    "gu": "Gujarati",
}


async def _sarvam_chunk_call(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    lang_code: str,
    chunk_path: str,
    offset: float,
) -> list[dict]:
    """POST one ≤25s chunk to Sarvam; return offset-adjusted segments."""
    path = Path(chunk_path)
    with path.open("rb") as fh:
        files = {"file": (path.name, fh, "audio/wav")}
        data = {"model": model, "language_code": lang_code, "with_timestamps": "true"}
        resp = await client.post(
            SARVAM_ENDPOINT,
            headers={"api-subscription-key": api_key},
            data=data,
            files=files,
        )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"sarvam transcription failed ({resp.status_code}): {resp.text[:400]}",
        )
    chunk_segments = _sarvam_segments(resp.json())
    for s in chunk_segments:
        s["start"] += offset
        s["end"] += offset
    return chunk_segments


def _sarvam_segments(payload: dict) -> list[dict]:
    """Convert Sarvam's response into ~3-second display segments.

    Sarvam's saarika:v2.5 does not return real per-word timestamps for Hindi
    — `timestamps.words` is usually a single-element array containing the
    whole chunk transcript, with start/end spanning the full chunk. So we
    split the transcript ourselves and distribute timing proportionally
    across the resulting phrases.

    Splitting strategy: prefer punctuation boundaries (।, ?, !, ,) — they
    map to natural musical/spoken breath points. If no punctuation exists,
    fall back to fixed-size word groups. Either way, each output phrase
    gets timestamps interpolated from its character-position within the
    chunk's [start, end] range.
    """
    timestamps = payload.get("timestamps") or {}
    words_field = timestamps.get("words") or []
    starts = timestamps.get("start_time_seconds") or []
    ends = timestamps.get("end_time_seconds") or []

    transcript = (payload.get("transcript") or "").strip()
    if not transcript:
        return []

    # Determine the chunk's overall time window. We use the first start and
    # last end across whatever Sarvam returned. If timing is missing entirely,
    # fall back to a zero-length segment so dedup still has a midpoint.
    if starts and ends:
        chunk_start = float(starts[0])
        chunk_end = float(ends[-1])
    else:
        chunk_start = 0.0
        chunk_end = 0.0

    # If Sarvam genuinely DID return per-word timestamps (more than one entry
    # AND counts match the word list), honor them and bunch into 3s segments.
    real_per_word = (
        len(words_field) > 1
        and len(words_field) == len(starts) == len(ends)
    )
    if real_per_word:
        return _bunch_words_into_segments(words_field, starts, ends, max_seconds=3.0)

    phrases = split_transcript(transcript)
    return distribute_phrases(phrases, chunk_start, chunk_end)


def _bunch_words_into_segments(
    words: list[str], starts: list, ends: list, max_seconds: float
) -> list[dict]:
    segments: list[dict] = []
    buf_words: list[str] = []
    buf_start: float | None = None
    buf_end: float = 0.0
    for w, s, e in zip(words, starts, ends):
        s = float(s); e = float(e)
        if buf_start is None:
            buf_start = s
        buf_words.append(w)
        buf_end = e
        if (buf_end - buf_start) >= max_seconds:
            segments.append({"start": buf_start, "end": buf_end, "text": " ".join(buf_words)})
            buf_words, buf_start = [], None
    if buf_words and buf_start is not None:
        segments.append({"start": buf_start, "end": buf_end, "text": " ".join(buf_words)})
    return segments


# Punctuation marks that map to phrase boundaries across our supported scripts.
# `।` = Devanagari danda (Hindi/Gujarati phrase end). Latin equivalents kept too.
_PHRASE_SPLIT_PUNCT = "।.?!,;"


def _is_abbreviation_period(text: str, i: int) -> bool:
    """True if the `.` at position `i` looks like an abbreviation period
    (Mr., Dr., U.S., etc.) rather than a sentence terminator.

    Heuristic: walk backwards across ASCII letters from i-1; if the run is
    shorter than 4 characters, treat as an abbreviation. Real words ending
    sentences are almost always 4+ letters; English titles/initials are 1-3.
    """
    j = i - 1
    while j >= 0 and text[j].isascii() and text[j].isalpha():
        j -= 1
    run_len = i - 1 - j
    return 0 < run_len < 4


def split_transcript(
    text: str,
    max_words: int = 8,
    chunk_size: int = 5,
) -> list[str]:
    """Split a transcript into display-sized phrases.

    First try splitting on punctuation. If that yields phrases longer than
    `max_words`, split those further into fixed `chunk_size`-word groups.
    """
    # Walk the string; cut after each punctuation char, keeping the punct
    # attached to the preceding phrase. Guards:
    #   - Digit-between: keep "1.4", "10,000" intact (numeric literals).
    #   - Short alphabetic prefix before `.`: treat as abbreviation (Mr., Dr.,
    #     Ms., St., U.S., etc.) — period there does NOT end a phrase. A run of
    #     4+ letters before `.` is taken to be a real word ending a sentence.
    raw: list[str] = []
    buf = ""
    for i, ch in enumerate(text):
        buf += ch
        if ch in _PHRASE_SPLIT_PUNCT:
            if ch in ".," and i + 1 < len(text) and text[i + 1].isdigit():
                continue
            if ch == "." and _is_abbreviation_period(text, i):
                continue
            phrase = buf.strip()
            if phrase:
                raw.append(phrase)
            buf = ""
    tail = buf.strip()
    if tail:
        raw.append(tail)

    # If a single phrase has too many words (e.g., a sung line with no
    # punctuation), split it into fixed-size word groups.
    out: list[str] = []
    for phrase in raw:
        words = phrase.split()
        if len(words) <= max_words:
            out.append(phrase)
            continue
        for i in range(0, len(words), chunk_size):
            out.append(" ".join(words[i:i + chunk_size]))
    return out or [text]   # ensure at least one phrase


import regex as _regex


def grapheme_len(text: str) -> int:
    """Count grapheme clusters in `text` — closer to spoken length for
    Devanagari/Gujarati than Python's len() which counts each matra/anusvara
    as a separate character. `\\X` is Unicode TR29 "extended grapheme cluster"
    pattern provided by the `regex` library.
    """
    return len(_regex.findall(r"\X", text))


def distribute_phrases(
    phrases: list[str], chunk_start: float, chunk_end: float
) -> list[dict]:
    """Spread phrases proportionally across [chunk_start, chunk_end] by
    grapheme-cluster count. Each phrase gets time roughly proportional to
    its spoken length — a reasonable heuristic when no real word timings
    exist. Grapheme weighting (vs len()) prevents subtitle drift on Indic
    scripts where a word like "लाता" (4 codepoints, 2 graphemes) takes the
    same spoken time as "लव" (2 codepoints, 2 graphemes).
    """
    if not phrases:
        return []
    weights = [grapheme_len(p) for p in phrases]
    total = sum(weights) or 1
    duration = max(chunk_end - chunk_start, 0.0)

    segments: list[dict] = []
    cursor = 0
    for p, w in zip(phrases, weights):
        frac_start = cursor / total
        cursor += w
        frac_end = cursor / total
        seg_start = chunk_start + frac_start * duration
        seg_end = chunk_start + frac_end * duration
        segments.append({"start": seg_start, "end": seg_end, "text": p})
    return segments
