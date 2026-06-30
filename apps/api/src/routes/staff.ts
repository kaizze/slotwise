import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { StaffService } from '../services/staff.service';
import { requireAuth, requireOwner } from '../middleware/auth';

const workingHoursSchema = z.object({
  // Matches WorkingHours['dayOfWeek'] in @slotwise/types exactly (0=Sunday..6=Saturday)
  // — a plain z.number().min(0).max(6) only validates the range at runtime and
  // infers as `number`, not the literal union the shared type requires.
  dayOfWeek:  z.union([
    z.literal(0), z.literal(1), z.literal(2), z.literal(3),
    z.literal(4), z.literal(5), z.literal(6),
  ]),
  startTime:  z.string(),
  endTime:    z.string(),
  breakStart: z.string().optional(),
  breakEnd:   z.string().optional(),
});

const createStaffSchema = z.object({
  name:         z.string().min(1),
  email:        z.string().email().optional(),
  phone:        z.string().optional(),
  serviceIds:   z.array(z.string().uuid()).default([]),
  workingHours: z.array(workingHoursSchema).default([]),
});

const updateStaffSchema = createStaffSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export async function staffRoutes(fastify: FastifyInstance) {
  // All staff management requires auth — public widget never sees this
  fastify.addHook('preHandler', requireAuth);

  fastify.get('/', async (request, reply) => {
    const business = request.business!;
    const { includeInactive } = request.query as { includeInactive?: string };

    const staff = await StaffService.list(business.id, includeInactive === 'true');
    return reply.send({ data: staff });
  });

  fastify.get('/:id', async (request, reply) => {
    const business = request.business!;
    const { id } = request.params as { id: string };

    const staff = await StaffService.getById(business.id, id);
    if (!staff) return reply.status(404).send({ error: 'Staff member not found' });

    return reply.send({ data: staff });
  });

  fastify.post('/', async (request, reply) => {
    const business = request.business!;
    const body = createStaffSchema.parse(request.body);

    const staff = await StaffService.create({
      businessId: business.id,
      ...body,
    });

    return reply.status(201).send({ data: staff });
  });

  fastify.patch('/:id', async (request, reply) => {
    const business = request.business!;
    const { id } = request.params as { id: string };
    const body = updateStaffSchema.parse(request.body);

    try {
      const staff = await StaffService.update(business.id, id, body);
      return reply.send({ data: staff });
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

      await StaffService.deactivate(business.id, id);
      return reply.status(204).send();
    },
  });
}
