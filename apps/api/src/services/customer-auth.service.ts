import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { db } from '../db/client.js';
import { BusinessService } from './business.service.js';
import type { Customer, CustomerAuthTokenPayload, CustomerEmailStatus } from '@slotwise/types';

const BCRYPT_ROUNDS = 12;

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
    notes: (row.notes as string | null) ?? undefined,
    preferences: (row.preferences as string | null) ?? undefined,
    favouriteStaffId: (row.favourite_staff_id as string | null) ?? undefined,
    createdAt: row.created_at as Date,
  };
}

function publicCustomer(customer: Customer) {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
  };
}

function accessPayload(customer: Customer): CustomerAuthTokenPayload {
  return {
    typ: 'customer',
    customerId: customer.id,
    businessId: customer.businessId,
  };
}

export class CustomerAuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'CustomerAuthError';
  }
}

export const CustomerAuthService = {

  /**
   * Create a registered customer account for a business, or upgrade an existing
   * guest row (same phone, no password yet) by setting a password.
   */
  async register(input: {
    businessSlug: string;
    name: string;
    phone: string;
    email: string;
    password: string;
  }): Promise<{ customer: Customer; accessTokenPayload: CustomerAuthTokenPayload }> {
    const business = await BusinessService.getBySlug(input.businessSlug);
    if (!business) {
      throw new CustomerAuthError('Business not found', 404);
    }

    const normalizedPhone = input.phone.replace(/[^\d+]/g, '');
    const normalizedEmail = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const digitCount = (normalizedPhone.match(/\d/g) ?? []).length;

    if (digitCount < 8) {
      throw new CustomerAuthError('Enter a valid phone number with at least 8 digits');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const byPhone = await db.queryOne(
      'SELECT * FROM customers WHERE business_id = $1 AND phone = $2',
      [business.id, normalizedPhone],
    );

    if (byPhone?.password_hash) {
      throw new CustomerAuthError('An account already exists for this phone. Sign in instead.', 409);
    }

    // Another registered customer already uses this email at this business.
    const emailTaken = await db.queryOne(
      `SELECT id FROM customers
       WHERE business_id = $1
         AND password_hash IS NOT NULL
         AND lower(email) = $2
         AND ($3::uuid IS NULL OR id <> $3)`,
      [business.id, normalizedEmail, (byPhone?.id as string | undefined) ?? null],
    );
    if (emailTaken) {
      throw new CustomerAuthError('An account already exists for this email. Sign in instead.', 409);
    }

    if (byPhone) {
      // Upgrade guest → registered account
      const previousEmail = ((byPhone.email as string | null) ?? '').toLowerCase() || null;
      const emailChanged = normalizedEmail !== previousEmail;

      const updated = await db.queryOneOrThrow(`
        UPDATE customers
        SET name = $2,
            email = $3,
            password_hash = $4,
            email_status = CASE WHEN $5 THEN 'valid' ELSE email_status END,
            email_status_reason = CASE WHEN $5 THEN NULL ELSE email_status_reason END,
            email_status_at = CASE WHEN $5 THEN NULL ELSE email_status_at END
        WHERE id = $1
        RETURNING *
      `, [byPhone.id as string, name, normalizedEmail, passwordHash, emailChanged]);

      const customer = toCustomer(updated);
      return { customer, accessTokenPayload: accessPayload(customer) };
    }

    const created = await db.queryOneOrThrow(`
      INSERT INTO customers (id, business_id, name, phone, email, password_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [randomUUID(), business.id, name, normalizedPhone, normalizedEmail, passwordHash]);

    const customer = toCustomer(created);
    return { customer, accessTokenPayload: accessPayload(customer) };
  },

  /**
   * Sign in with email or phone + password for a specific business.
   * Returns null on any credential failure (generic error at the route layer).
   */
  async login(input: {
    businessSlug: string;
    identifier: string;
    password: string;
  }): Promise<{ customer: Customer; accessTokenPayload: CustomerAuthTokenPayload } | null> {
    const business = await BusinessService.getBySlug(input.businessSlug);
    if (!business) return null;

    const identifier = input.identifier.trim();
    if (!identifier) return null;

    const looksLikeEmail = identifier.includes('@');
    const row = looksLikeEmail
      ? await db.queryOne<{ password_hash: string | null } & Record<string, unknown>>(
          `SELECT * FROM customers
           WHERE business_id = $1
             AND password_hash IS NOT NULL
             AND lower(email) = $2
           LIMIT 1`,
          [business.id, identifier.toLowerCase()],
        )
      : await db.queryOne<{ password_hash: string | null } & Record<string, unknown>>(
          `SELECT * FROM customers
           WHERE business_id = $1
             AND password_hash IS NOT NULL
             AND phone = $2
           LIMIT 1`,
          [business.id, identifier.replace(/\s+/g, '')],
        );

    if (!row?.password_hash) return null;

    const valid = await bcrypt.compare(input.password, row.password_hash);
    if (!valid) return null;

    const customer = toCustomer(row);
    return { customer, accessTokenPayload: accessPayload(customer) };
  },

  async getById(customerId: string): Promise<Customer | null> {
    const row = await db.queryOne(
      'SELECT * FROM customers WHERE id = $1 AND password_hash IS NOT NULL',
      [customerId],
    );
    return row ? toCustomer(row) : null;
  },

  toPublicCustomer: publicCustomer,
};
