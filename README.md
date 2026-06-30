# SlotWise

Smart booking platform for small businesses with AI-assisted scheduling and an AI agent booking channel.

## Stack

- **API**: Node.js + Fastify + TypeScript
- **Dashboard**: Next.js (TBD - Phase 2)
- **Widget**: Vanilla JS/TS (TBD - Phase 2)
- **Database**: PostgreSQL
- **Cache/Queue**: Redis
- **AI**: Claude API (claude-haiku for agent, claude-sonnet for complex tasks)
- **Monorepo**: Turborepo

## Project Structure

```
slotwise/
├── apps/
│   ├── api/              # Fastify API server
│   │   └── src/
│   │       ├── routes/   # HTTP route handlers
│   │       ├── services/ # Business logic
│   │       ├── agents/   # AI agent loop
│   │       ├── db/       # DB client + migrations
│   │       └── queues/   # Background jobs
│   ├── dashboard/        # Next.js admin (Phase 2)
│   └── widget/           # Embeddable booking widget (Phase 2)
├── packages/
│   ├── types/            # Shared TypeScript interfaces
│   ├── slot-optimizer/   # Slot scoring algorithm
│   └── utils/            # Shared utilities
└── infrastructure/
    ├── postgres/         # SQL schema
    ├── nginx/            # Reverse proxy config
    └── docker/           # Dockerfiles
```

## Getting Started

> Deploying to a real server (even just for testing)? See [`docs/testing-deploy.md`](docs/testing-deploy.md) for the full VPS runbook instead of the local steps below.

### Prerequisites
- Node.js >= 20
- Docker + Docker Compose

### 1. Clone and install

```bash
git clone <repo>
cd slotwise
npm install
```

### 2. Start infrastructure

```bash
docker-compose up -d
# PostgreSQL on :5432, Redis on :6379
# Schema is auto-applied on first run
```

### 3. Configure environment

```bash
cp apps/api/.env.example apps/api/.env
# Edit .env — minimum: ANTHROPIC_API_KEY and JWT_SECRET
```

### 4. Start development

```bash
npm run dev
# API on http://localhost:3001
```

## Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/signup` | Create business + first owner login |
| POST | `/api/v1/auth/login` | Get access token + refresh cookie |
| POST | `/api/v1/auth/refresh` | Rotate refresh token, get new access token |
| POST | `/api/v1/auth/logout` | Revoke refresh token |
| GET  | `/api/v1/auth/me` | Current authenticated business/role |
| GET  | `/api/v1/slots/:businessSlug` | Available slots (scored) |
| POST | `/api/v1/bookings` | Create booking |
| POST | `/api/v1/agent/:businessSlug/chat` | AI agent conversation turn |
| GET  | `/api/v1/bookings/:ref` | Booking by ref |
| POST | `/api/v1/bookings/:ref/cancel` | Cancel booking |
| GET  | `/health` | Health check |

## Auth Model

Two distinct concepts, often confused in booking apps:

- **`staff`** — a bookable resource (a hairdresser, a doctor). No login.
- **`users`** — a dashboard login account (`owner` or `staff` role). May optionally link to a `staff` row via `staffId` if that person is also bookable.

Access tokens are short-lived JWTs (15 min) returned in the response body — the dashboard holds this in memory, not localStorage. Refresh tokens are long-lived (30 days), stored httpOnly + sameSite=strict cookies, hashed in the DB, and rotated on every use (old one is revoked the moment a new one is issued).

> **Note:** `bcrypt` has native bindings. On a fresh VPS, `npm install` may need `build-essential` (Debian/Ubuntu: `apt install build-essential python3`) the first time.

## Agent Channel

The AI agent is accessible at `POST /api/v1/agent/:businessSlug/chat`.

Send the full message history each request (stateless):

```json
{
  "messages": [
    { "role": "user", "content": "I want to book a haircut on Wednesday" }
  ]
}
```

Response:
```json
{
  "reply": "I have slots on Wednesday at 10:00, 14:00, and 17:30. Any preference?",
  "messages": [ ... full updated history ... ]
}
```

## Booking Widget

A framework-free, embeddable booking widget (`apps/widget`) that any client site drops in with one script tag:

```html
<script
  src="https://cdn.slotwise.app/slotwise-widget.js"
  data-business="salon-eleni"
  data-accent="#ec4899"
  defer
></script>
```

It renders as a floating launcher button in the bottom-right corner that opens a 4-step booking panel (service → time → details → confirmation). Built with:

- **Shadow DOM** — full style isolation in both directions; the host page's CSS can't break the widget, and the widget's CSS can't leak out.
- **No framework, no runtime dependency** — ships as a single IIFE bundle (`vite build`), safe to drop into a 2014 WordPress theme or a modern Next.js site alike.
- **Themeable** — one CSS custom property (`--sw-accent`) controls the accent color, set via `data-accent` on the script tag.
- **Manual init available** for sites that prefer JS control: `SlotWiseWidget.init({ businessSlug, accentColor })`.

To develop locally:

```bash
cd apps/widget
npm run dev
# open example.html in a browser, or point Vite's dev server at it
```

To build the production bundle:

```bash
npm run build --workspace=apps/widget
# outputs apps/widget/dist/slotwise-widget.js
```

## Admin Dashboard

A Next.js dashboard (`apps/dashboard`) covering the full operator loop: login, day-view bookings calendar, and staff/services/business settings management.

- **Auth**: access token held in memory only (no localStorage), silently restored on page load via the httpOnly refresh cookie. A 401 on any request triggers one transparent refresh-and-retry before failing.
- **Calendar**: day view with prev/next/today navigation. Each booking shows its service color (matching the widget), customer, staff, and a no-show risk badge when the optimizer's risk score is elevated. Cancel goes through a confirmation modal and an authenticated `/bookings/:ref/admin-cancel` route, distinct from the public customer-facing cancel link.
- **Staff**: list + slide-over create/edit panel, including a per-day working-hours editor (the same shape the slot optimizer consumes) and a service-assignment chip picker.
- **Services**: list + slide-over create/edit panel — name, description, duration, price, color (the color shown in both the widget and the calendar).
- **Settings**: booking rules (slot duration, buffer, advance-booking window), channel toggles (AI agent, SMS), and the no-show extra-reminder threshold. Read-only for `staff`-role users — only `owner` can save changes, matching the API's `requireOwner` gate.

```bash
cd apps/dashboard
cp .env.local.example .env.local
npm run dev
# http://localhost:3000 — log in with the seeded owner account (see db:seed output)
```

## WhatsApp & SMS Channel

The AI agent is reachable over WhatsApp and SMS via Twilio webhooks (`apps/api/src/routes/webhooks.ts`), sharing the same agentic loop as the website chat widget (`agents/booking-agent.ts`) — one agent backend, multiple surfaces, per the original design.

- **Signature verification**: every inbound request is checked against Twilio's `X-Twilio-Signature` header before reaching the agent — an unverified webhook would let anyone who finds the URL pattern burn Claude API budget or trigger fake bookings.
- **Session continuity**: conversation history persists per phone number + channel + business in `agent_sessions`, with a 30-minute idle window — texting back an hour later starts a fresh conversation rather than confusingly resuming a stale one.
- **Setup**: this is mostly Twilio Console configuration, not code — see [`docs/whatsapp-setup.md`](docs/whatsapp-setup.md) for the full walkthrough (sandbox testing, production number approval, required env vars, and the most common signature-verification pitfall).

## Build Phases

- [x] **Phase 1** — Architecture, types, slot optimizer, agent route, booking service
- [x] **Phase 2** — Full CRUD routes, DB client, notification service, auth
- [x] **Phase 2.5** — Embeddable booking widget
- [x] **Phase 3** — Admin dashboard: login, bookings calendar, staff/services/settings
- [x] **Phase 5** — WhatsApp/SMS webhook channel, signature-verified
- [ ] **Phase 6** — Multi-tenancy billing (Stripe)
- [ ] **Phase 7** — Production deployment (VPS, domains, TLS, CORS/cookie config for real domains)
