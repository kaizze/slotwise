import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BusinessService } from '../services/business.service.js';
import { WaitlistService } from '../services/waitlist.service.js';
import { requireAuth } from '../middleware/auth.js';

const joinWaitlistSchema = z.object({
  businessSlug: z.string(),
  serviceId: z.string().uuid(),
  customerName: z.string().min(1),
  customerPhone: z.string().min(6),
  customerEmail: z.string().email().optional(),
  staffId: z.string().uuid().optional(),
  preferredDate: z.string().optional(),
});

const listQuerySchema = z.object({
  includeNotified: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export async function waitlistRoutes(fastify: FastifyInstance) {

  // Public: join waitlist (widget / agent)
  fastify.post('/', async (request, reply) => {
    const body = joinWaitlistSchema.parse(request.body);

    const business = await BusinessService.getBySlug(body.businessSlug);
    if (!business) return reply.status(404).send({ error: 'Business not found' });

    let preferredWindowStart: Date | undefined;
    let preferredWindowEnd: Date | undefined;

    if (body.preferredDate) {
      const dayStart = new Date(body.preferredDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(body.preferredDate);
      dayEnd.setHours(23, 59, 59, 999);
      preferredWindowStart = dayStart;
      preferredWindowEnd = dayEnd;
    }

    const entry = await WaitlistService.join({
      businessId: business.id,
      serviceId: body.serviceId,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      customerEmail: body.customerEmail,
      staffId: body.staffId,
      preferredWindowStart,
      preferredWindowEnd,
    });

    return reply.status(201).send({ data: entry });
  });

  // Admin: list waitlist entries for the authenticated business
  fastify.get('/', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const business = request.business!;
      const query = listQuerySchema.parse(request.query);

      const entries = await WaitlistService.list(business.id, {
        includeNotified: query.includeNotified === 'true',
        limit: query.limit ?? 50,
      });

      return reply.send({ data: entries });
    },
  });

  // Admin: remove someone from the waitlist
  fastify.delete('/:id', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const business = request.business!;
      const { id } = request.params as { id: string };

      try {
        await WaitlistService.remove(business.id, id);
        return reply.status(204).send();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Remove failed';
        return reply.status(404).send({ error: message });
      }
    },
  });
}
