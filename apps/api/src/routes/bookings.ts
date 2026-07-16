import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BookingService } from '../services/booking.service.js';
import { CustomerService } from '../services/customer.service.js';
import { BusinessService } from '../services/business.service.js';
import { requireAuth } from '../middleware/auth.js';
import type { Booking } from '@slotwise/types';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createBookingSchema = z.object({
  businessSlug:  z.string(),
  serviceId:     z.string().uuid(),
  staffId:       z.string().uuid(),
  slotDatetime:  z.string(),       // ISO 8601
  customerName:  z.string().min(1),
  customerPhone: z.string().min(6),
  customerEmail: z.string().email().optional(),
  notes:         z.string().optional(),
});

const cancelBookingSchema = z.object({
  reason: z.string().optional(),
});

const listBookingsQuerySchema = z.object({
  from: z.string().optional(),
  to:   z.string().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function bookingRoutes(fastify: FastifyInstance) {

  // Public: create a booking (widget channel)
  fastify.post('/', async (request, reply) => {
    const body = createBookingSchema.parse(request.body);

    const business = await BusinessService.getBySlug(body.businessSlug);
    if (!business) return reply.status(404).send({ error: 'Business not found' });

    const customer = await CustomerService.findOrCreate({
      businessId: business.id,
      name: body.customerName,
      phone: body.customerPhone,
      email: body.customerEmail,
    });

    try {
      const booking = await BookingService.create({
        businessId: business.id,
        serviceId: body.serviceId,
        staffId: body.staffId,
        slotDatetime: body.slotDatetime,
        customerId: customer.id,
        notes: body.notes,
        channel: 'widget',
      });

      return reply.status(201).send({ data: booking });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Booking failed';
      return reply.status(409).send({ error: message });
    }
  });

  // Public: look up a booking by reference
  fastify.get('/:ref', async (request, reply) => {
    const { ref } = request.params as { ref: string };
    const { businessSlug } = request.query as { businessSlug?: string };

    if (!businessSlug) {
      return reply.status(400).send({ error: 'businessSlug query param required' });
    }

    const business = await BusinessService.getBySlug(businessSlug);
    if (!business) return reply.status(404).send({ error: 'Business not found' });

    const bookings = await BookingService.getByBusiness(
      business.id,
      new Date(0),
      new Date('2100-01-01')
    );
    const booking = bookings.find((b: Booking) => b.ref === ref);

    if (!booking) return reply.status(404).send({ error: 'Booking not found' });
    return reply.send({ data: booking });
  });

  // Public: cancel a booking by reference
  fastify.post('/:ref/cancel', async (request, reply) => {
    const { ref } = request.params as { ref: string };
    const body = cancelBookingSchema.parse(request.body ?? {});
    const { businessSlug } = request.query as { businessSlug?: string };

    if (!businessSlug) {
      return reply.status(400).send({ error: 'businessSlug query param required' });
    }

    const business = await BusinessService.getBySlug(businessSlug);
    if (!business) return reply.status(404).send({ error: 'Business not found' });

    try {
      const result = await BookingService.cancel(business.id, ref, body.reason);
      return reply.send({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cancel failed';
      return reply.status(404).send({ error: message });
    }
  });

  // Admin: list bookings for a date range (requires auth)
  fastify.get('/', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const query = listBookingsQuerySchema.parse(request.query);
      const business = request.business!;

      const from = query.from ? new Date(query.from) : new Date();
      const to   = query.to   ? new Date(query.to)   : new Date(Date.now() + 7 * 86_400_000);

      const bookings = await BookingService.getByBusiness(business.id, from, to);
      return reply.send({ data: bookings });
    },
  });

  // Admin: look up bookings by customer phone (used by dashboard search)
  fastify.get('/by-phone/:phone', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const { phone } = request.params as { phone: string };
      const business = request.business!;

      const bookings = await BookingService.getByPhone(business.id, phone);
      return reply.send({ data: bookings });
    },
  });

  // Admin: cancel a booking — scoped to the authenticated business, not a
  // query-param slug. Distinct from the public /:ref/cancel above: that one
  // is for customer self-service (e.g. a "cancel my booking" link in an SMS),
  // this one is for staff cancelling on a customer's behalf from the dashboard.
  fastify.post('/:ref/admin-cancel', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const { ref } = request.params as { ref: string };
      const body = cancelBookingSchema.parse(request.body ?? {});
      const business = request.business!;

      try {
        const result = await BookingService.cancel(business.id, ref, body.reason);
        return reply.send({ data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Cancel failed';
        return reply.status(404).send({ error: message });
      }
    },
  });

  // Admin: mark a confirmed booking as no-show (feeds customer no-show profiling)
  fastify.post('/:ref/admin-no-show', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const { ref } = request.params as { ref: string };
      const business = request.business!;

      try {
        const booking = await BookingService.markNoShow(business.id, ref);
        return reply.send({ data: booking });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Mark no-show failed';
        return reply.status(404).send({ error: message });
      }
    },
  });
}
