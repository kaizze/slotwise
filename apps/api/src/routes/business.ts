import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BusinessService } from '../services/business.service';
import { requireAuth, requireOwner } from '../middleware/auth';

const updateSettingsSchema = z.object({
  slotDurationMinutes: z.number().int().positive().optional(),
  bufferMinutes: z.number().int().nonnegative().optional(),
  maxAdvanceDays: z.number().int().positive().optional(),
  requiresDeposit: z.boolean().optional(),
  depositAmount: z.number().nonnegative().optional(),
  smsEnabled: z.boolean().optional(),
  agentEnabled: z.boolean().optional(),
  noShowThreshold: z.number().min(0).max(1).optional(),
});

export async function businessRoutes(fastify: FastifyInstance) {

  // Public: minimal business info for the widget (name, type, locale — no settings internals)
  fastify.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const business = await BusinessService.getBySlug(slug);
    if (!business) return reply.status(404).send({ error: 'Business not found' });

    return reply.send({
      data: {
        name: business.name,
        type: business.type,
        timezone: business.timezone,
        locale: business.locale,
        agentEnabled: business.settings.agentEnabled,
      },
    });
  });

  // Tenant creation happens via POST /api/v1/auth/signup (business + owner
  // user created together — there's no such thing as a business with no
  // owner, so this is intentionally not a standalone endpoint here).

  // Admin: get full settings (requires auth)
  fastify.get('/me', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      return reply.send({ data: request.business });
    },
  });

  // Admin: update settings — owner only (controls billing-relevant toggles like agentEnabled)
  fastify.patch('/me/settings', {
    preHandler: [requireAuth, requireOwner],
    handler: async (request, reply) => {
      const business = request.business!;
      const updates = updateSettingsSchema.parse(request.body);

      const updated = await BusinessService.updateSettings(business.id, updates);
      return reply.send({ data: updated });
    },
  });
}

