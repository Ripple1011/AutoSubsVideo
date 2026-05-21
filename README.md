# AutoSub

Multilingual automated subtitle generator for short-form video creators (YouTube Shorts, Instagram Reels, TikTok). Supports English, Hindi, and Gujarati.

**Stack:** FastAPI · React (Vite) · TailwindCSS · Celery · Redis · Cloud ASR (Groq / OpenAI / Sarvam / Gemini).

---

## Quick start — local dev

### Prerequisites

| OS | Install |
|---|---|
| **macOS** | `brew install python@3.12 node ffmpeg redis && brew services start redis` |
| **Windows** | Python 3.12, Node 20+, [Memurai](https://www.memurai.com/get-memurai) (Redis port) |
| **Linux** | `sudo apt install python3.12 python3.12-venv nodejs npm ffmpeg redis-server` |

### Backend

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                # add your GEMINI_API_KEY etc.
uvicorn app.main:app --port 8000 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev                         # http://localhost:5173
```

### Optional — Celery worker (async pipeline)

Only needed if `CELERY_ENABLED=true` in `backend/.env`. Otherwise the pipeline runs inline in FastAPI.

```bash
cd backend
source .venv/bin/activate
celery -A app.tasks worker -c 1 --loglevel=info
# Windows: add `-P solo` flag
```

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
