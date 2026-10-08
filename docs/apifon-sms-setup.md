# Apifon SMS Setup

Apifon (`apifon.com`) is the preferred outbound SMS provider for Greek businesses. Twilio remains available for WhatsApp and optional SMS / inbound agent webhooks.

## 1. Create an Apifon API token

1. Sign up / log in at [apifon.com](https://www.apifon.com/)
2. Create an **HMAC** API token with the **SMS** scope
3. Set a default SMS Sender ID (alphanumeric, max 11 chars), e.g. `SalonEleni`
4. Optionally restrict the token to your server’s outbound IP

You’ll get a **token** and a **secret key**.

## 2. API environment variables

On the server (`apps/api/.env`):

```bash
APIFON_TOKEN=your_token
APIFON_SECRET=your_secret
APIFON_DEFAULT_SENDER_ID=SalonEleni
```

Restart the API after editing env:

```bash
pm2 restart slotwise-api
```

## 3. Dashboard Settings

1. Open **Settings → Channels**
2. Enable **SMS notifications**
3. Set **SMS provider** to **Apifon (Greece)**
4. Set **SMS sender name** (must match an approved Apifon sender ID)
5. Save

## Notes

- Numbers are sent in international digit form (`3069…`). Greek `69…` mobiles are auto-prefixed with `30`.
- WhatsApp still uses Twilio until an Apifon WhatsApp path is added.
- Delivery callbacks (DLR) are optional; outbound confirmations/reminders work without them.
