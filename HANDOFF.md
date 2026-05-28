# Handoff Notes

Most recent session at the top. Each session: what landed, what works, what's queued.
Both AI agents update this file at end of session. Read before starting.

---

## 2026-05-28 (late night, ~02:00) · Windows agent — Slice 3b-continued: Razorpay integration (code complete, blocked on entity KYC)

**Landed:**
- `razorpay==1.4.2` Python SDK in `backend/requirements.txt`, plus
  `setuptools>=70,<81` (the SDK still imports `pkg_resources` which is
  removed in setuptools 81+).
- `backend/app/payments.py` — single seam to the Razorpay SDK:
  - `is_configured()` / `is_test_mode()` helpers (test mode is
    detected by `rzp_test_` prefix on the key id).
  - `create_order(amount_paise, slug, user_email)` — one-time pack
    Orders. Echoes slug + email into Razorpay `notes` for webhook
    attribution later.
  - `verify_payment_signature(order_id, payment_id, signature)` —
    HMAC-SHA256 over `{order_id}|{payment_id}` keyed with the
    Razorpay secret. Constant-time compare via `hmac.compare_digest`.
  - `sync_plan_to_razorpay(plan)` — packs return sentinel
    `"one_time:{slug}"`; subscriptions call `client.plan.create()`
    and return the resulting `plan_XXXX` id.
- New endpoints in main.py:
  - `POST /admin/plans/{id}/sync-to-razorpay` — admin button; idempotent
    for packs; `force=true` re-syncs subscriptions when a new Razorpay
    Plan is needed (price change).
  - `POST /checkout/{slug}` — auth required; creates an Order for the
    plan and returns `{key_id, order_id, amount, currency, name,
    description, prefill, slug}` for the frontend to invoke Checkout.
    Subscriptions return 501 (out of scope for this slice — packs first).
  - `POST /razorpay/verify` — auth required; receives the success
    handler payload, verifies signature, grants credits idempotently
    via `payment_ref = razorpay_payment_id`. Returns
    `{balance, credited, source}`.
- Razorpay config in backend/app/config.py:
  - `razorpay_key_id`, `razorpay_key_secret`, `razorpay_webhook_secret`
    (last one unused until VPS+HTTPS so we can receive webhooks).

**Frontend:**
- `frontend/src/lib/razorpay.js` — lazy-loads
  `https://checkout.razorpay.com/v1/checkout.js` on first Buy click.
  Single-flight promise; subsequent calls reuse the SDK.
- AdminPlans.jsx: per-row "Sync" / "Re-sync" button next to the
  synced/not-synced badge. Disabled for one_time packs once synced
  (their sentinel never needs re-syncing).
- Pricing.jsx Buy flow:
  1. POST `/checkout/{slug}` → backend creates Order, returns config.
  2. `loadRazorpaySDK()`.
  3. `new window.Razorpay({...}).open()`. Modal opens.
  4. On success handler: POST `/razorpay/verify`. On success, dispatch
     `autosub:credits-refresh` event (badge updates), navigate to
     `/account`.
  5. `payment.failed` event → render the error on the card.
- Checkout options include
  `method: { upi: true, card: true, netbanking: true, wallet: true }`
  to force-show UPI as a tab (Razorpay sometimes hides it for
  test-mode accounts without explicit method declaration).

**Verified end-to-end up to the Razorpay gateway:**
- Order creation works against the live Razorpay sandbox
  (`order_Suli3Qzx1wKIx9` returned with amount=4900 INR status=created).
- Sync button writes `razorpay_plan_id = "one_time:pack_10"`; UI flips
  to "synced" badge; Pricing card "Buy now" becomes clickable.
- Checkout modal opens correctly.

**What is NOT verified (blocker is Razorpay-side):**
- A real payment attempt with the official test card
  `4111 1111 1111 1111` was REJECTED by Razorpay with "International
  cards are not supported" — this is Razorpay's catch-all error
  message for un-activated accounts. Razorpay tightened policy in
  2024-2025: un-activated Indian accounts cannot process ANY payment
  in test mode, not even with their own test cards.
- UPI option is hidden in Checkout for the same reason — Razorpay's
  Account & Settings → Checkout settings → Payment Configuration page
  shows only Cards / Netbanking / Wallets / PayLater, no UPI toggle.
  UPI appears once the account is activated.

**Account activation blocker:**
- Razorpay requires a one-time ₹199 KYC verification fee + business
  KYC (PAN, bank account, business details) to activate the account.
- User declined activation on the current test account because they
  intend to use a different PAN + Aadhaar for the real business
  entity (not yet incorporated). Paying ₹199 + KYC'ing twice (now,
  then again with the real entity later) was correctly identified as
  wasted effort.
- Code stays committed; when the real business entity Razorpay
  account is ready, paste new `RAZORPAY_KEY_ID` and
  `RAZORPAY_KEY_SECRET` into VPS .env and the entire payment flow
  works without further code changes.

**Other decisions made today (no code impact):**
- Domain choice: `vaacha.app` purchased on Porkbun ($10.81 first year,
  $14.93 renewal). `.app` requires HTTPS via TLD-level HSTS preload
  which dovetails with the VPS+HTTPS slice queued for the next session.
  Other options considered + rejected:
    - `kairoslab.live`: parent company domain, brand mismatch with
      the product.
    - `vaacha.tech` via free-first-year offer: $64/year renewal trap.
    - `vaacha.tech` on Porkbun: $51/year renewal — same trap, slightly
      cheaper bait.
    - `vaacha.io` / `vaacha.ai`: better brand but 3-6× the cost of
      `.app`. Defer until product is validated and budget supports it.
- Payment provider choice: Razorpay confirmed over Cashfree / PhonePe
  PG / PayU. Razorpay has the strongest UPI Autopay subscription
  support in India and the deepest documentation; fee differences
  (1.9-2.0% range) are noise until ₹5+ lakhs/month.

**Files added:**
- `backend/app/payments.py`
- `frontend/src/lib/razorpay.js`

**Files modified:**
- `backend/app/config.py` (Razorpay env vars)
- `backend/app/main.py` (3 new payment endpoints)
- `backend/requirements.txt` (razorpay, setuptools pin)
- `frontend/src/routes/AdminPlans.jsx` (Sync button)
- `frontend/src/routes/Pricing.jsx` (Buy flow with Razorpay Checkout)

**Queued for the next session (VPS deploy + HTTPS, ~3-4 hours):**
- Point `vaacha.app` DNS A record at VPS `187.124.151.114`.
- Update Google Cloud Console:
  - Authorized JS origins: add `https://vaacha.app`.
  - Authorized redirect URIs: add
    `https://vaacha.app/auth/google/callback`.
- Update VPS `backend/.env`:
  - `OAUTH_CALLBACK_BASE=https://vaacha.app`
  - `OAUTH_SUCCESS_REDIRECT=https://vaacha.app/projects`
  - (All other secrets carried from local .env when ready.)
- SSH to VPS, run `/root/autosub/deploy/update.sh` to pull the four
  commits worth of work (Slice 1 routes through Slice 3b Razorpay).
- nginx vhost: change `server_name` from `_` to `vaacha.app`.
- certbot for Let's Encrypt cert: `certbot --nginx -d vaacha.app`.
- Verify: visit `https://vaacha.app`, log in via Google, see Projects,
  upload a video, see credits decrement.
- VPS-only blockers to fix during deploy:
  - The shared-password middleware was originally for "guard the IP
    with one password." With real auth and a real domain, we may want
    to retire it; verify behavior on the live URL first.

**Queued for the session after that:**
- Razorpay activation with the real business entity Razorpay account
  (when entity exists).
- Razorpay subscription endpoints (Monthly + Annual tiers; current
  code only handles packs).
- Razorpay webhook handler at `POST /razorpay/webhook` — requires
  HTTPS, so VPS+HTTPS must land first. Verifies signature with
  `RAZORPAY_WEBHOOK_SECRET`. Handles `payment.captured` (idempotent
  duplicate of /razorpay/verify), `subscription.charged` (monthly
  refills), `subscription.cancelled`.

---

## 2026-05-28 (late night) · Windows agent — Slice 3b (pre-Razorpay): Plans + Admin + Pricing + Account

**Landed:**
- `plans` table in `users.db`. Stores tier definitions (slug,
  display_name, description, credits_granted, price_inr_paise, cadence,
  rollover_cap, razorpay_plan_id, active, sort_order). Seeded on first
  boot with the 4 starter tiers (idempotent — admin edits survive).
- Public endpoint `GET /plans` returns active plans for `/pricing`.
- Superuser-only CRUD on `/admin/plans`:
  - `GET /admin/plans` — list everything (active + inactive).
  - `POST /admin/plans` — create new plan.
  - `PATCH /admin/plans/{id}` — edit. `slug` and `cadence` are
    immutable (changing them mid-flight orphans active subscriptions).
  - `DELETE /admin/plans/{id}` — hard-delete (refused if
    razorpay_plan_id is set).
- `current_superuser` dependency in auth.py (active=True + superuser=True).
- New routes:
  - `/pricing` — public 4-card layout. "Coming soon" buttons until
    payment integration is live. Amber banner explains the wait.
  - `/account` — credit balance + grant history table + subscription
    placeholder. "Get more credits" CTA → /pricing.
  - `/admin/plans` — full edit table per row. Slug + cadence locked
    (greyed display); display_name / description / credits_granted /
    price_inr / rollover_cap / sort_order / active are editable. Save
    button activates only when the row is dirty. Backend rejects
    non-superusers with 403; UI shows a friendly message before the
    round-trip.
- DropZone empty-state banner appears when balance===0, with a "See
  plans" button → /pricing. Generate button disabled.
- Top-bar avatar dropdown now offers: Account & credits / Pricing /
  Manage plans (admin only) / Log out.

**Payment provider pivot — Stripe → Razorpay:**

Stripe India is invite-only and has poor UPI subscription support. We
switched to Razorpay before writing any Stripe code, so the integration
slice ahead is clean.

- All references to "stripe" in code + comments renamed:
  - DB column `stripe_price_id` → `razorpay_plan_id` (drop+recreated
    the table; no data lost since only seed rows existed).
  - DB column `stripe_ref` on credit_grants → `payment_ref`
    (provider-agnostic on purpose, in case we add Stripe-International
    later for non-IN users).
  - UI strings and code comments updated.
- Scope is **India-only v1**. Razorpay handles UPI (most common
  payment method in India), cards, netbanking, wallets, and
  subscriptions with UPI Autopay mandates. No multi-currency support
  in v1; if we ever want US/EU customers we add Stripe as a second
  provider then.

**Decisions baked in:**
- Pricing stored in **paise** (₹49.00 = 4900) — integer math, no
  float drift.
- Slug + cadence are immutable post-creation. Other fields are admin-
  editable any time.
- `purchasable = bool(razorpay_plan_id)`. UI uses this single boolean
  to decide whether the Buy button is enabled.
- Superuser flag is the admin gate. Anyone manually promoted via the
  DB can access /admin/plans; new signups are NOT superuser by default.
- Razorpay plan IDs follow Razorpay conventions: `plan_XXXX` for
  subscriptions, sentinel `"one_time:pack_10"` (or similar) for packs
  since Razorpay doesn't need pre-created plan objects for one-time
  Orders.

**Files added:**
- `backend/app/plans.py`
- `frontend/src/routes/Pricing.jsx`
- `frontend/src/routes/Account.jsx`
- `frontend/src/routes/AdminPlans.jsx`

**Files modified:**
- `backend/app/main.py` — `/plans` + `/admin/plans*` + uuid import + seed call
- `backend/app/auth.py` — current_superuser dependency
- `backend/app/credits.py` — column rename
- `frontend/src/App.jsx` — dropdown items
- `frontend/src/components/DropZone.jsx` — empty-state banner
- `frontend/src/main.jsx` — three new routes wired

**Queued for Slice 3b-continued (when Razorpay creds arrive):**
- Install `razorpay` Python SDK + add to requirements.txt
- Config: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
- `POST /admin/plans/{id}/sync-to-razorpay`:
  - For packs (cadence=one_time): set razorpay_plan_id to a sentinel
    like `"one_time:{slug}"`; no Razorpay API call required (Orders
    are created per-checkout).
  - For subscriptions (monthly/annual): call `client.plan.create()` to
    create a Razorpay Plan, store the returned `plan_XXXX` id.
- `POST /checkout/{slug}`:
  - Pack: create a Razorpay Order via `client.order.create()` for
    amount = plan.price_inr_paise. Return `{order_id, key_id,
    amount, currency: 'INR', name, prefill_email}` so the frontend
    can open Razorpay Checkout.
  - Subscription: create a Razorpay Subscription via
    `client.subscription.create()` with the plan_id. Return
    `{subscription_id, key_id, ...}`.
- Frontend Pricing card "Buy" button:
  - POST to /checkout/{slug}, get back checkout config.
  - Load Razorpay Checkout JS (`<script src="https://checkout.razorpay.com/v1/checkout.js">`).
  - Open `new Razorpay({...}).open()` with the config.
  - On success handler: POST verification to backend, then redirect
    to /account.
- `POST /razorpay/webhook`:
  - Verify signature with RAZORPAY_WEBHOOK_SECRET.
  - Handle `payment.captured` (one-time pack) → grant credits.
  - Handle `subscription.charged` (monthly/annual renewal) → grant
    credits using plan's credits_granted.
  - Handle `subscription.cancelled` → no more grants; existing
    credits stay.
  - Idempotency: dedupe via payment_id stored in payment_ref.
- Account page additions:
  - Active subscription card (plan name, next billing date, cancel
    link via Razorpay customer portal or via in-app PATCH endpoint).
- Admin page additions:
  - "Sync to Razorpay" button per row (creates Plan via API).
  - "Create new plan" row at bottom (calls POST /admin/plans).

**You need to (parallel work):**
1. Sign up at razorpay.com.
2. Complete KYC (PAN + business proof). Test mode works immediately.
3. Save Test Key ID + Test Key Secret. You'll paste into .env when
   we wire Slice 3b-continued.
4. Test webhook setup happens later (Razorpay generates a webhook
   secret you'll add).

**Deployed to VPS:** NO. Same OAuth-domain blocker as before. Also
applies to Razorpay — webhooks need a public HTTPS URL, so VPS deploy
+ domain + HTTPS must precede Razorpay live mode.

---

## 2026-05-28 (night) · Windows agent — Slice 3a: Credits + 60s cap + managed Gemini

**Landed:**
- Credits system: `credit_grants` table in `users.db`. Each row is one
  issuance (signup bonus, pack purchase, monthly refill, refund).
  FIFO-consumed across grants — the oldest non-expired grant with
  `credits_remaining > 0` loses one credit per transcription. Atomic
  `UPDATE ... WHERE credits_remaining > 0` so concurrent uploads from
  the same user can't double-spend.
- New module `backend/app/credits.py` exposes:
  `grant_credits / consume_credit / refund_credit / get_balance / get_history`.
- Signup bonus: 3 free credits granted via `on_after_register` in auth.py.
  Superuser flag adds an extra 1000 dev-allotment grant. Both retroactive
  for the existing 2 users — script-promoted both to superuser and
  granted 1003 credits each.
- `/upload` behavior is now bimodal:
  - **Managed** (no `X-User-ASR-Key` header): provider/model are FORCED
    to `gemini` + `gemini-2.5-pro` server-side (frontend can't downgrade
    by poking the dropdown). Credit consumed pre-pipeline; refunded on
    any HTTPException or unhandled exception.
  - **BYOK** (key header present): their key, their model choice, no
    credit consumed. Backward-compatible.
- 60-second video cap enforced server-side via ffprobe AFTER write to
  disk (we need the file to probe). On over-cap: refund credit, purge
  upload directory, 413 Payload Too Large with a creator-friendly
  "trim the clip" message. `MAX_SECONDS = 60.0`.
- New endpoint `GET /users/me/credits` → `{balance, history: [...]}`.
- New job JSON fields: `billing_mode` ("byok" | "managed") and
  `consumed_grant_id` (UUID of the grant row that funded this job). Set
  on upload; used for refund and future per-user usage analytics.

**Frontend:**
- `useCredits()` hook: `{balance, history, loading, refresh}`. Fetches
  `/users/me/credits` on mount. Cross-component sync via a
  `'autosub:credits-refresh'` window event — every consumer refetches
  when any consumer calls refresh(). Avoids context-provider boilerplate
  for now.
- `CreditsBadge` component — purple pill "🪙 N" in the top bar. Turns
  rose-colored when balance ≤ 3 (low warning).
- DropZone:
  - Pre-flight check: balance === 0 → reject upload before sending.
  - On generate: refresh() after both success and failure paths (the
    failure path catches refunds the server issued).
- SettingsModal restructured:
  - Default view: a single "Managed by AutoSub — Gemini 2.5 Pro" panel
    with a one-line explanation of credits.
  - BYOK provider/model/key inputs moved behind a collapsed "▸ Advanced:
    bring your own API key" section. Auto-expanded when a key is already
    saved (so existing BYOK users see their config).

**Pricing & tier shape (locked in, not yet implemented):**

| Tier | Credits | Price | Notes |
|---|---|---|---|
| Free (signup) | 3 | ₹0 | One-time on registration |
| Pack-10 | 10 | ₹49 | One-time, never expires |
| Pack-50 | 50 | ₹199 | One-time, never expires |
| Pro Monthly | 150/mo | ₹399 | Rollover up to 300 |
| Pro Annual | 1500/yr | ₹2,999 | |

Unit economics at gemini-2.5-pro: ~₹0.38 cost per video, 80-92% margin
across all tiers. Hard 60s cap blocks the "upload 4-hour file" attack;
credits naturally rate-limit; free tier capped at ₹1.14 worst-case per
new account. Source models doc / pricing detail kept in commit msg.

**Decisions baked in:**
- 1 credit = 1 video (regardless of length under 60s). Simple to explain.
- Free + paid tiers all use `gemini-2.5-pro` (best Indic accuracy).
- Refund credit on any pipeline failure (HTTPException OR Exception).
- Server-side override of provider/model for managed users — frontend
  is decorative for the model picker when no BYOK key is present.
- BYOK kept as a power-user opt-in. Their usage is free to us.
- People API was already enabled in Google Cloud Console (auth slice
  prereq); nothing changed there.

**Known issues / things to know:**
- Frontend has TWO different patterns now for cross-component state:
  `useAuth` is per-instance (each component independently fetches
  /users/me), `useCredits` is per-instance + window-event-broadcast.
  Both work. If we add a third (e.g., user settings), consider
  centralizing on Zustand. Not worth the refactor today.
- The 60s cap is enforced AFTER the upload writes to disk. A user with a
  large file would still incur disk write + ffprobe cost before
  rejection. Acceptable for now (videos are tens of MB, not GB); revisit
  if we ever raise the cap or accept longer files.
- `_PUBLIC_GET_PATHS` in main.py is `("/health", "/users/me")` — exact
  match. `/users/me/credits` is NOT in the list, but the shared-password
  middleware only blocks when `SHARED_PASSWORD` is set. On localhost it
  doesn't matter; on VPS it does. If/when the VPS hits this code, either
  add `/users/me/credits` to public paths OR retire the shared-password
  gate entirely.

**Files added:**
- `backend/app/credits.py`
- `frontend/src/hooks/useCredits.js`
- `frontend/src/components/CreditsBadge.jsx`

**Files modified:**
- `backend/app/auth.py` (signup bonus in on_after_register)
- `backend/app/main.py` (force pro, credit consume/refund, 60s cap,
  /users/me/credits)
- `frontend/src/App.jsx` (renders CreditsBadge)
- `frontend/src/components/DropZone.jsx` (balance check + refresh)
- `frontend/src/components/SettingsModal.jsx` (managed-first UX)

**Queued for Slice 3b — Stripe billing (next session):**
- Stripe products (4 SKUs: pack_10, pack_50, monthly, annual).
- `/pricing` route with 4 tier cards and Stripe Checkout buttons.
- `/account` route — credit balance + grant history + active subscription.
- Webhook handler `/stripe/webhook` writes new `credit_grants` rows on
  payment success. Idempotency via stripe_ref unique check.
- Empty state when balance === 0 should link to /pricing instead of a
  dead-end error toast.
- Monthly tier needs a scheduler (cron or Celery beat) to refill credits
  on subscription anniversaries. Stripe webhooks for `invoice.paid` can
  drive this.
- Refunds / cancellation flow (Stripe's portal handles most of it).
- Email receipts (Stripe does it; we just need to verify it's enabled).

**Deployed to VPS:** NO. Same blocker as Slice 2 (Google OAuth doesn't
accept raw IPs as redirect URIs since 2024). Mac agent SHOULD NOT
deploy this slice to VPS until a real domain + HTTPS + updated Google
Console redirect URIs are configured.

---

## 2026-05-28 (evening) · Windows agent — Slice 2: Auth (Google OAuth)

**Landed:**
- `fastapi-users` + Google OAuth + cookie/JWT session backend.
  - SQLite at `backend/data/users.db` (users + oauth_accounts tables).
  - JWT signing secret auto-generated on first boot, written to `.env` as
    `JWT_SECRET`, persists across restarts.
  - Cookie: `autosub_session`, HttpOnly + SameSite=Lax, 30-day lifetime,
    `Secure=False` until HTTPS lands.
- Auth routers mounted in `main.py`:
  - `GET /auth/google/authorize` — returns `{authorization_url}` for the
    frontend to redirect to.
  - `GET /auth/google/callback` — handled by fastapi-users; a small middleware
    promotes the library's success 204 into a 302 to the configured frontend
    URL, otherwise the browser is stranded on a blank page after the Google
    round-trip.
  - `POST /auth/logout` — clears the cookie.
  - `GET /users/me` — current user profile.
  - `POST /users/claim-orphans` — one-shot for the first registered user to
    inherit pre-auth jobs (no `user_id` in their state JSON). Server returns
    `{claimed: 0}` for every subsequent user; safe to call repeatedly.
- Per-user data isolation:
  - `storage.read_job(id, user_id=...)` returns None when the job is owned
    by someone else (same behavior as "doesn't exist").
  - `storage.list_jobs(limit, user_id=...)` filters by user_id; oversamples
    by 3x before filtering so a user with many interleaved-by-time jobs
    still gets a full page.
  - Every job endpoint in `main.py` now has `Depends(current_active_user)`:
    `/upload`, `/jobs` (list), `/jobs/{id}` (read), `/jobs/{id}` (patch),
    `/jobs/{id}` (delete), `/export/hard`.
  - `/jobs/{id}/video` and `/jobs/{id}/thumb` stay public (the 12-char
    random ID is the soft secret; `<video>`/`<img>` can't send headers).
- Frontend:
  - `useAuth()` hook — `{user, loading, logout, refresh}`. Probes
    `/users/me` on mount; on success kicks off a best-effort
    claim-orphans POST (silent failure).
  - `RequireAuth` route wrapper — redirects to `/login` while preserving
    the originally-requested path in `location.state.from`.
  - `Login` route — single "Continue with Google" button; full-page
    redirect to `authorization_url`. Bounces logged-in users to the
    `next` destination immediately.
  - `App.jsx` shell now shows a purple avatar circle (first letter of
    email) in the top-right with a dropdown for email + logout.
  - `apiClient.api()` and `uploadFile()` now send `credentials: 'include'`
    so the session cookie travels with every request.
  - 401 handler: if detail mentions "password" it still prompts for the
    shared-password (legacy gate). Otherwise it redirects to `/login`,
    preserving the current path via `?next=...`.

**Google Cloud Console setup (you did this manually, for the record):**
- OAuth consent screen: External, Testing mode, user email added as test
  user.
- Scopes: `openid`, `userinfo.email`, `userinfo.profile`.
- People API: enabled (httpx_oauth calls
  `https://people.googleapis.com/v1/people/me`; this API must be enabled
  on the project, otherwise the callback 500s with `GetIdEmailError`).
- Authorized JS origins: `http://localhost:5173`, `http://localhost:8000`.
- Authorized redirect URI: `http://localhost:8000/auth/google/callback`.
- VPS deferred until a real domain (Google won't accept raw IPs as redirect
  URIs since 2024; nip.io workaround documented but not wired).

**Decisions baked in:**
- OAuth-only, no email/password. `hashed_password` column exists on the
  User model (from the fastapi-users mixin) but is never written.
- First-registered-user inherits orphan jobs. After that, orphans stay
  invisible. Idempotent via the `claim_orphans_if_first_user()` count
  check.
- SQLite, not Postgres. Single file, zero ops.
- People API for profile retrieval (httpx_oauth default). Could be
  swapped to `oauth2/v2/userinfo` later if Google deprecates it.
- Shared-password gate STILL ACTIVE on the VPS. Two layers during
  transition. Retire once auth is solid on the deployed app.

**Known issues:**
- `useAuth()` is per-component state — `App.jsx`, `RequireAuth`, and
  `Login` each independently fetch `/users/me` on mount. Functionally
  correct (each gets the same answer from the cookie) but visible in the
  log as duplicate requests. Refactor to a shared context if it becomes
  a perf concern.
- The claim-orphans fetch fires from `useAuth.refresh()` — runs on every
  mount of any component using the hook. The server-side dedup is
  idempotent so this is harmless, just noisy. Could be moved to a
  one-shot on first successful login if the duplicate POSTs become
  annoying in the log.

**Files added:**
- `backend/app/auth.py` — fastapi-users wiring + Google client + DB engine
- `backend/app/schemas.py` — UserRead/UserCreate/UserUpdate
- `backend/data/users.db` (created on first boot)
- `frontend/src/hooks/useAuth.js`
- `frontend/src/routes/Login.jsx`
- `frontend/src/components/RequireAuth.jsx`

**Files modified:**
- `backend/app/main.py` — auth routers, OAuth callback middleware,
  `Depends(current_active_user)` everywhere, public-paths exception for
  `/auth/*` and `/users/me`.
- `backend/app/config.py` — `GOOGLE_OAUTH_*`, `JWT_SECRET`,
  `OAUTH_CALLBACK_BASE`, `OAUTH_SUCCESS_REDIRECT`,
  `JWT_LIFETIME_SECONDS`.
- `backend/app/storage.py` — `user_id` field, per-user filtering,
  `claim_orphan_jobs`.
- `backend/.env` — JWT_SECRET written automatically.
- `backend/requirements.txt` — fastapi-users[sqlalchemy,oauth],
  aiosqlite, httpx-oauth, itsdangerous.
- `frontend/src/App.jsx` — user dropdown.
- `frontend/src/lib/apiClient.js` — credentials include, 401 → /login.
- `frontend/src/main.jsx` — `/login` route + RequireAuth wrapper.

**Queued for Slice 3:**
- Retire shared-password gate (env-flag toggle so it can be turned off
  per-deployment).
- Per-user BYOK API keys stored in DB (move out of browser localStorage
  so a session move to another browser doesn't lose configuration).
- Account settings page (`/account`): change email, revoke active
  sessions, delete account.
- Public landing page (`/`) for logged-out users — currently we redirect
  straight to `/login`.
- Stripe billing + Gemini-cost tracking (Phase C).
- VPS deploy: requires a domain (Google won't accept the raw IP) OR
  switch to nip.io. Document a clear "go to production" checklist that
  includes both OAuth domain setup and HTTPS via certbot.

**Deployed to VPS:** NO. Localhost-only OAuth so far. Mac agent should NOT
deploy this slice to VPS without first adding the VPS domain/origin to
Google Cloud Console — otherwise login from the VPS will 401 at the
"OAuth client not found" step.

---

## 2026-05-28 · Windows agent — Slice 1: Routes + Projects

**Landed (one commit, pushed to `main`):**
- React Router (`react-router-dom`) added. Three routes:
  - `/projects` → grid of all jobs with thumbnails
  - `/projects/new` → existing DropZone (URL-driven)
  - `/projects/:id` → workspace (URL-driven, refresh-safe, shareable)
- `useWorkspace(jobId)` hook in `frontend/src/hooks/` — encapsulates segments, undo/redo, auto-save, video URL. Reusable across routes.
- `lib/defaultStyle.js` — extracted DEFAULT_STYLE + loadSavedStyle so both routes agree.
- Thumbnail extraction:
  - `extract_thumbnail()` in `video_worker.py` (single ffmpeg seek + scale 480px)
  - Pipeline runs audio extract + thumbnail in parallel via `asyncio.to_thread`
  - `GET /jobs/{id}/thumb` endpoint (public, behind password gate's path exception)
  - One-shot backfill ran locally — 32 of 33 existing jobs got thumbnails (the last is a corrupt test stub)
- Karaoke UX guardrail in `DesignControls.jsx`: the On/Off buttons are disabled when no segment has `words[]`, with explainer text directing users to re-upload with Gemini.
- Backend timing logs now include the model name: `[gemini:gemini-2.5-flash] ...`

**App.jsx refactor:**
- Was 320 lines of full-state controller. Now ~70 lines: persistent shell (top bar + Outlet) + nav helpers. All editor state moved to `Workspace.jsx` via `useWorkspace`.
- Header now uses `Link` to `/projects/new` instead of an in-app `handleNewVideo`. RecentVideosMenu and ExportMenu kept verbatim, just receive the `workspaceId` from URL match.

**Forward-compat with auth (Phase B, next slice):**
- Job IDs unchanged (no DB migration needed).
- Backend `/jobs/*` paths unchanged (Phase B just wraps with auth dep).
- `useWorkspace` is reusable — `useAuth()` slots beside it.
- Routes are simple — `<RequireAuth>` wraps them later.

**What's NOT in this slice (intentional):**
- Auth / users / sessions.
- Per-user data isolation.
- Sign-up / pricing / landing.
- Search / filter / sort on Projects list.

**Known issue / not-a-bug:**
- A user reported "60s video takes 50s to process, was 22s before." Investigation: my Slice 1 added ~0.5s of pipeline overhead (negligible). The slowdown is **Google Gemini API latency variance** — same code/model can take 12s one upload and 27s the next. Today's `gemini-2.5-flash` on a Hindi devotional clip took 27s of inference. No code fix possible. Flash is still 2-3× faster than pro on average; verify model selection in Settings.
- One test surfaced "collapsed timestamps detected" — Gemini compressed all 24 words into a 0.43s window. Pipeline already handles this (`_repair_collapsed_word_timestamps` in pipeline.py) by redistributing words uniformly. Karaoke per-word timing is approximate when this triggers.

**Queued for Slice 2 (auth — separate session):**
- `fastapi-users` integration (email/password + JWT cookie).
- SQLite `users` table.
- `user_id` field on every job, filtering on every read.
- `/login`, `/signup`, protected-routes wrapper on frontend.
- Migrate existing jobs to a "default" user on first boot so test data isn't orphaned.
- Plan: shared-password gate stays during transition; retire once auth is solid.

**Files added:**
- `frontend/src/hooks/useWorkspace.js`
- `frontend/src/lib/defaultStyle.js`
- `frontend/src/routes/ProjectsList.jsx`
- `frontend/src/routes/NewProject.jsx`
- `frontend/src/routes/Workspace.jsx`
- `HANDOFF.md` (this file)

**Files modified:**
- `backend/app/main.py` (thumb endpoint + password gate exception)
- `backend/app/pipeline.py` (parallel extract, thumb call)
- `backend/app/video_worker.py` (extract_thumbnail)
- `backend/app/whisper_client.py` (model in log prefix)
- `frontend/src/App.jsx` (shell refactor)
- `frontend/src/main.jsx` (router setup)
- `frontend/src/lib/apiClient.js` (jobThumbUrl)
- `frontend/src/components/DesignControls.jsx` (karaoke guardrail)
- `frontend/package.json` / `package-lock.json` (react-router-dom)

**Deployed to VPS:** Not yet — user pushed via `git push`; VPS deploy will be triggered next time someone SSHs and runs `update.sh`. (Per discussed protocol: push first, deploy on review.)

---

## Protocol going forward

- **Single agent per session.** Whichever machine is being used owns the codebase until end of session. The other agent does not touch the repo.
- **End of session checklist:**
  1. Verify build passes + smoke-test critical paths.
  2. Commit with clear, accurate message.
  3. `git push origin main`.
  4. Update top of `HANDOFF.md` with what landed, what's broken, what's queued.
  5. Commit + push `HANDOFF.md`.
  6. (Optional) Deploy to VPS via `update.sh` if changes are user-visible.
- **Start of session checklist:**
  1. `git pull origin main`.
  2. Read this file's top entry.
  3. If frontend deps changed, `cd frontend && npm install`. If backend, `pip install -r backend/requirements.txt`.
  4. Continue.
