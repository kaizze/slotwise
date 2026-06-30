import { randomUUID } from 'crypto';
import { db } from '../db/client.js';
import type { Staff, WorkingHours } from '@slotwise/types';

function toStaff(row: Record<string, unknown>): Staff {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    name: row.name as string,
    email: row.email as string,
    phone: row.phone as string | undefined,
    services: row.service_ids as string[],
    workingHours: row.working_hours as WorkingHours[],
    isActive: row.is_active as boolean,
  };
}

export const StaffService = {

  async list(businessId: string, includeInactive = false): Promise<Staff[]> {
    const sql = includeInactive
      ? 'SELECT * FROM staff WHERE business_id = $1 ORDER BY name ASC'
      : 'SELECT * FROM staff WHERE business_id = $1 AND is_active = TRUE ORDER BY name ASC';

    const result = await db.query(sql, [businessId]);
    return result.rows.map(toStaff);
  },

  async getById(businessId: string, staffId: string): Promise<Staff | null> {
    const row = await db.queryOne(
      'SELECT * FROM staff WHERE id = $1 AND business_id = $2',
      [staffId, businessId]
    );
    return row ? toStaff(row) : null;
  },

  async create(input: {
    businessId: string;
    name: string;
    email?: string;
    phone?: string;
    serviceIds: string[];
    workingHours: WorkingHours[];
  }): Promise<Staff> {
    const row = await db.queryOneOrThrow(`
      INSERT INTO staff (id, business_id, name, email, phone, service_ids, working_hours)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      randomUUID(),
      input.businessId,
      input.name,
      input.email ?? null,
      input.phone ?? null,
      input.serviceIds,
      JSON.stringify(input.workingHours),
    ]);

    return toStaff(row);
  },

  async update(
    businessId: string,
    staffId: string,
    updates: Partial<{
      name: string;
      email: string;
      phone: string;
      serviceIds: string[];
      workingHours: WorkingHours[];
      isActive: boolean;
    }>
  ): Promise<Staff> {
    const existing = await this.getById(businessId, staffId);
    if (!existing) throw new Error('Staff member not found');

    const row = await db.queryOneOrThrow(`
      UPDATE staff SET
        name          = $3,
        email         = $4,
        phone         = $5,
        service_ids   = $6,
        working_hours = $7,
        is_active     = $8
      WHERE id = $1 AND business_id = $2
      RETURNING *
    `, [
      staffId,
      businessId,
      updates.name ?? existing.name,
      updates.email ?? existing.email,
      updates.phone ?? existing.phone ?? null,
      updates.serviceIds ?? existing.services,
      JSON.stringify(updates.workingHours ?? existing.workingHours),
      updates.isActive ?? existing.isActive,
    ]);

    return toStaff(row);
  },

  async deactivate(businessId: string, staffId: string): Promise<void> {
    await db.query(
      'UPDATE staff SET is_active = FALSE WHERE id = $1 AND business_id = $2',
      [staffId, businessId]
    );
  },
};
