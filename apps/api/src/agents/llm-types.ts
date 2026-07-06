// Provider-neutral agent message format. Clients round-trip `history` as
// AgentTurnMessage[] so tool context survives across turns regardless of LLM.

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type AgentPart =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { kind: 'tool_result'; id: string; name: string; result: string };

export interface AgentTurnMessage {
  role: 'user' | 'assistant';
  parts: AgentPart[];
}

export interface LlmCompletionResult {
  stopReason: 'end_turn' | 'tool_use';
  parts: AgentPart[];
}

export interface LlmProvider {
  complete(input: {
    systemPrompt: string;
    messages: AgentTurnMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmCompletionResult>;
}

export function textPart(text: string): AgentPart {
  return { kind: 'text', text };
}

export function messageFromText(role: 'user' | 'assistant', text: string): AgentTurnMessage {
  return { role, parts: [textPart(text)] };
}

export function extractReplyText(parts: AgentPart[]): string {
  return parts
    .filter((p): p is Extract<AgentPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('')
    .trim();
}

/** Simple display history — text-only turns for the chat UI. */
export function toDisplayMessages(messages: AgentTurnMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    const text = extractReplyText(msg.parts);
    if (!text) continue;
    // Skip tool-result-only user turns (internal)
    if (msg.role === 'user' && msg.parts.every((p) => p.kind === 'tool_result')) continue;
    out.push({ role: msg.role, content: text });
  }

  return out;
}

/** Convert legacy Anthropic history blobs from older clients. */
export function normalizeHistory(raw: unknown): AgentTurnMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // Already canonical
  if (raw[0]?.parts) return raw as AgentTurnMessage[];

  const out: AgentTurnMessage[] = [];

  for (const msg of raw) {
    if (!msg || typeof msg !== 'object') continue;
    const role = msg.role === 'assistant' ? 'assistant' : 'user';

    if (typeof msg.content === 'string') {
      out.push(messageFromText(role, msg.content));
      continue;
    }

    if (!Array.isArray(msg.content)) continue;

    const parts: AgentPart[] = [];
    for (const block of msg.content) {
      if (!block || typeof block !== 'object') continue;

      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(textPart(block.text));
      } else if (block.type === 'tool_use') {
        parts.push({
          kind: 'tool_call',
          id: String(block.id),
          name: String(block.name),
          args: (block.input as Record<string, unknown>) ?? {},
        });
      } else if (block.type === 'tool_result') {
        parts.push({
          kind: 'tool_result',
          id: String(block.tool_use_id),
          name: String(block.name ?? 'tool'),
          result: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
        });
      }
    }

    if (parts.length > 0) out.push({ role, parts });
  }

  return out;
}
