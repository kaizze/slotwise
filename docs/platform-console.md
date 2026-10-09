# SlotWise Platform Console

Internal dashboard for **SlotWise admins and developers** — cross-tenant ops, not the salon owner dashboard.

## Boundaries

| Surface | Audience | Scope |
|---------|----------|--------|
| `apps/dashboard` | Salon owner / staff | One `businessId` |
| `apps/platform` | SlotWise admin / developer | All businesses + system health |
| `apps/widget` | End customers | Public booking |

Platform auth is a **separate principal** (`platform_users`). Never reuse salon `owner` / `staff` tokens for fleet ops.

Default URL (dev): `http://localhost:3003`  
API prefix: `/api/v1/platform/*`

---

## Information architecture

1. **Overview** — fleet snapshot (tenants, bookings today, notification failures)
2. **Businesses** — directory, search, detail, create tenant
3. **Health** — API/DB/queue/provider config presence
4. **Notifications** — failed / stuck queue rows (ops inbox)
5. **Developers** — env checklist, webhook URLs, quick links to docs

---

## Sprint plan

### Sprint 1 — Foundation *(this PR)*
- [x] Product brief + sprint plan (`docs/platform-console.md`)
- [x] `platform_users` + platform JWT auth (separate from tenant)
- [x] Seed first admin from `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`
- [x] API: login, me, businesses list, system health
- [x] `apps/platform` Next app: login, shell, businesses table, health page
- [x] PM2 + CORS wiring

### Sprint 2 — Tenant ops
- Business detail (settings summary, staff/services counts, recent bookings)
- Create business UI (wrap existing signup/create-business flow)
- Channel status badges (email/SMS/agent enabled)
- Soft “open tenant dashboard” link (no impersonation yet)

### Sprint 3 — Observability
- Notification queue stats + failed send inbox
- Fleet analytics (bookings / no-shows last 7–30 days)
- Provider diagnostics (Apifon/Twilio/Brevo/LLM env present?)

### Sprint 4 — Support & billing readiness
- Audited support login / impersonation
- Surface `plan` / `plan_expires` + Stripe hooks (Phase 6)
- Platform developer accounts (`role: developer` read-mostly)

---

## Auth model (Sprint 1)

```
platform_users (email, password_hash, role: admin|developer)
       │
       ▼
JWT access token { typ: 'platform', userId, role }  (~8h)
+ httpOnly refresh cookie `platform_refresh_token`
```

Middleware: `requirePlatformAuth` — rejects merchant/customer JWTs.

---

## Deploy sketch

```bash
# apps/api/.env
PLATFORM_ADMIN_EMAIL=you@example.com
PLATFORM_ADMIN_PASSWORD=change-me
ALLOWED_ORIGINS=https://app.example.com,https://platform.example.com

npm run db:migrate
npm run build --workspace=apps/platform
pm2 start ecosystem.config.js   # includes slotwise-platform
```
