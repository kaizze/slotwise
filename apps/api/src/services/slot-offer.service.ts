import { randomBytes, randomUUID } from 'crypto';
import { db } from '../db/client.js';
import type { Booking } from '@slotwise/types';
import type { ConsolidationSuggestion } from '@slotwise/slot-optimizer';

const OFFER_TTL_MS = 2 * 60 * 60_000; // 2 hours
const CONSOLIDATION_MIN_SCORE_GAIN = 10;

interface SlotOfferRow {
  id: string;
  business_id: string;
  customer_id: string;
  offer_type: 'rebook' | 'waitlist';
  booking_id: string | null;
  waitlist_id: string | null;
  service_id: string;
  staff_id: string;
  slot_starts_at: Date;
  slot_ends_at: Date;
  status: string;
  offer_token: string;
  incentive: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Date;
}

function generateOfferToken(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

function computeExpiresAt(slotStartsAt: Date): Date {
  const ttlExpiry = new Date(Date.now() + OFFER_TTL_MS);
  const slotExpiry = new Date(slotStartsAt.getTime() - 5 * 60_000);
  return ttlExpiry < slotExpiry ? ttlExpiry : slotExpiry;
}

const ACCEPTANCE_PATTERN = /^(yes|y|ok|okay|sure|ναι|ναι!|accept|confirmed|confirm)$/i;

function messageContainsToken(message: string, token: string): boolean {
  return message.toUpperCase().includes(token.toUpperCase());
}

export interface SlotOfferListItem {
  id: string;
  offerType: 'rebook' | 'waitlist';
  status: string;
  offerToken: string;
  slotStartsAt: string;
  slotEndsAt: string;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
  incentive?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  serviceName: string;
  staffName: string;
  bookingRef?: string;
}

export const SlotOfferService = {

  consolidationMinScoreGain: CONSOLIDATION_MIN_SCORE_GAIN,

  async list(businessId: string, options?: {
    status?: 'pending' | 'accepted' | 'expired' | 'cancelled' | 'all';
    limit?: number;
  }): Promise<SlotOfferListItem[]> {
    const status = options?.status ?? 'all';
    const limit = options?.limit ?? 50;

    const result = await db.query<SlotOfferRow & {
      booking_ref: string | null;
      service_name: string;
      staff_name: string;
      customer_name: string;
      customer_phone: string;
      customer_email: string | null;
    }>(`
      SELECT
        o.*,
        b.ref AS booking_ref,
        s.name AS service_name,
        st.name AS staff_name,
        c.name AS customer_name,
        c.phone AS customer_phone,
        c.email AS customer_email
      FROM slot_offers o
      JOIN customers c ON c.id = o.customer_id
      JOIN services s ON s.id = o.service_id
      JOIN staff st ON st.id = o.staff_id
      LEFT JOIN bookings b ON b.id = o.booking_id
      WHERE o.business_id = $1
        AND ($2::text = 'all' OR o.status = $2)
      ORDER BY o.created_at DESC
      LIMIT $3
    `, [businessId, status, limit]);

    // Mark expired pending offers lazily for accurate dashboard status
    const now = Date.now();
    for (const row of result.rows) {
      if (row.status === 'pending' && new Date(row.expires_at).getTime() <= now) {
        await db.query(`UPDATE slot_offers SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [row.id]);
        row.status = 'expired';
      }
    }

    return result.rows.map((row) => ({
      id: row.id,
      offerType: row.offer_type,
      status: row.status,
      offerToken: row.offer_token,
      slotStartsAt: new Date(row.slot_starts_at).toISOString(),
      slotEndsAt: new Date(row.slot_ends_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : undefined,
      createdAt: new Date(row.created_at).toISOString(),
      incentive: row.incentive ?? undefined,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerEmail: row.customer_email ?? undefined,
      serviceName: row.service_name,
      staffName: row.staff_name,
      bookingRef: row.booking_ref ?? undefined,
    }));
  },

  async createRebookOffer(
    booking: Booking,
    suggestion: ConsolidationSuggestion,
    slotEndsAt: Date,
  ): Promise<{ offerId: string; offerToken: string }> {
    const slotStartsAt = new Date(suggestion.suggestedSlot);
    await this.cancelPendingOffersForSlot(booking.businessId, booking.staffId, slotStartsAt);

    const offerToken = generateOfferToken();
    const row = await db.queryOneOrThrow<SlotOfferRow>(`
      INSERT INTO slot_offers
        (id, business_id, customer_id, offer_type, booking_id, service_id, staff_id,
         slot_starts_at, slot_ends_at, offer_token, incentive, expires_at)
      VALUES
        ($1, $2, $3, 'rebook', $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      randomUUID(),
      booking.businessId,
      booking.customerId,
      booking.id,
      booking.serviceId,
      booking.staffId,
      slotStartsAt,
      slotEndsAt,
      offerToken,
      suggestion.incentive ?? null,
      computeExpiresAt(slotStartsAt),
    ]);

    return { offerId: row.id, offerToken: row.offer_token };
  },

  async createWaitlistOffer(input: {
    businessId: string;
    customerId: string;
    waitlistId: string;
    serviceId: string;
    staffId: string;
    slotStartsAt: Date;
    slotEndsAt: Date;
  }): Promise<{ offerId: string; offerToken: string }> {
    await this.cancelPendingOffersForSlot(input.businessId, input.staffId, input.slotStartsAt);

    const offerToken = generateOfferToken();
    const row = await db.queryOneOrThrow<SlotOfferRow>(`
      INSERT INTO slot_offers
        (id, business_id, customer_id, offer_type, waitlist_id, service_id, staff_id,
         slot_starts_at, slot_ends_at, offer_token, expires_at)
      VALUES
        ($1, $2, $3, 'waitlist', $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      randomUUID(),
      input.businessId,
      input.customerId,
      input.waitlistId,
      input.serviceId,
      input.staffId,
      input.slotStartsAt,
      input.slotEndsAt,
      offerToken,
      computeExpiresAt(input.slotStartsAt),
    ]);

    // Leave the active waitlist as soon as we offer a slot (not only on accept).
    await db.query(
      'UPDATE waitlist SET notified = TRUE WHERE id = $1 AND business_id = $2',
      [input.waitlistId, input.businessId],
    );

    return { offerId: row.id, offerToken: row.offer_token };
  },

  async cancelPendingOffersForSlot(
    businessId: string,
    staffId: string,
    slotStartsAt: Date,
  ): Promise<void> {
    await db.query(`
      UPDATE slot_offers
      SET status = 'cancelled'
      WHERE business_id = $1
        AND staff_id = $2
        AND slot_starts_at = $3
        AND status = 'pending'
    `, [businessId, staffId, slotStartsAt]);
  },

  async getPendingForPhone(businessId: string, phone: string) {
    const normalizedPhone = phone.replace(/\s+/g, '');
    const result = await db.query<SlotOfferRow & {
      booking_ref: string | null;
      service_name: string;
      staff_name: string;
      customer_phone: string;
    }>(`
      SELECT o.*, b.ref AS booking_ref, s.name AS service_name, st.name AS staff_name, c.phone AS customer_phone
      FROM slot_offers o
      JOIN customers c ON c.id = o.customer_id
      JOIN services s ON s.id = o.service_id
      JOIN staff st ON st.id = o.staff_id
      LEFT JOIN bookings b ON b.id = o.booking_id
      WHERE o.business_id = $1
        AND c.phone = $2
        AND o.status = 'pending'
        AND o.expires_at > NOW()
      ORDER BY o.created_at DESC
    `, [businessId, normalizedPhone]);

    return result.rows;
  },

  async tryAcceptFromMessage(
    businessId: string,
    phone: string,
    message: string,
  ): Promise<{ handled: boolean; reply?: string }> {
    const trimmed = message.trim();
    const normalizedPhone = phone.replace(/\s+/g, '');

    let offer = await db.queryOne<SlotOfferRow>(`
      SELECT o.*
      FROM slot_offers o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.business_id = $1
        AND c.phone = $2
        AND o.status = 'pending'
        AND o.expires_at > NOW()
      ORDER BY o.created_at DESC
      LIMIT 1
    `, [businessId, normalizedPhone]);

    if (!offer) return { handled: false };

    const tokenMatch = offer.offer_token && messageContainsToken(trimmed, offer.offer_token);
    const yesMatch = ACCEPTANCE_PATTERN.test(trimmed);

    if (!tokenMatch && !yesMatch) return { handled: false };

    try {
      const result = await this.acceptOffer(offer.id, businessId, offer.customer_id);
      return { handled: true, reply: result.message };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not accept offer';
      return { handled: true, reply: msg };
    }
  },

  async acceptOffer(
    offerId: string,
    businessId: string,
    customerId: string,
    offerToken?: string,
  ): Promise<{ booking: Booking; message: string }> {
    const offer = await db.queryOne<SlotOfferRow>(`
      SELECT * FROM slot_offers
      WHERE id = $1 AND business_id = $2 AND customer_id = $3
    `, [offerId, businessId, customerId]);

    if (!offer) throw new Error('Offer not found');
    if (offerToken && offer.offer_token !== offerToken.toUpperCase()) {
      throw new Error('Invalid offer code');
    }
    if (offer.status !== 'pending') throw new Error('This offer is no longer available');
    if (offer.expires_at <= new Date()) {
      await db.query(`UPDATE slot_offers SET status = 'expired' WHERE id = $1`, [offer.id]);
      throw new Error('This offer has expired');
    }

    let booking: Booking;
    const { BookingService } = await import('./booking.service.js');

    if (offer.offer_type === 'rebook') {
      if (!offer.booking_id) throw new Error('Invalid rebook offer');

      const existing = await db.queryOne<{ ref: string }>(
        'SELECT ref FROM bookings WHERE id = $1',
        [offer.booking_id]
      );
      if (!existing) throw new Error('Booking not found');

      booking = await BookingService.reschedule(
        businessId,
        existing.ref,
        new Date(offer.slot_starts_at),
      );
    } else {
      booking = await BookingService.create({
        businessId,
        serviceId: offer.service_id,
        staffId: offer.staff_id,
        slotDatetime: new Date(offer.slot_starts_at).toISOString(),
        customerId: offer.customer_id,
        channel: 'agent',
        notes: 'Booked from waitlist offer',
      });

      if (offer.waitlist_id) {
        await db.query('UPDATE waitlist SET notified = TRUE WHERE id = $1', [offer.waitlist_id]);
      }
    }

    await db.query(`
      UPDATE slot_offers
      SET status = 'accepted', accepted_at = NOW()
      WHERE id = $1
    `, [offer.id]);

    await db.query(`
      UPDATE slot_offers
      SET status = 'cancelled'
      WHERE business_id = $1
        AND staff_id = $2
        AND slot_starts_at = $3
        AND status = 'pending'
        AND id != $4
    `, [businessId, offer.staff_id, offer.slot_starts_at, offer.id]);

    return {
      booking,
      message: `Done! Your appointment is confirmed. Reference: ${booking.ref}`,
    };
  },
};
