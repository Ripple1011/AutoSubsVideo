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


async def max_video_seconds_for_user(user_id) -> int:
    """Resolve the upload cap for a specific user.

    Logic:
      1. Look up the user's unexpired credit grants. The 'source' column on
         each grant is the plan slug (or 'signup_bonus' / 'superuser_dev').
      2. For each grant matching a real Plan row, read that plan's
         max_video_seconds. Take the MAX across all matched plans -- if a
         user has Pro Monthly (300s) AND a Starter Pack (60s), they get the
         300s privilege. Buying down doesn't punish.
      3. If no plan-backed grants resolve a value, fall through to the
         site-wide max via current_max_video_seconds().

    Returns the cap in seconds. The upload handler clamps videos longer
    than this with HTTP 413.
    """
    import uuid as _uuid
    from datetime import datetime, timezone
    from sqlalchemy import select
    from .plans import Plan
    from .credits import CreditGrant

    # Normalize id (caller may pass str or UUID).
    if isinstance(user_id, str):
        try:
            user_id = _uuid.UUID(user_id)
        except ValueError:
            return await current_max_video_seconds()

    now = datetime.now(timezone.utc)
    best: Optional[int] = None
    async with async_session_maker() as session:
        # Pull active grants joined to their plan rows (left-joined since
        # signup_bonus / refund grants have no plan row).
        grants = (await session.execute(
            select(CreditGrant, Plan)
            .outerjoin(Plan, Plan.slug == CreditGrant.source)
            .where(
                CreditGrant.user_id == user_id,
                CreditGrant.credits_remaining > 0,
            )
        )).all()
        for grant, plan in grants:
            if grant.expires_at and grant.expires_at <= now:
                continue
            if plan and plan.max_video_seconds is not None:
                if best is None or plan.max_video_seconds > best:
                    best = plan.max_video_seconds

    if best is not None:
        return best
    return await current_max_video_seconds()
