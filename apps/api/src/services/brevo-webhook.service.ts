import { db } from '../db/client.js';

// Brevo transactional webhook handler.
// Docs: https://developers.brevo.com/docs/transactional-webhooks
// Payload events use snake_case (hard_bounce, soft_bounce, …).

interface BrevoWebhookPayload {
  event?: string;
  email?: string;
  'message-id'?: string;
  messageId?: string;
  reason?: string;
  subject?: string;
  tags?: string[];
  ts?: number;
  ts_event?: number;
}

const HANDLED_EVENTS = new Set([
  'hard_bounce',
  'soft_bounce',
  'spam',
  'blocked',
  'invalid_email',
  'unsubscribed',
]);

function normalizeEvent(raw: string | undefined): string | null {
  if (!raw) return null;
  const map: Record<string, string> = {
    hard_bounce: 'hard_bounce',
    hardbounce: 'hard_bounce',
    soft_bounce: 'soft_bounce',
    softbounce: 'soft_bounce',
    spam: 'spam',
    blocked: 'blocked',
    invalid_email: 'invalid_email',
    invalid: 'invalid_email',
    invalidemail: 'invalid_email',
    unsubscribed: 'unsubscribed',
  };
  return map[raw.toLowerCase()] ?? null;
}

function messageIdVariants(messageId: string): string[] {
  const trimmed = messageId.trim();
  const variants = new Set<string>([trimmed]);
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    variants.add(trimmed.slice(1, -1));
  } else {
    variants.add(`<${trimmed}>`);
  }
  return [...variants];
}

/** Permanent suppress: invalid address. Complained: spam/unsubscribe. Soft bounce: log only. */
function suppressStatus(event: string): 'invalid' | 'complained' | null {
  if (event === 'hard_bounce' || event === 'blocked' || event === 'invalid_email') {
    return 'invalid';
  }
  if (event === 'spam' || event === 'unsubscribed') {
    return 'complained';
  }
  return null;
}

export const BrevoWebhookService = {

  async handle(payload: BrevoWebhookPayload): Promise<{
    handled: boolean;
    event?: string;
    notificationId?: string;
    suppressed?: boolean;
  }> {
    const event = normalizeEvent(payload.event);
    if (!event || !HANDLED_EVENTS.has(event)) {
      return { handled: false };
    }

    const messageId = payload['message-id'] ?? payload.messageId;
    const email = payload.email?.trim().toLowerCase();
    const reason = payload.reason
      ? `brevo:${event}:${payload.reason}`
      : `brevo:${event}`;

    let customerId: string | null = null;
    let notificationId: string | null = null;

    if (messageId) {
      const variants = messageIdVariants(messageId);
      const notification = await db.queryOne<{ id: string; customer_id: string }>(`
        SELECT id, customer_id FROM notifications
        WHERE channel = 'email' AND provider_id = ANY($1::text[])
        ORDER BY created_at DESC
        LIMIT 1
      `, [variants]);

      if (notification) {
        notificationId = notification.id;
        customerId = notification.customer_id;

        if (event === 'soft_bounce') {
          // Temporary failure — keep status=sent, record reason for debugging
          await db.query(
            `UPDATE notifications SET last_error = $2 WHERE id = $1`,
            [notification.id, reason],
          );
        } else {
          await db.query(
            `UPDATE notifications SET status = 'failed', last_error = $2 WHERE id = $1`,
            [notification.id, reason],
          );
        }
      }
    }

    if (!customerId && email) {
      const customer = await db.queryOne<{ id: string }>(`
        SELECT id FROM customers
        WHERE lower(email) = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [email]);
      customerId = customer?.id ?? null;
    }

    const suppressAs = suppressStatus(event);
    let suppressed = false;

    if (suppressAs) {
      // Suppress every customer row that shares this address (or the matched id).
      const result = email
        ? await db.query(`
            UPDATE customers
            SET email_status = $2,
                email_status_reason = $3,
                email_status_at = NOW()
            WHERE email_status = 'valid'
              AND (id = $1 OR ($4::text IS NOT NULL AND lower(email) = $4))
          `, [customerId, suppressAs, reason, email])
        : customerId
          ? await db.query(`
              UPDATE customers
              SET email_status = $2,
                  email_status_reason = $3,
                  email_status_at = NOW()
              WHERE id = $1 AND email_status = 'valid'
            `, [customerId, suppressAs, reason])
          : null;
      suppressed = (result?.rowCount ?? 0) > 0;
    }

    console.info('[brevo-webhook]', {
      event,
      email,
      messageId,
      notificationId,
      customerId,
      suppressed,
    });

    return {
      handled: true,
      event,
      notificationId: notificationId ?? undefined,
      suppressed,
    };
  },
};
