import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { db } from '../db/client';
import type { User, UserRole } from '@slotwise/types';

const BCRYPT_ROUNDS = 12;

function toUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    email: row.email as string,
    name: row.name as string,
    role: row.role as UserRole,
    staffId: row.staff_id as string | undefined,
    isActive: row.is_active as boolean,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
  };
}

export const UserService = {

  async create(input: {
    businessId: string;
    email: string;
    password: string;
    name: string;
    role?: UserRole;
    staffId?: string;
  }): Promise<User> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing) throw new Error('Email already in use');

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const row = await db.queryOneOrThrow(`
      INSERT INTO users (id, business_id, email, password_hash, name, role, staff_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      randomUUID(),
      input.businessId,
      normalizedEmail,
      passwordHash,
      input.name,
      input.role ?? 'owner',
      input.staffId ?? null,
    ]);

    return toUser(row);
  },

  /**
   * Verifies email + password. Returns the user on success, null on failure.
   * Deliberately returns null rather than throwing — callers should give a
   * generic "invalid credentials" response either way (don't leak which part failed).
   */
  async verifyCredentials(email: string, password: string): Promise<User | null> {
    const normalizedEmail = email.trim().toLowerCase();

    const row = await db.queryOne<{ password_hash: string } & Record<string, unknown>>(
      'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
      [normalizedEmail]
    );

    if (!row) return null;

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) return null;

    return toUser(row);
  },

  async getById(userId: string): Promise<User | null> {
    const row = await db.queryOne('SELECT * FROM users WHERE id = $1', [userId]);
    return row ? toUser(row) : null;
  },

  async markLoggedIn(userId: string): Promise<void> {
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
  },

  async changePassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
  },

  async list(businessId: string): Promise<User[]> {
    const result = await db.query(
      'SELECT * FROM users WHERE business_id = $1 ORDER BY created_at ASC',
      [businessId]
    );
    return result.rows.map(toUser);
  },
};
