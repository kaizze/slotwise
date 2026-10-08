import { randomUUID } from 'crypto';
import { db } from '../db/client.js';
import type { Booking } from '@slotwise/types';
import type { ConsolidationSuggestion } from '@slotwise/slot-optimizer';

// ─── Internal: enqueue a notification ──────────────────────────────────────
// Writes to the `notifications` table; the queue worker (queues/notification-worker.ts)
// polls for due rows and performs actual SMS/email dispatch via Twilio/Brevo.
// Booking creation never blocks on the external API call.

interface EnqueueInput {
  businessId: string;
  bookingId?: string;
  customerId: string;
  type: 'confirmation' | 'reminder' | 'cancellation' | 'rebook_offer' | 'waitlist_offer';
  channel: 'sms' | 'email' | 'whatsapp';
  payload?: Record<string, unknown>;
  scheduledFor?: Date; // defaults to "now" (next worker tick)
}

async function enqueue(input: EnqueueInput): Promise<void> {
  await db.query(`
    INSERT INTO notifications
      (id, business_id, booking_id, customer_id, type, channel, status, payload, scheduled_for)
    VALUES
      ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
  `, [
    randomUUID(),
    input.businessId,
    input.bookingId ?? null,
    input.customerId,
    input.type,
    input.channel,
    JSON.stringify(input.payload ?? {}),
    input.scheduledFor ?? new Date(),
  ]);
}

interface ChannelPreferences {
  sms: boolean;
  email: boolean;
}

async function getChannelPreferences(
  businessId: string,
  customerId: string
): Promise<ChannelPreferences> {
  const result = await db.queryOneOrThrow<{
    sms_enabled: boolean;
    email_enabled: boolean;
    customer_email: string | null;
    email_status: string;
  }>(`
    SELECT
      COALESCE((b.settings->>'smsEnabled')::boolean, false) AS sms_enabled,
      COALESCE((b.settings->>'emailEnabled')::boolean, true) AS email_enabled,
      c.email AS customer_email,
      COALESCE(c.email_status, 'valid') AS email_status
    FROM businesses b
    JOIN customers c ON c.business_id = b.id
    WHERE b.id = $1 AND c.id = $2
  `, [businessId, customerId]);

  return {
    sms: result.sms_enabled,
    email:
      result.email_enabled
      && !!result.customer_email
      && result.email_status === 'valid',
  };
}

async function enqueueForCustomer(
  input: Omit<EnqueueInput, 'channel'>,
  channels: ChannelPreferences
): Promise<void> {
  if (channels.sms) {
    await enqueue({ ...input, channel: 'sms' });
  }
  if (channels.email) {
    await enqueue({ ...input, channel: 'email' });
  }
}

interface ReminderSettings {
  enabled: boolean;
  hoursBefore: number;
  noShowThreshold: number;
}

async function getReminderSettings(businessId: string): Promise<ReminderSettings> {
  const row = await db.queryOneOrThrow<{
    reminder_enabled: boolean;
    reminder_hours: number;
    no_show_threshold: number;
  }>(`
    SELECT
      COALESCE((settings->>'reminderEnabled')::boolean, true) AS reminder_enabled,
      COALESCE((settings->>'reminderHoursBefore')::numeric, 24) AS reminder_hours,
      COALESCE((settings->>'noShowThreshold')::numeric, 0.5) AS no_show_threshold
    FROM businesses
    WHERE id = $1
  `, [businessId]);

  const hours = Number(row.reminder_hours);
  return {
    enabled: row.reminder_enabled,
    hoursBefore: Number.isFinite(hours) && hours > 0 ? hours : 24,
    noShowThreshold: Number(row.no_show_threshold) || 0.5,
  };
}

/** Cancel unsent reminders for a booking (e.g. on reschedule / cancel). */
async function cancelPendingReminders(bookingId: string): Promise<void> {
  await db.query(`
    UPDATE notifications
    SET status = 'cancelled', last_error = 'superseded'
    WHERE booking_id = $1
      AND type = 'reminder'
      AND status = 'pending'
  `, [bookingId]);
}

function computeReminderSendAt(startsAt: Date, hoursBefore: number): Date | null {
  const now = Date.now();
  const startMs = startsAt.getTime();
  // Too close / already started — do not remind.
  if (startMs <= now + 30 * 60_000) return null;

  const target = startMs - hoursBefore * 60 * 60_000;
  if (target > now) return new Date(target);

  // Inside the reminder window (e.g. booked yesterday for tomorrow, deploy mid-window):
  // send on the next worker tick rather than skipping.
  return new Date();
}

export const NotificationService = {

  async scheduleConfirmation(booking: Booking): Promise<void> {
    const channels = await getChannelPreferences(booking.businessId, booking.customerId);
    await enqueueForCustomer({
      businessId: booking.businessId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'confirmation',
    }, channels);
  },

  /**
   * Standard pre-appointment reminder (default 24h before).
   * Controlled by business settings reminderEnabled / reminderHoursBefore.
   */
  async scheduleStandardReminder(booking: Booking): Promise<void> {
    const settings = await getReminderSettings(booking.businessId);
    if (!settings.enabled) return;

    const scheduledFor = computeReminderSendAt(booking.startsAt, settings.hoursBefore);
    if (!scheduledFor) return;

    const channels = await getChannelPreferences(booking.businessId, booking.customerId);
    await enqueueForCustomer({
      businessId: booking.businessId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'reminder',
      scheduledFor,
      payload: {
        kind: 'standard',
        hoursBefore: settings.hoursBefore,
      },
    }, channels);
  },

  /**
   * High no-show-risk bookings get a second reminder closer to the appointment.
   * Scheduled for 2 hours before the appointment (capped to "now" if that's already past).
   */
  async scheduleExtraReminder(booking: Booking): Promise<void> {
    const twoHoursBefore = new Date(booking.startsAt.getTime() - 2 * 60 * 60_000);
    const scheduledFor = twoHoursBefore > new Date() ? twoHoursBefore : new Date();
    if (booking.startsAt.getTime() <= Date.now() + 15 * 60_000) return;

    const channels = await getChannelPreferences(booking.businessId, booking.customerId);

    await enqueueForCustomer({
      businessId: booking.businessId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'reminder',
      scheduledFor,
      payload: {
        kind: 'extra',
        hoursBefore: 2,
      },
    }, channels);
  },

  /**
   * Schedule confirmation + standard 24h reminder (+ optional high-risk 2h reminder).
   * Replaces any pending reminders first (safe for reschedule).
   */
  async scheduleBookingNotifications(
    booking: Booking,
    options: { includeExtraReminder?: boolean } = {},
  ): Promise<void> {
    await cancelPendingReminders(booking.id);
    await this.scheduleConfirmation(booking);
    await this.scheduleStandardReminder(booking);

    if (options.includeExtraReminder) {
      const settings = await getReminderSettings(booking.businessId);
      if (booking.noShowRisk > settings.noShowThreshold) {
        await this.scheduleExtraReminder(booking);
      }
    }
  },

  async scheduleCancellationNotice(booking: Booking): Promise<void> {
    await cancelPendingReminders(booking.id);
    const channels = await getChannelPreferences(booking.businessId, booking.customerId);
    await enqueueForCustomer({
      businessId: booking.businessId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'cancellation',
    }, channels);
  },

  /**
   * Backfill standard reminders for upcoming confirmed bookings that don't have one yet.
   * Safe to call from the notification worker poll loop.
   */
  async scheduleMissingStandardReminders(limit = 40): Promise<number> {
    const rows = await db.query<{
      id: string;
      business_id: string;
      customer_id: string;
      starts_at: Date;
      no_show_risk: number;
      reminder_hours: number;
    }>(`
      SELECT
        b.id,
        b.business_id,
        b.customer_id,
        b.starts_at,
        b.no_show_risk,
        COALESCE((biz.settings->>'reminderHoursBefore')::numeric, 24) AS reminder_hours
      FROM bookings b
      JOIN businesses biz ON biz.id = b.business_id
      WHERE b.status = 'confirmed'
        AND b.starts_at > NOW() + interval '30 minutes'
        AND COALESCE((biz.settings->>'reminderEnabled')::boolean, true) = true
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.booking_id = b.id
            AND n.type = 'reminder'
            AND n.status IN ('pending', 'processing', 'sent')
            AND COALESCE(n.payload->>'kind', 'standard') = 'standard'
        )
      ORDER BY b.starts_at ASC
      LIMIT $1
    `, [limit]);

    let scheduled = 0;
    for (const row of rows.rows) {
      const hours = Number(row.reminder_hours);
      const hoursBefore = Number.isFinite(hours) && hours > 0 ? hours : 24;
      const scheduledFor = computeReminderSendAt(new Date(row.starts_at), hoursBefore);
      if (!scheduledFor) continue;

      const channels = await getChannelPreferences(row.business_id, row.customer_id);
      if (!channels.sms && !channels.email) continue;

      await enqueueForCustomer({
        businessId: row.business_id,
        bookingId: row.id,
        customerId: row.customer_id,
        type: 'reminder',
        scheduledFor,
        payload: {
          kind: 'standard',
          hoursBefore,
          backfilled: true,
        },
      }, channels);
      scheduled += 1;
    }

    return scheduled;
  },

  async sendWaitlistOffer(
    businessId: string,
    waitlistEntry: { id: string; customer_id: string; phone: string; name: string },
    freedSlot: { starts_at: Date; ends_at: Date; staff_id: string },
    offerMeta?: { offerId: string; offerToken: string; serviceName: string },
  ): Promise<void> {
    const channels = await getChannelPreferences(businessId, waitlistEntry.customer_id);
    await enqueueForCustomer({
      businessId,
      customerId: waitlistEntry.customer_id,
      type: 'waitlist_offer',
      payload: {
        freedSlotStart: freedSlot.starts_at,
        serviceName: offerMeta?.serviceName,
        offerId: offerMeta?.offerId,
        offerToken: offerMeta?.offerToken,
      },
    }, channels);
  },

  async sendRebookOffer(
    booking: Booking,
    suggestion: ConsolidationSuggestion,
    offerMeta?: { offerId: string; offerToken: string },
  ): Promise<void> {
    const channels = await getChannelPreferences(booking.businessId, booking.customerId);
    await enqueueForCustomer({
      businessId: booking.businessId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'rebook_offer',
      payload: {
        newTime: suggestion.suggestedSlot,
        incentive: suggestion.incentive,
        offerId: offerMeta?.offerId,
        offerToken: offerMeta?.offerToken,
      },
    }, channels);
  },
};
