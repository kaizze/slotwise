import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BusinessService } from '../services/business.service.js';
import {
  runAgentLoop,
  buildSystemPrompt,
  messagesToHistory,
  normalizeHistory,
  toDisplayMessages,
} from '../agents/booking-agent.js';
import type { AgentTurnMessage } from '../agents/llm-types.js';
import { messageFromText } from '../agents/llm-types.js';
import { optionalCustomerAuth } from '../middleware/customer-auth.js';
import { CustomerAuthService } from '../services/customer-auth.service.js';

// ─── Route registration ───────────────────────────────────────────────────────

const chatBodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ),
  // Full agent history including tool calls/results from previous turns.
  // Round-trip as `history` on the next request to preserve context.
  history: z.array(z.any()).optional(),
  sessionId: z.string().optional(),
});

export async function agentRoutes(fastify: FastifyInstance) {
  fastify.post('/:businessSlug/chat', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    preHandler: optionalCustomerAuth,
    handler: async (request, reply) => {
      try {
      const { businessSlug } = request.params as { businessSlug: string };
      const body = chatBodySchema.parse(request.body);

      const business = await BusinessService.getBySlug(businessSlug);
      if (!business) {
        return reply.status(404).send({ error: 'Business not found' });
      }

      if (!business.settings.agentEnabled) {
        return reply.status(403).send({ error: 'AI agent not enabled for this business' });
      }

      const signedInCustomer =
        request.authCustomer?.businessId === business.id
          ? await CustomerAuthService.getById(request.authCustomer.customerId)
          : null;

      const systemPrompt = buildSystemPrompt(
        business,
        signedInCustomer
          ? {
              name: signedInCustomer.name,
              phone: signedInCustomer.phone,
              email: signedInCustomer.email,
            }
          : undefined,
      );

      let agentMessages: AgentTurnMessage[];

      if (body.history && body.history.length > 0) {
        agentMessages = normalizeHistory(body.history);

        const lastUserMessage = [...body.messages].reverse().find((m) => m.role === 'user');
        const lastHistoryMsg = agentMessages[agentMessages.length - 1];
        const historyEndsWithUserText =
          lastHistoryMsg?.role === 'user' &&
          lastHistoryMsg.parts.some((p) => p.kind === 'text');

        if (lastUserMessage && !historyEndsWithUserText) {
          agentMessages = [
            ...agentMessages,
            messageFromText('user', lastUserMessage.content),
          ];
        }
      } else {
        agentMessages = messagesToHistory(body.messages);
      }

      const { reply: agentReply, messages: updatedMessages } = await runAgentLoop(
        agentMessages,
        systemPrompt,
        business.id
      );

      return reply.send({
        reply: agentReply,
        messages: toDisplayMessages(updatedMessages),
        history: updatedMessages,
      });
      } catch (err) {
      request.log.error({ err }, 'Agent chat failed');

      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('Missing required env var')) {
        return reply.status(503).send({
          error: 'agent_not_configured',
          message: 'AI agent is not configured on the server (missing API key).',
        });
      }

      return reply.status(500).send({
        error: 'agent_error',
        message: 'The booking assistant failed. Please try again in a moment.',
      });
      }
    },
  });
}
