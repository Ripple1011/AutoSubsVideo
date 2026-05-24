#!/usr/bin/env bash
# Ongoing deploy: pull from GitHub, refresh deps, rebuild frontend, restart.
# Run on the VPS as root. Safe to re-run; quick when nothing has changed.

set -euo pipefail

REPO_DIR="/root/autosub"

cd "$REPO_DIR"

echo "=== git pull ==="
git pull --ff-only

echo "=== backend deps (pip — fast if requirements unchanged) ==="
backend/.venv/bin/pip install -r backend/requirements.txt

echo "=== frontend build (npm install + vite build) ==="
cd "$REPO_DIR/frontend"
npm install
npm run build
cd "$REPO_DIR"

# Re-apply the world-read perms on dist/ since vite wipes the dir on
# each build. setup.sh added /root + /root/autosub +x traversal once;
# only the dist contents need refreshing now.
chmod -R o+r /root/autosub/frontend/dist 2>/dev/null || true

echo "=== restart systemd unit ==="
systemctl restart autosub
sleep 1
systemctl --no-pager status autosub | head -n 10

echo
echo "Done. Tail logs with:  journalctl -u autosub -f"
