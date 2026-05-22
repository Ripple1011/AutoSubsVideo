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
    """Render hard-burned subtitles into the video via FFmpeg's `ass` filter.

    The style_schema is converted to an ASS file alongside `out_path`, then
    FFmpeg overlays it. Audio is stream-copied (`-c:a copy`) so the only
    re-encode happens on the video track. Returns `out_path` on success.

    Known caveat: the rendered font is whatever libass resolves via
    fontconfig on the host machine. If the system doesn't have the named
    font installed, libass falls back silently and the burn may differ
    slightly from the in-browser preview.
    """
    import subprocess
    from imageio_ffmpeg import get_ffmpeg_exe

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    ass_path = out.with_suffix(".ass")
    ass_path.write_text(_build_ass(segments, style_schema), encoding="utf-8")

    ffmpeg = get_ffmpeg_exe()
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-i", video_path,
        "-vf", f"ass={ass_path}",
        "-c:a", "copy",
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg burn_subtitles failed: {result.stderr.strip()[:600]}")
    return str(out)


# Per-speaker palette MUST stay in lockstep with frontend/src/lib/speakerColors.js
# so the burned video matches what the user saw in the preview canvas.
_SPEAKER_PALETTE = ["#FFE066", "#66E0FF", "#FF99CC", "#99FF99", "#FFCC66"]

# ASS alignment numpad codes (numpad layout: 1=BL, 2=BC, 3=BR, 5=center, 8=TC).
_ASS_ALIGN = {"top": 8, "center": 5, "bottom": 2}


def _build_ass(segments: list[dict], style: dict) -> str:
    """Render segments + style into an ASS (Advanced SubStation Alpha) doc.
    libass handles per-frame compositing including outline, opaque box, and
    inline color overrides. Reference resolution is 1920x1080 — libass scales
    to the actual video dimensions, so this works for any input aspect.
    """
    primary_bgr = _hex_to_ass(style.get("textColor") or "#ffffff")
    outline_bgr = _hex_to_ass(style.get("outlineColor") or "#000000")
    highlight_bgr = _hex_to_ass(style.get("highlightColor") or "#aa3bff")

    font_name = (style.get("font") or "Sans").replace(",", " ")
    # Frontend uses fontSize: `${2 * scale}rem` over a 9:16 preview. Map the
    # same multiplier onto a fixed reference size for the burn.
    scale = max(0.1, float(style.get("scale") or 1.0))
    font_size = int(round(72 * scale))

    align = _ASS_ALIGN.get(style.get("verticalAlignment"), 2)
    # BorderStyle 1: outline + shadow; 3: opaque box behind text (matches
    # the preview's highlightColor backdrop). transparent BG → no box.
    border_style = 1 if style.get("highlightTransparent") else 3

    # speakers in order of first appearance — used to look up per-speaker
    # color the same way the frontend does (first speaker keeps user color,
    # subsequent speakers cycle through the palette).
    speaker_order: list[str] = []
    for s in segments:
        sp = s.get("speaker")
        if sp and sp not in speaker_order:
            speaker_order.append(sp)

    def speaker_color_override(speaker: str | None) -> str:
        if not speaker:
            return ""
        idx = speaker_order.index(speaker) if speaker in speaker_order else -1
        if idx <= 0:
            return ""   # first speaker uses the Style's PrimaryColour
        palette_hex = _SPEAKER_PALETTE[(idx - 1) % len(_SPEAKER_PALETTE)]
        return f"{{\\c{_hex_to_ass(palette_hex)}}}"

    header = (
        "[Script Info]\n"
        "Title: AutoSub burn\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1920\n"
        "PlayResY: 1080\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{font_name},{font_size},{primary_bgr},{outline_bgr},{highlight_bgr},"
        f"1,0,0,0,100,100,0,0,{border_style},3,0,{align},40,40,80,1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    events: list[str] = []
    for s in segments:
        text = (s.get("text") or "").strip()
        if not text:
            continue
        start = _ass_time(float(s["start"]))
        end = _ass_time(float(s["end"]))
        override = speaker_color_override(s.get("speaker"))
        # ASS reserves `{`, `}`, and `\\` in dialogue text — escape them so
        # user-typed punctuation doesn't break the parser.
        safe = text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
        events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{override}{safe}")

    return header + "\n".join(events) + "\n"


def _hex_to_ass(hex_color: str) -> str:
    """`#RRGGBB` → ASS color literal `&H00BBGGRR&`. ASS colors are AABBGGRR
    with alpha first (0 = opaque). `&H...&` form is the inline-override
    syntax used in both Style definitions and `{\\c...}` mid-dialogue swaps.
    """
    h = (hex_color or "").lstrip("#")
    if len(h) != 6:
        h = "ffffff"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}&".upper()


def _ass_time(t: float) -> str:
    """Seconds → 'H:MM:SS.cc' (centiseconds) — the ASS-specific timestamp
    format. Uses integer-centisecond math to avoid rounding carry bugs at
    second boundaries.
    """
    total_cs = max(0, int(round(t * 100)))
    h, rem = divmod(total_cs, 360_000)
    m, rem = divmod(rem, 6_000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"
