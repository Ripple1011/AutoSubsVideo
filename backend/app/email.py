"""Transactional email via Resend.

Single function `send_welcome_email(to, name)` -- callers don't need to
think about API surface or templates. If `RESEND_API_KEY` is unset
(local dev without the env var, or smoke tests), every send is a silent
no-op so onboarding flows don't crash for the wrong reason.

Why Resend: free tier covers our send volume (100/day, 3000/mo) at
launch, the API is one HTTP call, and the SDK is a thin wrapper -- no
heavyweight queue or relay needed for the welcome-email use case.

This module deliberately avoids:
  - Background workers (Celery) -- a missed welcome email isn't fatal;
    we'd rather a brand-new user wait an extra ~300ms for the signup
    HTTP request to return than risk Celery being down.
  - Templating engines -- single template, inline HTML is fine.
  - Bounce/complaint tracking -- Resend's dashboard surfaces this; we
    don't need to ingest webhooks for it on day one.
"""

import asyncio
from typing import Optional

import httpx

from .config import get_settings


RESEND_API = "https://api.resend.com/emails"


def _from_address() -> str:
    """Header value: `Vaacha <hello@vaacha.app>`. The displayed sender
    name is "Vaacha" -- looks like a brand, not a service account, in
    inbox lists.

    Falls back to Resend's sandbox `onboarding@resend.dev` if the
    custom domain hasn't been verified yet -- lets us ship the code
    before the DNS records propagate.
    """
    s = get_settings()
    addr = s.resend_from or "onboarding@resend.dev"
    return f"Vaacha <{addr}>"


async def send_welcome_email(to: str, *, name: Optional[str] = None) -> bool:
    """Fire-and-log welcome email. Returns True on 2xx.

    Synchronous-by-design from the caller's perspective even though the
    HTTP call is async -- on_after_register is already an async coroutine
    so we just await this. Total roundtrip is ~300-600ms; users see the
    OAuth callback redirect once the entire signup pipeline (grant
    credits + send welcome) completes, which is fine for a single send.
    """
    s = get_settings()
    if not s.resend_api_key:
        print(f"[email] skipped welcome to {to} (RESEND_API_KEY not configured)", flush=True)
        return False

    greeting = name.split()[0] if name else "there"
    subject = "Welcome to Vaacha — 3 free videos waiting"
    html = _welcome_html(greeting)
    text = _welcome_text(greeting)

    headers = {
        "Authorization": f"Bearer {s.resend_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "from": _from_address(),
        "to": [to],
        "subject": subject,
        "html": html,
        "text": text,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(RESEND_API, headers=headers, json=payload)
        if r.status_code // 100 == 2:
            print(f"[email] sent welcome to {to}", flush=True)
            return True
        print(f"[email] welcome to {to} failed: HTTP {r.status_code} — {r.text[:300]}", flush=True)
        return False
    except Exception as e:
        print(f"[email] welcome to {to} errored: {e}", flush=True)
        return False


# Plain-text fallback for clients that don't render HTML. Same content,
# stripped of markup. Gmail / Outlook will prefer the HTML; spam filters
# weight a text/plain alternative positively.
def _welcome_text(greeting: str) -> str:
    return f"""Hi {greeting},

Welcome to Vaacha — auto subtitles for Hindi, Gujarati, and English Shorts and Reels.

You have 3 free videos waiting in your account. Here's how to use them:

  1. Upload a .mp4 or .mov of up to 60 seconds.
  2. Pick a language (or let auto-detect figure it out).
  3. Tweak the style — font, color, position — in the live preview.
  4. Export as .srt / .vtt sidecar or a fully burned-in .mp4.

Start your first project: https://vaacha.app/projects/new

Questions, ideas, complaints — just reply to this email. A human reads it.

— The Vaacha team
https://vaacha.app
"""


# HTML version. Intentionally simple: table-based layout would be more
# bulletproof for legacy Outlook, but Vaacha's audience is creators on
# Gmail / Apple Mail / Outlook 365 -- all modern flexbox-aware.
def _welcome_html(greeting: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Welcome to Vaacha</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;letter-spacing:-0.01em;">
      Welcome to <span style="background:linear-gradient(90deg,#2C6BFF 0%,#7C3AED 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">Vaacha</span>
    </h1>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;">AI subtitles for Indian creators.</p>

    <p style="font-size:16px;line-height:1.55;margin:0 0 16px;">Hi {greeting},</p>
    <p style="font-size:16px;line-height:1.55;margin:0 0 20px;">
      You're in. Your account has <strong>3 free videos</strong> ready to go — no credit card needed.
    </p>

    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 22px;margin:0 0 24px;">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#7C3AED;">How it works</p>
      <ol style="margin:0;padding-left:20px;font-size:15px;line-height:1.65;color:#334155;">
        <li>Upload a .mp4 / .mov up to 60 seconds.</li>
        <li>Pick a language — or auto-detect.</li>
        <li>Style it the way you want in the live preview.</li>
        <li>Export as .srt / .vtt or a burned-in .mp4.</li>
      </ol>
    </div>

    <div style="text-align:center;margin:0 0 28px;">
      <a href="https://vaacha.app/projects/new"
         style="display:inline-block;background:linear-gradient(90deg,#2C6BFF 0%,#7C3AED 100%);color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:999px;">
        Start your first project →
      </a>
    </div>

    <p style="font-size:13px;line-height:1.55;color:#64748b;margin:0 0 4px;">
      Questions, ideas, complaints — just reply to this email. A human reads it.
    </p>
    <p style="font-size:13px;line-height:1.55;color:#64748b;margin:0;">— The Vaacha team</p>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px;">
    <p style="font-size:11px;color:#94a3b8;margin:0;">
      You're receiving this because you signed up at <a href="https://vaacha.app" style="color:#94a3b8;">vaacha.app</a>.
      Vaacha is a product of Kairos Lab.
    </p>
  </div>
</body>
</html>"""
