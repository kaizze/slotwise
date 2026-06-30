import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AgentMessage } from '@slotwise/types';
import { BusinessService } from '../services/business.service';
import { runAgentLoop, buildSystemPrompt } from '../agents/booking-agent';

// ─── Route registration ───────────────────────────────────────────────────────

const chatBodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ),
  sessionId: z.string().optional(),
});

export async function agentRoutes(fastify: FastifyInstance) {
  fastify.post('/:businessSlug/chat', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const { businessSlug } = request.params as { businessSlug: string };
      const body = chatBodySchema.parse(request.body);

      const business = await BusinessService.getBySlug(businessSlug);
      if (!business) {
        return reply.status(404).send({ error: 'Business not found' });
      }

      if (!business.settings.agentEnabled) {
        return reply.status(403).send({ error: 'AI agent not enabled for this business' });
      }

      const systemPrompt = buildSystemPrompt(business);

      // Convert our message format to Anthropic's format
      const anthropicMessages: Anthropic.MessageParam[] = body.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const { reply: agentReply, messages: updatedMessages } = await runAgentLoop(
        anthropicMessages,
        systemPrompt,
        business.id
      );

      // Convert back to our format for the client
      const responseMessages: AgentMessage[] = updatedMessages
        .filter((m) => typeof m.content === 'string')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content as string,
        }));

      return reply.send({
        reply: agentReply,
        messages: responseMessages,
      });
    },
  });
}
