import dayjs from 'dayjs';
import { db } from '../db/client';
import { rankSlots } from '@slotwise/slot-optimizer';
import type { Slot, Booking, WorkingHours } from '@slotwise/types';

interface GetSlotsInput {
  businessId: string;
  serviceId: string;
  date: string;         // YYYY-MM-DD or natural language like "Wednesday"
  staffId?: string;
}

// ─── Row types ────────────────────────────────────────────────────────────────
// Same rationale as booking.service.ts — explicit shapes for what's actually
// selected, so field access is checked against real columns instead of
// silently being `unknown`.

interface ServiceRow {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
  currency: string;
  color: string;
}

interface ServiceDurationRow {
  duration_minutes: number;
}

interface StaffRow {
  id: string;
  name: string;
  working_hours: WorkingHours[];
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
}

interface BusinessSettingsRow {
  settings: { bufferMinutes?: number } & Record<string, unknown>;
}

function toBooking(row: BookingRow): Booking {
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
  };
}

function resolveDate(dateStr: string): string {
  // Handle natural language dates
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const lower = dateStr.toLowerCase().trim();

  const dayIndex = days.indexOf(lower);
  if (dayIndex !== -1) {
    let target = dayjs();
    const today = target.day();
    let diff = dayIndex - today;
    if (diff <= 0) diff += 7; // always next occurrence
    return target.add(diff, 'day').format('YYYY-MM-DD');
  }

  if (lower === 'tomorrow') return dayjs().add(1, 'day').format('YYYY-MM-DD');
  if (lower === 'today') return dayjs().format('YYYY-MM-DD');

  // Assume it's already YYYY-MM-DD
  return dateStr;
}

export const SlotService = {

  async getServices(businessId: string, query?: string) {
    let sql = `
      SELECT id, name, description, duration_minutes, price, currency, color
      FROM services
      WHERE business_id = $1 AND is_active = TRUE
    `;
    const params: Array<string> = [businessId];

    if (query) {
      sql += ` AND name ILIKE $2`;
      params.push(`%${query}%`);
    }

    sql += ' ORDER BY name ASC';
    const result = await db.query<ServiceRow>(sql, params);
    return result.rows;
  },

  async getAvailableSlots(input: GetSlotsInput): Promise<Slot[]> {
    const resolvedDate = resolveDate(input.date);
    const dayStart = dayjs(resolvedDate).startOf('day');
    const dayEnd   = dayjs(resolvedDate).endOf('day');

    // Get service duration
    const service = await db.query<ServiceDurationRow>(
      'SELECT duration_minutes FROM services WHERE id = $1 AND business_id = $2',
      [input.serviceId, input.businessId]
    );
    if (!service.rows[0]) throw new Error('Service not found');
    const duration = service.rows[0].duration_minutes;

    // Get eligible staff
    let staffQuery = `
      SELECT s.id, s.name, s.working_hours
      FROM staff s
      WHERE s.business_id = $1 AND s.is_active = TRUE
        AND $2 = ANY(s.service_ids)
    `;
    const staffParams: Array<string> = [input.businessId, input.serviceId];

    if (input.staffId) {
      staffQuery += ` AND s.id = $3`;
      staffParams.push(input.staffId);
    }

    const staffResult = await db.query<StaffRow>(staffQuery, staffParams);
    const staffList = staffResult.rows;

    // Get existing bookings for the day
    const existingResult = await db.query<BookingRow>(`
      SELECT * FROM bookings
      WHERE business_id = $1
        AND starts_at BETWEEN $2 AND $3
        AND status NOT IN ('cancelled')
    `, [input.businessId, dayStart.toDate(), dayEnd.toDate()]);

    const existingBookings: Booking[] = existingResult.rows.map(toBooking);

    // Get business settings (buffer time)
    const bizResult = await db.query<BusinessSettingsRow>(
      'SELECT settings FROM businesses WHERE id = $1',
      [input.businessId]
    );
    const settings = bizResult.rows[0]?.settings ?? {};
    const bufferMinutes: number = settings.bufferMinutes ?? 0;

    // Generate candidate slots for each staff member
    const candidates: Array<Pick<Slot, 'startsAt' | 'endsAt' | 'staffId' | 'staffName'>> = [];

    const dayOfWeek = dayStart.day();

    for (const staff of staffList) {
      const workingHours = staff.working_hours.find((wh) => wh.dayOfWeek === dayOfWeek);

      if (!workingHours) continue; // staff doesn't work this day

      const [startH, startM] = workingHours.startTime.split(':').map(Number);
      const [endH, endM] = workingHours.endTime.split(':').map(Number);

      let cursor = dayStart.hour(startH).minute(startM).second(0);
      const workEnd = dayStart.hour(endH).minute(endM).second(0);

      // Get this staff's bookings for conflict detection
      const staffBookings = existingBookings.filter((b) => b.staffId === staff.id);

      while (cursor.add(duration, 'minute').isBefore(workEnd) || cursor.add(duration, 'minute').isSame(workEnd)) {
        const slotStart = cursor.toDate();
        const slotEnd = cursor.add(duration + bufferMinutes, 'minute').toDate();

        // Skip if in break
        if (workingHours.breakStart && workingHours.breakEnd) {
          const [bH, bM] = workingHours.breakStart.split(':').map(Number);
          const [beH, beM] = workingHours.breakEnd.split(':').map(Number);
          const breakStart = dayStart.hour(bH).minute(bM);
          const breakEnd = dayStart.hour(beH).minute(beM);
          if (cursor.isBefore(breakEnd) && cursor.add(duration, 'minute').isAfter(breakStart)) {
            cursor = breakEnd;
            continue;
          }
        }

        // Skip if past
        if (dayjs(slotStart).isBefore(dayjs())) {
          cursor = cursor.add(duration, 'minute');
          continue;
        }

        // Check conflict with existing bookings
        const hasConflict = staffBookings.some((b) => {
          const bStart = new Date(b.startsAt).getTime();
          const bEnd   = new Date(b.endsAt).getTime();
          return slotStart.getTime() < bEnd && slotEnd.getTime() > bStart;
        });

        if (!hasConflict) {
          candidates.push({
            startsAt: slotStart,
            endsAt:   new Date(cursor.add(duration, 'minute').toDate()),
            staffId:  staff.id,
            staffName: staff.name,
          });
        }

        cursor = cursor.add(duration, 'minute');
      }
    }

    // Rank by optimizer score and return top results
    return rankSlots(candidates, existingBookings);
  },
};
