# WhatsApp & SMS Setup (Twilio Console)

This is the external configuration needed to make the AI agent reachable over WhatsApp and SMS. The code side (`apps/api/src/routes/webhooks.ts`) has been ready since the notifications task — this is purely Twilio Console + environment configuration.

## Prerequisites

- A Twilio account (https://console.twilio.com)
- The API deployed somewhere with a real, stable HTTPS URL — **Twilio will not call `http://` or `localhost` URLs in production.** For local testing, see "Local development" below.

---

## 1. WhatsApp Sandbox (fastest way to test)

Twilio's WhatsApp Sandbox lets you test immediately without WhatsApp Business approval, which can take days.

1. Console → **Messaging → Try it out → Send a WhatsApp message**
2. You'll get a sandbox number (e.g. `+1 415 523 8886`) and a join code like `join example-word`
3. From your own phone, WhatsApp that join code to the sandbox number — this opts your number into the sandbox for 72 hours (re-join when it expires)
4. Under **Sandbox settings**, set:
   - **When a message comes in**: `https://api.yourdomain.com/webhooks/whatsapp/salon-eleni` (replace with your real API domain and the target business's slug)
   - **Method**: `HTTP POST`
5. Save

That's it for sandbox testing — message the sandbox number and the agent should respond.

> **Sandbox limitation**: every business shares the same sandbox number during testing. For a real alpha with one tenant this is fine — just hardcode that business's slug in the webhook URL. For multiple tenants, each needs either its own approved WhatsApp number (see below) or a routing layer that isn't built yet.

---

## 2. Production WhatsApp (per-business number)

For a real tenant beyond testing:

1. Console → **Messaging → Senders → WhatsApp senders**
2. Register a number — either:
   - **Twilio-hosted number**: Twilio provisions one for you (simpler, faster)
   - **Bring your own number**: if the business already has a WhatsApp Business number, this requires WhatsApp's number-porting process via Meta — slower, but means customers message a number they already recognize
3. Submit for **WhatsApp Business Profile approval** (business name, category, description, logo) — Meta reviews this, typically 1–3 business days
4. Once approved, set the webhook on that sender:
   - **When a message comes in**: `https://api.yourdomain.com/webhooks/whatsapp/{businessSlug}`
   - **Method**: `HTTP POST`

Repeat per business — each tenant's WhatsApp number points at its own `{businessSlug}` in the webhook URL, which is how `webhooks.ts` resolves which business's agent should handle the conversation.

---

## 3. SMS (optional, simpler channel)

1. Console → **Phone Numbers → Buy a number** (or use an existing Twilio number)
2. Under that number's **Messaging** configuration:
   - **When a message comes in**: `https://api.yourdomain.com/webhooks/sms/{businessSlug}`
   - **Method**: `HTTP POST`

No approval process — SMS numbers are active immediately.

---

## 4. Required environment variables

```bash
# apps/api/.env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here          # Console → Account → API keys & tokens
TWILIO_FROM_NUMBER=+1xxxxxxxxxx                 # for outbound SMS (notification dispatch)
TWILIO_WHATSAPP_FROM=+1xxxxxxxxxx                # the approved/sandbox WhatsApp sender
PUBLIC_BASE_URL=https://api.yourdomain.com       # REQUIRED — see "Signature verification" below
```

`TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are under **Console → Account → API keys & tokens** (the *main* Account SID/Auth Token pair, not a separate API Key — `validateRequest` specifically needs the Auth Token).

---

## 5. Signature verification — why `PUBLIC_BASE_URL` must be exact

Every inbound webhook is verified against Twilio's `X-Twilio-Signature` header before it reaches the agent (see `verifyTwilioSignature` in `webhooks.ts`). This check recomputes the expected signature using **the exact URL Twilio called**, including scheme and host. If `PUBLIC_BASE_URL` doesn't match byte-for-byte what's configured in the Twilio Console, every request gets rejected with `403 Invalid signature` — not a vague failure, this is the most common setup mistake.

Checklist:
- `PUBLIC_BASE_URL` has no trailing slash: `https://api.yourdomain.com`, not `https://api.yourdomain.com/`
- It's `https://`, not `http://`, once you're past local sandbox testing
- It matches the domain Twilio is actually configured to call — if you're behind Cloudflare or another proxy that rewrites the host, this can silently diverge

If signatures keep failing after deployment, log `fullUrl` from `verifyTwilioSignature` (already logged on rejection at `warn` level) and compare it character-for-character against the URL field in the Twilio Console.

---

## 6. Local development

Twilio cannot reach `localhost`. To test against a live Twilio number from your dev machine, use a tunnel:

```bash
# ngrok (or any similar tool)
ngrok http 3001
```

Then:
1. Set `PUBLIC_BASE_URL=https://your-ngrok-id.ngrok-free.app` in `.env`
2. Point the Twilio Console webhook at `https://your-ngrok-id.ngrok-free.app/webhooks/whatsapp/{businessSlug}`
3. Restart the API after changing `PUBLIC_BASE_URL` — it's read once at request time from `process.env`, but ngrok URLs change on every tunnel restart, so this needs re-syncing each session unless you're on a paid ngrok plan with a static subdomain

---

## 7. Verifying it actually works end to end

1. Confirm `agentEnabled: true` for the test business (dashboard → Settings → Channels, or `PATCH /api/v1/businesses/me/settings`)
2. Message the sandbox/configured number: *"I'd like to book a haircut on Friday"*
3. Expected: the agent calls `get_services`, `get_available_slots`, asks for name + phone, confirms, calls `create_booking`
4. Check the dashboard calendar — the booking should appear with **channel: whatsapp** (or `sms`)
5. Check `notifications` table — a confirmation SMS should be queued (and sent, once the notification worker picks it up)

If step 2 gets no response at all: check the API logs for `403 Invalid signature` (see §5) or `503 Webhook not configured` (missing env vars) before assuming the agent itself is broken.
