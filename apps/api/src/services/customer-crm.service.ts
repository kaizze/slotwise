import { db } from '../db/client.js';

export interface CustomerCrmSummary {
  id: string;
  name: string;
  phone: string;
  email?: string;
  lastVisitAt: string | null;
  totalSpent: number;
  currency: string;
  bookingsCount: number;
  noShows: number;
  notes?: string;
  preferences?: string;
  /** Explicitly pinned favourite staff id, if any */
  favouriteStaffId?: string | null;
  /** Display favourite: pinned staff, else most-booked staff */
  favouriteEmployee?: { id: string; name: string } | null;
  createdAt: string;
}

export interface CustomerCrmDetail extends CustomerCrmSummary {
  emailStatus?: string;
  recentBookings: Array<{
    id: string;
    ref: string;
    startsAt: string;
    endsAt: string;
    status: string;
    serviceName: string;
    staffName: string;
    price: number;
  }>;
}

function relativeMoneyStatuses(): string {
  // Revenue attributed to the customer for CRM "total spent"
  return `('completed', 'confirmed')`;
}

export const CustomerCrmService = {

  async list(businessId: string, options?: {
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ customers: CustomerCrmSummary[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const q = options?.query?.trim();

    const countRow = await db.queryOneOrThrow<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM customers c
      WHERE c.business_id = $1
        AND (
          $2::text IS NULL
          OR c.name ILIKE '%' || $2 || '%'
          OR c.phone ILIKE '%' || $2 || '%'
          OR COALESCE(c.email, '') ILIKE '%' || $2 || '%'
        )
    `, [businessId, q || null]);

    const result = await db.query<{
      id: string;
      name: string;
      phone: string;
      email: string | null;
      notes: string | null;
      preferences: string | null;
      created_at: Date;
      last_visit_at: Date | null;
      total_spent: string;
      bookings_count: string;
      no_shows: string;
      favourite_staff_id: string | null;
      favourite_staff_name: string | null;
      currency: string;
    }>(`
      SELECT
        c.id,
        c.name,
        c.phone,
        c.email,
        c.notes,
        c.preferences,
        c.created_at,
        c.favourite_staff_id,
        fav.name AS favourite_staff_name,
        (
          SELECT MAX(b.starts_at)
          FROM bookings b
          WHERE b.customer_id = c.id
            AND b.status IN ('completed', 'confirmed')
            AND b.starts_at <= NOW()
        ) AS last_visit_at,
        COALESCE((
          SELECT SUM(s.price)
          FROM bookings b
          JOIN services s ON s.id = b.service_id
          WHERE b.customer_id = c.id
            AND b.status IN ${relativeMoneyStatuses()}
        ), 0)::text AS total_spent,
        COALESCE((
          SELECT COUNT(*)
          FROM bookings b
          WHERE b.customer_id = c.id
            AND b.status <> 'cancelled'
        ), 0)::text AS bookings_count,
        COALESCE((
          SELECT COUNT(*)
          FROM bookings b
          WHERE b.customer_id = c.id
            AND b.status = 'no_show'
        ), c.no_show_count, 0)::text AS no_shows,
        COALESCE((
          SELECT s.currency FROM services s
          WHERE s.business_id = c.business_id AND s.is_active = TRUE
          LIMIT 1
        ), 'EUR') AS currency
      FROM customers c
      LEFT JOIN staff fav ON fav.id = c.favourite_staff_id
      WHERE c.business_id = $1
        AND (
          $2::text IS NULL
          OR c.name ILIKE '%' || $2 || '%'
          OR c.phone ILIKE '%' || $2 || '%'
          OR COALESCE(c.email, '') ILIKE '%' || $2 || '%'
        )
      ORDER BY c.name ASC
      LIMIT $3 OFFSET $4
    `, [businessId, q || null, limit, offset]);

    const customers = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email ?? undefined,
      lastVisitAt: row.last_visit_at ? new Date(row.last_visit_at).toISOString() : null,
      totalSpent: Number(row.total_spent),
      currency: row.currency,
      bookingsCount: Number(row.bookings_count),
      noShows: Number(row.no_shows),
      notes: row.notes ?? undefined,
      preferences: row.preferences ?? undefined,
      favouriteStaffId: row.favourite_staff_id,
      favouriteEmployee: row.favourite_staff_id
        ? { id: row.favourite_staff_id, name: row.favourite_staff_name ?? 'Staff' }
        : null,
      createdAt: new Date(row.created_at).toISOString(),
    }));

    return { customers, total: Number(countRow.count) };
  },

  async getDetail(businessId: string, customerId: string): Promise<CustomerCrmDetail | null> {
    const row = await db.queryOne<{
      id: string;
      name: string;
      phone: string;
      email: string | null;
      email_status: string | null;
      notes: string | null;
      preferences: string | null;
      created_at: Date;
      last_visit_at: Date | null;
      total_spent: string;
      bookings_count: string;
      no_shows: string;
      favourite_staff_id: string | null;
      favourite_staff_name: string | null;
      derived_staff_id: string | null;
      derived_staff_name: string | null;
      currency: string;
    }>(`
      SELECT
        c.id,
        c.name,
        c.phone,
        c.email,
        c.email_status,
        c.notes,
        c.preferences,
        c.created_at,
        c.favourite_staff_id,
        fav.name AS favourite_staff_name,
        (
          SELECT MAX(b.starts_at)
          FROM bookings b
          WHERE b.customer_id = c.id
            AND b.status IN ('completed', 'confirmed')
            AND b.starts_at <= NOW()
        ) AS last_visit_at,
        COALESCE((
          SELECT SUM(s.price)
          FROM bookings b
          JOIN services s ON s.id = b.service_id
          WHERE b.customer_id = c.id
            AND b.status IN ${relativeMoneyStatuses()}
        ), 0)::text AS total_spent,
        COALESCE((
          SELECT COUNT(*)
          FROM bookings b
          WHERE b.customer_id = c.id
            AND b.status <> 'cancelled'
        ), 0)::text AS bookings_count,
        COALESCE((
          SELECT COUNT(*)
          FROM bookings b
          WHERE b.customer_id = c.id
            AND b.status = 'no_show'
        ), c.no_show_count, 0)::text AS no_shows,
        (
          SELECT st.id
          FROM bookings b
          JOIN staff st ON st.id = b.staff_id
          WHERE b.customer_id = c.id
            AND b.status <> 'cancelled'
          GROUP BY st.id
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ) AS derived_staff_id,
        (
          SELECT st.name
          FROM bookings b
          JOIN staff st ON st.id = b.staff_id
          WHERE b.customer_id = c.id
            AND b.status <> 'cancelled'
          GROUP BY st.id, st.name
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ) AS derived_staff_name,
        COALESCE((
          SELECT s.currency FROM services s
          WHERE s.business_id = c.business_id AND s.is_active = TRUE
          LIMIT 1
        ), 'EUR') AS currency
      FROM customers c
      LEFT JOIN staff fav ON fav.id = c.favourite_staff_id
      WHERE c.business_id = $1 AND c.id = $2
    `, [businessId, customerId]);

    if (!row) return null;

    const favouriteEmployee = row.favourite_staff_id
      ? { id: row.favourite_staff_id, name: row.favourite_staff_name ?? 'Staff' }
      : row.derived_staff_id
        ? { id: row.derived_staff_id, name: row.derived_staff_name ?? 'Staff' }
        : null;

    const favouriteStaffId = row.favourite_staff_id;

    const bookings = await db.query<{
      id: string;
      ref: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
      service_name: string;
      staff_name: string;
      price: string;
    }>(`
      SELECT
        b.id, b.ref, b.starts_at, b.ends_at, b.status,
        s.name AS service_name, s.price::text AS price,
        st.name AS staff_name
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      JOIN staff st ON st.id = b.staff_id
      WHERE b.customer_id = $1 AND b.business_id = $2
      ORDER BY b.starts_at DESC
      LIMIT 20
    `, [customerId, businessId]);

    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email ?? undefined,
      emailStatus: row.email_status ?? undefined,
      lastVisitAt: row.last_visit_at ? new Date(row.last_visit_at).toISOString() : null,
      totalSpent: Number(row.total_spent),
      currency: row.currency,
      bookingsCount: Number(row.bookings_count),
      noShows: Number(row.no_shows),
      notes: row.notes ?? undefined,
      preferences: row.preferences ?? undefined,
      favouriteStaffId,
      favouriteEmployee,
      createdAt: new Date(row.created_at).toISOString(),
      recentBookings: bookings.rows.map((b) => ({
        id: b.id,
        ref: b.ref,
        startsAt: new Date(b.starts_at).toISOString(),
        endsAt: new Date(b.ends_at).toISOString(),
        status: b.status,
        serviceName: b.service_name,
        staffName: b.staff_name,
        price: Number(b.price),
      })),
    };
  },

  async update(
    businessId: string,
    customerId: string,
    updates: {
      name?: string;
      email?: string | null;
      notes?: string | null;
      preferences?: string | null;
      favouriteStaffId?: string | null;
    },
  ): Promise<CustomerCrmDetail | null> {
    const existing = await db.queryOne(
      'SELECT id FROM customers WHERE id = $1 AND business_id = $2',
      [customerId, businessId],
    );
    if (!existing) return null;

    if (updates.favouriteStaffId) {
      const staff = await db.queryOne(
        'SELECT id FROM staff WHERE id = $1 AND business_id = $2',
        [updates.favouriteStaffId, businessId],
      );
      if (!staff) throw new Error('Staff member not found');
    }

    await db.query(`
      UPDATE customers SET
        name = COALESCE($3, name),
        email = CASE WHEN $4::boolean THEN $5 ELSE email END,
        notes = CASE WHEN $6::boolean THEN $7 ELSE notes END,
        preferences = CASE WHEN $8::boolean THEN $9 ELSE preferences END,
        favourite_staff_id = CASE WHEN $10::boolean THEN $11::uuid ELSE favourite_staff_id END
      WHERE id = $1 AND business_id = $2
    `, [
      customerId,
      businessId,
      updates.name?.trim() || null,
      updates.email !== undefined,
      updates.email === null || updates.email === ''
        ? null
        : updates.email?.trim().toLowerCase() ?? null,
      updates.notes !== undefined,
      updates.notes ?? null,
      updates.preferences !== undefined,
      updates.preferences ?? null,
      updates.favouriteStaffId !== undefined,
      updates.favouriteStaffId || null,
    ]);

    return this.getDetail(businessId, customerId);
  },
};
