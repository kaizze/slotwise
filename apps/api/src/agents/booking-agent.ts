import { BookingService } from '../services/booking.service.js';
import { SlotService, resolveBookingDate, resolveTimeOfDay, resolvePreferredTime } from '../services/slot.service.js';
import { CustomerService } from '../services/customer.service.js';
import { StaffService } from '../services/staff.service.js';
import { BusinessService } from '../services/business.service.js';
import { SlotOfferService } from '../services/slot-offer.service.js';
import { WaitlistService } from '../services/waitlist.service.js';
import type { Business } from '@slotwise/types';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import type { AgentTurnMessage, ToolDefinition } from './llm-types.js';
import {
  extractReplyText,
  messageFromText,
  normalizeHistory,
  toDisplayMessages,
} from './llm-types.js';
import { getAgentLlmProvider } from './llm-provider.js';

dayjs.extend(utc);
dayjs.extend(timezone);

function formatBookingForAgent(
  booking: {
    ref: string;
    startsAt: Date;
    serviceName?: string;
    staffName?: string;
  },
  tz: string,
) {
  const start = dayjs(booking.startsAt).tz(tz);
  return {
    ref: booking.ref,
    service_name: booking.serviceName,
    staff_name: booking.staffName,
    local_time: start.format('HH:mm'),
    local_datetime: start.format('dddd D MMMM, HH:mm'),
    starts_at: booking.startsAt,
  };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'get_services',
    description: 'List available services. Call immediately when the customer mentions any service. If a Greek query returns nothing, call again without query to list all services.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional filter e.g. "haircut", "κούρεμα". Omit to list all services.' },
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
    description: 'Get available appointment slots for a date. Returns real START times (local_time) from the calendar — never invent slots. When the customer asks for a specific clock time (e.g. 9:30), always pass preferred_time so the full day is searched.',
    parameters: {
      type: 'object',
      required: ['service_id'],
      properties: {
        service_id: { type: 'string' },
        date: {
          type: 'string',
          description: 'Use natural language: "tomorrow", "αύριο", "today", day names — OR YYYY-MM-DD from CURRENT DATE CONTEXT.',
        },
        staff_id: { type: 'string', description: 'Optional staff ID if customer requested a specific person' },
        time_preference: {
          type: 'string',
          enum: ['morning', 'afternoon', 'evening'],
          description: 'Filter to part of day when customer asks — morning (9-13), afternoon (13-17), evening (17+). Greek: πρωί / απόγευμα / βράδυ.',
        },
        preferred_time: {
          type: 'string',
          description:
            'Clock time the customer wants (exact or approximate), e.g. "11:00", "11.00", "11", "κοντά στις 11". Searches ALL slots that day (not just the top 5) and returns exact_matches or nearby_alternatives.',
        },
        group_by_staff: {
          type: 'boolean',
          description: 'True when customer asks who is available — one best slot per staff member',
        },
      },
    },
  },
  {
    name: 'find_or_create_customer',
    description: 'Look up customer by phone. Creates a new record if not found. Always pass email when the customer provided one (even optional) so confirmation emails can be sent.',
    parameters: {
      type: 'object',
      required: ['phone', 'name'],
      properties: {
        phone: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string', description: 'Optional email for booking confirmations' },
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
    description: 'Look up existing and upcoming bookings for a customer by phone. Times are in local_time / local_datetime (business timezone) — always use those when talking to the customer, not starts_at.',
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
  {
    name: 'get_pending_offers',
    description: 'List active slot offers (rebook or waitlist) for a customer by phone. Use when they ask about moving an appointment or a slot offer.',
    parameters: {
      type: 'object',
      required: ['phone'],
      properties: {
        phone: { type: 'string' },
      },
    },
  },
  {
    name: 'accept_slot_offer',
    description: 'Accept a pending slot offer and book/reschedule the appointment. Call when customer says YES/ΝΑΙ to a rebook or waitlist offer.',
    parameters: {
      type: 'object',
      required: ['phone'],
      properties: {
        phone: { type: 'string' },
        offer_token: { type: 'string', description: 'Optional offer code from the notification' },
      },
    },
  },
  {
    name: 'join_waitlist',
    description: 'Add customer to waitlist when no suitable slots are available. They will be notified if a slot opens.',
    parameters: {
      type: 'object',
      required: ['phone', 'name', 'service_id'],
      properties: {
        phone: { type: 'string' },
        name: { type: 'string' },
        service_id: { type: 'string' },
        staff_id: { type: 'string' },
        email: { type: 'string', description: 'Optional email for waitlist notifications' },
        preferred_date: { type: 'string', description: 'YYYY-MM-DD or natural language like tomorrow' },
      },
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────

export type AgentClientLanguage = 'el' | 'en';

/** Detect Greek vs English from customer text. Returns null when ambiguous. */
export function detectClientLanguage(text: string): AgentClientLanguage | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/[\u0370-\u03FF\u1F00-\u1FFF]/.test(trimmed)) return 'el';
  if (/[A-Za-z]/.test(trimmed)) return 'en';
  return null;
}

export function resolveClientLanguage(input: {
  explicit?: string | null;
  latestUserText?: string | null;
  businessLocale?: string | null;
}): AgentClientLanguage {
  const explicit = input.explicit?.trim().toLowerCase();
  if (explicit === 'el' || explicit === 'en') return explicit;

  const detected = input.latestUserText
    ? detectClientLanguage(input.latestUserText)
    : null;
  if (detected) return detected;

  return input.businessLocale === 'el' ? 'el' : 'en';
}

function languageLabel(lang: AgentClientLanguage): string {
  return lang === 'el' ? 'Greek' : 'English';
}

export function buildSystemPrompt(
  business: Pick<Business, 'name' | 'type' | 'locale' | 'settings' | 'timezone'>,
  authenticatedCustomer?: { id: string; name: string; phone: string; email?: string },
  clientLanguage: AgentClientLanguage = business.locale === 'el' ? 'el' : 'en',
): string {
  const sessionLanguage = languageLabel(clientLanguage);
  const now = dayjs().tz(business.timezone);
  const today = now.format('YYYY-MM-DD (dddd)');
  const tomorrow = now.add(1, 'day').format('YYYY-MM-DD (dddd)');
  const firstName = authenticatedCustomer?.name.trim().split(/\s+/)[0] ?? '';
  const personalizationExamples = clientLanguage === 'el'
    ? `"Γεια σου ${firstName}, πώς μπορώ να σε βοηθήσω σήμερα;" / "Το ραντεβού σου επιβεβαιώθηκε, ${firstName}, για Τετάρτη στις 11:00."`
    : `"Hello ${firstName}, how can I help you today?" / "Your booking is confirmed, ${firstName}, for Wednesday at 11:00."`;
  const authenticatedCustomerBlock = authenticatedCustomer
    ? `

SIGNED-IN MEMBER (verified account for this business):
- Customer ID: ${authenticatedCustomer.id}
- Full name: ${authenticatedCustomer.name}
- First name to use in conversation: ${firstName}
- Phone: ${authenticatedCustomer.phone}
- Email: ${authenticatedCustomer.email ?? 'not provided'}

PERSONALIZATION (required when signed in):
- Address them by first name naturally: greetings, confirmations, and follow-ups.
  Examples: ${personalizationExamples}
- Do NOT ask for their name or phone — you already have them.
- Do NOT ask them to re-enter account details unless they explicitly want to book for someone else.
- When booking / waitlist / looking up bookings / accepting offers, use their saved phone/name/email.
- Call find_or_create_customer with their saved name, phone, and email before create_booking.
- Keep personalization light and natural — don't force the name into every short reply.`
    : '';

  const contactStep = authenticatedCustomer
    ? `4. The customer is already signed in as ${firstName}. Skip collecting name/phone. Use their saved details for find_or_create_customer (name/phone/email above).
5. Confirm the appointment details with their first name, then call create_booking only after explicit confirmation.`
    : `4. Collect name and phone before booking. Also ask for email (optional) for the confirmation: e.g. "Email for the confirmation? (optional)".
5. Pass name, phone, and email (if given) to find_or_create_customer.
6. Confirm all details, then call create_booking only after explicit confirmation.`;

  return `You are the booking assistant for ${business.name} (${business.type}).

CURRENT DATE (${business.timezone}):
- Today: ${today}
- Tomorrow: ${tomorrow}
- NEVER invent or guess calendar dates. For get_available_slots use "tomorrow"/"αύριο" or a YYYY-MM-DD from above.

VOICE & LANGUAGE:
- SESSION LANGUAGE: ${sessionLanguage}. Start and continue this conversation in ${sessionLanguage}.
- This language is set at the beginning from the client's widget/channel (or detected from their first message).
- Always reply in ${sessionLanguage} unless the customer clearly switches language — then follow their new language for the rest of the chat.
- Do not mix languages in one reply. Do not answer in English if SESSION LANGUAGE is Greek (and vice versa), even for short greetings like "hello"/"ok".
- Tone: warm, clear, and professional — like a helpful front-desk person.
- Keep messages short: 1-3 sentences unless listing time options.
- Never mention internal IDs, UUIDs, or tool names.

BOOKING FLOW (follow in order):
1. When the customer mentions ANY service (even vaguely like "κουρεματάκι"), call get_services in the SAME turn — do not ask for date/time first.
2. If they name a staff member, call get_staff to resolve the name.
3. Call get_available_slots with natural-language dates ("αύριο", "tomorrow").
   - If the customer wants a specific part of the day, pass time_preference: morning / afternoon / evening.
   - If they ask for a clock time — exact OR approximate ("9:30", "στις 11", "κοντά στις 11.00", "around 11") — ALWAYS call get_available_slots again with preferred_time. Never judge availability from a previous short list.
   - Preferred-time tool results use status:
       • available_exact — that clock time IS free. Confirm it and list options (local_time + staff). Never say unavailable / "δυστυχώς" / "όχι ακριβώς".
       • nearby_only — that clock time is taken. Offer options, each with its own local_time (do not claim they are at the requested time).
       • none — truly nothing nearby; suggest another day or waitlist.
   - Always show local_time next to each option. Never list staff names alone.
   - For general browsing, present the times returned (up to 5 options). Treat local_time as the START time.
${contactStep}

RULES:
- Never say a service doesn't exist without calling get_services first. If unsure, call get_services with no query to list all.
- Never invent availability — always use get_available_slots.
- If get_services returns multiple options, present them and ask which one the customer wants.
- If slots are empty for one date, try the next business day before saying nothing is available.
- If a tool returns an error, explain simply and retry with corrected inputs.
- When presenting booking times to the customer, always use local_time or local_datetime from tool results — never convert starts_at yourself (it is UTC).
- Email is optional — if the customer declines or skips, continue without it.
- If the customer says YES/ΝΑΙ after a slot offer notification, call accept_slot_offer with their phone.
- If no slots are available and they want to be notified, offer join_waitlist.${authenticatedCustomerBlock}`;
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

export async function dispatchTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: {
    businessId: string;
    authenticatedCustomer?: { id: string; name: string; phone: string; email?: string };
  }
): Promise<string> {
  const { businessId, authenticatedCustomer } = context;

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

        const business = await BusinessService.getById(businessId);
        const tz = business?.timezone ?? 'UTC';
        const dateInput = (toolInput.date as string | undefined) ?? 'today';
        const resolvedDate = resolveBookingDate(dateInput, tz);
        const timeOfDay = resolveTimeOfDay(toolInput.time_preference as string | undefined);
        const preferredRaw = toolInput.preferred_time as string | undefined;
        const preferredTime = resolvePreferredTime(preferredRaw);

        // Clock-time requests (exact or approximate) search the full day; general browsing stays capped.
        const slots = await SlotService.getAvailableSlots({
          businessId,
          serviceId,
          date: dateInput,
          staffId,
          groupByStaff: toolInput.group_by_staff as boolean | undefined,
          timeOfDay: preferredTime ? undefined : timeOfDay,
          presentation: 'customer',
          limit: preferredTime || preferredRaw ? undefined : 5,
        });

        const mapped = slots.map((s) => ({
          starts_at: s.startsAt,
          local_time: dayjs(s.startsAt).tz(tz).format('HH:mm'),
          ends_at: s.endsAt,
          staff_id: s.staffId,
          staff_name: s.staffName,
        }));

        if (preferredRaw && !preferredTime) {
          return JSON.stringify({
            date_requested: dateInput,
            date_searched: resolvedDate,
            error: `Could not parse preferred_time "${preferredRaw}". Retry with HH:mm (e.g. "11:00").`,
            slots: mapped.slice(0, 5),
          });
        }

        if (preferredTime) {
          const exactMatches = mapped.filter((s) => s.local_time === preferredTime);
          const nearby = mapped
            .filter((s) => s.local_time !== preferredTime)
            .sort((a, b) => {
              const aDiff = Math.abs(
                dayjs(`2000-01-01T${a.local_time}`).diff(dayjs(`2000-01-01T${preferredTime}`), 'minute'),
              );
              const bDiff = Math.abs(
                dayjs(`2000-01-01T${b.local_time}`).diff(dayjs(`2000-01-01T${preferredTime}`), 'minute'),
              );
              return aDiff - bDiff;
            })
            .slice(0, 5);

          // Single status + options so the model can't mix "unavailable" with exact slots.
          if (exactMatches.length > 0) {
            return JSON.stringify({
              date_requested: dateInput,
              date_searched: resolvedDate,
              status: 'available_exact',
              preferred_time: preferredTime,
              options: exactMatches,
              how_to_reply:
                `${preferredTime} IS available. Confirm that time is free and list options as "local_time with staff_name". ` +
                `Do NOT say it is unavailable, "unfortunately", or "not exactly" — that would be wrong.`,
            });
          }

          if (nearby.length > 0) {
            return JSON.stringify({
              date_requested: dateInput,
              date_searched: resolvedDate,
              status: 'nearby_only',
              preferred_time: preferredTime,
              options: nearby,
              how_to_reply:
                `${preferredTime} is not free. Offer the closest alternatives. ` +
                `Every option MUST include its own local_time (they are NOT at ${preferredTime}). ` +
                `Do not invent ${preferredTime} availability.`,
            });
          }

          return JSON.stringify({
            date_requested: dateInput,
            date_searched: resolvedDate,
            status: 'none',
            preferred_time: preferredTime,
            options: [],
            how_to_reply: `No slots that day near ${preferredTime}. Suggest another day or join_waitlist.`,
          });
        }

        return JSON.stringify({
          date_requested: dateInput,
          date_searched: resolvedDate,
          time_filter: timeOfDay ?? 'all day',
          total_matching: mapped.length,
          slots: mapped,
        });
      }

      case 'find_or_create_customer': {
        // Signed-in members keep their verified phone; never let the model rebind identity.
        const phone = authenticatedCustomer?.phone ?? (toolInput.phone as string);
        const name = authenticatedCustomer?.name ?? (toolInput.name as string);
        const email = authenticatedCustomer?.email
          ?? (toolInput.email as string | undefined);

        const customer = await CustomerService.findOrCreate({
          businessId,
          phone,
          name,
          email,
        });
        return JSON.stringify({
          ...customer,
          // Hint for the model when a member is already authenticated.
          ...(authenticatedCustomer
            ? { signed_in: true, how_to_reply: `Use first name "${authenticatedCustomer.name.trim().split(/\s+/)[0]}" in confirmations.` }
            : {}),
        });
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

        const customerId = authenticatedCustomer?.id ?? (toolInput.customer_id as string);

        const booking = await BookingService.create({
          businessId,
          serviceId: bookingServiceId,
          staffId: toolInput.staff_id as string,
          slotDatetime: toolInput.slot_datetime as string,
          customerId,
          notes: toolInput.notes as string | undefined,
          channel: 'agent',
        });

        const business = await BusinessService.getById(businessId);
        const tz = business?.timezone ?? 'UTC';
        const formatted = formatBookingForAgent(booking, tz);
        const firstName = authenticatedCustomer?.name.trim().split(/\s+/)[0];
        return JSON.stringify({
          ...formatted,
          ...(firstName
            ? { how_to_reply: `Confirm using their first name, e.g. "Your booking is confirmed, ${firstName}, for ${formatted.local_datetime}."` }
            : {}),
        });
      }

      case 'get_customer_bookings': {
        const business = await BusinessService.getById(businessId);
        const tz = business?.timezone ?? 'UTC';
        const phone = authenticatedCustomer?.phone ?? (toolInput.phone as string);
        const bookings = await BookingService.getByPhone(businessId, phone);
        return JSON.stringify({
          timezone: tz,
          bookings: bookings.map((b) => formatBookingForAgent(b, tz)),
        });
      }

      case 'cancel_booking': {
        const result = await BookingService.cancel(
          businessId,
          toolInput.booking_ref as string,
          toolInput.reason as string
        );
        return JSON.stringify(result);
      }

      case 'get_pending_offers': {
        const business = await BusinessService.getById(businessId);
        const tz = business?.timezone ?? 'UTC';
        const offers = await SlotOfferService.getPendingForPhone(
          businessId,
          authenticatedCustomer?.phone ?? (toolInput.phone as string),
        );
        return JSON.stringify({
          timezone: tz,
          offers: offers.map((o) => ({
            offer_id: o.id,
            offer_token: o.offer_token,
            offer_type: o.offer_type,
            local_time: dayjs(o.slot_starts_at).tz(tz).format('HH:mm'),
            local_datetime: dayjs(o.slot_starts_at).tz(tz).format('dddd D MMMM, HH:mm'),
            service_name: o.service_name,
            staff_name: o.staff_name,
            booking_ref: o.booking_ref,
            incentive: o.incentive,
          })),
        });
      }

      case 'accept_slot_offer': {
        const phone = authenticatedCustomer?.phone ?? (toolInput.phone as string);
        const normalizedPhone = phone.replace(/\s+/g, '');
        const customer = authenticatedCustomer
          ? await CustomerService.getById(authenticatedCustomer.id)
          : await CustomerService.getByPhone(businessId, normalizedPhone);
        if (!customer) {
          return JSON.stringify({ error: 'Customer not found' });
        }

        const pending = await SlotOfferService.getPendingForPhone(businessId, normalizedPhone);
        const token = toolInput.offer_token as string | undefined;
        const offer = token
          ? pending.find((o) => o.offer_token === token.toUpperCase()) ?? pending[0]
          : pending[0];

        if (!offer) {
          return JSON.stringify({ error: 'No active offer found for this customer' });
        }

        const result = await SlotOfferService.acceptOffer(
          offer.id,
          businessId,
          customer.id,
          token,
        );
        return JSON.stringify({
          success: true,
          ref: result.booking.ref,
          message: result.message,
        });
      }

      case 'join_waitlist': {
        let serviceId = toolInput.service_id as string;
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!UUID_RE.test(serviceId)) {
          const services = await SlotService.getServices(businessId, serviceId);
          if (!services[0]) {
            return JSON.stringify({ error: `No service found matching "${serviceId}". Call get_services first.` });
          }
          serviceId = services[0].id;
        }

        const business = await BusinessService.getById(businessId);
        const tz = business?.timezone ?? 'UTC';

        let preferredWindowStart: Date | undefined;
        let preferredWindowEnd: Date | undefined;
        const preferredDate = toolInput.preferred_date as string | undefined;
        if (preferredDate) {
          const resolved = resolveBookingDate(preferredDate, tz);
          const dayStart = dayjs.tz(resolved, tz).startOf('day');
          preferredWindowStart = dayStart.toDate();
          preferredWindowEnd = dayStart.endOf('day').toDate();
        }

        const entry = await WaitlistService.join({
          businessId,
          serviceId,
          customerName: authenticatedCustomer?.name ?? (toolInput.name as string),
          customerPhone: authenticatedCustomer?.phone ?? (toolInput.phone as string),
          customerEmail: authenticatedCustomer?.email ?? (toolInput.email as string | undefined),
          staffId: toolInput.staff_id as string | undefined,
          preferredWindowStart,
          preferredWindowEnd,
        });

        return JSON.stringify({ success: true, waitlist_id: entry.id });
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
  businessId: string,
  authenticatedCustomer?: { id: string; name: string; phone: string; email?: string },
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
        result: await dispatchTool(call.name, call.args, { businessId, authenticatedCustomer }),
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
  const clientLanguage = resolveClientLanguage({
    latestUserText: userMessage,
    businessLocale: business.locale,
  });
  const systemPrompt = buildSystemPrompt(business, undefined, clientLanguage);

  const canonicalHistory: AgentTurnMessage[] = [
    ...history.map((m) => messageFromText(m.role, m.content)),
    messageFromText('user', userMessage),
  ];

  const { reply, messages } = await runAgentLoop(canonicalHistory, systemPrompt, business.id);

  return { reply, history: toDisplayMessages(messages) };
}
