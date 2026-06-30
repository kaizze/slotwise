import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SlotService } from '../services/slot.service';
import { BusinessService } from '../services/business.service';

const getSlotsQuerySchema = z.object({
  serviceId: z.string().uuid(),
  date:      z.string(),               // YYYY-MM-DD or "Wednesday"/"tomorrow"
  staffId:   z.string().uuid().optional(),
});

export async function slotRoutes(fastify: FastifyInstance) {

  // Public: get scored available slots for a business + service + date
  fastify.get('/:businessSlug', async (request, reply) => {
    const { businessSlug } = request.params as { businessSlug: string };
    const query = getSlotsQuerySchema.parse(request.query);

    const business = await BusinessService.getBySlug(businessSlug);
    if (!business) return reply.status(404).send({ error: 'Business not found' });

    try {
      const slots = await SlotService.getAvailableSlots({
        businessId: business.id,
        serviceId: query.serviceId,
        date: query.date,
        staffId: query.staffId,
      });

      return reply.send({ data: slots });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not fetch slots';
      return reply.status(400).send({ error: message });
    }
  });

  // Public: list services for a business (widget needs this to build the form)
  fastify.get('/:businessSlug/services', async (request, reply) => {
    const { businessSlug } = request.params as { businessSlug: string };

    const business = await BusinessService.getBySlug(businessSlug);
    if (!business) return reply.status(404).send({ error: 'Business not found' });

    const services = await SlotService.getServices(business.id);
    return reply.send({ data: services });
  });
}
