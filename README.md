# AutoSub

Multilingual automated subtitle generator for short-form video creators (YouTube Shorts, Instagram Reels, TikTok). Supports English, Hindi, and Gujarati.

**Stack:** FastAPI · React (Vite) · TailwindCSS · Celery · Redis · Cloud ASR (Groq / OpenAI / Sarvam / Gemini).

---

## Quick start

### macOS / Linux — two commands

Requires [Homebrew](https://brew.sh) on macOS, or apt on Linux. Then:

```bash
git clone https://github.com/Ripple1011/AutoSubsVideo.git autosub
cd autosub
make setup    # installs system deps + venv + npm install
make run      # starts FastAPI :8000 + Vite :5173
```

Open [http://localhost:5173](http://localhost:5173). Paste your Gemini API key in the **⚙ Settings** modal (stored in browser, never on disk).

Other useful targets: `make api`, `make web`, `make worker`, `make clean`. Run `make help` to list them.

### Windows

Make isn't installed by default on Windows. Use the manual steps below.

#### Prerequisites

- Python 3.12 ([python.org](https://www.python.org/downloads/))
- Node 20+ ([nodejs.org](https://nodejs.org))
- [Memurai](https://www.memurai.com/get-memurai) (Redis-compatible Windows service) — only needed if you want the Celery async path

#### Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env             # add your GEMINI_API_KEY etc.
uvicorn app.main:app --port 8000 --reload
```

#### Frontend

```powershell
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

#### Optional — Celery worker

Only needed if `CELERY_ENABLED=true` in `backend/.env`.

```powershell
cd backend
.venv\Scripts\activate
celery -A app.tasks worker -c 1 -P solo --loglevel=info
```

The `-P solo` flag is Windows-only (Celery's default `prefork` pool requires `os.fork()`).

---

## ASR provider config

Set one of these via the **⚙ Settings** modal in the UI (per-request BYOK) or `.env`:

| Provider | Best for | Models |
|---|---|---|
| **Gemini** | Hindi / Gujarati accuracy + real timestamps | `gemini-2.5-flash` (default), `gemini-2.5-pro` (best) |
| **Groq** | Fast English | `whisper-large-v3` |
| **OpenAI** | English | `whisper-1` |
| **Sarvam** | Indic text accuracy (no per-word timestamps) | `saarika:v2.5` |

Get keys at [aistudio.google.com](https://aistudio.google.com), [console.groq.com](https://console.groq.com), [platform.openai.com](https://platform.openai.com), [dashboard.sarvam.ai](https://dashboard.sarvam.ai).

---

## Project layout

```
backend/    FastAPI + Celery worker (Python 3.12+)
frontend/   React + Vite + Tailwind v4
deploy/     systemd units for Hostinger VPS deployment
CLAUDE.md   Detailed architecture + design decisions
```

See `CLAUDE.md` for the full system design and `deploy/README.md` for VPS deployment.
