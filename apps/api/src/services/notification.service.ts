import { randomUUID } from 'crypto';
import { db } from '../db/client';
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

export const NotificationService = {

  async scheduleConfirmation(booking: Booking): Promise<void> {
    await enqueue({
      businessId: booking.businessId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'confirmation',
      channel: 'sms',
    });
  },

  /**
   * High no-show-risk bookings get a second reminder closer to the appointment.
   * Scheduled for 2 hours before the appointment (capped to "now" if that's already past).
   */
  async scheduleExtraReminder(booking: Booking): Promise<void> {
    const twoHoursBefore = new Date(booking.startsAt.getTime() - 2 * 60 * 60_000);
    const scheduledFor = twoHoursBefore > new Date() ? twoHoursBefore : new Date();

    await enqueue({
      businessId: booking.businessId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'reminder',
      channel: 'sms',
      scheduledFor,
    });
  },

  async scheduleCancellationNotice(booking: Booking): Promise<void> {
    await enqueue({
      businessId: booking.businessId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'cancellation',
      channel: 'sms',
    });
  },

  async sendWaitlistOffer(
    businessId: string,
    waitlistEntry: { id: string; customer_id: string; phone: string; name: string },
    freedSlot: { starts_at: Date; staff_id: string }
  ): Promise<void> {
    await enqueue({
      businessId,
      customerId: waitlistEntry.customer_id,
      type: 'waitlist_offer',
      channel: 'sms',
      payload: { freedSlotStart: freedSlot.starts_at },
    });
  },

  async sendRebookOffer(
    booking: Booking,
    suggestion: ConsolidationSuggestion
  ): Promise<void> {
    await enqueue({
      businessId: booking.businessId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'rebook_offer',
      channel: 'sms',
      payload: {
        newTime: suggestion.suggestedSlot,
        incentive: suggestion.incentive,
      },
    });
  },
};
