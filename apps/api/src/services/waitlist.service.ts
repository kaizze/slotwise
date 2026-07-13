import { randomUUID } from 'crypto';
import { db } from '../db/client.js';
import { CustomerService } from './customer.service.js';
import type { WaitlistEntry } from '@slotwise/types';

function toWaitlistEntry(row: Record<string, unknown>): WaitlistEntry {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    customerId: row.customer_id as string,
    serviceId: row.service_id as string,
    staffId: row.staff_id as string | undefined,
    preferredWindowStart: row.preferred_window_start
      ? new Date(row.preferred_window_start as string)
      : undefined,
    preferredWindowEnd: row.preferred_window_end
      ? new Date(row.preferred_window_end as string)
      : undefined,
    createdAt: new Date(row.created_at as string),
  };
}

export const WaitlistService = {

  async join(input: {
    businessId: string;
    serviceId: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    staffId?: string;
    preferredWindowStart?: Date;
    preferredWindowEnd?: Date;
  }): Promise<WaitlistEntry> {
    const customer = await CustomerService.findOrCreate({
      businessId: input.businessId,
      name: input.customerName,
      phone: input.customerPhone,
      email: input.customerEmail,
    });

    // One active waitlist entry per customer/service
    const existing = await db.queryOne(`
      SELECT id FROM waitlist
      WHERE business_id = $1 AND customer_id = $2 AND service_id = $3 AND notified = FALSE
    `, [input.businessId, customer.id, input.serviceId]);

    if (existing) {
      const updated = await db.queryOneOrThrow(`
        UPDATE waitlist
        SET staff_id = $2,
            preferred_window_start = $3,
            preferred_window_end = $4
        WHERE id = $1
        RETURNING *
      `, [
        existing.id as string,
        input.staffId ?? null,
        input.preferredWindowStart ?? null,
        input.preferredWindowEnd ?? null,
      ]);
      return toWaitlistEntry(updated);
    }

    const created = await db.queryOneOrThrow(`
      INSERT INTO waitlist
        (id, business_id, customer_id, service_id, staff_id,
         preferred_window_start, preferred_window_end)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      randomUUID(),
      input.businessId,
      customer.id,
      input.serviceId,
      input.staffId ?? null,
      input.preferredWindowStart ?? null,
      input.preferredWindowEnd ?? null,
    ]);

    return toWaitlistEntry(created);
  },
};
