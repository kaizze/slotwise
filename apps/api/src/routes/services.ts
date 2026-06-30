import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ServiceService } from '../services/service.service.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';

const createServiceSchema = z.object({
  name:            z.string().min(1),
  description:     z.string().optional(),
  durationMinutes: z.number().int().positive(),
  price:           z.number().nonnegative(),
  color:           z.string().optional(),
});

const updateServiceSchema = createServiceSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export async function serviceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/', async (request, reply) => {
    const business = request.business!;
    const { includeInactive } = request.query as { includeInactive?: string };

    const services = await ServiceService.list(business.id, includeInactive === 'true');
    return reply.send({ data: services });
  });

  fastify.get('/:id', async (request, reply) => {
    const business = request.business!;
    const { id } = request.params as { id: string };

    const service = await ServiceService.getById(business.id, id);
    if (!service) return reply.status(404).send({ error: 'Service not found' });

    return reply.send({ data: service });
  });

  fastify.post('/', async (request, reply) => {
    const business = request.business!;
    const body = createServiceSchema.parse(request.body);

    const service = await ServiceService.create({
      businessId: business.id,
      ...body,
    });

    return reply.status(201).send({ data: service });
  });

  fastify.patch('/:id', async (request, reply) => {
    const business = request.business!;
    const { id } = request.params as { id: string };
    const body = updateServiceSchema.parse(request.body);

    try {
      const service = await ServiceService.update(business.id, id, body);
      return reply.send({ data: service });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed';
      return reply.status(404).send({ error: message });
    }
  });

  fastify.delete('/:id', {
    preHandler: requireOwner,
    handler: async (request, reply) => {
      const business = request.business!;
      const { id } = request.params as { id: string };

      await ServiceService.deactivate(business.id, id);
      return reply.status(204).send();
    },
  });
}
