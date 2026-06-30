import twilio from 'twilio';

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!client) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (!sid || !token) {
      throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
    }

    client = twilio(sid, token);
  }
  return client;
}

// ─── SMS ──────────────────────────────────────────────────────────────────────

export async function sendSms(to: string, body: string): Promise<{ providerId: string }> {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new Error('TWILIO_FROM_NUMBER not configured');

  const message = await getClient().messages.create({
    to,
    from,
    body,
  });

  return { providerId: message.sid };
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
// Requires a Twilio WhatsApp-enabled sender (sandbox or approved number).

export async function sendWhatsApp(to: string, body: string): Promise<{ providerId: string }> {
  const from = process.env.TWILIO_WHATSAPP_FROM ?? process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new Error('TWILIO_WHATSAPP_FROM not configured');

  const normalizedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const normalizedFrom = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;

  const message = await getClient().messages.create({
    to: normalizedTo,
    from: normalizedFrom,
    body,
  });

  return { providerId: message.sid };
}
