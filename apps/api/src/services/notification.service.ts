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
   * High no-show-risk bookings get a second reminder closer to the appointment.
   * Scheduled for 2 hours before the appointment (capped to "now" if that's already past).
   */
  async scheduleExtraReminder(booking: Booking): Promise<void> {
    const twoHoursBefore = new Date(booking.startsAt.getTime() - 2 * 60 * 60_000);
    const scheduledFor = twoHoursBefore > new Date() ? twoHoursBefore : new Date();
    const channels = await getChannelPreferences(booking.businessId, booking.customerId);

    await enqueueForCustomer({
      businessId: booking.businessId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'reminder',
      scheduledFor,
    }, channels);
  },

  async scheduleCancellationNotice(booking: Booking): Promise<void> {
    const channels = await getChannelPreferences(booking.businessId, booking.customerId);
    await enqueueForCustomer({
      businessId: booking.businessId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'cancellation',
    }, channels);
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
