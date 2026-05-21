"""Filesystem layout for uploads + job state.

    backend/data/
      uploads/{job_id}/source.<ext>      # raw upload
      uploads/{job_id}/audio.wav         # extracted (later)
      jobs/{job_id}.json                 # job state document

Job state JSON shape:
    {
      "id": "...", "status": "uploaded|extracting|transcribing|ready|failed",
      "language": "auto|en|hi|gu",
      "filename": "original.mp4",
      "created_at": "iso8601",
      "segments": [{"start": 0.0, "end": 1.5, "text": "..."}],
      "error": null
    }
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

DATA_ROOT = Path(__file__).resolve().parent.parent / "data"
UPLOADS = DATA_ROOT / "uploads"
JOBS = DATA_ROOT / "jobs"

ALLOWED_EXTENSIONS = {".mp4", ".mov"}


def ensure_dirs() -> None:
    UPLOADS.mkdir(parents=True, exist_ok=True)
    JOBS.mkdir(parents=True, exist_ok=True)


def new_job_id() -> str:
    return uuid.uuid4().hex[:12]


def job_path(job_id: str) -> Path:
    return JOBS / f"{job_id}.json"


def upload_dir(job_id: str) -> Path:
    d = UPLOADS / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_job(state: dict) -> None:
    ensure_dirs()
    job_path(state["id"]).write_text(json.dumps(state, indent=2))


def read_job(job_id: str) -> dict | None:
    p = job_path(job_id)
    if not p.exists():
        return None
    return json.loads(p.read_text())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
