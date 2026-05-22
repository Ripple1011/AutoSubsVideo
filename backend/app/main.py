"""FastAPI entry point for AutoSub.

Handlers stay thin: validate, persist, dispatch to Celery via tasks.py.
No FFmpeg/MoviePy/ASR work runs inside request threads.
"""

import shutil
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import get_settings
from .storage import (
    ALLOWED_EXTENSIONS,
    delete_job,
    list_jobs,
    new_job_id,
    now_iso,
    read_job,
    upload_dir,
    write_job,
)
from .pipeline import run_pipeline
from .whisper_client import resolve_credentials, PROVIDER_MODELS

app = FastAPI(title="AutoSub API")

# Dev: Vite proxy handles same-origin in normal use, but allow direct calls
# from 5173 too in case anyone hits the API without the proxy.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Liveness probe + ASR config summary (no secrets returned)."""
    settings = get_settings()
    return {
        "status": "ok",
        "server_default_provider": settings.asr_provider,
        "server_default_model": settings.asr_model,
        "server_has_groq_key": bool(settings.groq_api_key),
        "server_has_openai_key": bool(settings.openai_api_key),
        "server_has_sarvam_key": bool(settings.sarvam_api_key),
        "server_has_gemini_key": bool(settings.gemini_api_key),
        "supported_providers": sorted(PROVIDER_MODELS.keys()),
        "provider_models": PROVIDER_MODELS,
    }


@app.post("/asr/check")
async def asr_check(
    x_user_asr_key: str | None = Header(default=None),
    x_user_asr_provider: str | None = Header(default=None),
    x_user_asr_model: str | None = Header(default=None),
):
    """Resolve credentials using BYOK→env precedence and report which side won.

    Used by the frontend Settings modal's "Test Connection" button to confirm
    the wiring works without burning an actual transcription call.
    """
    provider, model, _api_key = resolve_credentials(
        x_user_asr_key, x_user_asr_provider, x_user_asr_model,
    )
    return {
        "ok": True,
        "resolved_provider": provider,
        "resolved_model": model,
        "key_source": "user_header" if x_user_asr_key else "server_env",
    }


@app.post("/upload")
async def upload(
    file: UploadFile = File(...),
    language: str = Form("auto"),
    prompt: str = Form(""),
    start_offset: float = Form(0.0),
    x_user_asr_key: str | None = Header(default=None),
    x_user_asr_provider: str | None = Header(default=None),
    x_user_asr_model: str | None = Header(default=None),
):
    """Accept .mp4/.mov, persist to disk, register job, enqueue pipeline.

    BYOK headers (when present) override server .env defaults downstream.
    Returns: { job_id }.
    """
    # Validate credentials up front so the user fails fast — don't write the
    # file to disk if their key/provider combo is invalid.
    resolve_credentials(x_user_asr_key, x_user_asr_provider, x_user_asr_model)

    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}.",
        )

    job_id = new_job_id()
    target = upload_dir(job_id) / f"source{ext}"
    with target.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    state = {
        "id": job_id,
        "status": "queued",
        "language": language,
        "prompt": prompt or None,
        "start_offset": max(0.0, float(start_offset)),
        "filename": file.filename,
        "created_at": now_iso(),
        "segments": [],
        "error": None,
    }
    write_job(state)

    settings = get_settings()
    if settings.celery_enabled:
        # Dispatch to the worker; /upload returns instantly. Frontend polls
        # /jobs/{id} until status reaches 'ready' or 'failed'.
        from .tasks import transcribe_job_task
        transcribe_job_task.delay(
            job_id, str(target),
            x_user_asr_key, x_user_asr_provider, x_user_asr_model,
        )
        return {"job_id": job_id}

    # Inline fallback (dev / no-Redis): run the pipeline in-process.
    try:
        await run_pipeline(
            job_id, str(target),
            x_user_asr_key, x_user_asr_provider, x_user_asr_model,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {e}")

    return {"job_id": job_id}


@app.get("/jobs")
async def list_recent_jobs(limit: int = 20):
    """Recent jobs for the Recent Videos picker. Newest first, capped at
    `limit` (default 20). Each entry is a compact summary — no segments.
    """
    return list_jobs(limit)


@app.delete("/jobs/{job_id}")
async def delete_existing_job(job_id: str):
    """Remove a job's state file + entire upload folder (source video and
    derived audio). Idempotent: 200 even if the job was already gone.
    """
    existed = delete_job(job_id)
    return {"ok": True, "existed": existed}


@app.get("/jobs/{job_id}")
async def job_status(job_id: str):
    """Poll job state + transcription JSON when ready."""
    state = read_job(job_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return state


@app.get("/jobs/{job_id}/video")
async def job_video(job_id: str):
    """Stream the original uploaded video file for a job. Used by the
    frontend to restore the workspace after a page refresh — the segments
    already live in the job JSON, but the <video> element needs a URL
    pointing at the source bytes.
    """
    state = read_job(job_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    folder = upload_dir(job_id)
    # Source files land at `source.<ext>` where ext was the original upload
    # suffix; pick whichever allowed extension exists on disk.
    candidates = [
        p for p in folder.glob("source.*")
        if p.suffix.lower() in ALLOWED_EXTENSIONS
    ]
    if not candidates:
        raise HTTPException(
            status_code=404,
            detail=f"Source video missing for job '{job_id}'.",
        )
    return FileResponse(candidates[0])


@app.post("/export/soft")
async def export_soft(job_id: str, fmt: str = "srt"):
    """Bundle original video + .srt/.vtt sidecar. No worker dispatch."""
    raise NotImplementedError


@app.post("/export/hard")
async def export_hard(job_id: str, style_schema: dict):
    """Enqueue Celery burn_subtitles task with frontend style schema."""
    raise NotImplementedError
