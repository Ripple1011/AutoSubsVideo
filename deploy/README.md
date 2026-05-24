# Deploying AutoSub to a Hostinger VPS

Target: **Ubuntu 24.04**, root access, IP-only (no domain yet). Architecture is `nginx → uvicorn (systemd) → FastAPI`; the frontend builds to static files served by nginx. Source of truth is GitHub `main`; the VPS pulls from there.

```
[ your laptop ] ── git push ──→ [ GitHub main ] ── ssh + pull ──→ [ Hostinger VPS ]
                                                                   nginx :80
                                                                     ↓
                                                                   uvicorn :8000
                                                                     ↓
                                                                   data/uploads/
                                                                   data/jobs/
                                                                   data/fonts/
```

---

## 1. First-time setup (~15 minutes)

Run these once per fresh VPS.

### a. SSH in

```bash
ssh root@<your-vps-ip>
```

### b. Install git + clone the repo

```bash
apt-get update && apt-get install -y git
cd /root
git clone https://github.com/Ripple1011/AutoSubsVideo.git autosub
```

Repo MUST live at `/root/autosub` — the systemd unit and nginx config hardcode that path. If you want a different location, edit `deploy/autosub.service` and `deploy/nginx.conf` first.

### c. Run the bootstrap script

```bash
cd /root/autosub
chmod +x deploy/setup.sh deploy/update.sh
./deploy/setup.sh
```

This installs system packages (python3, node 22, ffmpeg, redis, nginx), builds the backend venv + frontend bundle, copies the systemd unit and nginx vhost into place, and drops a starter `backend/.env` if one doesn't exist.

### d. Set the password + Gemini key

```bash
nano /root/autosub/backend/.env
```

Set at least:

```
SHARED_PASSWORD=<a-long-random-string>
GEMINI_API_KEY=<your-gemini-key>
```

Save and exit.

### e. Start the service

```bash
systemctl start autosub
systemctl status autosub          # should say "active (running)"
journalctl -u autosub -n 30       # check the boot log
```

### f. Visit it

Open `http://<your-vps-ip>/` in any browser. You'll be prompted for the shared password the first time. After that it's stored in your browser's localStorage and sent on every API call.

---

## 2. Ongoing deploys (after every git push)

From the VPS:

```bash
ssh root@<your-vps-ip>
/root/autosub/deploy/update.sh
```

That pulls the latest `main`, refreshes Python + Node deps if any changed, rebuilds the frontend, and restarts the service. Takes 20-60 seconds depending on what changed.

If you want to script this from your laptop in a single command:

```bash
ssh root@<your-vps-ip> '/root/autosub/deploy/update.sh'
```

---

## 3. Adding a domain + SSL later

Once you point a domain (or subdomain) at the VPS:

1. Edit `/etc/nginx/sites-available/autosub`:

   ```
   server_name autosub.yourdomain.com;
   ```

2. Reload nginx and run certbot:

   ```bash
   apt-get install -y certbot python3-certbot-nginx
   nginx -t && systemctl reload nginx
   certbot --nginx -d autosub.yourdomain.com
   ```

   Certbot rewrites the nginx file in place to add an HTTPS server block on 443 and a redirect from 80 → 443. Auto-renewal is wired by certbot's systemd timer.

---

## 4. Operations cheat-sheet

| Task | Command |
|---|---|
| Tail live logs | `journalctl -u autosub -f` |
| Last 100 lines | `journalctl -u autosub -n 100` |
| Restart only the API | `systemctl restart autosub` |
| Reload nginx config | `nginx -t && systemctl reload nginx` |
| Backup all job data | `tar czf autosub-data-$(date +%F).tgz -C /root/autosub/backend data/` |
| Disk usage by jobs | `du -sh /root/autosub/backend/data/uploads/*` |
| Delete a specific job manually | `rm -rf /root/autosub/backend/data/uploads/<id>; rm /root/autosub/backend/data/jobs/<id>.json` |
| Wipe ALL jobs | `rm -rf /root/autosub/backend/data/uploads/* /root/autosub/backend/data/jobs/*.json` |
| Reset the shared password | edit `backend/.env`, `systemctl restart autosub`, browsers re-prompt on next request |

---

## 5. Firewall

Open only what nginx needs:

```bash
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp     # for when you add SSL
ufw enable
```

Do NOT open port `8000`. The backend listens on `127.0.0.1` only — nginx is the only thing that talks to it. Opening 8000 publicly would let visitors bypass nginx and the password gate.

---

## 6. Things to know

- **Data location**: `/root/autosub/backend/data/`. Survives deploys. Wipe if you want a clean slate.
- **Auto-retention**: jobs older than `RETENTION_DAYS` (default 14) are removed on every `GET /jobs` call. Configurable in `backend/.env`.
- **Font bundle**: downloaded automatically on first startup into `data/fonts/`. ~5 MB. Required for burn-in WYSIWYG.
- **Re-renders**: burned mp4s are cached at `data/uploads/{id}/burned.mp4`. A second click with the same style returns instantly. Delete that file to force a re-render.
- **Logs are noisy** during transcription (Gemini timing prints). Filter with `journalctl -u autosub -f | grep -v gemini` if you want quieter output.
- **CELERY_ENABLED**: keep `false`. The pipeline runs inline. Celery isn't fully wired in this deploy; the legacy `autosub-api.service` + `autosub-worker.service` units are kept as reference for a future Celery-based deploy under a dedicated service user.

---

## 7. Troubleshooting

- **502 Bad Gateway from nginx** — backend isn't running. `systemctl status autosub` and `journalctl -u autosub -n 50`.
- **401 Unauthorized in the browser** — password mismatch. Clear the site's `localStorage` (DevTools → Application → Local Storage → delete `autosub.password`) and refresh, you'll be re-prompted. Or edit `backend/.env` and restart the service.
- **Burn fails with "fonts not found"** — first startup downloads fonts; check `ls /root/autosub/backend/data/fonts/`. If empty, look at `journalctl -u autosub` for `[fonts] WARNING:` lines indicating which URLs failed.
- **Disk full** — check `du -sh /root/autosub/backend/data/uploads/*`. Lower `RETENTION_DAYS` in env and restart, or wipe manually.
- **"Unable to load video" in browser** — the source file is missing. `ls /root/autosub/backend/data/uploads/<id>/`. If the folder is gone (auto-deleted by retention), the job's segments still exist but the source doesn't.

---

## 8. Files in this directory

| File | Purpose |
|---|---|
| `setup.sh` | One-shot first-time VPS bootstrap |
| `update.sh` | Pull-build-restart for every subsequent deploy |
| `autosub.service` | systemd unit currently in use (single uvicorn process, runs as root) |
| `nginx.conf` | Reverse proxy + SPA static serving |
| `env.example` | Starter `backend/.env` template (copied during setup) |
| `autosub-api.service` | (legacy) systemd unit for FastAPI under a dedicated `autosub` user |
| `autosub-worker.service` | (legacy) systemd unit for Celery worker — only needed if `CELERY_ENABLED=true` |
