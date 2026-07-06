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
    },
  });
}
