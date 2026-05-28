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


def read_job(job_id: str, user_id: str | None = None) -> dict | None:
    """Read a job's state file. When `user_id` is provided, returns None for
    jobs owned by a different user — same as if the job didn't exist. This
    is the per-user isolation seam: API handlers always pass user_id, the
    pipeline / cleanup code passes None (privileged read).
    """
    p = job_path(job_id)
    if not p.exists():
        return None
    state = json.loads(p.read_text())
    if user_id is not None and state.get("user_id") not in (user_id, None):
        # Owned by someone else. Pretend it doesn't exist.
        return None
    return state


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_jobs(limit: int = 20, user_id: str | None = None) -> list[dict]:
    """Return a compact summary of the most-recent `limit` jobs owned by
    `user_id` (or all jobs if user_id is None — used by background tasks).

    Sorted newest-first by file mtime. Each item is small enough to render
    in a dropdown menu — no segments, no transcripts, just enough to
    identify the job. Malformed JSON files are skipped silently.
    """
    if not JOBS.exists():
        return []
    # We oversample by 3× before filtering by user_id so users with many
    # jobs interleaved with other users' jobs still get a full page.
    # Acceptable for current scale; revisit if we cross 1k jobs/user.
    scan_limit = max(1, limit) * 3 if user_id is not None else max(1, limit)
    paths = sorted(
        JOBS.glob("*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )[:scan_limit]
    out: list[dict] = []
    for p in paths:
        try:
            state = json.loads(p.read_text())
        except Exception:
            continue
        if user_id is not None and state.get("user_id") not in (user_id, None):
            continue
        out.append({
            "id": state.get("id"),
            "filename": state.get("filename"),
            "created_at": state.get("created_at"),
            "status": state.get("status"),
            "language": state.get("language"),
            "num_segments": len(state.get("segments") or []),
        })
        if len(out) >= limit:
            break
    return out


def cleanup_old_jobs(retention_days: int) -> int:
    """Delete every job whose state file is older than `retention_days`.

    Uses the JSON file's mtime as the age signal — so opening / re-rendering
    a job (any write to its state) effectively resets the clock. Returns the
    number of jobs deleted. A retention_days <= 0 disables cleanup entirely
    (returns 0 without scanning).

    Reuses delete_job() so the source video + derived audio + burned mp4
    all go in one operation.
    """
    import time
    if retention_days <= 0 or not JOBS.exists():
        return 0
    cutoff = time.time() - retention_days * 86400
    removed = 0
    for path in JOBS.glob("*.json"):
        try:
            if path.stat().st_mtime < cutoff:
                # job_id is the filename stem
                delete_job(path.stem)
                removed += 1
        except OSError:
            # File raced with another delete or got corrupted — skip and move on.
            continue
    return removed


def claim_orphan_jobs(user_id: str) -> int:
    """Assign every job that has no `user_id` to the given user. Used as a
    one-shot when the first real user signs up — jobs created before auth
    existed have no owner; this hands them over so the user's history
    doesn't start empty.

    Returns the number of jobs claimed. Idempotent on subsequent runs
    (jobs that already have a user_id are skipped).
    """
    if not JOBS.exists():
        return 0
    claimed = 0
    for path in JOBS.glob("*.json"):
        try:
            state = json.loads(path.read_text())
        except Exception:
            continue
        if state.get("user_id"):
            continue
        state["user_id"] = user_id
        path.write_text(json.dumps(state, indent=2))
        claimed += 1
    return claimed


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
