#!/usr/bin/env bash
# AutoSub first-time VPS bootstrap for Ubuntu 24.04.
#
# Assumes:
#   - Running as root.
#   - Repo cloned to /root/autosub (i.e., $REPO_DIR below).
#   - Outbound internet works for apt / pip / npm / Google Fonts.
#
# Idempotent for everything except the systemd / nginx file copies (those
# overwrite). Safe to re-run. Doesn't touch backend/.env if it exists.

set -euo pipefail

REPO_DIR="/root/autosub"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root."
  exit 1
fi

if [[ ! -d "$REPO_DIR" ]]; then
  echo "ERROR: expected the repo at $REPO_DIR. Clone it there first:"
  echo "    cd /root && git clone https://github.com/Ripple1011/AutoSubsVideo.git autosub"
  exit 1
fi

echo
echo "=== [1/6] System packages (apt) ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update
# Ubuntu 24.04 ships Python 3.12 as the default python3; no PPA needed.
apt-get install -y \
  python3 python3-venv python3-dev \
  ffmpeg \
  redis-server \
  nginx \
  curl git build-essential

echo
echo "=== [2/6] Node.js 22 (Vite needs 20+) ==="
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | cut -dv -f2 | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "Node $(node -v) already installed — keeping."
fi

echo
echo "=== [3/6] Python venv + backend deps ==="
cd "$REPO_DIR"
if [[ ! -d backend/.venv ]]; then
  python3 -m venv backend/.venv
fi
backend/.venv/bin/pip install --upgrade pip
backend/.venv/bin/pip install -r backend/requirements.txt

echo
echo "=== [4/6] Frontend npm install + build ==="
cd "$REPO_DIR/frontend"
npm install
npm run build
cd "$REPO_DIR"

# nginx runs as www-data and can't traverse into /root by default (root's
# home is mode 700). Open just the directory chain down to dist/ for
# traversal + read; the .env file inside backend/ stays mode 600 so its
# secrets are still inaccessible to www-data.
chmod o+x /root /root/autosub /root/autosub/frontend /root/autosub/frontend/dist 2>/dev/null || true
chmod -R o+r /root/autosub/frontend/dist 2>/dev/null || true

echo
echo "=== [5/6] systemd unit ==="
cp "$REPO_DIR/deploy/autosub.service" /etc/systemd/system/autosub.service
systemctl daemon-reload
systemctl enable autosub
# Don't start yet — wait until the user fills in backend/.env. Tell them.

echo
echo "=== [6/6] nginx vhost ==="
# Add as a NEW vhost — won't touch any existing sites already enabled on
# this VPS. AutoSub listens on :8080 to avoid clashing with anything on
# :80. Don't remove sites-enabled/default here; another app may rely on
# it and the script needs to coexist with whatever's already deployed.
cp "$REPO_DIR/deploy/nginx.conf" /etc/nginx/sites-available/autosub
ln -sf /etc/nginx/sites-available/autosub /etc/nginx/sites-enabled/autosub
nginx -t
systemctl reload nginx

# Drop a starter .env if there isn't one, so the operator just edits values
# rather than typing the file from scratch.
if [[ ! -f "$REPO_DIR/backend/.env" ]]; then
  cp "$REPO_DIR/deploy/env.example" "$REPO_DIR/backend/.env"
  chmod 600 "$REPO_DIR/backend/.env"
  echo
  echo "Created backend/.env from deploy/env.example. Edit it now to set"
  echo "GEMINI_API_KEY and SHARED_PASSWORD (see comments in the file)."
fi

# Make sure redis is up — installed earlier but might not be started.
systemctl enable --now redis-server

PUBLIC_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || echo "<your-vps-ip>")"

cat <<EOF

────────────────────────────────────────────────────────────
Setup complete.

NEXT STEPS:

  1. Edit the env file with your secrets:
       nano $REPO_DIR/backend/.env

     Required for production:
       SHARED_PASSWORD=...          (the gate password you'll share)
     Optional but recommended (so users without BYOK still work):
       GEMINI_API_KEY=...

  2. Start the API:
       systemctl start autosub

  3. Verify it came up:
       systemctl status autosub
       curl -s http://127.0.0.1:8001/health | head

  4. Open port 8080 in the firewall (if ufw is enabled):
       ufw allow 8080/tcp

  5. Visit your site:
       http://${PUBLIC_IP}:8080/

  To deploy updates later, just run:
       /root/autosub/deploy/update.sh

  To tail logs:
       journalctl -u autosub -f
────────────────────────────────────────────────────────────
EOF
