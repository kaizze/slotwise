import { randomUUID } from 'crypto';
import { db } from '../db/client.js';
import { rankSlots, scoreNoShowRisk, findConsolidationOpportunities } from '@slotwise/slot-optimizer';
import { NotificationService } from './notification.service.js';
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

// ─── Row types ────────────────────────────────────────────────────────────────
// Explicit shapes for raw query results — db.query() defaults to
// Record<string, unknown> when no type argument is given, which makes every
// field access `unknown` and therefore unusable as a SQL param or in
// arithmetic without an explicit (and easy to get wrong) cast at each call
// site. Declaring the actual selected columns here means the compiler
// verifies field access against what the SQL really selects.

interface ServiceDurationRow {
  duration_minutes: number;
  price: number;
}

interface CustomerRiskRow {
  no_show_count: number;
  total_bookings: number;
}

interface BookingRow {
  id: string;
  ref: string;
  business_id: string;
  service_id: string;
  staff_id: string;
  customer_id: string;
  starts_at: Date;
  ends_at: Date;
  status: Booking['status'];
  channel: Booking['channel'];
  notes: string | null;
  no_show_risk: number;
  created_at: Date;
  updated_at: Date;
  service_name?: string;
  service_color?: string;
  staff_name?: string;
  customer_name?: string;
  customer_phone?: string;
}

interface WaitlistEntryRow {
  id: string;
  customer_id: string;
  phone: string;
  name: string;
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
//
// Takes BookingRow (not a loose Record<string, unknown>) so every field access
// below is checked against the real query shape rather than cast blindly —
// the casts that used to live here were silencing the exact class of bug this
// whole row-typing pass exists to catch.

function toBooking(row: BookingRow): Booking & {
  serviceName?: string;
  serviceColor?: string;
  staffName?: string;
  customerName?: string;
  customerPhone?: string;
} {
  return {
    id: row.id,
    ref: row.ref,
    businessId: row.business_id,
    serviceId: row.service_id,
    staffId: row.staff_id,
    customerId: row.customer_id,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    status: row.status,
    channel: row.channel,
    notes: row.notes ?? undefined,
    noShowRisk: Number(row.no_show_risk),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    // Pass through joined display columns when present (undefined otherwise)
    serviceName: row.service_name,
    serviceColor: row.service_color,
    staffName: row.staff_name,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const BookingService = {

  async create(input: CreateBookingInput): Promise<Booking> {
    // Get service duration to calculate end time
    const service = await db.query<ServiceDurationRow>(
      'SELECT duration_minutes, price FROM services WHERE id = $1',
      [input.serviceId]
    );
    const serviceRow = service.rows[0];
    if (!serviceRow) throw new Error('Service not found');

    const startsAt = new Date(input.slotDatetime);
    const endsAt = new Date(startsAt.getTime() + serviceRow.duration_minutes * 60_000);

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
    const customer = await db.query<CustomerRiskRow>(
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
    const result = await db.query<BookingRow>(`
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

    const insertedRow = result.rows[0];
    if (!insertedRow) throw new Error('Booking insert returned no row');
    const booking = toBooking(insertedRow);

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
    const result = await db.query<BookingRow>(`
      UPDATE bookings
      SET status = 'cancelled', notes = COALESCE(notes || ' | ' || $3, notes), updated_at = NOW()
      WHERE ref = $1 AND business_id = $2 AND status = 'confirmed'
      RETURNING *
    `, [ref, businessId, reason ?? null]);

    const cancelled = result.rows[0];
    if (!cancelled) throw new Error('Booking not found or already cancelled');

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
    const waitlisted = await db.query<WaitlistEntryRow>(`
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
    const remaining = await db.query<BookingRow>(`
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
    const top = opportunities[0];
    if (top && top.scoreGain >= 15) {
      const booking = remainingBookings.find((b: Booking) => b.id === top.bookingId);
      if (booking) {
        await NotificationService.sendRebookOffer(booking, top);
      }
    }
  },

  async getByPhone(businessId: string, phone: string): Promise<Booking[]> {
    const result = await db.query<BookingRow>(`
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
    const result = await db.query<BookingRow>(`
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
