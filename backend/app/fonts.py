"""On-disk font cache for the FFmpeg/libass burn-in path.

The in-browser preview loads the eight display faces from Google Fonts via
CSS, but the burned-in mp4 is composited by libass on the server. libass
resolves Fontname → file via fontconfig — if a system doesn't have a font
installed (typical for Hostinger Ubuntu, sometimes for macOS), libass falls
back silently and the burn looks different from the preview.

To make the burn WYSIWYG we ship a curated set of TTFs under
`backend/data/fonts/` and pass that directory to libass with the `fontsdir=`
filter argument (see `video_worker.burn_subtitles`).

The fonts are NOT committed to the repo (`backend/data/` is gitignored).
Instead `ensure_fonts_present()` downloads any missing files on first server
startup. Sources are stable raw URLs from the upstream google/fonts repo;
all listed faces are SIL OFL licensed and free to redistribute.
"""

import urllib.request
from pathlib import Path

FONTS_DIR = Path(__file__).resolve().parent.parent / "data" / "fonts"

# (filename, source URL). Filename is what we save the file as locally;
# libass reads the family + style names from the TTF metadata. All sourced
# from github.com/google/fonts where each family is stored under
# ofl/<family>/static/.
_DOWNLOADS: list[tuple[str, str]] = [
    # Latin display fonts (the DesignControls dropdown). Variable fonts
    # carry every weight (Regular..Black, etc.) in a single file; libass
    # selects the requested face via standard fontconfig matching.
    (
        "Montserrat-VariableFont.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf",
    ),
    (
        "Anton-Regular.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf",
    ),
    (
        "Poppins-ExtraBold.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-ExtraBold.ttf",
    ),
    # Indic display / fallback (Devanagari + Gujarati capable).
    (
        "Teko-VariableFont.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/teko/Teko%5Bwght%5D.ttf",
    ),
    (
        "Baloo2-VariableFont.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/baloo2/Baloo2%5Bwght%5D.ttf",
    ),
    (
        "MuktaVaani-ExtraBold.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/muktavaani/MuktaVaani-ExtraBold.ttf",
    ),
    (
        "Mukta-ExtraBold.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/mukta/Mukta-ExtraBold.ttf",
    ),
    (
        "RozhaOne-Regular.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/rozhaone/RozhaOne-Regular.ttf",
    ),
    (
        "Rasa-VariableFont.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/rasa/Rasa%5Bwght%5D.ttf",
    ),
    # Universal fallback for Devanagari + Gujarati scripts. libass uses
    # these when the chosen display font lacks Indic glyph coverage.
    (
        "NotoSansDevanagari-Regular.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansdevanagari/NotoSansDevanagari%5Bwdth%2Cwght%5D.ttf",
    ),
    (
        "NotoSansGujarati-Regular.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansgujarati/NotoSansGujarati%5Bwdth%2Cwght%5D.ttf",
    ),
]


def ensure_fonts_present(timeout_sec: float = 10.0) -> tuple[int, int]:
    """Download any missing fonts into FONTS_DIR. Idempotent — files that
    already exist on disk are skipped, so the cost is one-time on the very
    first server boot.

    Each download has its own timeout; failures are logged but do not raise.
    libass will fall back to system fontconfig for anything that didn't make
    it to disk, so partial success still gives some burns.

    Returns (downloaded_count, failed_count) for visibility in the boot log.
    """
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    failed = 0
    for name, url in _DOWNLOADS:
        path = FONTS_DIR / name
        if path.exists() and path.stat().st_size > 0:
            continue
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "AutoSub-FontBundler/1.0"},
            )
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                data = resp.read()
            if not data:
                raise ValueError("empty response body")
            path.write_bytes(data)
            downloaded += 1
            print(f"[fonts] downloaded {name} ({len(data) / 1024:.0f} KB)", flush=True)
        except Exception as e:
            failed += 1
            print(f"[fonts] WARNING: failed to fetch {name}: {e}", flush=True)
            # Remove any partial file so the next boot retries cleanly.
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
    return downloaded, failed
