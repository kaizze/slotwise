import { randomUUID } from 'crypto';
import { db } from '../db/client';
import { rankSlots, scoreNoShowRisk, findConsolidationOpportunities } from '@slotwise/slot-optimizer';
import { NotificationService } from './notification.service';
import type { Booking, BookingChannel, Slot } from '@slotwise/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateBookingInput {
  businessId: string;
  serviceId: string;
  staffId: string;
  slotDatetime: string;
  customerId: string;
  notes?: string;
  channel: BookingChannel;
}

// ─── Booking reference generator ──────────────────────────────────────────────

function generateRef(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 90000) + 10000;
  return `SW-${year}-${random}`;
}

// ─── Row mapper ─────────────────────────────────────────────────────────────
// DB rows are snake_case; the Booking interface is camelCase. Extra joined
// columns (service_name, staff_name, etc.) are preserved for callers that need
// them, even though they aren't part of the strict Booking type.

function toBooking(row: Record<string, unknown>): Booking & {
  serviceName?: string;
  serviceColor?: string;
  staffName?: string;
  customerName?: string;
  customerPhone?: string;
} {
  return {
    id: row.id as string,
    ref: row.ref as string,
    businessId: row.business_id as string,
    serviceId: row.service_id as string,
    staffId: row.staff_id as string,
    customerId: row.customer_id as string,
    startsAt: new Date(row.starts_at as string),
    endsAt: new Date(row.ends_at as string),
    status: row.status as Booking['status'],
    channel: row.channel as Booking['channel'],
    notes: row.notes as string | undefined,
    noShowRisk: Number(row.no_show_risk),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    // Pass through joined display columns when present (undefined otherwise)
    serviceName: row.service_name as string | undefined,
    serviceColor: row.service_color as string | undefined,
    staffName: row.staff_name as string | undefined,
    customerName: row.customer_name as string | undefined,
    customerPhone: row.customer_phone as string | undefined,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const BookingService = {

  async create(input: CreateBookingInput): Promise<Booking> {
    // Get service duration to calculate end time
    const service = await db.query(
      'SELECT duration_minutes, price FROM services WHERE id = $1',
      [input.serviceId]
    );
    if (!service.rows[0]) throw new Error('Service not found');

    const startsAt = new Date(input.slotDatetime);
    const endsAt = new Date(startsAt.getTime() + service.rows[0].duration_minutes * 60_000);

    // Conflict check
    const conflict = await db.query(`
      SELECT id FROM bookings
      WHERE staff_id = $1
        AND status NOT IN ('cancelled')
        AND tstzrange(starts_at, ends_at) && tstzrange($2::timestamptz, $3::timestamptz)
    `, [input.staffId, startsAt.toISOString(), endsAt.toISOString()]);

    if (conflict.rows.length > 0) {
      throw new Error('Slot is no longer available');
    }

    // Calculate no-show risk
    const customer = await db.query(
      'SELECT no_show_count, total_bookings FROM customers WHERE id = $1',
      [input.customerId]
    );

    const noShowRisk = scoreNoShowRisk({
      daysSinceBooked: 0,
      pastNoShows: customer.rows[0]?.no_show_count ?? 0,
      totalBookings: customer.rows[0]?.total_bookings ?? 0,
      channel: input.channel,
      hourOfDay: startsAt.getHours(),
      dayOfWeek: startsAt.getDay(),
    });

    // Insert booking
    const ref = generateRef();
    const result = await db.query(`
      INSERT INTO bookings
        (id, ref, business_id, service_id, staff_id, customer_id,
         starts_at, ends_at, status, channel, notes, no_show_risk)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9, $10, $11)
      RETURNING *
    `, [
      randomUUID(), ref,
      input.businessId, input.serviceId, input.staffId, input.customerId,
      startsAt, endsAt, input.channel, input.notes ?? null, noShowRisk,
    ]);

    const booking = toBooking(result.rows[0]);

    // Update customer stats
    await db.query(
      'UPDATE customers SET total_bookings = total_bookings + 1 WHERE id = $1',
      [input.customerId]
    );

    // Queue notifications
    await NotificationService.scheduleConfirmation(booking);
    if (noShowRisk > 0.4) {
      await NotificationService.scheduleExtraReminder(booking);
    }

    return booking;
  },

  async cancel(businessId: string, ref: string, reason?: string): Promise<{ success: boolean; freedSlot: { startsAt: Date; endsAt: Date; staffId: string } }> {
    const result = await db.query(`
      UPDATE bookings
      SET status = 'cancelled', notes = COALESCE(notes || ' | ' || $3, notes), updated_at = NOW()
      WHERE ref = $1 AND business_id = $2 AND status = 'confirmed'
      RETURNING *
    `, [ref, businessId, reason ?? null]);

    if (!result.rows[0]) throw new Error('Booking not found or already cancelled');

    const cancelled = result.rows[0];
    const cancelledBookingTyped = toBooking(cancelled);

    await NotificationService.scheduleCancellationNotice(cancelledBookingTyped);

    // Trigger waitlist check and consolidation opportunities in background
    setImmediate(() => {
      BookingService.handleCancellationRecovery(businessId, cancelled).catch(console.error);
    });

    return {
      success: true,
      freedSlot: {
        startsAt: cancelled.starts_at,
        endsAt: cancelled.ends_at,
        staffId: cancelled.staff_id,
      },
    };
  },

  async handleCancellationRecovery(
    businessId: string,
    cancelledBooking: { starts_at: Date; ends_at: Date; staff_id: string }
  ): Promise<void> {
    // 1. Check waitlist first
    const waitlisted = await db.query(`
      SELECT w.*, c.phone, c.name FROM waitlist w
      JOIN customers c ON c.id = w.customer_id
      WHERE w.business_id = $1
        AND w.notified = FALSE
        AND (w.preferred_window_start IS NULL OR w.preferred_window_start <= $2)
        AND (w.preferred_window_end IS NULL OR w.preferred_window_end >= $2)
      ORDER BY w.created_at ASC
      LIMIT 3
    `, [businessId, cancelledBooking.starts_at]);

    if (waitlisted.rows.length > 0) {
      for (const entry of waitlisted.rows) {
        await NotificationService.sendWaitlistOffer(businessId, entry, cancelledBooking);
        await db.query('UPDATE waitlist SET notified = TRUE WHERE id = $1', [entry.id]);
      }
      return; // Waitlist takes priority
    }

    // 2. Find consolidation opportunities
    const remaining = await db.query(`
      SELECT * FROM bookings
      WHERE business_id = $1
        AND staff_id = $2
        AND status = 'confirmed'
        AND starts_at::date = $3::date
    `, [businessId, cancelledBooking.staff_id, cancelledBooking.starts_at]);

    const remainingBookings = remaining.rows.map(toBooking);

    const opportunities = findConsolidationOpportunities(
      {
        startsAt: new Date(cancelledBooking.starts_at),
        endsAt: new Date(cancelledBooking.ends_at),
        staffId: cancelledBooking.staff_id,
      },
      remainingBookings
    );

    // Notify top opportunity customer
    if (opportunities.length > 0 && opportunities[0].scoreGain >= 15) {
      const top = opportunities[0];
      const booking = remainingBookings.find((b) => b.id === top.bookingId);
      if (booking) {
        await NotificationService.sendRebookOffer(booking, top);
      }
    }
  },

  async getByPhone(businessId: string, phone: string): Promise<Booking[]> {
    const result = await db.query(`
      SELECT b.*, s.name as service_name, st.name as staff_name
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      JOIN staff st ON st.id = b.staff_id
      JOIN customers c ON c.id = b.customer_id
      WHERE b.business_id = $1 AND c.phone = $2
        AND b.status = 'confirmed'
        AND b.starts_at > NOW()
      ORDER BY b.starts_at ASC
      LIMIT 5
    `, [businessId, phone]);

    return result.rows.map(toBooking);
  },

  async getByBusiness(
    businessId: string,
    from: Date,
    to: Date
  ): Promise<Booking[]> {
    const result = await db.query(`
      SELECT b.*, s.name as service_name, s.color as service_color, st.name as staff_name,
             c.name as customer_name, c.phone as customer_phone
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      JOIN staff st ON st.id = b.staff_id
      JOIN customers c ON c.id = b.customer_id
      WHERE b.business_id = $1
        AND b.starts_at BETWEEN $2 AND $3
        AND b.status != 'cancelled'
      ORDER BY b.starts_at ASC
    `, [businessId, from, to]);

    return result.rows.map(toBooking);
  },
};
