import { db } from '../db/client.js';

export interface PlatformBusinessRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  timezone: string;
  locale: string;
  plan: string | null;
  planExpires: string | null;
  createdAt: string;
  staffCount: number;
  servicesCount: number;
  bookings7d: number;
  smsEnabled: boolean;
  emailEnabled: boolean;
  agentEnabled: boolean;
  smsProvider: string | null;
}

export interface PlatformHealthReport {
  status: 'ok' | 'degraded';
  ts: string;
  db: {
    healthy: boolean;
    latencyMs: number;
    poolSize: number;
    idleConnections: number;
    waitingClients: number;
  };
  env: {
    database: boolean;
    jwt: boolean;
    brevo: boolean;
    apifon: boolean;
    twilio: boolean;
    llm: boolean;
    platformAdmin: boolean;
  };
  notifications: {
    pending: number;
    processing: number;
    failed24h: number;
    sent24h: number;
  };
  fleet: {
    businesses: number;
    activeStaff: number;
    bookingsToday: number;
  };
}

export const PlatformService = {
  async listBusinesses(query?: string): Promise<PlatformBusinessRow[]> {
    const q = query?.trim();
    const result = await db.query<{
      id: string;
      name: string;
      slug: string;
      type: string;
      timezone: string;
      locale: string;
      plan: string | null;
      plan_expires: Date | null;
      created_at: Date;
      staff_count: string;
      services_count: string;
      bookings_7d: string;
      settings: Record<string, unknown> | null;
    }>(`
      SELECT
        b.id,
        b.name,
        b.slug,
        b.type,
        b.timezone,
        b.locale,
        b.plan,
        b.plan_expires,
        b.created_at,
        b.settings,
        (SELECT COUNT(*)::text FROM staff s WHERE s.business_id = b.id AND s.is_active) AS staff_count,
        (SELECT COUNT(*)::text FROM services sv WHERE sv.business_id = b.id AND sv.is_active) AS services_count,
        (
          SELECT COUNT(*)::text FROM bookings bk
          WHERE bk.business_id = b.id
            AND bk.starts_at >= NOW() - interval '7 days'
            AND bk.status NOT IN ('cancelled')
        ) AS bookings_7d
      FROM businesses b
      WHERE ($1::text IS NULL OR b.name ILIKE '%' || $1 || '%' OR b.slug ILIKE '%' || $1 || '%')
      ORDER BY b.created_at DESC
    `, [q || null]);

    return result.rows.map((row) => {
      const settings = row.settings ?? {};
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        type: row.type,
        timezone: row.timezone,
        locale: row.locale,
        plan: row.plan,
        planExpires: row.plan_expires ? new Date(row.plan_expires).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
        staffCount: Number(row.staff_count),
        servicesCount: Number(row.services_count),
        bookings7d: Number(row.bookings_7d),
        smsEnabled: Boolean(settings.smsEnabled),
        emailEnabled: settings.emailEnabled !== false,
        agentEnabled: Boolean(settings.agentEnabled),
        smsProvider: typeof settings.smsProvider === 'string' ? settings.smsProvider : null,
      };
    });
  },

  async getHealth(): Promise<PlatformHealthReport> {
    const dbHealth = await db.healthCheck();

    const notif = await db.queryOne<{
      pending: string;
      processing: string;
      failed_24h: string;
      sent_24h: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
        COUNT(*) FILTER (WHERE status = 'processing')::text AS processing,
        COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= NOW() - interval '24 hours')::text AS failed_24h,
        COUNT(*) FILTER (WHERE status = 'sent' AND sent_at >= NOW() - interval '24 hours')::text AS sent_24h
      FROM notifications
    `);

    const fleet = await db.queryOne<{
      businesses: string;
      active_staff: string;
      bookings_today: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM businesses) AS businesses,
        (SELECT COUNT(*)::text FROM staff WHERE is_active) AS active_staff,
        (
          SELECT COUNT(*)::text FROM bookings
          WHERE starts_at >= date_trunc('day', NOW())
            AND starts_at < date_trunc('day', NOW()) + interval '1 day'
            AND status NOT IN ('cancelled')
        ) AS bookings_today
    `);

    const env = {
      database: Boolean(process.env.DATABASE_URL),
      jwt: Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET !== 'change-me-in-production'),
      brevo: Boolean(process.env.BREVO_API_KEY),
      apifon: Boolean(process.env.APIFON_TOKEN && process.env.APIFON_SECRET),
      twilio: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      llm: Boolean(
        process.env.OPENAI_API_KEY
        || process.env.ANTHROPIC_API_KEY
        || process.env.GOOGLE_API_KEY,
      ),
      platformAdmin: Boolean(
        process.env.PLATFORM_ADMIN_EMAIL && process.env.PLATFORM_ADMIN_PASSWORD,
      ),
    };

    const healthy = dbHealth.healthy;
    return {
      status: healthy ? 'ok' : 'degraded',
      ts: new Date().toISOString(),
      db: dbHealth,
      env,
      notifications: {
        pending: Number(notif?.pending ?? 0),
        processing: Number(notif?.processing ?? 0),
        failed24h: Number(notif?.failed_24h ?? 0),
        sent24h: Number(notif?.sent_24h ?? 0),
      },
      fleet: {
        businesses: Number(fleet?.businesses ?? 0),
        activeStaff: Number(fleet?.active_staff ?? 0),
        bookingsToday: Number(fleet?.bookings_today ?? 0),
      },
    };
  },
};
