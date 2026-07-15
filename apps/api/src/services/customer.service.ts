import { randomUUID } from 'crypto';
import { db } from '../db/client.js';
import type { Customer, CustomerEmailStatus } from '@slotwise/types';

function toCustomer(row: Record<string, unknown>): Customer {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    name: row.name as string,
    phone: row.phone as string,
    email: (row.email as string | null) ?? undefined,
    emailStatus: (row.email_status as CustomerEmailStatus | undefined) ?? 'valid',
    noShowCount: row.no_show_count as number,
    totalBookings: row.total_bookings as number,
    createdAt: row.created_at as Date,
  };
}

export const CustomerService = {

  async findOrCreate(input: {
    businessId: string;
    phone: string;
    name: string;
    email?: string;
  }): Promise<Customer> {
    const normalizedPhone = input.phone.replace(/\s+/g, '');
    const normalizedEmail = input.email?.trim().toLowerCase() || undefined;

    const existing = await db.queryOne(
      'SELECT * FROM customers WHERE business_id = $1 AND phone = $2',
      [input.businessId, normalizedPhone]
    );

    if (existing) {
      const nextName = input.name || (existing.name as string);
      const previousEmail = ((existing.email as string | null) ?? '').toLowerCase() || null;
      const nameChanged = nextName !== existing.name;
      const emailChanged = normalizedEmail != null && normalizedEmail !== previousEmail;

      if (nameChanged || emailChanged) {
        // New email after a bounce → clear suppression so we can try again
        const updated = await db.queryOneOrThrow(`
          UPDATE customers
          SET name = $2,
              email = COALESCE($3, email),
              email_status = CASE
                WHEN $3 IS NOT NULL AND lower($3) IS DISTINCT FROM lower(COALESCE(email, ''))
                  THEN 'valid'
                ELSE email_status
              END,
              email_status_reason = CASE
                WHEN $3 IS NOT NULL AND lower($3) IS DISTINCT FROM lower(COALESCE(email, ''))
                  THEN NULL
                ELSE email_status_reason
              END,
              email_status_at = CASE
                WHEN $3 IS NOT NULL AND lower($3) IS DISTINCT FROM lower(COALESCE(email, ''))
                  THEN NULL
                ELSE email_status_at
              END
          WHERE id = $1
          RETURNING *
        `, [existing.id as string, nextName, normalizedEmail ?? null]);
        return toCustomer(updated);
      }
      return toCustomer(existing);
    }

    const created = await db.queryOneOrThrow(`
      INSERT INTO customers (id, business_id, name, phone, email)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [randomUUID(), input.businessId, input.name, normalizedPhone, normalizedEmail ?? null]);

    return toCustomer(created);
  },

  async getByPhone(businessId: string, phone: string): Promise<Customer | null> {
    const row = await db.queryOne(
      'SELECT * FROM customers WHERE business_id = $1 AND phone = $2',
      [businessId, phone.replace(/\s+/g, '')]
    );
    return row ? toCustomer(row) : null;
  },

  async getById(customerId: string): Promise<Customer | null> {
    const row = await db.queryOne('SELECT * FROM customers WHERE id = $1', [customerId]);
    return row ? toCustomer(row) : null;
  },

  async recordNoShow(customerId: string): Promise<void> {
    await db.query(
      'UPDATE customers SET no_show_count = no_show_count + 1 WHERE id = $1',
      [customerId]
    );
  },

  async search(businessId: string, query: string, limit = 10): Promise<Customer[]> {
    const result = await db.query(`
      SELECT * FROM customers
      WHERE business_id = $1
        AND (name ILIKE $2 OR phone ILIKE $2)
      ORDER BY name ASC
      LIMIT $3
    `, [businessId, `%${query}%`, limit]);

    return result.rows.map(toCustomer);
  },
};
