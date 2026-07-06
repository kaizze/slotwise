import { BookingService } from '../services/booking.service.js';
import { SlotService } from '../services/slot.service.js';
import { CustomerService } from '../services/customer.service.js';
import { StaffService } from '../services/staff.service.js';
import type { Business } from '@slotwise/types';
import type { AgentTurnMessage, ToolDefinition } from './llm-types.js';
import {
  extractReplyText,
  messageFromText,
  normalizeHistory,
  toDisplayMessages,
} from './llm-types.js';
import { getAgentLlmProvider } from './llm-provider.js';

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'get_services',
    description: 'List available services for this business. Call this first to match what the customer wants.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional filter e.g. "haircut", "manicure"' },
      },
    },
  },
  {
    name: 'get_staff',
    description: 'List active staff members. Call when the customer names a specific person.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional name filter e.g. "Maria"' },
      },
    },
  },
  {
    name: 'get_available_slots',
    description: 'Get scored available appointment slots. Always call before presenting options — never invent slots.',
    parameters: {
      type: 'object',
      required: ['service_id'],
      properties: {
        service_id: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD or natural e.g. "Wednesday", "tomorrow"' },
        staff_id: { type: 'string', description: 'Optional staff ID if customer requested a specific person' },
        group_by_staff: {
          type: 'boolean',
          description: 'True when customer asks who is available — one best slot per staff member',
        },
      },
    },
  },
  {
    name: 'find_or_create_customer',
    description: 'Look up customer by phone. Creates a new record if not found.',
    parameters: {
      type: 'object',
      required: ['phone', 'name'],
      properties: {
        phone: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
      },
    },
  },
  {
    name: 'create_booking',
    description: 'Create the appointment. Only call after the customer explicitly confirms all details.',
    parameters: {
      type: 'object',
      required: ['service_id', 'staff_id', 'slot_datetime', 'customer_id'],
      properties: {
        service_id: { type: 'string' },
        staff_id: { type: 'string' },
        slot_datetime: { type: 'string', description: 'ISO 8601 datetime' },
        customer_id: { type: 'string' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'get_customer_bookings',
    description: 'Look up existing and upcoming bookings for a customer by phone.',
    parameters: {
      type: 'object',
      required: ['phone'],
      properties: {
        phone: { type: 'string' },
      },
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel an existing booking by its reference.',
    parameters: {
      type: 'object',
      required: ['booking_ref'],
      properties: {
        booking_ref: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(business: Pick<Business, 'name' | 'type' | 'locale' | 'settings'>): string {
  const defaultLanguage = business.locale === 'el' ? 'Greek' : 'English';

  return `You are the booking assistant for ${business.name} (${business.type}).

VOICE & LANGUAGE:
- Reply in the same language the customer uses. If unclear, use ${defaultLanguage}.
- Tone: warm, clear, and professional — like a helpful front-desk person, not a chatbot or stiff corporate bot.
- Keep messages short: 1-3 sentences unless listing time options.
- Use the customer's name once you know it.
- Never mention internal IDs, UUIDs, or tool names.

BOOKING FLOW (follow in order):
1. Understand what they need: service, date/time, staff preference (ask only what's missing).
2. Call get_services to resolve service names to IDs — always, even if the service seems obvious.
3. If they name a staff member, call get_staff to resolve the name.
4. Call get_available_slots — show at most 3 options, formatted clearly (day, time, staff name).
   - If they ask who is available, use group_by_staff: true.
5. Collect name and phone before booking.
6. Summarize all details and wait for explicit confirmation ("yes", "confirm", etc.).
7. Call create_booking only after they confirm.
8. End with the booking reference and a brief thank-you.

RULES:
- Never claim a service or staff member doesn't exist without calling get_services or get_staff first.
- On each new customer question about services/staff/slots, call the tools again — don't rely on memory alone.
- Never invent availability — always use get_available_slots.
- Multiple services: book one appointment at a time; offer the next after the first is confirmed.
- Ambiguous dates ("tomorrow", "Friday", "next week"): confirm the exact date before searching slots.
- If a tool returns an error, explain simply and ask for the missing info — don't expose raw errors.`;
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

export async function dispatchTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: { businessId: string }
): Promise<string> {
  const { businessId } = context;

  try {
    switch (toolName) {
      case 'get_services': {
        const services = await SlotService.getServices(businessId, toolInput.query as string);
        return JSON.stringify(services);
      }

      case 'get_staff': {
        const staff = await StaffService.list(businessId);

        const greekToLatin: Record<string, string> = {
          'α':'a','β':'b','γ':'g','δ':'d','ε':'e','ζ':'z','η':'i','θ':'th',
          'ι':'i','κ':'k','λ':'l','μ':'m','ν':'n','ξ':'x','ο':'o','π':'p',
          'ρ':'r','σ':'s','ς':'s','τ':'t','υ':'y','φ':'f','χ':'ch','ψ':'ps','ω':'o',
          'ά':'a','έ':'e','ή':'i','ί':'i','ό':'o','ύ':'y','ώ':'o','ϊ':'i','ϋ':'y',
          'ΐ':'i','ΰ':'y',
        };

        function transliterate(str: string): string {
          return str.toLowerCase().split('').map((c) => greekToLatin[c] ?? c).join('');
        }

        const filtered = toolInput.query
          ? (() => {
              const q = transliterate(toolInput.query as string);
              return staff.filter((s) => transliterate(s.name).includes(q));
            })()
          : staff;

        return JSON.stringify(filtered.map((s) => ({ id: s.id, name: s.name })));
      }

      case 'get_available_slots': {
        let serviceId = toolInput.service_id as string;

        const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!UUID_PATTERN.test(serviceId)) {
          const services = await SlotService.getServices(businessId, serviceId);
          if (!services[0]) {
            return JSON.stringify({ error: `No service found matching "${serviceId}". Call get_services first.` });
          }
          serviceId = services[0].id;
        }

        let staffId = toolInput.staff_id as string | undefined;
        if (staffId) {
          if (!UUID_PATTERN.test(staffId)) {
            const allStaff = await StaffService.list(businessId);
            const match = allStaff.find((s) => s.name.toLowerCase().includes(staffId!.toLowerCase()));
            staffId = match?.id;
          }
        }

        const slots = await SlotService.getAvailableSlots({
          businessId,
          serviceId,
          date: toolInput.date as string,
          staffId,
          groupByStaff: toolInput.group_by_staff as boolean | undefined,
        });
        return JSON.stringify(slots.slice(0, 3));
      }

      case 'find_or_create_customer': {
        const customer = await CustomerService.findOrCreate({
          businessId,
          phone: toolInput.phone as string,
          name: toolInput.name as string,
          email: toolInput.email as string | undefined,
        });
        return JSON.stringify(customer);
      }

      case 'create_booking': {
        let bookingServiceId = toolInput.service_id as string;
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!UUID_RE.test(bookingServiceId)) {
          const services = await SlotService.getServices(businessId, bookingServiceId);
          if (!services[0]) {
            return JSON.stringify({ error: `No service found matching "${bookingServiceId}". Call get_services first.` });
          }
          bookingServiceId = services[0].id;
        }

        const booking = await BookingService.create({
          businessId,
          serviceId: bookingServiceId,
          staffId: toolInput.staff_id as string,
          slotDatetime: toolInput.slot_datetime as string,
          customerId: toolInput.customer_id as string,
          notes: toolInput.notes as string | undefined,
          channel: 'agent',
        });
        return JSON.stringify({ ref: booking.ref, startsAt: booking.startsAt });
      }

      case 'get_customer_bookings': {
        const bookings = await BookingService.getByPhone(businessId, toolInput.phone as string);
        return JSON.stringify(bookings);
      }

      case 'cancel_booking': {
        const result = await BookingService.cancel(
          businessId,
          toolInput.booking_ref as string,
          toolInput.reason as string
        );
        return JSON.stringify(result);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return JSON.stringify({ error: message });
  }
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

export async function runAgentLoop(
  messages: AgentTurnMessage[],
  systemPrompt: string,
  businessId: string
): Promise<{ reply: string; messages: AgentTurnMessage[] }> {
  const provider = getAgentLlmProvider();
  const MAX_ITERATIONS = 10;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await provider.complete({
      systemPrompt,
      messages,
      tools: AGENT_TOOLS,
    });

    messages.push({ role: 'assistant', parts: response.parts });

    if (response.stopReason === 'end_turn') {
      const reply = extractReplyText(response.parts);
      return { reply, messages };
    }

    const toolCalls = response.parts.filter(
      (p): p is Extract<typeof p, { kind: 'tool_call' }> => p.kind === 'tool_call'
    );

    const toolResults = await Promise.all(
      toolCalls.map(async (call) => ({
        kind: 'tool_result' as const,
        id: call.id,
        name: call.name,
        result: await dispatchTool(call.name, call.args, { businessId }),
      }))
    );

    messages.push({ role: 'user', parts: toolResults });
  }

  return {
    reply: 'Sorry, I had trouble completing that request. Please try again.',
    messages,
  };
}

/** Build canonical history from simple text messages. */
export function messagesToHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): AgentTurnMessage[] {
  return messages.map((m) => messageFromText(m.role, m.content));
}

export { normalizeHistory, toDisplayMessages };

// ─── Convenience: text-only channels (WhatsApp / SMS) ───────────────────────

export async function runAgentTurn(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  business: Business
): Promise<{ reply: string; history: Array<{ role: 'user' | 'assistant'; content: string }> }> {
  const systemPrompt = buildSystemPrompt(business);

  const canonicalHistory: AgentTurnMessage[] = [
    ...history.map((m) => messageFromText(m.role, m.content)),
    messageFromText('user', userMessage),
  ];

  const { reply, messages } = await runAgentLoop(canonicalHistory, systemPrompt, business.id);

  return { reply, history: toDisplayMessages(messages) };
}
