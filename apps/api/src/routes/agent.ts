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

      // If the client sends back the full history from a previous turn, use it
      // directly — it contains the tool call/result pairs that give the agent
      // memory of what it already looked up. Without this, the agent starts
      // blind on every turn and hallucinates staff/services it already fetched.
      // Fall back to converting the simple messages array for the first turn.
      const anthropicMessages: Anthropic.MessageParam[] = body.history
        ? (body.history as Anthropic.MessageParam[])
        : body.messages.map((m) => ({ role: m.role, content: m.content }));

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
