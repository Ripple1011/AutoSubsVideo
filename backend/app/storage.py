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


def list_jobs(limit: int = 20) -> list[dict]:
    """Return a compact summary of the most-recent `limit` jobs, sorted
    newest-first by file mtime. Each item is small enough to render in a
    dropdown menu — no segments, no transcripts, just enough to identify
    the job. Malformed JSON files are skipped silently.
    """
    if not JOBS.exists():
        return []
    paths = sorted(
        JOBS.glob("*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )[:max(1, limit)]
    out: list[dict] = []
    for p in paths:
        try:
            state = json.loads(p.read_text())
        except Exception:
            continue
        out.append({
            "id": state.get("id"),
            "filename": state.get("filename"),
            "created_at": state.get("created_at"),
            "status": state.get("status"),
            "language": state.get("language"),
            "num_segments": len(state.get("segments") or []),
        })
    return out


def delete_job(job_id: str) -> bool:
    """Remove a job's state file and its entire upload folder (source video
    + derived audio). Returns True if the job state existed before deletion,
    False if it didn't (idempotent). Filesystem errors propagate up.
    """
    import shutil
    state_path = job_path(job_id)
    folder = UPLOADS / job_id
    existed = state_path.exists()
    if folder.exists():
        shutil.rmtree(folder)
    state_path.unlink(missing_ok=True)
    return existed
