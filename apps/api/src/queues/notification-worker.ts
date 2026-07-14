import { db } from '../db/client.js';
import { sendSms, sendWhatsApp } from '../services/providers/twilio.provider.js';
import { EmailService } from '../services/email.service.js';
import { smsTemplates, emailTemplates } from '../services/notification-templates.js';

interface NotificationRow {
  id: string;
  business_id: string;
  booking_id: string | null;
  customer_id: string;
  type: 'confirmation' | 'reminder' | 'cancellation' | 'rebook_offer' | 'waitlist_offer';
  channel: 'sms' | 'email' | 'whatsapp';
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

interface NotificationContext {
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  serviceName: string;
  staffName: string;
  businessName: string;
  businessLocale: string;
  businessTimezone: string;
  startsAt: Date | null;
  ref: string | null;
}

async function loadContext(row: NotificationRow): Promise<NotificationContext> {
  const result = await db.queryOneOrThrow<{
    customer_name: string;
    customer_phone: string;
    customer_email: string | null;
    business_name: string;
    business_locale: string;
    business_timezone: string;
    service_name: string | null;
    staff_name: string | null;
    starts_at: Date | null;
    ref: string | null;
  }>(`
    SELECT
      c.name  AS customer_name,
      c.phone AS customer_phone,
      c.email AS customer_email,
      b.name  AS business_name,
      b.locale AS business_locale,
      b.timezone AS business_timezone,
      s.name  AS service_name,
      st.name AS staff_name,
      bk.starts_at,
      bk.ref
    FROM customers c
    JOIN businesses b ON b.id = c.business_id
    LEFT JOIN bookings bk ON bk.id = $2
    LEFT JOIN services s  ON s.id = bk.service_id
    LEFT JOIN staff st    ON st.id = bk.staff_id
    WHERE c.id = $1
  `, [row.customer_id, row.booking_id]);

  return {
    customerName: result.customer_name,
    customerPhone: result.customer_phone,
    customerEmail: result.customer_email,
    serviceName: result.service_name ?? '',
    staffName: result.staff_name ?? '',
    businessName: result.business_name,
    businessLocale: result.business_locale,
    businessTimezone: result.business_timezone,
    startsAt: result.starts_at,
    ref: result.ref,
  };
}

async function dispatchOne(row: NotificationRow): Promise<void> {
  const ctx = await loadContext(row);

  const templateCtx = {
    customerName: ctx.customerName,
    serviceName: ctx.serviceName,
    staffName: ctx.staffName,
    businessName: ctx.businessName,
    startsAt: ctx.startsAt ?? new Date(),
    ref: ctx.ref ?? '',
    locale: ctx.businessLocale,
    timezone: ctx.businessTimezone,
  };

  if (row.channel === 'sms' || row.channel === 'whatsapp') {
    let body: string;

    switch (row.type) {
      case 'confirmation':
        body = smsTemplates.confirmation(templateCtx);
        break;
      case 'reminder':
        body = smsTemplates.reminder(templateCtx);
        break;
      case 'cancellation':
        body = smsTemplates.cancellation(templateCtx);
        break;
      case 'rebook_offer': {
        const rawNewTime = row.payload.newTime as string | undefined;
        body = smsTemplates.rebookOffer({
          ...templateCtx,
          newTime: rawNewTime ? new Date(rawNewTime) : templateCtx.startsAt,
          incentive: row.payload.incentive as string | undefined,
          offerToken: row.payload.offerToken as string | undefined,
        });
        break;
      }
      case 'waitlist_offer': {
        const freedSlotStart = row.payload.freedSlotStart as string | Date | undefined;
        const slotTime = freedSlotStart ? new Date(freedSlotStart) : templateCtx.startsAt;
        body = smsTemplates.waitlistOffer({
          businessName: ctx.businessName,
          serviceName: (row.payload.serviceName as string | undefined) ?? ctx.serviceName,
          startsAt: slotTime,
          locale: ctx.businessLocale,
          timezone: ctx.businessTimezone,
          offerToken: row.payload.offerToken as string | undefined,
        });
        break;
      }
      default:
        throw new Error(`Unknown notification type: ${row.type}`);
    }

    if (!ctx.customerPhone) throw new Error('Customer has no phone number');

    const { providerId } = row.channel === 'whatsapp'
      ? await sendWhatsApp(ctx.customerPhone, body)
      : await sendSms(ctx.customerPhone, body);

    await db.query(
      `UPDATE notifications SET status = 'sent', sent_at = NOW(), provider_id = $2 WHERE id = $1`,
      [row.id, providerId],
    );
    return;
  }

  if (row.channel === 'email') {
    if (!ctx.customerEmail) throw new Error('Customer has no email address');

    let subject: string;
    let html: string;

    switch (row.type) {
      case 'confirmation': {
        const template = emailTemplates.confirmation(templateCtx);
        subject = template.subject;
        html = template.html;
        break;
      }
      case 'reminder': {
        const template = emailTemplates.reminder(templateCtx);
        subject = template.subject;
        html = template.html;
        break;
      }
      case 'cancellation': {
        const template = emailTemplates.cancellation(templateCtx);
        subject = template.subject;
        html = template.html;
        break;
      }
      case 'rebook_offer': {
        const rawNewTime = row.payload.newTime as string | undefined;
        const template = emailTemplates.rebookOffer({
          ...templateCtx,
          newTime: rawNewTime ? new Date(rawNewTime) : templateCtx.startsAt,
          incentive: row.payload.incentive as string | undefined,
          offerToken: row.payload.offerToken as string | undefined,
        });
        subject = template.subject;
        html = template.html;
        break;
      }
      case 'waitlist_offer': {
        const freedSlotStart = row.payload.freedSlotStart as string | Date | undefined;
        const slotTime = freedSlotStart ? new Date(freedSlotStart) : templateCtx.startsAt;
        const template = emailTemplates.waitlistOffer({
          businessName: ctx.businessName,
          serviceName: (row.payload.serviceName as string | undefined) ?? ctx.serviceName,
          startsAt: slotTime,
          locale: ctx.businessLocale,
          timezone: ctx.businessTimezone,
          customerName: ctx.customerName,
          offerToken: row.payload.offerToken as string | undefined,
        });
        subject = template.subject;
        html = template.html;
        break;
      }
      default:
        throw new Error(`Unknown notification type: ${row.type}`);
    }

    const { providerId } = await EmailService.send({
      to: ctx.customerEmail,
      toName: ctx.customerName,
      subject,
      htmlContent: html,
    });

    await db.query(
      `UPDATE notifications SET status = 'sent', sent_at = NOW(), provider_id = $2 WHERE id = $1`,
      [row.id, providerId],
    );
  }
}

// ─── Worker loop ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 20;

let running = false;
let timer: NodeJS.Timeout | null = null;

async function processBatch(): Promise<void> {
  // Claim a batch atomically so multiple worker instances don't double-send
  const claimed = await db.query<NotificationRow>(`
    UPDATE notifications
    SET status = 'processing'
    WHERE id IN (
      SELECT id FROM notifications
      WHERE status = 'pending' AND scheduled_for <= NOW()
      ORDER BY scheduled_for ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `, [BATCH_SIZE]);

  for (const row of claimed.rows) {
    try {
      await dispatchOne(row);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown dispatch error';
      const attempts = row.attempts + 1;
      const willRetry = attempts < row.max_attempts;

      console.error(`[notification-worker] Failed to send ${row.id} (attempt ${attempts}):`, message);

      if (willRetry) {
        const backoffMinutes = attempts * attempts; // 1, 4, 9...
        await db.query(`
          UPDATE notifications
          SET status = 'pending',
              attempts = $2,
              last_error = $3,
              scheduled_for = NOW() + ($4 || ' minutes')::interval
          WHERE id = $1
        `, [row.id, attempts, message, backoffMinutes]);
      } else {
        await db.query(`
          UPDATE notifications
          SET status = 'failed', attempts = $2, last_error = $3
          WHERE id = $1
        `, [row.id, attempts, message]);
      }
    }
  }
}

export function startNotificationWorker(): void {
  if (running) return;
  running = true;

  console.info(`[notification-worker] Started, polling every ${POLL_INTERVAL_MS / 1000}s`);

  const tick = async () => {
    try {
      await processBatch();
    } catch (err) {
      console.error('[notification-worker] Batch processing error:', err);
    }
    if (running) timer = setTimeout(tick, POLL_INTERVAL_MS);
  };

  tick();
}

export function stopNotificationWorker(): void {
  running = false;
  if (timer) clearTimeout(timer);
}
