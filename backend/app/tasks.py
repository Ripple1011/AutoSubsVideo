"""Celery worker for AutoSub.

Single concurrency on the 2 vCPU host. Each task wraps the shared async
pipeline in `asyncio.run()` so the Celery worker (sync by default) can call it.

Launch locally with:
    cd backend
    .venv/Scripts/celery.exe -A app.tasks worker -c 1 -P solo --loglevel=info

On the VPS this becomes a systemd unit (see deploy/).
"""

import asyncio

from celery import Celery

from .config import get_settings
from .pipeline import run_pipeline

_settings = get_settings()

celery_app = Celery(
    "autosub",
    broker=_settings.redis_url,
    backend=_settings.redis_url,
)

# Keep tasks short and the box healthy: no prefetch above the work-in-progress.
celery_app.conf.update(
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_default_queue="autosub",
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)


@celery_app.task(name="autosub.transcribe_job", bind=True)
def transcribe_job_task(
    self,
    job_id: str,
    source_path: str,
    user_key: str | None = None,
    user_provider: str | None = None,
    user_model: str | None = None,
) -> dict:
    """Run the full extract+transcribe pipeline for a single job_id.

    `bind=True` lets us access self.request.id if we need it for logs later.
    """
    asyncio.run(run_pipeline(job_id, source_path, user_key, user_provider, user_model))
    return {"job_id": job_id, "ok": True}
