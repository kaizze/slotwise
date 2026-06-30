import { randomUUID } from 'crypto';
import { db } from '../db/client';
import type { Service } from '@slotwise/types';

function toService(row: Record<string, unknown>): Service {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    durationMinutes: row.duration_minutes as number,
    price: row.price as number,
    currency: row.currency as string,
    color: row.color as string,
    isActive: row.is_active as boolean,
  };
}

export const ServiceService = {

  async list(businessId: string, includeInactive = false): Promise<Service[]> {
    const sql = includeInactive
      ? 'SELECT * FROM services WHERE business_id = $1 ORDER BY name ASC'
      : 'SELECT * FROM services WHERE business_id = $1 AND is_active = TRUE ORDER BY name ASC';

    const result = await db.query(sql, [businessId]);
    return result.rows.map(toService);
  },

  async getById(businessId: string, serviceId: string): Promise<Service | null> {
    const row = await db.queryOne(
      'SELECT * FROM services WHERE id = $1 AND business_id = $2',
      [serviceId, businessId]
    );
    return row ? toService(row) : null;
  },

  async create(input: {
    businessId: string;
    name: string;
    description?: string;
    durationMinutes: number;
    price: number;
    currency?: string;
    color?: string;
  }): Promise<Service> {
    const row = await db.queryOneOrThrow(`
      INSERT INTO services (id, business_id, name, description, duration_minutes, price, currency, color)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      randomUUID(),
      input.businessId,
      input.name,
      input.description ?? null,
      input.durationMinutes,
      input.price,
      input.currency ?? 'EUR',
      input.color ?? '#6366f1',
    ]);

    return toService(row);
  },

  async update(
    businessId: string,
    serviceId: string,
    updates: Partial<{
      name: string;
      description: string;
      durationMinutes: number;
      price: number;
      color: string;
      isActive: boolean;
    }>
  ): Promise<Service> {
    const existing = await this.getById(businessId, serviceId);
    if (!existing) throw new Error('Service not found');

    const row = await db.queryOneOrThrow(`
      UPDATE services SET
        name              = $3,
        description       = $4,
        duration_minutes  = $5,
        price             = $6,
        color             = $7,
        is_active         = $8
      WHERE id = $1 AND business_id = $2
      RETURNING *
    `, [
      serviceId,
      businessId,
      updates.name ?? existing.name,
      updates.description ?? existing.description ?? null,
      updates.durationMinutes ?? existing.durationMinutes,
      updates.price ?? existing.price,
      updates.color ?? existing.color,
      updates.isActive ?? existing.isActive,
    ]);

    return toService(row);
  },

  async deactivate(businessId: string, serviceId: string): Promise<void> {
    await db.query(
      'UPDATE services SET is_active = FALSE WHERE id = $1 AND business_id = $2',
      [serviceId, businessId]
    );
  },
};
