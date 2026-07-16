import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { CustomerCrmService } from '../services/customer-crm.service.js';

const listQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  notes: z.string().nullable().optional(),
  preferences: z.string().nullable().optional(),
  favouriteStaffId: z.string().uuid().nullable().optional(),
});

export async function customerRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  // GET /api/v1/customers?q=&limit=&offset=
  fastify.get('/', async (request, reply) => {
    const business = request.business!;
    const query = listQuerySchema.parse(request.query);

    const { customers, total } = await CustomerCrmService.list(business.id, {
      query: query.q,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });

    return reply.send({
      data: {
        customers,
        total,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      },
    });
  });

  // GET /api/v1/customers/:id
  fastify.get('/:id', async (request, reply) => {
    const business = request.business!;
    const { id } = request.params as { id: string };

    const customer = await CustomerCrmService.getDetail(business.id, id);
    if (!customer) return reply.status(404).send({ error: 'Customer not found' });

    return reply.send({ data: customer });
  });

  // PATCH /api/v1/customers/:id — CRM notes / preferences / favourite staff
  fastify.patch('/:id', async (request, reply) => {
    const business = request.business!;
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);

    try {
      const customer = await CustomerCrmService.update(business.id, id, {
        name: body.name,
        email: body.email === '' ? null : body.email,
        notes: body.notes,
        preferences: body.preferences,
        favouriteStaffId: body.favouriteStaffId,
      });
      if (!customer) return reply.status(404).send({ error: 'Customer not found' });
      return reply.send({ data: customer });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed';
      return reply.status(400).send({ error: message });
    }
  });
}
