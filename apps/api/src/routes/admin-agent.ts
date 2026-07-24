import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  buildAdminSystemPrompt,
  runAdminAgentLoop,
} from '../agents/admin-agent.js';
import {
  normalizeHistory,
  toDisplayMessages,
  messageFromText,
} from '../agents/llm-types.js';
import type { AgentTurnMessage } from '../agents/llm-types.js';

function messagesToHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): AgentTurnMessage[] {
  return messages.map((m) => messageFromText(m.role, m.content));
}

const chatBodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    }),
  ),
  history: z.array(z.any()).optional(),
});

export async function adminAgentRoutes(fastify: FastifyInstance) {
  fastify.post('/chat', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      try {
        const body = chatBodySchema.parse(request.body);
        const business = request.business!;

        const systemPrompt = buildAdminSystemPrompt(business);

        let agentMessages: AgentTurnMessage[];

        if (body.history && body.history.length > 0) {
          agentMessages = normalizeHistory(body.history);

          const lastUserMessage = [...body.messages].reverse().find((m) => m.role === 'user');
          const lastHistoryMsg = agentMessages[agentMessages.length - 1];
          const historyEndsWithUserText =
            lastHistoryMsg?.role === 'user'
            && lastHistoryMsg.parts.some((p) => p.kind === 'text');

          if (lastUserMessage && !historyEndsWithUserText) {
            agentMessages = [
              ...agentMessages,
              messageFromText('user', lastUserMessage.content),
            ];
          }
        } else {
          agentMessages = messagesToHistory(body.messages);
        }

        const { reply: agentReply, messages: updatedMessages } = await runAdminAgentLoop(
          agentMessages,
          systemPrompt,
          business.id,
        );

        return reply.send({
          data: {
            reply: agentReply,
            messages: toDisplayMessages(updatedMessages),
            history: updatedMessages,
          },
        });
      } catch (err) {
        request.log.error({ err }, 'Admin agent chat failed');

        const message = err instanceof Error ? err.message : 'Unknown error';
        if (message.includes('Missing required env var')) {
          return reply.status(503).send({
            error: 'AI assistant is not configured on the server (missing API key).',
          });
        }

        return reply.status(500).send({
          error: 'The admin assistant failed. Please try again in a moment.',
        });
      }
    },
  });
}
