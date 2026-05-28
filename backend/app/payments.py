"""Razorpay integration.

Two flows:
  - One-time packs (cadence=one_time): create a Razorpay Order per
    checkout click. No pre-created Razorpay Plan needed.
  - Subscriptions (monthly / annual): pre-create a Razorpay Plan via
    `client.plan.create()` once per tier (admin "Sync" button); then
    `client.subscription.create()` per signup.

This module is the single seam between FastAPI handlers and the
Razorpay SDK. Anything that needs to call Razorpay imports from here.

Test mode: when RAZORPAY_KEY_ID starts with "rzp_test_", any value
returned by Razorpay is sandbox-only. We log the test-mode prefix on
init so it's visible in the server output.

Webhooks: Razorpay's webhook delivery requires a public HTTPS URL.
For localhost test, we verify the payment client-side via the HMAC
signature in the checkout success handler instead -- `verify_payment_signature`
below. Once we deploy with HTTPS, the webhook handler also lands.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any

import razorpay
from fastapi import HTTPException

from .config import get_settings


def _client() -> razorpay.Client:
    """Lazily instantiate the Razorpay client. Raises if keys are unset so
    handlers can return a clean 503 instead of crashing later."""
    s = get_settings()
    if not (s.razorpay_key_id and s.razorpay_key_secret):
        raise HTTPException(
            status_code=503,
            detail="Razorpay is not configured on the server.",
        )
    client = razorpay.Client(auth=(s.razorpay_key_id, s.razorpay_key_secret))
    return client


def is_configured() -> bool:
    s = get_settings()
    return bool(s.razorpay_key_id and s.razorpay_key_secret)


def is_test_mode() -> bool:
    s = get_settings()
    return bool(s.razorpay_key_id and s.razorpay_key_id.startswith("rzp_test_"))


# ----- One-time orders (packs) ---------------------------------------------

def create_order(amount_paise: int, *, slug: str, user_email: str) -> dict[str, Any]:
    """Create a Razorpay Order for a one-time pack purchase. Returns the
    order dict — the frontend uses `id`, `amount`, and `currency` from this
    when invoking Razorpay Checkout.

    notes.slug and notes.user_email are echoed back in webhook payloads,
    so we record them here for later credit-grant attribution.
    """
    client = _client()
    payload = {
        "amount": int(amount_paise),
        "currency": "INR",
        "receipt": f"autosub-{slug}",
        "notes": {
            "slug": slug,
            "user_email": user_email,
        },
        "payment_capture": 1,
    }
    return client.order.create(data=payload)


# ----- Signature verification (client-side success handler path) -----------

def verify_payment_signature(
    razorpay_order_id: str,
    razorpay_payment_id: str,
    razorpay_signature: str,
) -> bool:
    """Razorpay Checkout's success handler receives three strings. The HMAC
    is computed over `{order_id}|{payment_id}` keyed with the merchant
    secret. We recompute and compare in constant time.

    Returns True iff the signature is valid for this merchant's secret.
    Caller is expected to 400 on False — the payment is fraudulent or
    the request was tampered with.
    """
    s = get_settings()
    if not s.razorpay_key_secret:
        raise HTTPException(status_code=503, detail="Razorpay is not configured.")
    body = f"{razorpay_order_id}|{razorpay_payment_id}".encode("utf-8")
    expected = hmac.new(
        s.razorpay_key_secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, razorpay_signature)


# ----- Sync plan to Razorpay (admin) ---------------------------------------

def sync_plan_to_razorpay(plan) -> str:
    """Make `plan` purchasable. Returns the value to store in
    `plan.razorpay_plan_id`. Side effects:
      - one_time: sentinel only, no API call. (Orders are created per
        checkout in create_order.)
      - monthly / annual: calls Razorpay's Plan.create() to register a
        recurring billing plan, returns the resulting plan_XXXX id.

    Idempotent for one_time. For subscriptions, calling twice creates
    two Razorpay Plans -- caller is responsible for guarding (the admin
    endpoint refuses to sync a plan whose razorpay_plan_id is already
    set unless `force=True`).
    """
    if plan.cadence == "one_time":
        return f"one_time:{plan.slug}"

    if plan.cadence not in ("monthly", "annual"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot sync cadence '{plan.cadence}'.",
        )

    client = _client()
    period = "monthly" if plan.cadence == "monthly" else "yearly"
    item = {
        "name": plan.display_name,
        "amount": int(plan.price_inr_paise),
        "currency": "INR",
        "description": plan.description[:100],
    }
    payload = {
        "period": period,
        "interval": 1,
        "item": item,
        "notes": {"slug": plan.slug},
    }
    created = client.plan.create(data=payload)
    return str(created["id"])
