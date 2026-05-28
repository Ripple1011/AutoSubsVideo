"""Credits system.

Each transcription consumes one credit. Credits are issued in "grants" —
a single purchase, signup bonus, or refill. We FIFO-consume across grants:
oldest non-expired grant with credits_remaining > 0 loses one credit.

This shape is forward-compatible with everything we want to layer on:
  - Stripe purchase webhooks → insert a new row.
  - Subscription monthly refill → insert a new row each cycle.
  - Promo codes, referral bonuses → also rows.
  - Failed transcriptions → +1 to the most recently consumed grant.

Server is the single source of truth — the frontend only reads totals.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import ForeignKey, Integer, String, DateTime, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from .auth import Base, async_session_maker


# Source tags for credit grants. Keep stable — the frontend "credit history"
# view filters/renders by these. Add new ones as new SKUs/products land.
SOURCE_SIGNUP = "signup_bonus"
SOURCE_SUPERUSER_DEV = "superuser_dev"
SOURCE_PACK_10 = "pack_10"
SOURCE_PACK_50 = "pack_50"
SOURCE_MONTHLY = "monthly"
SOURCE_ANNUAL = "annual"
SOURCE_REFUND = "refund"

SIGNUP_BONUS_CREDITS = 3
SUPERUSER_DEV_CREDITS = 1000   # one-shot dev allotment for is_superuser users


class CreditGrant(Base):
    """One row per credit issuance event."""

    __tablename__ = "credit_grants"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String(32))
    credits_granted: Mapped[int] = mapped_column(Integer)
    credits_remaining: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Razorpay payment / subscription id, when the grant came from a
    # purchase. Null for signup bonuses, refunds, etc. The "razorpay_"
    # prefix isn't baked into the column name in case we ever add a second
    # provider (Stripe for non-IN users); the provider is inferred from
    # the value's prefix (rzp_*, sub_*, order_*, pay_*).
    payment_ref: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)


# ----- Read paths ----------------------------------------------------------

async def get_balance(user_id: uuid.UUID, session: AsyncSession) -> int:
    """Total credits available to spend right now. Excludes expired grants."""
    now = datetime.now(timezone.utc)
    stmt = select(CreditGrant).where(
        CreditGrant.user_id == user_id,
        CreditGrant.credits_remaining > 0,
    )
    result = await session.execute(stmt)
    total = 0
    for grant in result.scalars():
        if grant.expires_at and grant.expires_at <= now:
            continue
        total += grant.credits_remaining
    return total


async def get_history(user_id: uuid.UUID, session: AsyncSession) -> list[dict]:
    """All grants for the user, newest-first. Frontend renders as a list."""
    stmt = (
        select(CreditGrant)
        .where(CreditGrant.user_id == user_id)
        .order_by(CreditGrant.created_at.desc())
    )
    result = await session.execute(stmt)
    return [
        {
            "id": str(g.id),
            "source": g.source,
            "credits_granted": g.credits_granted,
            "credits_remaining": g.credits_remaining,
            "created_at": g.created_at.isoformat(),
            "expires_at": g.expires_at.isoformat() if g.expires_at else None,
        }
        for g in result.scalars()
    ]


# ----- Write paths ---------------------------------------------------------

async def grant_credits(
    user_id: uuid.UUID,
    source: str,
    credits: int,
    *,
    expires_at: Optional[datetime] = None,
    payment_ref: Optional[str] = None,
    session: Optional[AsyncSession] = None,
) -> CreditGrant:
    """Issue a new credit grant. Caller may pass an existing session (to fold
    into a larger transaction) or rely on us to open one."""

    async def _do(s: AsyncSession) -> CreditGrant:
        grant = CreditGrant(
            user_id=user_id,
            source=source,
            credits_granted=credits,
            credits_remaining=credits,
            expires_at=expires_at,
            payment_ref=payment_ref,
        )
        s.add(grant)
        await s.flush()
        return grant

    if session is not None:
        return await _do(session)
    async with async_session_maker() as s:
        grant = await _do(s)
        await s.commit()
        return grant


async def consume_credit(user_id: uuid.UUID) -> tuple[bool, Optional[uuid.UUID]]:
    """Atomically decrement the user's balance by 1. Returns
    (consumed, grant_id) — when consumed=False, the user is out of credits
    and the caller should reject the operation. grant_id is the row that
    lost the credit, kept so refund_credit() can hand it back if the
    pipeline fails downstream.

    Uses an UPDATE ... WHERE credits_remaining > 0 to avoid races between
    concurrent uploads from the same user — at most one wins.
    """
    now = datetime.now(timezone.utc)
    async with async_session_maker() as session:
        # Find the oldest valid grant with credits left.
        stmt = (
            select(CreditGrant)
            .where(
                CreditGrant.user_id == user_id,
                CreditGrant.credits_remaining > 0,
            )
            .order_by(CreditGrant.created_at.asc())
        )
        result = await session.execute(stmt)
        grants = [g for g in result.scalars() if not g.expires_at or g.expires_at > now]
        if not grants:
            return False, None
        target = grants[0]
        # Conditional UPDATE — only succeeds if the row still has credits.
        upd = (
            update(CreditGrant)
            .where(
                CreditGrant.id == target.id,
                CreditGrant.credits_remaining > 0,
            )
            .values(credits_remaining=CreditGrant.credits_remaining - 1)
            .returning(CreditGrant.id)
        )
        upd_result = await session.execute(upd)
        winner = upd_result.scalar_one_or_none()
        if winner is None:
            # Race lost — another request already consumed this row. Try the
            # caller again with a fresh transaction; for now we just report
            # failure and let them retry. Rare; not worth a loop here.
            await session.rollback()
            return False, None
        await session.commit()
        return True, winner


async def refund_credit(grant_id: uuid.UUID) -> None:
    """Restore one credit to the grant that consume_credit() decremented.
    Called when the pipeline fails — the user wasn't billable for that
    attempt. No-op if the grant has been deleted (e.g., user purged)."""
    async with async_session_maker() as session:
        await session.execute(
            update(CreditGrant)
            .where(CreditGrant.id == grant_id)
            .values(credits_remaining=CreditGrant.credits_remaining + 1)
        )
        await session.commit()
