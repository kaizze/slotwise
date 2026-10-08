# AGENTS.md

## Cursor Cloud specific instructions

SlotWise is a Turborepo monorepo. See `README.md` for the product overview and the
canonical list of commands/endpoints. This section only captures non-obvious
setup/run caveats for cloud agents.

### Services

| Service | Path | Dev command | Port | Notes |
|---------|------|-------------|------|-------|
| API (Fastify) | `apps/api` | `npm run dev` (in `apps/api`) | 3001 | Needs Postgres + Redis running. |
| Dashboard (Next.js) | `apps/dashboard` | `npm run dev` (in `apps/dashboard`) | 3000 | Talks to the API at `http://localhost:3001`. |
| Widget (Vite) | `apps/widget` | `npm run dev` / `npm run build` | 5173 (dev) | Framework-free embeddable bundle; no backend needed to build. |
| `packages/types`, `packages/slot-optimizer` | `packages/*` | `npm run build` | — | Shared libs consumed as `dist/` (see below). |

### Startup (dependencies already installed by the update script)

The update script only runs `npm install`. The following are runtime/startup steps the
agent must do each session (they are intentionally NOT in the update script):

1. **Build the shared packages first.** `apps/api` imports `@slotwise/types` and
   `@slotwise/slot-optimizer` via their compiled `dist/` (the packages' `main` fields),
   and `dist/` is gitignored. The API (run with `tsx`) will fail to resolve these imports
   until they are built:
   `npm run build --workspace=packages/types --workspace=packages/slot-optimizer`
   (uses npm workspaces directly, so it works even if the `packageManager` field — see
   below — has not been merged).
2. **Start infra.** There is no Docker/systemd in the cloud VM, so `docker-compose up` is
   not used. Start the apt-installed services directly:
   `sudo pg_ctlcluster 16 main start` and
   `sudo redis-server --daemonize yes --maxmemory 256mb --maxmemory-policy allkeys-lru`.
   Postgres role/db is `slotwise`/`slotwise` (password `slotwise`) on `:5432`, matching
   `DATABASE_URL` in `apps/api/.env`.
3. **Env files.** Copy `apps/api/.env.example` → `apps/api/.env` and
   `apps/dashboard/.env.local.example` → `apps/dashboard/.env.local` if missing. Set a real
   `JWT_SECRET` in the API env. `.env` files are gitignored.
4. **Migrate + seed.** From `apps/api`: `npm run db:migrate` then `npm run db:seed` (both use
   `tsx` directly — no turbo). Seed creates business `salon-eleni` and owner login
   `owner@saloneleni.gr` / `devpassword123`.

### Non-obvious gotchas

- **Turbo requires a `packageManager` field.** The pinned turbo (2.10.3) refuses to resolve
  the workspace without `packageManager` in the root `package.json`, so `npm run dev|build|lint`
  (which go through turbo) fail without it. This field was added during setup. If it is not
  merged, run per-app commands directly (e.g. `npm run dev` inside `apps/api` / `apps/dashboard`,
  which are `tsx`/`next` and don't need turbo).
- **`npm run lint` is not functional out of the box.** The only `lint` script is the dashboard's
  `next lint`, and there is no committed ESLint config, so it drops into an interactive
  "configure ESLint" prompt and fails non-interactively. There is nothing to fix here as part of
  environment setup.
- **The AI agent endpoint needs an LLM key.** `POST /api/v1/agent/:slug/chat` requires
  `OPENAI_API_KEY` (or `GOOGLE_API_KEY` / `ANTHROPIC_API_KEY` with `AGENT_LLM_PROVIDER`). The
  provider client is lazily created, so the server boots fine without a key — only the agent
  route fails until one is set. The core booking flow (slots + bookings + auth) needs no LLM key.
- **Pre-existing dashboard CORS bug.** The dashboard's `api-client` sends `credentials: 'include'`
  on every request, but the API only enables credentialed CORS for `/api/v1/auth`, `/api/v1/staff`,
  and `/api/v1/services` (`CREDENTIALED_PATH_PREFIXES` in `apps/api/src/server.ts`). So in a
  browser the dashboard's **bookings calendar** and **settings** pages fail to load with
  "Could not load bookings" (the `/api/v1/bookings` and `/api/v1/businesses` responses lack
  `Access-Control-Allow-Credentials: true`). Login, Services, and Staff pages work. This is an
  application defect, not an environment issue.
