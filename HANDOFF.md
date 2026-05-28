# Handoff Notes

Most recent session at the top. Each session: what landed, what works, what's queued.
Both AI agents update this file at end of session. Read before starting.

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
