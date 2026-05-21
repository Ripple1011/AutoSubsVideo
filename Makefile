# AutoSub — convenience targets for local dev.
# Designed for macOS + Linux. Windows users should follow README.md.

SHELL := /bin/bash
PY    := python3.12
VENV  := backend/.venv
ACT   := source $(VENV)/bin/activate

.PHONY: help setup brew backend frontend run api worker web clean

help:
	@echo ""
	@echo "AutoSub — available make targets:"
	@echo ""
	@echo "  make setup       Full setup: brew deps + backend venv + frontend npm"
	@echo "  make brew        Install Homebrew system deps (python, node, ffmpeg, redis)"
	@echo "  make backend     Create venv + pip install (assumes Python 3.12)"
	@echo "  make frontend    npm install"
	@echo ""
	@echo "  make run         Run API + frontend together (no Celery)"
	@echo "  make api         Run FastAPI only"
	@echo "  make worker      Run Celery worker only (requires Redis + CELERY_ENABLED=true)"
	@echo "  make web         Run Vite dev server only"
	@echo ""
	@echo "  make clean       Delete .venv, node_modules, data/, *.pyc"
	@echo ""

setup: brew backend frontend
	@echo ""
	@echo "✅ Setup complete."
	@echo "   Next: cp backend/.env.example backend/.env  (then add GEMINI_API_KEY)"
	@echo "         make run"
	@echo ""

brew:
	@command -v brew >/dev/null || { echo "Homebrew not found — install from https://brew.sh"; exit 1; }
	brew install python@3.12 node ffmpeg redis
	brew services start redis

backend:
	@test -d $(VENV) || $(PY) -m venv $(VENV)
	$(ACT) && pip install --upgrade pip && pip install -r backend/requirements.txt

frontend:
	cd frontend && npm install

# Run API + web in parallel. Ctrl-C kills both (trap handles the cleanup).
run:
	@trap 'kill 0' EXIT INT TERM; \
	$(MAKE) -j2 api web

api:
	$(ACT) && cd backend && uvicorn app.main:app --port 8000 --reload

worker:
	$(ACT) && cd backend && celery -A app.tasks worker -c 1 --loglevel=info

web:
	cd frontend && npm run dev

clean:
	rm -rf $(VENV) frontend/node_modules backend/data
	find . -type d -name __pycache__ -exec rm -rf {} +
