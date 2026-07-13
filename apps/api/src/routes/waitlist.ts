import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BusinessService } from '../services/business.service.js';
import { WaitlistService } from '../services/waitlist.service.js';

const joinWaitlistSchema = z.object({
  businessSlug: z.string(),
  serviceId: z.string().uuid(),
  customerName: z.string().min(1),
  customerPhone: z.string().min(6),
  customerEmail: z.string().email().optional(),
  staffId: z.string().uuid().optional(),
  preferredDate: z.string().optional(),
});

export async function waitlistRoutes(fastify: FastifyInstance) {

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
}
