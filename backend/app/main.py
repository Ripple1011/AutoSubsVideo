"""FastAPI entry point for AutoSub.

Handlers stay thin: validate, persist, dispatch to Celery via tasks.py.
No FFmpeg/MoviePy/ASR work runs inside request threads.
"""

import shutil
from pathlib import Path

from fastapi import Depends, FastAPI, UploadFile, File, Form, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

from .auth import (
    auth_backend,
    claim_orphans_if_first_user,
    create_db_and_tables,
    current_active_user,
    fastapi_users,
    google_oauth_client,
    _jwt_secret,
)
from .config import get_settings
from .fonts import ensure_fonts_present
from .schemas import UserRead, UserCreate, UserUpdate
from .storage import (
    ALLOWED_EXTENSIONS,
    claim_orphan_jobs,
    cleanup_old_jobs,
    delete_job,
    list_jobs,
    new_job_id,
    now_iso,
    read_job,
    upload_dir,
    write_job,
)
from .pipeline import run_pipeline
from .video_worker import burn_subtitles
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


# Paths the shared-password middleware lets through without auth:
#   /health            → liveness probe / uptime monitoring
#   /jobs/{id}/video   → <video src=...> can't attach custom headers, so the
#                        random 12-char job ID is the soft secret here
#   /export/soft       → <a href> downloads, same constraint
#   /auth/*            → login routes must be reachable to log in
#   /users/me          → frontend calls this to detect login state
# Everything else requires the X-AutoSub-Password header to match
# settings.shared_password when that setting is configured.
_PUBLIC_GET_PATHS = ("/health", "/users/me")


def _is_public_request(method: str, path: str) -> bool:
    if path.startswith("/auth/"):
        return True
    if method != "GET":
        return False
    if path in _PUBLIC_GET_PATHS:
        return True
    if path.startswith("/export/soft"):
        return True
    if path.startswith("/jobs/") and (path.endswith("/video") or path.endswith("/thumb")):
        return True
    return False


@app.middleware("http")
async def shared_password_gate(request: Request, call_next):
    """Reject requests without the shared password header when the gate is
    configured. No-op when SHARED_PASSWORD is unset (localhost dev).
    """
    settings = get_settings()
    if not settings.shared_password:
        return await call_next(request)
    if _is_public_request(request.method, request.url.path):
        return await call_next(request)
    header = request.headers.get("x-autosub-password", "")
    if header != settings.shared_password:
        return JSONResponse(
            {"detail": "Unauthorized — set the AutoSub password in the prompt."},
            status_code=401,
        )
    return await call_next(request)


@app.on_event("startup")
async def startup_tasks():
    """Boot-time housekeeping:
      1. Create the users DB tables if missing (Slice 2).
      2. Eagerly ensure the JWT secret is materialized so the first request
         doesn't pay the .env-write cost.
      3. Make sure the bundled burn-in fonts are present on disk so libass
         can find them via the `fontsdir=` filter argument (see
         video_worker.burn_subtitles). Downloads are idempotent; the only
         non-zero cost is the very first server boot.
      4. Sweep stale jobs older than the configured retention window. Cheap
         and silent when nothing's stale.
    """
    settings = get_settings()
    await create_db_and_tables()
    _jwt_secret()   # generates + persists if missing
    downloaded, failed = ensure_fonts_present()
    if downloaded:
        print(
            f"[fonts] startup fetched {downloaded} font(s); {failed} failed.",
            flush=True,
        )
    removed = cleanup_old_jobs(settings.retention_days)
    if removed:
        print(
            f"[storage] startup retention sweep removed {removed} job(s) "
            f"older than {settings.retention_days} days.",
            flush=True,
        )


# ----- Auth routers --------------------------------------------------------

# /auth/login + /auth/logout — cookie-based JWT session.
app.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/auth",
    tags=["auth"],
)
# /users/me — current user profile.
app.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)
# /auth/google/authorize + /auth/google/callback — Google OAuth flow.
# Only mounted when credentials are configured. Without these, /auth/google/*
# returns 404 and the frontend's "Continue with Google" button surfaces an
# error — which is the right behavior for a misconfigured server.
if google_oauth_client is not None:
    app.include_router(
        fastapi_users.get_oauth_router(
            google_oauth_client,
            auth_backend,
            _jwt_secret(),
            redirect_url=f"{get_settings().oauth_callback_base}/auth/google/callback",
            associate_by_email=True,
            is_verified_by_default=True,
        ),
        prefix="/auth/google",
        tags=["auth"],
    )

    # The OAuth callback inside the library uses our cookie-transport, which
    # responds 204 with Set-Cookie on success. That leaves the browser
    # stranded on a blank page after the Google round-trip. This middleware
    # promotes the 2xx success response into a 302 to the configured
    # frontend URL, keeping the Set-Cookie header(s) intact so the session
    # cookie lands the same way.
    @app.middleware("http")
    async def google_callback_redirect(request: Request, call_next):
        response = await call_next(request)
        if (
            request.url.path == "/auth/google/callback"
            and request.method == "GET"
            and 200 <= response.status_code < 300
        ):
            response.status_code = 302
            response.headers["location"] = get_settings().oauth_success_redirect
        return response
else:
    print("[auth] Google OAuth NOT configured (GOOGLE_OAUTH_CLIENT_ID/SECRET unset).", flush=True)


@app.post("/users/claim-orphans", tags=["users"])
async def claim_my_orphans(user=Depends(current_active_user)):
    """One-shot endpoint the frontend can call after first login to claim
    pre-auth jobs that had no owner. Only does anything if the caller is
    the first registered user. Idempotent — returns 0 after the first run."""
    from .auth import claim_orphans_if_first_user
    n = await claim_orphans_if_first_user(user)
    return {"claimed": n}


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
    user=Depends(current_active_user),
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
        "user_id": str(user.id),
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
async def list_recent_jobs(limit: int = 20, user=Depends(current_active_user)):
    """Recent jobs for the Recent Videos picker. Newest first, capped at
    `limit` (default 20). Each entry is a compact summary — no segments.

    Filters to the caller's user_id. Sweeps stale jobs (older than
    settings.retention_days) before listing, so the picker can't show
    entries that are about to disappear, and so cleanup happens lazily on
    a route that gets hit anyway every time the user opens the Recent
    dropdown.
    """
    cleanup_old_jobs(get_settings().retention_days)
    return list_jobs(limit, user_id=str(user.id))


@app.delete("/jobs/{job_id}")
async def delete_existing_job(job_id: str, user=Depends(current_active_user)):
    """Remove a job's state file + entire upload folder (source video and
    derived audio). Idempotent: 200 even if the job was already gone.
    Returns 404 if the caller doesn't own the job.
    """
    if not read_job(job_id, user_id=str(user.id)):
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    existed = delete_job(job_id)
    return {"ok": True, "existed": existed}


@app.get("/jobs/{job_id}")
async def job_status(job_id: str, user=Depends(current_active_user)):
    """Poll job state + transcription JSON when ready. 404 when the caller
    doesn't own the job (per-user isolation — see read_job)."""
    state = read_job(job_id, user_id=str(user.id))
    if not state:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return state


@app.patch("/jobs/{job_id}")
async def patch_job(job_id: str, body: dict, user=Depends(current_active_user)):
    """Persist user edits to a job's segments. Only `segments` is mutable
    through this endpoint — other state fields (status, language,
    filename, created_at) are immutable post-transcription. Used by the
    frontend's debounced auto-save when the user nudges timing or edits
    text in the sidebar.
    """
    state = read_job(job_id, user_id=str(user.id))
    if not state:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    segments = body.get("segments")
    if not isinstance(segments, list):
        raise HTTPException(
            status_code=400,
            detail="Request body must include a 'segments' list.",
        )
    # Each segment needs at least start / end / text. We tolerate extra
    # fields (words[], speaker, is_song, phrase_end) and pass them through
    # untouched so the rich Gemini metadata isn't lost.
    cleaned: list[dict] = []
    for s in segments:
        if not isinstance(s, dict):
            raise HTTPException(status_code=400, detail="Each segment must be an object.")
        if not all(k in s for k in ("start", "end", "text")):
            raise HTTPException(
                status_code=400,
                detail="Each segment must include start, end, and text.",
            )
        try:
            start = float(s["start"])
            end = float(s["end"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="start / end must be numbers.")
        if end <= start:
            raise HTTPException(status_code=400, detail="end must be greater than start.")
        cleaned.append({**s, "start": start, "end": end, "text": str(s["text"])})

    # Lazy-capture: jobs transcribed before segments_original existed don't
    # have a Gemini-pristine snapshot. On the first PATCH we record the
    # pre-edit state as the original so a future "Reset all" can revert
    # to it. Jobs from the new pipeline already carry segments_original
    # and won't enter this branch.
    if "segments_original" not in state:
        state["segments_original"] = state.get("segments") or []

    # Bounded edit history for cross-refresh undo. Before overwriting the
    # current segments, push the outgoing value onto segments_history and
    # rotate so the list never grows past HISTORY_LIMIT. The frontend
    # loads this list into the past undo stack on mount, giving Cmd+Z a
    # working trail even after a hard refresh. Granularity is per-PATCH
    # rather than per-click — auto-save debounces rapid clicks into one
    # request — so this is a coarser undo than the in-session stack.
    HISTORY_LIMIT = 10
    prev_segments = state.get("segments")
    if prev_segments:
        history = state.get("segments_history") or []
        history.append(prev_segments)
        state["segments_history"] = history[-HISTORY_LIMIT:]

    state["segments"] = cleaned
    write_job(state)
    return {"ok": True}


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


@app.get("/jobs/{job_id}/thumb")
async def job_thumb(job_id: str):
    """Serve the JPEG thumbnail captured during pipeline extraction. 404 when
    the thumb is missing (older jobs that pre-date thumbnail generation, or
    failed extractions). The frontend falls back to a status badge in that
    case, so a 404 here is non-fatal.
    """
    folder = upload_dir(job_id)
    path = folder / "thumb.jpg"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not available.")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/export/soft")
async def export_soft(job_id: str, fmt: str = "srt"):
    """Return the segments as an .srt or .vtt sidecar download.

    Pure read path — formats whatever is already in data/jobs/{id}.json.
    No worker dispatch; cheap enough to run synchronously inside the
    request thread.
    """
    fmt = fmt.lower().strip()
    if fmt not in ("srt", "vtt"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{fmt}'. Choose 'srt' or 'vtt'.",
        )
    state = read_job(job_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    segments = state.get("segments") or []
    if not segments:
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' has no segments yet (status: {state.get('status')}).",
        )

    body = _to_srt(segments) if fmt == "srt" else _to_vtt(segments)
    base = Path(state.get("filename") or job_id).stem
    return PlainTextResponse(
        body,
        media_type="text/vtt" if fmt == "vtt" else "application/x-subrip",
        headers={"Content-Disposition": f'attachment; filename="{base}.{fmt}"'},
    )


def _fmt_time(t: float, ms_sep: str) -> str:
    """Seconds → 'HH:MM:SS<ms_sep>mmm' using millisecond rounding that
    correctly carries across second/minute/hour boundaries.
    """
    total_ms = max(0, int(round(t * 1000)))
    h, rem = divmod(total_ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{ms_sep}{ms:03d}"


def _to_srt(segments: list[dict]) -> str:
    """SubRip: numbered blocks, comma decimal separator, CRLF-friendly text."""
    parts: list[str] = []
    for i, s in enumerate(segments, 1):
        parts.append(str(i))
        parts.append(f"{_fmt_time(float(s['start']), ',')} --> {_fmt_time(float(s['end']), ',')}")
        parts.append((s.get('text') or '').strip())
        parts.append('')
    return "\n".join(parts)


def _to_vtt(segments: list[dict]) -> str:
    """WebVTT: header + dot decimal separator. No numbered counter."""
    parts: list[str] = ["WEBVTT", ""]
    for s in segments:
        parts.append(f"{_fmt_time(float(s['start']), '.')} --> {_fmt_time(float(s['end']), '.')}")
        parts.append((s.get('text') or '').strip())
        parts.append('')
    return "\n".join(parts)


@app.post("/export/hard")
def export_hard(job_id: str, style_schema: dict, user=Depends(current_active_user)):
    """Burn the styled subtitles into the source video and return the mp4.

    Sync def on purpose — FastAPI runs sync handlers on its threadpool, so
    the blocking FFmpeg subprocess doesn't stall the event loop, and the
    CLAUDE.md 'one concurrent render' resource discipline holds naturally.

    Renders into data/uploads/{job_id}/burned.mp4 and serves that file. Re-
    requests overwrite (deterministic for a given style + segments).
    """
    state = read_job(job_id, user_id=str(user.id))
    if not state:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    segments = state.get("segments") or []
    if not segments:
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' has no segments yet (status: {state.get('status')}).",
        )

    folder = upload_dir(job_id)
    sources = [
        p for p in folder.glob("source.*")
        if p.suffix.lower() in ALLOWED_EXTENSIONS
    ]
    if not sources:
        raise HTTPException(
            status_code=404,
            detail=f"Source video missing for job '{job_id}'.",
        )

    out_path = folder / "burned.mp4"
    try:
        burn_subtitles(str(sources[0]), segments, style_schema, str(out_path))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    base = Path(state.get("filename") or job_id).stem
    return FileResponse(
        out_path,
        media_type="video/mp4",
        filename=f"{base} (subs).mp4",
    )
