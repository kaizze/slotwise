import { db } from '../db/client.js';

export interface AnalyticsTotals {
  reservations: number;
  revenue: number;
  cancelled: number;
  noShows: number;
  completed: number;
  confirmed: number;
  pending: number;
}

export interface AnalyticsBucket {
  key: string;
  label: string;
  count: number;
  revenue: number;
}

export interface AnalyticsReport {
  from: string;
  to: string;
  timezone: string;
  currency: string;
  totals: AnalyticsTotals;
  byHour: AnalyticsBucket[];
  byDayOfWeek: AnalyticsBucket[];
  byService: AnalyticsBucket[];
  byChannel: AnalyticsBucket[];
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export const AnalyticsService = {

  async getReport(input: {
    businessId: string;
    from: Date;
    to: Date;
  }): Promise<AnalyticsReport> {
    const biz = await db.queryOneOrThrow<{ timezone: string }>(
      'SELECT timezone FROM businesses WHERE id = $1',
      [input.businessId],
    );
    const timezone = biz.timezone || 'UTC';

    const currencyRow = await db.queryOne<{ currency: string }>(`
      SELECT COALESCE(
        (SELECT currency FROM services WHERE business_id = $1 AND is_active = TRUE LIMIT 1),
        'EUR'
      ) AS currency
    `, [input.businessId]);
    const currency = currencyRow?.currency ?? 'EUR';

    const params = [input.businessId, input.from.toISOString(), input.to.toISOString(), timezone];

    const totalsRow = await db.queryOneOrThrow<{
      reservations: string;
      revenue: string;
      cancelled: string;
      no_shows: string;
      completed: string;
      confirmed: string;
      pending: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE b.status <> 'cancelled')::text AS reservations,
        COALESCE(SUM(s.price) FILTER (WHERE b.status IN ('confirmed', 'completed', 'pending')), 0)::text AS revenue,
        COUNT(*) FILTER (WHERE b.status = 'cancelled')::text AS cancelled,
        COUNT(*) FILTER (WHERE b.status = 'no_show')::text AS no_shows,
        COUNT(*) FILTER (WHERE b.status = 'completed')::text AS completed,
        COUNT(*) FILTER (WHERE b.status = 'confirmed')::text AS confirmed,
        COUNT(*) FILTER (WHERE b.status = 'pending')::text AS pending
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      WHERE b.business_id = $1
        AND b.starts_at >= $2::timestamptz
        AND b.starts_at < $3::timestamptz
    `, [input.businessId, input.from.toISOString(), input.to.toISOString()]);

    const hourRows = await db.query<{ hour: number; count: string; revenue: string }>(`
      SELECT
        EXTRACT(HOUR FROM b.starts_at AT TIME ZONE $4)::int AS hour,
        COUNT(*)::text AS count,
        COALESCE(SUM(s.price), 0)::text AS revenue
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      WHERE b.business_id = $1
        AND b.starts_at >= $2::timestamptz
        AND b.starts_at < $3::timestamptz
        AND b.status <> 'cancelled'
      GROUP BY 1
      ORDER BY 1
    `, params);

    const dowRows = await db.query<{ dow: number; count: string; revenue: string }>(`
      SELECT
        EXTRACT(DOW FROM b.starts_at AT TIME ZONE $4)::int AS dow,
        COUNT(*)::text AS count,
        COALESCE(SUM(s.price), 0)::text AS revenue
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      WHERE b.business_id = $1
        AND b.starts_at >= $2::timestamptz
        AND b.starts_at < $3::timestamptz
        AND b.status <> 'cancelled'
      GROUP BY 1
      ORDER BY 1
    `, params);

    const serviceRows = await db.query<{
      service_id: string;
      service_name: string;
      count: string;
      revenue: string;
    }>(`
      SELECT
        s.id AS service_id,
        s.name AS service_name,
        COUNT(*)::text AS count,
        COALESCE(SUM(s.price), 0)::text AS revenue
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      WHERE b.business_id = $1
        AND b.starts_at >= $2::timestamptz
        AND b.starts_at < $3::timestamptz
        AND b.status <> 'cancelled'
      GROUP BY s.id, s.name
      ORDER BY COUNT(*) DESC, s.name ASC
    `, [input.businessId, input.from.toISOString(), input.to.toISOString()]);

    const channelRows = await db.query<{ channel: string; count: string; revenue: string }>(`
      SELECT
        b.channel,
        COUNT(*)::text AS count,
        COALESCE(SUM(s.price), 0)::text AS revenue
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      WHERE b.business_id = $1
        AND b.starts_at >= $2::timestamptz
        AND b.starts_at < $3::timestamptz
        AND b.status <> 'cancelled'
      GROUP BY b.channel
      ORDER BY COUNT(*) DESC
    `, [input.businessId, input.from.toISOString(), input.to.toISOString()]);

    const hourMap = new Map(hourRows.rows.map((r) => [r.hour, r]));
    const byHour: AnalyticsBucket[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const row = hourMap.get(hour);
      const count = Number(row?.count ?? 0);
      // Keep typical salon hours visible; include early/late only when they have bookings.
      if (count === 0 && (hour < 8 || hour > 20)) continue;
      byHour.push({
        key: String(hour),
        label: hourLabel(hour),
        count,
        revenue: Number(row?.revenue ?? 0),
      });
    }

    const dowMap = new Map(dowRows.rows.map((r) => [r.dow, r]));
    const byDayOfWeek: AnalyticsBucket[] = DAY_LABELS.map((label, dow) => {
      const row = dowMap.get(dow);
      return {
        key: String(dow),
        label,
        count: Number(row?.count ?? 0),
        revenue: Number(row?.revenue ?? 0),
      };
    });

    return {
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      timezone,
      currency,
      totals: {
        reservations: Number(totalsRow.reservations),
        revenue: Number(totalsRow.revenue),
        cancelled: Number(totalsRow.cancelled),
        noShows: Number(totalsRow.no_shows),
        completed: Number(totalsRow.completed),
        confirmed: Number(totalsRow.confirmed),
        pending: Number(totalsRow.pending),
      },
      byHour,
      byDayOfWeek,
      byService: serviceRows.rows.map((r) => ({
        key: r.service_id,
        label: r.service_name,
        count: Number(r.count),
        revenue: Number(r.revenue),
      })),
      byChannel: channelRows.rows.map((r) => ({
        key: r.channel,
        label: r.channel,
        count: Number(r.count),
        revenue: Number(r.revenue),
      })),
    };
  },
};
