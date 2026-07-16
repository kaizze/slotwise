import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { db } from '../db/client.js';
import type { WorkingHours } from '@slotwise/types';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface OverviewBooking {
  id: string;
  ref: string;
  startsAt: string;
  endsAt: string;
  status: string;
  channel: string;
  serviceName?: string;
  serviceColor?: string;
  staffName?: string;
  customerName?: string;
  customerPhone?: string;
  noShowRisk: number;
}

export interface TodayOverview {
  date: string;
  timezone: string;
  currency: string;
  totals: {
    bookingsToday: number;
    revenueToday: number;
    occupancyPercent: number | null;
    upcomingIn30Min: number;
    waitlistActive: number;
    cancelledToday: number;
  };
  timeline: OverviewBooking[];
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh! * 60 + em!) - (sh! * 60 + sm!);
}

function capacityMinutesForDay(workingHours: WorkingHours[], dayOfWeek: number): number {
  return workingHours
    .filter((wh) => wh.dayOfWeek === dayOfWeek)
    .reduce((sum, wh) => {
      let mins = minutesBetween(wh.startTime, wh.endTime);
      if (wh.breakStart && wh.breakEnd) {
        mins -= minutesBetween(wh.breakStart, wh.breakEnd);
      }
      return sum + Math.max(0, mins);
    }, 0);
}

export const OverviewService = {

  async getToday(businessId: string): Promise<TodayOverview> {
    const biz = await db.queryOneOrThrow<{ timezone: string }>(
      'SELECT timezone FROM businesses WHERE id = $1',
      [businessId],
    );
    const tz = biz.timezone || 'UTC';
    const now = dayjs().tz(tz);
    const date = now.format('YYYY-MM-DD');
    const dayStart = now.startOf('day').toDate();
    const dayEnd = now.add(1, 'day').startOf('day').toDate();
    const in30 = now.add(30, 'minute').toDate();

    const currencyRow = await db.queryOne<{ currency: string }>(`
      SELECT COALESCE(
        (SELECT currency FROM services WHERE business_id = $1 AND is_active = TRUE LIMIT 1),
        'EUR'
      ) AS currency
    `, [businessId]);

    const totals = await db.queryOneOrThrow<{
      bookings_today: string;
      revenue_today: string;
      cancelled_today: string;
      upcoming_30: string;
      booked_minutes: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE b.status <> 'cancelled')::text AS bookings_today,
        COALESCE(SUM(s.price) FILTER (WHERE b.status IN ('confirmed', 'completed', 'pending')), 0)::text AS revenue_today,
        COUNT(*) FILTER (WHERE b.status = 'cancelled')::text AS cancelled_today,
        COUNT(*) FILTER (
          WHERE b.status <> 'cancelled'
            AND b.starts_at >= NOW()
            AND b.starts_at < $4::timestamptz
        )::text AS upcoming_30,
        COALESCE(SUM(
          EXTRACT(EPOCH FROM (b.ends_at - b.starts_at)) / 60
        ) FILTER (WHERE b.status <> 'cancelled'), 0)::text AS booked_minutes
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      WHERE b.business_id = $1
        AND b.starts_at >= $2::timestamptz
        AND b.starts_at < $3::timestamptz
    `, [businessId, dayStart.toISOString(), dayEnd.toISOString(), in30.toISOString()]);

    const waitlist = await db.queryOneOrThrow<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM waitlist
      WHERE business_id = $1 AND notified = FALSE
    `, [businessId]);

    const staffResult = await db.query<{ working_hours: WorkingHours[] }>(`
      SELECT working_hours FROM staff
      WHERE business_id = $1 AND is_active = TRUE
    `, [businessId]);

    const dow = now.day(); // 0=Sun
    const capacityMinutes = staffResult.rows.reduce(
      (sum, row) => sum + capacityMinutesForDay(row.working_hours ?? [], dow),
      0,
    );
    const bookedMinutes = Number(totals.booked_minutes);
    const occupancyPercent = capacityMinutes > 0
      ? Math.min(100, Math.round((bookedMinutes / capacityMinutes) * 100))
      : null;

    const timelineResult = await db.query<{
      id: string;
      ref: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
      channel: string;
      no_show_risk: number;
      service_name: string | null;
      service_color: string | null;
      staff_name: string | null;
      customer_name: string | null;
      customer_phone: string | null;
    }>(`
      SELECT
        b.id, b.ref, b.starts_at, b.ends_at, b.status, b.channel, b.no_show_risk,
        s.name AS service_name, s.color AS service_color,
        st.name AS staff_name,
        c.name AS customer_name, c.phone AS customer_phone
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      JOIN staff st ON st.id = b.staff_id
      JOIN customers c ON c.id = b.customer_id
      WHERE b.business_id = $1
        AND b.starts_at >= $2::timestamptz
        AND b.starts_at < $3::timestamptz
        AND b.status <> 'cancelled'
      ORDER BY b.starts_at ASC
    `, [businessId, dayStart.toISOString(), dayEnd.toISOString()]);

    return {
      date,
      timezone: tz,
      currency: currencyRow?.currency ?? 'EUR',
      totals: {
        bookingsToday: Number(totals.bookings_today),
        revenueToday: Number(totals.revenue_today),
        occupancyPercent,
        upcomingIn30Min: Number(totals.upcoming_30),
        waitlistActive: Number(waitlist.count),
        cancelledToday: Number(totals.cancelled_today),
      },
      timeline: timelineResult.rows.map((row) => ({
        id: row.id,
        ref: row.ref,
        startsAt: new Date(row.starts_at).toISOString(),
        endsAt: new Date(row.ends_at).toISOString(),
        status: row.status,
        channel: row.channel,
        noShowRisk: Number(row.no_show_risk ?? 0),
        serviceName: row.service_name ?? undefined,
        serviceColor: row.service_color ?? undefined,
        staffName: row.staff_name ?? undefined,
        customerName: row.customer_name ?? undefined,
        customerPhone: row.customer_phone ?? undefined,
      })),
    };
  },
};
