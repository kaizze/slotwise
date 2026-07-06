import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AgentMessage } from '@slotwise/types';
import { BusinessService } from '../services/business.service.js';
import { runAgentLoop, buildSystemPrompt } from '../agents/booking-agent.js';

// ─── Route registration ───────────────────────────────────────────────────────

const chatBodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ),
  // Full Anthropic message history including tool calls/results from previous
  // turns. If provided, this is used instead of messages — preserving the
  // complete tool context so the agent doesn't forget what it already looked up.
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

      let anthropicMessages: Anthropic.MessageParam[];

      if (body.history && body.history.length > 0) {
        anthropicMessages = body.history as Anthropic.MessageParam[];

        // The history from the previous turn ends with the assistant's last reply.
        // We need to append the new user message — get it from the messages array
        // (the last user message is what the customer just sent).
        const lastUserMessage = [...body.messages].reverse().find((m) => m.role === 'user');
        const lastHistoryMsg = anthropicMessages[anthropicMessages.length - 1];

        // Only append if the history doesn't already end with this user message
        if (lastUserMessage && lastHistoryMsg?.role !== 'user') {
          anthropicMessages = [
            ...anthropicMessages,
            { role: 'user' as const, content: lastUserMessage.content },
          ];
        }
      } else {
        anthropicMessages = body.messages.map((m) => ({ role: m.role, content: m.content }));
      }

      const { reply: agentReply, messages: updatedMessages } = await runAgentLoop(
        anthropicMessages,
        systemPrompt,
        business.id
      );

      // Simple text messages for display (backward compat)
      const responseMessages: AgentMessage[] = updatedMessages
        .filter((m: Anthropic.MessageParam) => typeof m.content === 'string')
        .map((m: Anthropic.MessageParam) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content as string,
        }));

      responseMessages.push({ role: 'assistant', content: agentReply });

      return reply.send({
        reply: agentReply,
        messages: responseMessages,
        // Full Anthropic history including tool calls — client must round-trip
        // this as `history` on the next request to preserve agent context.
        history: updatedMessages,
      });
    },
  });
}
