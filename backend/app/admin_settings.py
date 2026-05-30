"""Runtime-editable admin settings -- key/value rows that override env defaults.

Tiny abstraction so the admin UI can flip a knob without an SSH session
and systemctl restart. Right now only `max_video_seconds` is wired up,
but the same pattern works for any single-value setting you'd want
adjustable at runtime (default ASR model, signup bonus, etc).

Resolution order whenever the backend reads a knob:
  1. AdminSetting row in the DB (if present)
  2. settings.<key> from .env (Pydantic default)

The fall-through means an empty DB row reverts the value to the .env
default automatically -- no "delete row" gymnastics needed in the UI,
just type 0 / clear field / save.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Integer, String, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from .auth import Base, async_session_maker
from .config import get_settings


class AdminSetting(Base):
    """Single-row-per-key admin override. Value stored as int for now since
    the only knob is `max_video_seconds`; widen to a JSON column if/when
    we add string- or struct-valued settings.
    """

    __tablename__ = "admin_settings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    value_int: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


KEY_MAX_VIDEO_SECONDS = "max_video_seconds"


async def get_int(key: str, default: int) -> int:
    """Read an int setting. Falls back to `default` if the row doesn't
    exist or value_int is NULL."""
    async with async_session_maker() as session:
        row = (await session.execute(
            select(AdminSetting).where(AdminSetting.key == key)
        )).scalar_one_or_none()
        if row and row.value_int is not None:
            return row.value_int
    return default


async def set_int(key: str, value: Optional[int]) -> None:
    """Upsert an int setting. Pass None to clear (reverts to env default)."""
    async with async_session_maker() as session:
        row = (await session.execute(
            select(AdminSetting).where(AdminSetting.key == key)
        )).scalar_one_or_none()
        if row:
            row.value_int = value
        else:
            session.add(AdminSetting(key=key, value_int=value))
        await session.commit()


# Convenience getter for the upload handler -- reads DB override or
# falls back to settings.max_video_seconds from .env.
async def current_max_video_seconds() -> int:
    return await get_int(KEY_MAX_VIDEO_SECONDS, get_settings().max_video_seconds)
