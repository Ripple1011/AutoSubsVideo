# CLAUDE.md — AutoSub Master Source of Truth

This file is the persistent system directive for Claude Code when operating inside the AutoSub repository. Treat it as authoritative; defer to it over assumptions.

---

## 1. Product Scope

**AutoSub** — a multilingual automated subtitle generator web app for short-form video creators (YouTube Shorts, Instagram Reels, TikTok).

- **Input:** `.mp4` / `.mov` uploads (≤10 min personal, throttled to 90s for future SaaS tiers).
- **Output:** Stylized, speech-synchronized subtitles, exported as either:
  - **Soft export** — original video + `.srt` / `.vtt` sidecar (free/fast tier).
  - **Hard export** — style JSON + video burned via FFmpeg in Celery (pro tier).
- **Languages:** English, Hindi, Gujarati (with Auto-Detect default).

---

## 2. Finalized Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | **React (Vite, JavaScript) + TailwindCSS** | Premium, instant visual editing; responsive canvas. |
| Backend API | **FastAPI (Python 3.11+)** | Async-native, ideal for streaming uploads. |
| Transcription | **Cloud Whisper API / Groq** | Offloads CPU-heavy ASR away from Hostinger KVM 2. |
| Video Processing | **MoviePy + FFmpeg** | Audio extraction on intake; frame burn on export. |
| Async Queue | **Celery + Redis** | Single-file rendering pipeline; prevents server crash. |
| Host Target | **Hostinger KVM 2** (2 vCPU, 8GB RAM, Ubuntu) | Constrained — no local AI inference allowed. |

**Hard constraint:** No local model inference. All AI transcription is cloud-delegated. Heavy I/O (extract/burn) runs only inside the Celery worker, never inside the FastAPI request thread.

---

## 3. Canonical Directory Map

```
autosub-root/
├── backend/                       # FastAPI Application
│   ├── app/
│   │   ├── main.py                # Core API endpoints (upload, status, export)
│   │   ├── config.py              # pydantic-settings env loader
│   │   ├── storage.py             # Filesystem layout + job state I/O
│   │   ├── video_worker.py        # MoviePy / FFmpeg pipelines
│   │   ├── whisper_client.py      # Multi-provider ASR (Groq/OpenAI/Sarvam/Gemini)
│   │   └── tasks.py               # Celery background job definitions
│   ├── data/                      # Runtime: uploads/{job_id}/, jobs/{job_id}.json
│   ├── requirements.txt
│   └── .env                       # GEMINI_API_KEY, etc. (gitignored)
├── frontend/                      # React (Vite) Application
│   ├── src/
│   │   ├── components/            # VideoCanvas, SubtitleSidebar, ColorPicker, …
│   │   ├── lib/                   # apiClient (BYOK headers + fetch wrapper)
│   │   ├── App.jsx                # Main dashboard layout
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js             # Tailwind v4 plugin + /api proxy
└── CLAUDE.md                      # This file
```

**Deployment model (Path C — no Docker):**
- Local dev: Python venv (`backend/.venv`) + npm/Vite + native Redis binary (Windows fork).
- Hostinger VPS: `apt install redis-server`, run FastAPI/Celery via systemd. No Docker Desktop, no Docker Engine, no docker-compose.yml. Saves ~500 MB RAM on the 8 GB box.
- TailwindCSS v4 is config-less (no `tailwind.config.js` needed); imports via `@tailwindcss/vite` plugin.

---

## 4. Execution Paradigms (Non-Negotiable)

1. **Decoupled heavy work:** Any task touching FFmpeg, MoviePy, or large file I/O must be dispatched via `tasks.py` to Celery. FastAPI handlers stay thin.
2. **Cloud-only ASR:** `whisper_client.py` is the single entry point for transcription. No local Whisper models, no `torch` in `requirements.txt`.
3. **Hybrid API key strategy (BYOK-ready):**
   - **Server default:** `GROQ_API_KEY`, `OPENAI_API_KEY`, and `ASR_PROVIDER` (`groq` | `openai`) live in backend `.env`, loaded via `pydantic-settings`. Never exposed to the frontend.
   - **UI override (BYOK):** A frontend Settings modal accepts a user-supplied key + provider + model selection (e.g. `whisper-large-v3`, `whisper-large-v3-turbo`). Stored only in browser `localStorage`; sent per-request via `X-User-ASR-Key`, `X-User-ASR-Provider`, `X-User-ASR-Model` headers. **Never persisted server-side.**
   - **Resolution order in `whisper_client.py`:** user-supplied headers → server `.env` fallback → 400 error if neither present.
   - Model selection is provider-scoped (Groq models ≠ OpenAI models); frontend dropdown is filtered by chosen provider.
4. **Style-as-data:** Subtitle styling (font, hex colors, scale, alignment, position) is a JSON schema generated on the frontend. Soft exports never invoke the worker; hard exports POST the schema → FastAPI → Celery → FFmpeg.
5. **9:16 canvas authority:** The right-hand preview is the single source of visual truth — all style changes render via a transparent HTML overlay on top of the native `<video>` element with zero server round-trips during editing.
6. **Left/right split UI:** Left = editable timestamped text blocks (click-to-scrub). Right = 9:16 phone-ratio canvas with live style overlay.
7. **Resource discipline:** Target a 2 vCPU / 8 GB box. One concurrent render job. Reject uploads >10 min server-side before queuing.

---

## 5. UI States

- **Setup State:** Drag-and-drop zone, language dropdown (Auto-Detect / English / Hindi / Gujarati), single "Generate Subtitles" CTA.
- **Interactive Workspace:** Two equal columns — script editor (left) + 9:16 canvas with transparent overlay (right) + design sidebar.
- **Design Sidebar:** Fonts (Impact, Montserrat Black, Poppins Bold), hex pickers (text, outline, highlight), scale slider, vertical alignment (Top/Center/Bottom).

---

## 6. Operating Rules for Claude Code

- **Never install global packages, scaffold dependencies, or write config without explicit user approval per task.**
- Confirm before creating new top-level directories outside the canonical map above.
- Prefer editing existing files over creating new ones.
- Keep backend handlers async; never block the event loop on FFmpeg/MoviePy.
- All commits/PRs should call out which architectural layer they touch (backend / frontend / worker / infra).
