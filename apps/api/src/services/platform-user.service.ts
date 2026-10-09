import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { db } from '../db/client.js';
import type { PlatformRole, PlatformUser } from '@slotwise/types';

const BCRYPT_ROUNDS = 12;

function toPlatformUser(row: Record<string, unknown>): PlatformUser {
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    role: row.role as PlatformRole,
    isActive: row.is_active as boolean,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
  };
}

export const PlatformUserService = {
  async getById(id: string): Promise<PlatformUser | null> {
    const row = await db.queryOne('SELECT * FROM platform_users WHERE id = $1', [id]);
    return row ? toPlatformUser(row) : null;
  },

  async getByEmail(email: string): Promise<PlatformUser | null> {
    const row = await db.queryOne(
      'SELECT * FROM platform_users WHERE lower(email) = lower($1)',
      [email],
    );
    return row ? toPlatformUser(row) : null;
  },

  async create(input: {
    email: string;
    password: string;
    name: string;
    role?: PlatformRole;
  }): Promise<PlatformUser> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const row = await db.queryOneOrThrow(`
      INSERT INTO platform_users (id, email, password_hash, name, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      randomUUID(),
      input.email.trim().toLowerCase(),
      passwordHash,
      input.name.trim(),
      input.role ?? 'admin',
    ]);
    return toPlatformUser(row);
  },

  async verifyCredentials(email: string, password: string): Promise<PlatformUser | null> {
    const row = await db.queryOne<{
      id: string;
      email: string;
      name: string;
      role: PlatformRole;
      is_active: boolean;
      password_hash: string;
      last_login_at: string | null;
      created_at: string;
    }>(`
      SELECT * FROM platform_users
      WHERE lower(email) = lower($1) AND is_active = TRUE
    `, [email]);

    if (!row) return null;
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return null;

    await db.query(
      'UPDATE platform_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1',
      [row.id],
    );

    return toPlatformUser({ ...row, last_login_at: new Date().toISOString() });
  },

  /**
   * Ensures a bootstrap admin exists from env (idempotent).
   * Used on API boot so the first deploy has a login without a CLI step.
   */
  async ensureBootstrapAdmin(): Promise<void> {
    const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.PLATFORM_ADMIN_PASSWORD;
    if (!email || !password) return;

    const existing = await this.getByEmail(email);
    if (existing) return;

    const name = process.env.PLATFORM_ADMIN_NAME?.trim() || 'Platform Admin';
    await this.create({ email, password, name, role: 'admin' });
    console.info(`[platform] Bootstrap admin created for ${email}`);
  },
};
