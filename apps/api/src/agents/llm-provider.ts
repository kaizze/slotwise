import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { GoogleGenerativeAI, type Content, type Part, type FunctionDeclarationSchema } from '@google/generative-ai';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  AgentPart,
  AgentTurnMessage,
  LlmCompletionResult,
  LlmProvider,
  ToolDefinition,
} from './llm-types.js';
import { extractReplyText } from './llm-types.js';

// ─── Provider selection ───────────────────────────────────────────────────────

export type AgentLlmProviderName = 'openai' | 'gemini' | 'anthropic';

export function getAgentLlmProvider(): LlmProvider {
  const name = (process.env.AGENT_LLM_PROVIDER ?? 'openai').toLowerCase() as AgentLlmProviderName;

  switch (name) {
    case 'gemini':
      return new GeminiProvider();
    case 'anthropic':
      return new AnthropicProvider();
    case 'openai':
    default:
      return new OpenAiProvider();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function defaultModel(provider: AgentLlmProviderName): string {
  if (process.env.AGENT_LLM_MODEL) return process.env.AGENT_LLM_MODEL;

  switch (provider) {
    case 'openai':
      return 'gpt-4o-mini';
    case 'gemini':
      return 'gemini-2.0-flash';
    case 'anthropic':
      return 'claude-haiku-4-5';
  }
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

class OpenAiProvider implements LlmProvider {
  private client: OpenAI | null = null;
  private model = defaultModel('openai');

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });
    }
    return this.client;
  }

  async complete(input: {
    systemPrompt: string;
    messages: AgentTurnMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmCompletionResult> {
    const openAiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: input.systemPrompt },
      ...toOpenAiMessages(input.messages),
    ];

    const response = await this.getClient().chat.completions.create({
      model: this.model,
      max_tokens: 1024,
      messages: openAiMessages,
      tools: input.tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    });

    const choice = response.choices[0];
    if (!choice) {
      return { stopReason: 'end_turn', parts: [{ kind: 'text', text: '' }] };
    }

    const parts = fromOpenAiAssistantMessage(choice.message);

    if (choice.finish_reason === 'tool_calls' || parts.some((p) => p.kind === 'tool_call')) {
      return { stopReason: 'tool_use', parts };
    }

    return { stopReason: 'end_turn', parts };
  }
}

function toOpenAiMessages(messages: AgentTurnMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    const text = extractReplyText(msg.parts);
    const toolCalls = msg.parts.filter((p): p is Extract<AgentPart, { kind: 'tool_call' }> => p.kind === 'tool_call');
    const toolResults = msg.parts.filter((p): p is Extract<AgentPart, { kind: 'tool_result' }> => p.kind === 'tool_result');

    if (msg.role === 'assistant') {
      if (toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });
      } else if (text) {
        out.push({ role: 'assistant', content: text });
      }
      continue;
    }

    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        out.push({ role: 'tool', tool_call_id: tr.id, content: tr.result });
      }
      continue;
    }

    if (text) out.push({ role: 'user', content: text });
  }

  return out;
}

function fromOpenAiAssistantMessage(
  message: OpenAI.Chat.Completions.ChatCompletionMessage
): AgentPart[] {
  const parts: AgentPart[] = [];

  if (message.content) parts.push({ kind: 'text', text: message.content });

  for (const call of message.tool_calls ?? []) {
    if (call.type !== 'function') continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      args = {};
    }
    parts.push({ kind: 'tool_call', id: call.id, name: call.function.name, args });
  }

  return parts;
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

class GeminiProvider implements LlmProvider {
  private client: GoogleGenerativeAI | null = null;
  private model = defaultModel('gemini');

  private getClient(): GoogleGenerativeAI {
    if (!this.client) {
      this.client = new GoogleGenerativeAI(requireEnv('GOOGLE_API_KEY'));
    }
    return this.client;
  }

  async complete(input: {
    systemPrompt: string;
    messages: AgentTurnMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmCompletionResult> {
    const model = this.getClient().getGenerativeModel({
      model: this.model,
      systemInstruction: input.systemPrompt,
      tools: [{ functionDeclarations: input.tools.map(toGeminiTool) }],
    });

    const contents: Content[] = input.messages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: toGeminiParts(msg.parts),
    }));

    const result = await model.generateContent({ contents });
    const response = result.response;
    const candidate = response.candidates?.[0];

    const parts: AgentPart[] = [];
    const contentParts = candidate?.content?.parts ?? [];

    for (const part of contentParts) {
      if (part.text) parts.push({ kind: 'text', text: part.text });
      if (part.functionCall?.name) {
        parts.push({
          kind: 'tool_call',
          id: `call_${randomUUID()}`,
          name: part.functionCall.name,
          args: (part.functionCall.args as Record<string, unknown>) ?? {},
        });
      }
    }

    const hasToolCall = parts.some((p) => p.kind === 'tool_call');
    return { stopReason: hasToolCall ? 'tool_use' : 'end_turn', parts };
  }
}

function toGeminiTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as unknown as FunctionDeclarationSchema,
  };
}

function toGeminiParts(parts: AgentPart[]): Part[] {
  const out: Part[] = [];

  for (const part of parts) {
    if (part.kind === 'text' && part.text) {
      out.push({ text: part.text });
    } else if (part.kind === 'tool_call') {
      out.push({ functionCall: { name: part.name, args: part.args } });
    } else if (part.kind === 'tool_result') {
      out.push({
        functionResponse: {
          name: part.name,
          response: { output: part.result },
        },
      });
    }
  }

  return out;
}

// ─── Anthropic (legacy opt-in) ────────────────────────────────────────────────

class AnthropicProvider implements LlmProvider {
  private model = defaultModel('anthropic');

  async complete(input: {
    systemPrompt: string;
    messages: AgentTurnMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmCompletionResult> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });

    const anthropicMessages = toAnthropicMessages(input.messages);

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: input.systemPrompt,
      messages: anthropicMessages,
      tools: input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters as Anthropic.Tool.InputSchema,
      })),
    });

    const parts: AgentPart[] = [];

    for (const block of response.content) {
      if (block.type === 'text') parts.push({ kind: 'text', text: block.text });
      if (block.type === 'tool_use') {
        parts.push({
          kind: 'tool_call',
          id: block.id,
          name: block.name,
          args: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
      parts,
    };
  }
}

function toAnthropicMessages(messages: AgentTurnMessage[]): Anthropic.MessageParam[] {
  return messages.map((msg): Anthropic.MessageParam => {
    type Block =
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      | { type: 'tool_result'; tool_use_id: string; content: string };

    const blocks: Block[] = [];

    for (const part of msg.parts) {
      if (part.kind === 'text') {
        blocks.push({ type: 'text', text: part.text });
      } else if (part.kind === 'tool_call') {
        blocks.push({ type: 'tool_use', id: part.id, name: part.name, input: part.args });
      } else if (part.kind === 'tool_result') {
        blocks.push({ type: 'tool_result', tool_use_id: part.id, content: part.result });
      }
    }

    if (blocks.length === 1 && blocks[0]?.type === 'text') {
      return { role: msg.role, content: blocks[0].text };
    }

    return { role: msg.role, content: blocks as Anthropic.MessageParam['content'] };
  });
}
