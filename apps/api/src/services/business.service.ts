import { randomUUID } from 'crypto';
import { db } from '../db/client.js';
import type { Business } from '@slotwise/types';

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

export const BusinessService = {

  async getBySlug(slug: string): Promise<Business | null> {
    const row = await db.queryOne(
      'SELECT * FROM businesses WHERE slug = $1',
      [slug]
    );
    return row ? toBusiness(row) : null;
  },

  async getById(id: string): Promise<Business | null> {
    const row = await db.queryOne(
      'SELECT * FROM businesses WHERE id = $1',
      [id]
    );
    return row ? toBusiness(row) : null;
  },

  async create(input: {
    name: string;
    slug: string;
    type: Business['type'];
    timezone?: string;
    locale?: string;
  }): Promise<Business> {
    const defaultSettings = {
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      maxAdvanceDays: 30,
      requiresDeposit: false,
      smsEnabled: false,
      agentEnabled: false,
      noShowThreshold: 0.5,
    };

    const row = await db.queryOneOrThrow(`
      INSERT INTO businesses (id, name, slug, type, timezone, locale, settings)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      randomUUID(),
      input.name,
      input.slug,
      input.type,
      input.timezone ?? 'Europe/Athens',
      input.locale ?? 'el',
      JSON.stringify(defaultSettings),
    ]);

    return toBusiness(row);
  },

  async updateSettings(
    businessId: string,
    settings: Partial<Business['settings']>
  ): Promise<Business> {
    const current = await this.getById(businessId);
    if (!current) throw new Error('Business not found');

    const merged = { ...current.settings, ...settings };

    const row = await db.queryOneOrThrow(`
      UPDATE businesses SET settings = $2 WHERE id = $1
      RETURNING *
    `, [businessId, JSON.stringify(merged)]);

    return toBusiness(row);
  },
};
