"""MoviePy / FFmpeg pipelines. Only ever invoked from Celery tasks (or, for
now, the synchronous pipeline in main.py while Celery is not yet wired).

Two operations:
    1. extract_audio  — lightweight, runs on intake.
    2. burn_subtitles — heavy frame rendering, hard-export path only.
"""

from pathlib import Path


def extract_audio(video_path: str, out_path: str, start_offset: float = 0.0) -> str:
    """Strip audio to a mono 16 kHz WAV — the format ASR APIs prefer.

    `start_offset` (seconds) trims that much from the beginning, used to
    skip intros / aalaap / instrumental sections. Direct FFmpeg subprocess
    avoids MoviePy's reader quirks on Windows + Python 3.13.

    Returns the output path on success.
    """
    import subprocess
    from imageio_ffmpeg import get_ffmpeg_exe

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = get_ffmpeg_exe()
    cmd = [ffmpeg, "-y", "-loglevel", "error"]
    if start_offset and start_offset > 0:
        cmd += ["-ss", f"{start_offset:.3f}"]
    cmd += [
        "-i", video_path,
        "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le",
        "-vn",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg extract_audio failed: {result.stderr.strip()}")
    return out_path


def chunk_audio(
    audio_path: str,
    chunk_seconds: float = 25.0,
) -> list[tuple[str, float]]:
    """Hard-boundary chunker for Sarvam's 30s sync cap.

    Cuts every `chunk_seconds` with NO overlap. Returns [(chunk_path, offset)].
    Each second of source audio appears in exactly one chunk → no duplicates
    can arise downstream, no text dedup needed.

    Trade-off: a word straddling a cut may be split between adjacent chunks
    and one half may transcribe poorly. In practice Sarvam (and most ASR
    models) recovers cleanly because 25s is many word-widths, and the
    artifact when it occurs is a single word at the boundary — far less
    visible than the duplicate-line bug from overlapping chunks.
    """
    import subprocess
    from imageio_ffmpeg import get_ffmpeg_exe

    src = Path(audio_path)
    ffmpeg = get_ffmpeg_exe()
    duration = _probe_duration(ffmpeg, str(src))

    if duration <= chunk_seconds:
        return [(str(src), 0.0)]

    chunks: list[tuple[str, float]] = []
    idx = 0
    offset = 0.0
    while offset < duration:
        end = min(offset + chunk_seconds, duration)
        out = src.parent / f"chunk_{idx:03d}.wav"
        cmd = [
            ffmpeg, "-y", "-loglevel", "error",
            "-ss", f"{offset:.3f}",
            "-t", f"{end - offset:.3f}",
            "-i", str(src),
            "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le",
            str(out),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg chunk failed: {result.stderr.strip()}")
        chunks.append((str(out), offset))
        offset = end
        idx += 1
    return chunks


def probe_duration(path: str) -> float:
    """Return audio/video duration in seconds. Thin public wrapper around
    `_probe_duration` for callers that don't already have an ffmpeg path.
    """
    from imageio_ffmpeg import get_ffmpeg_exe
    return _probe_duration(get_ffmpeg_exe(), path)


def _probe_duration(ffmpeg: str, path: str) -> float:
    import subprocess
    # FFmpeg prints duration to stderr; parse from the "Duration:" line.
    result = subprocess.run(
        [ffmpeg, "-i", path, "-hide_banner"],
        capture_output=True, text=True,
    )
    for line in result.stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            ts = line.split(",", 1)[0].replace("Duration:", "").strip()
            h, m, s = ts.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise RuntimeError(f"Could not read duration from ffmpeg output for {path}")


def burn_subtitles(
    video_path: str,
    segments: list[dict],
    style_schema: dict,
    out_path: str,
) -> str:
    """Render hard-burned subtitles using FFmpeg drawtext / ASS overlay.

    style_schema fields: font, text_color, outline_color, highlight_color,
    scale, vertical_alignment ("top"|"center"|"bottom").
    """
    raise NotImplementedError
