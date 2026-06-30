import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { db } from '../db/client';
import { UserService } from './user.service';
import { RefreshTokenService } from './refresh-token.service';
import type { User, Business, AuthTokenPayload } from '@slotwise/types';

const BCRYPT_ROUNDS = 12;

function toUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    email: row.email as string,
    name: row.name as string,
    role: row.role as User['role'],
    staffId: row.staff_id as string | undefined,
    isActive: row.is_active as boolean,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
  };
}

function toBusiness(row: Record<string, unknown>): Business {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    type: row.type as Business['type'],
    timezone: row.timezone as string,
    locale: row.locale as string,
    settings: row.settings as Business['settings'],
    createdAt: row.created_at as Date,
  };
}

export interface SignupInput {
  businessName: string;
  businessSlug: string;
  businessType: Business['type'];
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  timezone?: string;
  locale?: string;
}

export interface AuthResult {
  user: User;
  business: Business;
  accessTokenPayload: AuthTokenPayload;
  refreshToken: string;
}

export const AuthService = {

  /**
   * Creates a new business AND its first owner user atomically.
   * If either insert fails (e.g. duplicate slug, duplicate email), nothing
   * is persisted — there's no such thing as a business with no owner.
   */
  async signup(input: SignupInput): Promise<AuthResult> {
    const normalizedEmail = input.ownerEmail.trim().toLowerCase();

    // Pre-check email uniqueness for a clean error before we even open a transaction
    // (the unique constraint would also catch this, but this gives a clearer message)
    const existingUser = await db.queryOne('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existingUser) throw new Error('Email already in use');

    const defaultSettings = {
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      maxAdvanceDays: 30,
      requiresDeposit: false,
      smsEnabled: false,
      agentEnabled: false,
      noShowThreshold: 0.5,
    };

    const passwordHash = await bcrypt.hash(input.ownerPassword, BCRYPT_ROUNDS);

    const { business, user } = await db.transaction(async (tx) => {
      const businessRow = await tx.queryOneOrThrow(`
        INSERT INTO businesses (id, name, slug, type, timezone, locale, settings)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        randomUUID(),
        input.businessName,
        input.businessSlug,
        input.businessType,
        input.timezone ?? 'Europe/Athens',
        input.locale ?? 'el',
        JSON.stringify(defaultSettings),
      ], 'Could not create business — slug may already be taken');

      const userRow = await tx.queryOneOrThrow(`
        INSERT INTO users (id, business_id, email, password_hash, name, role)
        VALUES ($1, $2, $3, $4, $5, 'owner')
        RETURNING *
      `, [
        randomUUID(),
        businessRow.id,
        normalizedEmail,
        passwordHash,
        input.ownerName,
      ], 'Could not create owner account');

      return { business: toBusiness(businessRow), user: toUser(userRow) };
    });

    const refreshToken = await RefreshTokenService.issue(user.id);

    return {
      user,
      business,
      accessTokenPayload: { userId: user.id, businessId: business.id, role: user.role },
      refreshToken,
    };
  },

  async login(email: string, password: string): Promise<AuthResult | null> {
    const user = await UserService.verifyCredentials(email, password);
    if (!user) return null;

    const business = await db.queryOne('SELECT * FROM businesses WHERE id = $1', [user.businessId]);
    if (!business) return null; // orphaned user — shouldn't happen, but don't crash

    await UserService.markLoggedIn(user.id);
    const refreshToken = await RefreshTokenService.issue(user.id);

    return {
      user,
      business: toBusiness(business),
      accessTokenPayload: { userId: user.id, businessId: user.businessId, role: user.role },
      refreshToken,
    };
  },

  /**
   * Exchanges a valid refresh token for a new access token payload + a
   * rotated refresh token. The old refresh token is invalidated immediately.
   */
  async refresh(rawRefreshToken: string): Promise<{
    accessTokenPayload: AuthTokenPayload;
    refreshToken: string;
  } | null> {
    const verified = await RefreshTokenService.verify(rawRefreshToken);
    if (!verified) return null;

    const user = await UserService.getById(verified.userId);
    if (!user || !user.isActive) return null;

    const newRefreshToken = await RefreshTokenService.rotate(verified.tokenId, user.id);

    return {
      accessTokenPayload: { userId: user.id, businessId: user.businessId, role: user.role },
      refreshToken: newRefreshToken,
    };
  },

  async logout(rawRefreshToken: string): Promise<void> {
    await RefreshTokenService.revoke(rawRefreshToken);
  },
};
