# Handoff Notes

Most recent session at the top. Each session: what landed, what works, what's queued.
Both AI agents update this file at end of session. Read before starting.

---

## 2026-05-28 · Windows agent

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
