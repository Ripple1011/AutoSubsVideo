"""The transcription pipeline as a single async function.

Shared between two callers:
    1. main.py — runs inline inside /upload when CELERY_ENABLED=false (dev).
    2. tasks.py — runs inside a Celery worker when CELERY_ENABLED=true (prod).

The job state document is persisted to disk between each phase so any frontend
poll of GET /jobs/{id} sees the live status (`extracting` → `transcribing` →
`ready` / `failed`).
"""

from pathlib import Path

from .storage import read_job, write_job
from .video_worker import extract_audio
from .whisper_client import transcribe


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
        result = await transcribe(
            str(audio_path),
            language=state["language"],
            prompt=state.get("prompt"),
            user_key=user_key,
            user_provider=user_provider,
            user_model=user_model,
        )

        # Shift segment timestamps back into the original video's timeline.
        offset = float(state.get("start_offset") or 0.0)
        segments = result["segments"]
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
