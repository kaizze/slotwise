import Anthropic from '@anthropic-ai/sdk';
import { BookingService } from '../services/booking.service.js';
import { SlotService } from '../services/slot.service.js';
import { CustomerService } from '../services/customer.service.js';
import { StaffService } from '../services/staff.service.js';
import type { Business } from '@slotwise/types';

const client = new Anthropic();

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_services',
    description: 'List available services for this business. Call this first to match what the customer wants.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Optional filter e.g. "haircut", "manicure"' },
      },
    },
  },
  {
    name: 'get_staff',
    description: 'List active staff members for this business. Call this when the customer expresses a preference for a specific staff member by name, to resolve their name to an ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Optional name filter e.g. "Maria"' },
      },
    },
  },
  {
    name: 'get_available_slots',
    description: 'Get scored available appointment slots. Always call this before presenting options — never invent slots.',
    input_schema: {
      type: 'object' as const,
      required: ['service_id'],
      properties: {
        service_id:  { type: 'string' },
        date:        { type: 'string', description: 'YYYY-MM-DD or natural e.g. "Wednesday", "tomorrow"' },
        staff_id:    { type: 'string', description: 'Optional: pass the staff member\'s ID if the customer requested a specific person' },
      },
    },
  },
  {
    name: 'find_or_create_customer',
    description: 'Look up customer by phone. Creates a new record if not found.',
    input_schema: {
      type: 'object' as const,
      required: ['phone', 'name'],
      properties: {
        phone: { type: 'string' },
        name:  { type: 'string' },
        email: { type: 'string' },
      },
    },
  },
  {
    name: 'create_booking',
    description: 'Create the appointment. Only call after confirming all details with the customer.',
    input_schema: {
      type: 'object' as const,
      required: ['service_id', 'staff_id', 'slot_datetime', 'customer_id'],
      properties: {
        service_id:    { type: 'string' },
        staff_id:      { type: 'string' },
        slot_datetime: { type: 'string', description: 'ISO 8601 datetime' },
        customer_id:   { type: 'string' },
        notes:         { type: 'string' },
      },
    },
  },
  {
    name: 'get_customer_bookings',
    description: 'Look up existing and upcoming bookings for a customer.',
    input_schema: {
      type: 'object' as const,
      required: ['phone'],
      properties: {
        phone: { type: 'string' },
      },
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel an existing booking by its reference.',
    input_schema: {
      type: 'object' as const,
      required: ['booking_ref'],
      properties: {
        booking_ref: { type: 'string' },
        reason:      { type: 'string' },
      },
    },
  },
];

// ─── System prompt builder ────────────────────────────────────────────────────

export function buildSystemPrompt(business: Pick<Business, 'name' | 'type' | 'locale' | 'settings'>): string {
  const isGreek = business.locale === 'el';

  return `You are the booking assistant for ${business.name}, a ${business.type}.

LANGUAGE:
${isGreek
  ? `The business is Greek. Respond in Greek by default unless the customer writes in another language.
Greek tone: casual and warm, use "εσύ" (not "εσείς"), keep it short and natural like a text message.
Good Greek example: "Γεια! Πότε θες να έρθεις και για ποια υπηρεσία;"
Bad Greek example: "Καλημέρα σας! Πώς θα μπορούσα να σας εξυπηρετήσω σήμερα;"`
  : `Respond in the customer's language.`}

YOUR JOB (follow this order strictly):
1. Understand what they want: service, date/time, staff preference (all optional at first — ask only what you need)
2. Call get_services to get service IDs — ALWAYS do this, even if the service name seems obvious
3. If the customer names a specific staff member, call get_staff with their name to get the staff ID
4. Call get_available_slots with the service_id (and staff_id if known) — show max 3 slots
5. Collect name + phone (needed to create the booking)
6. Confirm all details with the customer in one clear summary
7. Call create_booking only after the customer explicitly confirms
8. Give them the booking reference

CRITICAL RULES:
- NEVER say a service or staff member doesn't exist without calling get_services or get_staff first to check
- NEVER invent slots — always call get_available_slots
- If the customer asks about multiple bookings (e.g. haircut with Maria + blow dry with Eleni), handle ONE at a time — complete the first booking, then offer to book the second
- Staff names in Greek may be informal (e.g. "Μαρία" = "Maria Stavrakaki") — use get_staff to match
- Keep each message short — 2-4 lines maximum unless showing slot options
- Do not mention IDs to the customer
- If you're unsure about a date ("αύριο", "την Παρασκευή"), confirm it before searching slots`;
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
        const filtered = toolInput.query
          ? staff.filter((s) => s.name.toLowerCase().includes((toolInput.query as string).toLowerCase()))
          : staff;
        return JSON.stringify(filtered.map((s) => ({ id: s.id, name: s.name })));
      }

      case 'get_available_slots': {
        const slots = await SlotService.getAvailableSlots({
          businessId,
          serviceId: toolInput.service_id as string,
          date: toolInput.date as string,
          staffId: toolInput.staff_id as string | undefined,
        });
        // Return top 3 scored slots only
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
        const booking = await BookingService.create({
          businessId,
          serviceId: toolInput.service_id as string,
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
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
  businessId: string
): Promise<{ reply: string; messages: Anthropic.MessageParam[] }> {
  const MAX_ITERATIONS = 10; // safety ceiling — prevents runaway tool-call loops

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',  // fast + cheap for most turns
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools: AGENT_TOOLS,
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      const reply = textBlock?.type === 'text' ? textBlock.text : '';
      // The tool_use branch below already appends each intermediate assistant
      // turn to `messages` — this final, plain-text turn must be appended
      // here too, or every conversation's returned history is missing its
      // own last reply. A client that round-trips `messages` back on the next
      // request (the documented usage pattern) would silently lose the
      // assistant's most recent message every single turn.
      messages.push({ role: 'assistant', content: response.content });
      return { reply, messages };
    }

    if (response.stop_reason === 'tool_use') {
      // Append Claude's response to history
      messages.push({ role: 'assistant', content: response.content });

      // Process all tool calls in this response
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const result = await dispatchTool(
          block.name,
          block.input as Record<string, unknown>,
          { businessId }
        );

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      // Append tool results and loop
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason (e.g. max_tokens cutoff)
    break;
  }

  return {
    reply: 'I encountered an issue processing your request. Please try again.',
    messages,
  };
}

// ─── Convenience: run a single text-in, text-out turn ────────────────────────
// Used by webhook channels (WhatsApp/SMS) that don't carry rich message arrays.

export async function runAgentTurn(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  business: Business
): Promise<{ reply: string; history: Array<{ role: 'user' | 'assistant'; content: string }> }> {
  const systemPrompt = buildSystemPrompt(business);

  const anthropicMessages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userMessage },
  ];

  const { reply, messages } = await runAgentLoop(anthropicMessages, systemPrompt, business.id);

  const updatedHistory = messages
    .filter((m) => typeof m.content === 'string')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));

  return { reply, history: updatedHistory };
}
