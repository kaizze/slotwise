import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { SlotOfferService } from '../services/slot-offer.service.js';

const listQuerySchema = z.object({
  status: z.enum(['pending', 'accepted', 'expired', 'cancelled', 'all']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export async function offerRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/', async (request, reply) => {
    const business = request.business!;
    const query = listQuerySchema.parse(request.query);

    const offers = await SlotOfferService.list(business.id, {
      status: query.status ?? 'all',
      limit: query.limit ?? 50,
    });

    return reply.send({ data: offers });
  });
}
