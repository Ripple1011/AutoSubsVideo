"""Subscription / pack plan definitions.

Plans are stored in the database so the admin UI can edit them without a
code deploy. On first boot we seed the 4 starter tiers; subsequent boots
respect any edits the admin has made and only create missing rows.

Pricing is stored in **paise** (1 INR = 100 paise) to avoid floating-point
rounding errors. UI converts to ₹ on render.

razorpay_plan_id is null until the admin clicks "Sync to Razorpay" in
the admin UI. While null, the plan is shown on /pricing as "Coming soon"
(not purchasable).

For one-time packs Razorpay doesn't require a pre-created Plan object —
we create an Order per checkout. We still set razorpay_plan_id to a
sentinel value (e.g., "one_time:pack_10") on sync so `purchasable` works
uniformly across packs and subscriptions.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from .auth import Base, async_session_maker


# Cadence values. Keep stable -- webhook handlers branch on these.
CADENCE_ONE_TIME = "one_time"
CADENCE_MONTHLY = "monthly"
CADENCE_ANNUAL = "annual"


class Plan(Base):
    """One row per purchasable tier."""

    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(String(256))
    credits_granted: Mapped[int] = mapped_column(Integer)
    price_inr_paise: Mapped[int] = mapped_column(Integer)  # ₹49.00 = 4900
    cadence: Mapped[str] = mapped_column(String(16))       # one_time | monthly | annual
    rollover_cap: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    razorpay_plan_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


# Seed values. Used only when the row for the given slug doesn't exist.
# Editing this list does NOT update existing rows -- use the admin UI for
# that. Order in this list drives the default sort_order.
_SEED_PLANS: list[dict] = [
    {
        "slug": "pack_10",
        "display_name": "Starter Pack",
        "description": "10 videos. One-time. Never expires.",
        "credits_granted": 10,
        "price_inr_paise": 4900,        # ₹49
        "cadence": CADENCE_ONE_TIME,
        "rollover_cap": None,
    },
    {
        "slug": "pack_50",
        "display_name": "Creator Pack",
        "description": "50 videos. One-time. Never expires.",
        "credits_granted": 50,
        "price_inr_paise": 19900,       # ₹199
        "cadence": CADENCE_ONE_TIME,
        "rollover_cap": None,
    },
    {
        "slug": "monthly",
        "display_name": "Pro Monthly",
        "description": "150 videos every month. Rolls over up to 300. Cancel anytime.",
        "credits_granted": 150,
        "price_inr_paise": 39900,       # ₹399
        "cadence": CADENCE_MONTHLY,
        "rollover_cap": 300,
    },
    {
        "slug": "annual",
        "display_name": "Pro Annual",
        "description": "1500 videos per year. Save ₹1,789 vs monthly.",
        "credits_granted": 1500,
        "price_inr_paise": 299900,      # ₹2,999
        "cadence": CADENCE_ANNUAL,
        "rollover_cap": None,
    },
]


async def seed_plans_if_missing() -> int:
    """On first boot, create rows for any seed slug that doesn't exist.
    Returns the number of plans created. Idempotent — existing rows are
    left untouched so admin edits survive across restarts."""
    async with async_session_maker() as session:
        existing_slugs = set(
            (await session.execute(select(Plan.slug))).scalars().all()
        )
        created = 0
        for i, seed in enumerate(_SEED_PLANS):
            if seed["slug"] in existing_slugs:
                continue
            session.add(Plan(**seed, sort_order=i, active=True))
            created += 1
        if created:
            await session.commit()
        return created


async def list_active(session: AsyncSession) -> list[Plan]:
    stmt = (
        select(Plan)
        .where(Plan.active.is_(True))
        .order_by(Plan.sort_order.asc(), Plan.price_inr_paise.asc())
    )
    return list((await session.execute(stmt)).scalars().all())


async def list_all(session: AsyncSession) -> list[Plan]:
    stmt = select(Plan).order_by(Plan.sort_order.asc(), Plan.price_inr_paise.asc())
    return list((await session.execute(stmt)).scalars().all())


def to_dict(plan: Plan) -> dict:
    """Serialize a Plan row for the API. Frontend reads price_inr (rupees,
    derived) rather than paise so the UI doesn't have to know about paise.
    """
    return {
        "id": str(plan.id),
        "slug": plan.slug,
        "display_name": plan.display_name,
        "description": plan.description,
        "credits_granted": plan.credits_granted,
        "price_inr_paise": plan.price_inr_paise,
        "price_inr": plan.price_inr_paise / 100,
        "cadence": plan.cadence,
        "rollover_cap": plan.rollover_cap,
        "razorpay_plan_id": plan.razorpay_plan_id,
        "purchasable": bool(plan.razorpay_plan_id),
        "active": plan.active,
        "sort_order": plan.sort_order,
        "created_at": plan.created_at.isoformat(),
        "updated_at": plan.updated_at.isoformat(),
    }
