import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import twilio from 'twilio';
import { db } from '../db/client.js';
import { BusinessService } from '../services/business.service.js';
import { runAgentTurn } from '../agents/booking-agent.js';
import { SlotOfferService } from '../services/slot-offer.service.js';

// ─── Twilio request authenticity check ────────────────────────────────────────
// Twilio signs every webhook request with HMAC-SHA1 over the full request URL
// + sorted POST params, using the account's auth token as the key. Without
// this check, anyone who discovers the URL pattern (predictable — businessSlug
// is public) could POST fake messages: burning the Claude API budget per
// message, or worse, steering the agent into creating real bookings.
//
// Twilio needs the *exact* URL it called, including scheme and host, which is
// why PUBLIC_BASE_URL is required here rather than derived from the request —
// a reverse proxy (nginx) can rewrite Host/X-Forwarded-* in ways that don't
// match what Twilio actually signed against. request.url is Fastify's path +
// query string as received (e.g. "/whatsapp/salon-eleni"), which is reliable;
// it's the *host* portion that proxies make untrustworthy, hence sourcing
// that part from an explicit env var instead of any request header.

async function verifyTwilioSignature(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;

  if (!authToken || !publicBaseUrl) {
    request.log.error('Twilio webhook called but TWILIO_AUTH_TOKEN or PUBLIC_BASE_URL is not configured');
    return reply.status(503).send({ error: 'Webhook not configured' });
  }

  const signature = request.headers['x-twilio-signature'];
  if (typeof signature !== 'string') {
    return reply.status(403).send({ error: 'Missing Twilio signature' });
  }

  const fullUrl = `${publicBaseUrl}${request.url}`;
  const params = (request.body ?? {}) as Record<string, string>;

  const isValid = twilio.validateRequest(authToken, signature, fullUrl, params);

  if (!isValid) {
    request.log.warn({ fullUrl }, 'Rejected webhook request with invalid Twilio signature');
    return reply.status(403).send({ error: 'Invalid signature' });
  }
}

// ─── Session persistence ──────────────────────────────────────────────────────
// WhatsApp/SMS are stateless per-request from Twilio's side, so we keep the
// conversation history in agent_sessions, keyed by a deterministic session key
// stored inside collected_data (phone + channel + business).

async function getOrCreateSessionByPhone(businessId: string, phone: string, channel: string) {
  const sessionKey = `${businessId}:${channel}:${phone}`;

  const existing = await db.queryOne<{
    id: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }>(`
    SELECT id, messages FROM agent_sessions
    WHERE business_id = $1 AND channel = $2
      AND collected_data->>'sessionKey' = $3
      AND updated_at > NOW() - INTERVAL '30 minutes'
    LIMIT 1
  `, [businessId, channel, sessionKey]);

  if (existing) return existing;

  const created = await db.queryOneOrThrow<{
    id: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }>(`
    INSERT INTO agent_sessions (id, business_id, channel, messages, collected_data)
    VALUES ($1, $2, $3, '[]'::jsonb, $4::jsonb)
    RETURNING id, messages
  `, [randomUUID(), businessId, channel, JSON.stringify({ sessionKey })]);

  return created;
}

async function saveSession(
  sessionId: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
) {
  await db.query(
    `UPDATE agent_sessions SET messages = $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [sessionId, JSON.stringify(history)]
  );
}

// ─── Twilio webhook payload (form-encoded) ────────────────────────────────────

interface TwilioWebhookBody {
  From: string;    // e.g. "whatsapp:+306944123456" or "+306944123456"
  Body: string;
  To: string;
}

function extractPhone(twilioFrom: string): string {
  return twilioFrom.replace('whatsapp:', '').replace(/\s+/g, '');
}

// ─── TwiML response helper ────────────────────────────────────────────────────

function twimlResponse(message: string): string {
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

// ─── Shared handler for WhatsApp + SMS (same logic, different channel tag) ───

async function handleInboundMessage(
  businessSlug: string,
  channel: 'whatsapp' | 'sms',
  body: TwilioWebhookBody,
  log: { error: (err: unknown, msg: string) => void }
): Promise<string> {
  const business = await BusinessService.getBySlug(businessSlug);

  if (!business) {
    return twimlResponse('Service unavailable.');
  }

  if (!business.settings.agentEnabled) {
    return twimlResponse(
      `Thanks for contacting ${business.name}. Online booking via this channel is currently unavailable — please call us directly.`
    );
  }

  const phone = extractPhone(body.From);

  try {
    const acceptance = await SlotOfferService.tryAcceptFromMessage(
      business.id,
      phone,
      body.Body,
    );
    if (acceptance.handled && acceptance.reply) {
      return twimlResponse(acceptance.reply);
    }

    const session = await getOrCreateSessionByPhone(business.id, phone, channel);

    const { reply: agentReply, history } = await runAgentTurn(
      session.messages,
      body.Body,
      business
    );

    await saveSession(session.id, history);

    return twimlResponse(agentReply);
  } catch (err) {
    log.error(err, `${channel} webhook error`);
    return twimlResponse('Sorry, something went wrong. Please try again in a moment.');
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function webhookRoutes(fastify: FastifyInstance) {

  // Twilio WhatsApp inbound — configure this URL in Twilio console per business.
  // Rate limited per-IP as a backstop; Twilio's own infra is the real sender so
  // this mainly protects against signature-bypass attempts or Twilio retries
  // piling up during an outage, not legitimate conversation volume.
  fastify.post('/whatsapp/:businessSlug', {
    preHandler: verifyTwilioSignature,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const { businessSlug } = request.params as { businessSlug: string };
      const body = request.body as TwilioWebhookBody;

      const twiml = await handleInboundMessage(businessSlug, 'whatsapp', body, request.log);
      return reply.status(200).type('text/xml').send(twiml);
    },
  });

  // Twilio SMS inbound — same flow, plain SMS instead of WhatsApp
  fastify.post('/sms/:businessSlug', {
    preHandler: verifyTwilioSignature,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const { businessSlug } = request.params as { businessSlug: string };
      const body = request.body as TwilioWebhookBody;

      const twiml = await handleInboundMessage(businessSlug, 'sms', body, request.log);
      return reply.status(200).type('text/xml').send(twiml);
    },
  });
}
