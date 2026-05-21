# AutoSub — Deployment Notes (Path C, no Docker)

This directory holds reference systemd units + setup notes for running AutoSub
natively on a Hostinger KVM 2 VPS (2 vCPU, 8 GB RAM, Ubuntu 24.04 LTS).

## 1. One-time VPS setup

```bash
sudo apt update
sudo apt install -y python3.12 python3.12-venv ffmpeg nginx redis-server nodejs npm
sudo systemctl enable --now redis-server
```

Verify Redis: `redis-cli ping` → `PONG`.

## 2. App deploy

```bash
sudo useradd --system --create-home --shell /bin/bash autosub
sudo -iu autosub
git clone <repo> autosub
cd autosub/backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env  # fill in GEMINI_API_KEY etc, set CELERY_ENABLED=true
```

Frontend (one-time build):
```bash
cd ../frontend
npm install
npm run build
# outputs to dist/, served by nginx (config not included here yet)
```

## 3. systemd units

Copy `autosub-api.service` and `autosub-worker.service` to `/etc/systemd/system/`
(edit the `WorkingDirectory` and `User` if your layout differs), then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now autosub-api autosub-worker
sudo systemctl status autosub-api autosub-worker
```

Logs: `journalctl -u autosub-api -f` and `journalctl -u autosub-worker -f`.

## 4. Local dev (Windows)

Install **Memurai** (free Redis-compatible service for Windows):

  https://www.memurai.com/get-memurai

It auto-installs as a Windows service. Verify with `memurai-cli ping` → `PONG`.

Then in three terminals:

```
# Terminal 1 — FastAPI
cd backend
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000 --reload

# Terminal 2 — Celery worker
cd backend
.venv/Scripts/celery.exe -A app.tasks worker -c 1 -P solo --loglevel=info

# Terminal 3 — Vite frontend
cd frontend
npm run dev
```

Set `CELERY_ENABLED=true` in `backend/.env` to dispatch via the worker.
Leave it `false` to run inline in the FastAPI process (no worker needed).
