# Testing Deploy Runbook

Gets the API + Dashboard running on a fresh VPS, reachable by IP, for hands-on testing — not a hardened production/alpha deploy. Read [Scope & what this is not](#scope--what-this-is-not) before you start so the gaps are intentional, not surprises.

---

## 0. Provision the VPS

Any provider works; Hetzner CX22 (2 vCPU / 4GB RAM, ~€4/mo) is comfortably enough for one testing tenant.

1. Create the server — **Ubuntu 24.04 LTS**, add your SSH key at creation (skip password auth entirely)
2. SSH in: `ssh root@<server-ip>`
3. Basic hardening (5 minutes, worth doing even for testing):
   ```bash
   apt update && apt upgrade -y
   ufw allow OpenSSH
   ufw allow 80/tcp
   ufw enable
   ```
4. Create a non-root user for running the app (don't run Node as root):
   ```bash
   adduser slotwise
   usermod -aG sudo slotwise
   su - slotwise
   ```

All commands below assume you're now logged in as `slotwise`, in its home directory.

---

## 1. Install runtime dependencies

```bash
# Node 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Build tools — bcrypt has native bindings, needs these to compile on install
sudo apt install -y build-essential python3

# Docker + Compose (for Postgres/Redis)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker slotwise
newgrp docker   # picks up the docker group without a fresh login

# nginx
sudo apt install -y nginx

# PM2, globally
sudo npm install -g pm2
```

Verify: `node -v` should print v20.x. `docker ps` should run without `sudo`.

---

## 2. Get the code onto the box

```bash
cd ~
git clone <your-repo-url> slotwise
cd slotwise
```

(If you're not using git yet, `scp -r` the project directory instead — just make sure `node_modules` and `dist` aren't included, they'll be rebuilt on the server.)

---

## 3. Start Postgres + Redis

```bash
docker compose up -d
docker compose ps   # both should show "healthy" within ~10s
```

---

## 4. Configure environment

### API (`apps/api/.env`)

```bash
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
```

Set these for real:

```bash
NODE_ENV=development
# INTENTIONALLY development, not production, for this HTTP-only testing
# deploy. The refresh-token cookie sets Secure: true when NODE_ENV is
# "production" (apps/api/src/routes/auth.ts) — browsers silently refuse to
# send Secure cookies over plain HTTP, which would make login appear to work
# but session-restore-on-reload would always fail with no obvious error.
# Switch this once TLS is in front of the app (see the end of this doc).

PORT=3001
PUBLIC_BASE_URL=http://<server-ip>:3001
# Only matters if testing WhatsApp/SMS webhooks — otherwise harmless as-is.

JWT_SECRET=<generate one: openssl rand -hex 32>

DATABASE_URL=postgresql://slotwise:slotwise@localhost:5432/slotwise
REDIS_URL=redis://localhost:6379

ANTHROPIC_API_KEY=sk-ant-...
# Required for the AI agent channel. Leave blank only if you're not testing
# the agent — booking via widget/dashboard works without it.

ALLOWED_ORIGINS=http://<server-ip>
# The DASHBOARD's public-facing origin (what the browser's Origin header
# will actually be), NOT the API's own address. With the single-origin nginx
# setup in this doc, that's the same host, no port — e.g. http://203.0.113.5
# (not http://203.0.113.5:3000, not http://localhost:anything).
```

Leave Twilio/Brevo vars blank if you're not testing notifications yet — `notification-worker.ts` will log dispatch failures but won't crash the app.

### Dashboard (`apps/dashboard/.env.local`)

```bash
cp apps/dashboard/.env.local.example apps/dashboard/.env.local
nano apps/dashboard/.env.local
```

```bash
NEXT_PUBLIC_API_BASE_URL=
# Empty/relative — see infrastructure/nginx/slotwise.conf. The dashboard and
# API are served from the same origin, so API calls go to relative /api/v1/...
# paths and the browser resolves them against whatever host you're actually
# visiting. This also sidesteps CORS entirely for the dashboard's own calls.
```

This is a build-time variable (`NEXT_PUBLIC_*` prefix) — if you change it later, you must rebuild (next section), not just restart the process.

---

## 5. Install and build

From the **repo root** (not inside `apps/api`) — this matters, see the note below.

```bash
cd ~/slotwise
npm install
npm run build
```

> **Why repo root matters**: `apps/api` depends on two internal workspace packages (`@slotwise/types`, `@slotwise/slot-optimizer`). npm workspaces only creates the `node_modules` symlinks for these when `install` runs at the root. Turborepo's `build` task also builds them in the correct order (`types` → `slot-optimizer` → `api`) via the `^build` dependency declared in `turbo.json` — running `npm run build` inside `apps/api` alone would skip that and fail.

**This is the first time this exact build has run outside local dev** — watch the output. If `tsc` errors on the workspace packages, stop here and report it back rather than trying to work around it; that's a real bug to fix, not a deploy-environment quirk.

Run the migrations and seed data:

```bash
npm run db:migrate --workspace=apps/api
npm run db:seed --workspace=apps/api
```

The seed output prints a login email/password — save it, that's how you'll log into the dashboard.

---

## 6. Configure nginx

```bash
sudo cp infrastructure/nginx/slotwise.conf /etc/nginx/sites-available/slotwise
sudo ln -s /etc/nginx/sites-available/slotwise /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7. Start the app with PM2

```bash
cd ~/slotwise
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # prints a command — copy/paste and run it, makes PM2 survive a reboot
```

Check status and logs:

```bash
pm2 status
pm2 logs slotwise-api --lines 50
pm2 logs slotwise-dashboard --lines 50
```

---

## 8. Verify

```bash
curl http://localhost:3001/health
```

Expect something like `{"status":"ok","ts":"...","db":{"healthy":true,...}}`.

From a browser: visit `http://<server-ip>`. You should land on the dashboard, get redirected to `/login`, and be able to log in with the seeded credentials from step 5.

If login succeeds but a page reload bounces you back to `/login`: check `NODE_ENV` in `apps/api/.env` is `development` (see step 4) — this is the single most likely cause.

---

## Common failure modes

| Symptom | Likely cause |
|---|---|
| `502 Bad Gateway` from nginx | PM2 process isn't running — check `pm2 status` and `pm2 logs` |
| Login works, reload logs you out | `NODE_ENV=production` with no TLS — cookie isn't being sent |
| Dashboard loads but every API call fails | `ALLOWED_ORIGINS` doesn't match the browser's actual origin, or `NEXT_PUBLIC_API_BASE_URL` was set to something other than empty/relative and the dashboard wasn't rebuilt after changing it |
| `tsc` build fails on `@slotwise/types` import | `npm install` was run inside `apps/api/` instead of the repo root — re-run from root |
| Migration runner says "no migrations directory found" | `db:migrate` wasn't run via the workspace script from the root — use `npm run db:migrate --workspace=apps/api`, don't `cd` into the subdirectory and run it directly |

---

## Scope & what this is not

This gets the app running and reachable for hands-on testing — yourself, or a few trusted people you're walking through it live. It is deliberately not:

- **TLS-secured.** Plain HTTP. Anyone on the network path can see requests, including login credentials in transit.
- **Production-hardened.** `NODE_ENV=development` is required for cookies to work at all without TLS — a real, intentional tradeoff for this pass, not an oversight.
- **Tested under load.** One Node process per app, no clustering, no monitoring beyond `pm2 logs`.
- **Multi-tenant safe for strangers.** Fine for one tenant you're personally walking through it with.

Moving from this to an actual alpha (a real, unsupervised tenant's business) needs at minimum: a real domain + TLS (certbot is the easy path once a domain points at the server), `NODE_ENV=production` switched back on once TLS makes that safe, and `ALLOWED_ORIGINS`/`PUBLIC_BASE_URL` updated from a bare IP to the real domain.
