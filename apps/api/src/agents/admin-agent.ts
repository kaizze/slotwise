import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { BookingService } from '../services/booking.service.js';
import { BusinessService } from '../services/business.service.js';
import { CustomerCrmService } from '../services/customer-crm.service.js';
import { ServiceService } from '../services/service.service.js';
import { SlotService, resolveBookingDate } from '../services/slot.service.js';
import { StaffService } from '../services/staff.service.js';
import type { Booking, Business } from '@slotwise/types';
import type { AgentTurnMessage, ToolDefinition } from './llm-types.js';
import { extractReplyText } from './llm-types.js';
import { getAgentLlmProvider } from './llm-provider.js';

dayjs.extend(utc);
dayjs.extend(timezone);

type AdminBooking = Booking & {
  serviceName?: string;
  staffName?: string;
  customerName?: string;
};

// ─── Tools ────────────────────────────────────────────────────────────────────

export const ADMIN_TOOLS: ToolDefinition[] = [
  {
    name: 'get_staff',
    description: 'List active staff members (id + name). Call when the owner names someone like "Maria".',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional name filter' },
      },
    },
  },
  {
    name: 'get_services',
    description: 'List active services (id, name, duration, price).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional service name filter' },
      },
    },
  },
  {
    name: 'count_available_slots',
    description:
      'Count free appointment slots for a date (e.g. tomorrow). Sums open slots across services unless service_id is given.',
    parameters: {
      type: 'object',
      required: ['date'],
      properties: {
        date: {
          type: 'string',
          description: 'Natural language or YYYY-MM-DD: "tomorrow", "αύριο", "Friday", etc.',
        },
        service_id: { type: 'string', description: 'Optional service UUID to count for one service only' },
        staff_id: { type: 'string', description: 'Optional staff UUID filter' },
      },
    },
  },
  {
    name: 'get_inactive_customers',
    description: 'List customers who have not visited in N days (default 90). Use for "who hasn\'t visited in 3 months".',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Inactivity threshold in days (default 90)' },
        limit: { type: 'number', description: 'Max rows to return (default 25)' },
      },
    },
  },
  {
    name: 'get_analytics',
    description:
      'Booking analytics for a date range: totals plus breakdowns by service/hour/day. Use for busiest service, revenue, no-shows.',
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Lookback window ending today (default 30). Ignored if from/to provided.',
        },
        from: { type: 'string', description: 'Optional ISO date YYYY-MM-DD' },
        to: { type: 'string', description: 'Optional ISO date YYYY-MM-DD (exclusive end ok)' },
      },
    },
  },
  {
    name: 'list_bookings',
    description: 'List bookings for a date or range (refs, times, service, staff, customer).',
    parameters: {
      type: 'object',
      required: ['date'],
      properties: {
        date: {
          type: 'string',
          description: 'Day to list, natural language or YYYY-MM-DD. For a single day.',
        },
        staff_id: { type: 'string', description: 'Optional staff filter' },
      },
    },
  },
  {
    name: 'preview_reassign_bookings',
    description:
      'DRY RUN: preview moving bookings on a given day onto a target staff member. Never mutates. Always call this before confirm_reassign_bookings.',
    parameters: {
      type: 'object',
      required: ['date', 'staff_name'],
      properties: {
        date: {
          type: 'string',
          description: 'Day whose bookings should move, e.g. "Friday", "this Friday", YYYY-MM-DD',
        },
        staff_name: { type: 'string', description: 'Target staff name, e.g. "Maria"' },
        from_staff_name: {
          type: 'string',
          description: 'Optional: only move bookings currently assigned to this staff member',
        },
      },
    },
  },
  {
    name: 'confirm_reassign_bookings',
    description:
      'MUTATION: reassign specific booking refs to a staff member. Only call after preview_reassign_bookings AND the owner explicitly confirmed (e.g. "yes, do it").',
    parameters: {
      type: 'object',
      required: ['staff_id', 'booking_refs'],
      properties: {
        staff_id: { type: 'string', description: 'Target staff UUID from preview' },
        booking_refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Booking refs that were marked movable in the preview',
        },
      },
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────

export function buildAdminSystemPrompt(
  business: Pick<Business, 'name' | 'type' | 'locale' | 'timezone'>,
): string {
  const now = dayjs().tz(business.timezone);
  const today = now.format('YYYY-MM-DD (dddd)');
  const tomorrow = now.add(1, 'day').format('YYYY-MM-DD (dddd)');
  const language = business.locale === 'el' ? 'Greek' : 'English';

  return `You are the SlotWise admin AI assistant for ${business.name} (${business.type}).

CURRENT DATE (${business.timezone}):
- Today: ${today}
- Tomorrow: ${tomorrow}

ROLE:
- Help the business owner/staff with operational questions and safe schedule changes.
- Always use tools for counts and lists — never invent numbers.
- Keep answers concise and practical (bullet points when listing).
- Reply in ${language} unless the owner writes in another language — then follow them.

CAPABILITIES:
- Free slot counts for a day
- Inactive / lapsed customers
- Analytics (busiest service, revenue, no-shows)
- Booking lists for a day
- Preview + confirmed staff reassignment

WRITE SAFETY:
- preview_reassign_bookings is read-only. Always preview first for any "move bookings to X" request.
- confirm_reassign_bookings mutates data. ONLY call it after the owner clearly confirms (yes / ok / do it / προχώρα).
- If some bookings cannot move, explain why and only confirm the movable ones the owner accepts.
- Never cancel bookings or mark no-shows from this assistant.

EXAMPLES:
- "How many free slots tomorrow?" → count_available_slots date=tomorrow
- "Who hasn't visited in 3 months?" → get_inactive_customers days=90
- "Show my busiest service." → get_analytics days=30, then highlight top byService
- "Move all Friday bookings to Maria." → get_staff + preview_reassign_bookings, summarize, wait for confirmation, then confirm_reassign_bookings`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function transliterateGreek(str: string): string {
  const map: Record<string, string> = {
    α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th',
    ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p',
    ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
    ά: 'a', έ: 'e', ή: 'i', ί: 'i', ό: 'o', ύ: 'y', ώ: 'o', ϊ: 'i', ϋ: 'y',
  };
  return str.toLowerCase().split('').map((c) => map[c] ?? c).join('');
}

async function resolveStaffByName(businessId: string, name: string) {
  const staff = await StaffService.list(businessId);
  const q = transliterateGreek(name);
  return staff.find((s) => transliterateGreek(s.name).includes(q)) ?? null;
}

function nextWeekdayDate(input: string, tz: string): string {
  // Map weekday words onto the upcoming matching day (including today).
  const lower = input.trim().toLowerCase();
  const weekdays: Record<string, number> = {
    sunday: 0, sun: 0, κυριακή: 0, κυριακη: 0,
    monday: 1, mon: 1, δευτέρα: 1, δευτερα: 1,
    tuesday: 2, tue: 2, τρίτη: 2, τριτη: 2,
    wednesday: 3, wed: 3, τετάρτη: 3, τεταρτη: 3,
    thursday: 4, thu: 4, πέμπτη: 4, πεμπτη: 4,
    friday: 5, fri: 5, παρασκευή: 5, παρασκευη: 5,
    saturday: 6, sat: 6, σάββατο: 6, σαββατο: 6,
  };

  const match = Object.entries(weekdays).find(([key]) => lower.includes(key));
  if (!match) return resolveBookingDate(input, tz);

  const targetDow = match[1];
  let cursor = dayjs().tz(tz).startOf('day');
  for (let i = 0; i < 7; i++) {
    if (cursor.day() === targetDow) return cursor.format('YYYY-MM-DD');
    cursor = cursor.add(1, 'day');
  }
  return resolveBookingDate(input, tz);
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

export async function dispatchAdminTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: { businessId: string },
): Promise<string> {
  const { businessId } = context;

  try {
    switch (toolName) {
      case 'get_staff': {
        const staff = await StaffService.list(businessId);
        const filtered = toolInput.query
          ? staff.filter((s) =>
              transliterateGreek(s.name).includes(transliterateGreek(String(toolInput.query))),
            )
          : staff;
        return JSON.stringify(filtered.map((s) => ({
          id: s.id,
          name: s.name,
          services: s.services,
        })));
      }

      case 'get_services': {
        const services = await ServiceService.list(businessId);
        const filtered = toolInput.query
          ? services.filter((s) =>
              transliterateGreek(s.name).includes(transliterateGreek(String(toolInput.query))),
            )
          : services;
        return JSON.stringify(filtered.map((s) => ({
          id: s.id,
          name: s.name,
          duration_minutes: s.durationMinutes,
          price: s.price,
          currency: s.currency,
        })));
      }

      case 'count_available_slots': {
        const business = await BusinessService.getById(businessId);
        const tz = business?.timezone ?? 'UTC';
        const date = resolveBookingDate(String(toolInput.date ?? 'tomorrow'), tz);
        const staffId = toolInput.staff_id as string | undefined;

        let services = await ServiceService.list(businessId);
        if (toolInput.service_id) {
          services = services.filter((s) => s.id === toolInput.service_id);
        }
        if (services.length === 0) {
          return JSON.stringify({ error: 'No matching services', date });
        }

        const perService: Array<{ service_id: string; service_name: string; free_slots: number }> = [];
        let total = 0;

        for (const service of services) {
          const slots = await SlotService.getAvailableSlots({
            businessId,
            serviceId: service.id,
            date,
            staffId,
            presentation: 'customer',
            limit: undefined,
          });
          perService.push({
            service_id: service.id,
            service_name: service.name,
            free_slots: slots.length,
          });
          total += slots.length;
        }

        return JSON.stringify({
          date_requested: toolInput.date,
          date_searched: date,
          timezone: tz,
          total_free_slots: total,
          by_service: perService,
        });
      }

      case 'get_inactive_customers': {
        const days = Number(toolInput.days ?? 90);
        const limit = Number(toolInput.limit ?? 25);
        const result = await CustomerCrmService.listInactive(businessId, { days, limit });
        return JSON.stringify({
          days: result.days,
          total: result.total,
          customers: result.customers.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            email: c.email,
            last_visit_at: c.lastVisitAt,
            bookings_count: c.bookingsCount,
            total_spent: c.totalSpent,
            currency: c.currency,
          })),
        });
      }

      case 'get_analytics': {
        const business = await BusinessService.getById(businessId);
        const tz = business?.timezone ?? 'UTC';
        const days = Number(toolInput.days ?? 30);
        const from = toolInput.from
          ? dayjs.tz(String(toolInput.from), tz).startOf('day')
          : dayjs().tz(tz).subtract(days, 'day').startOf('day');
        const to = toolInput.to
          ? dayjs.tz(String(toolInput.to), tz).endOf('day')
          : dayjs().tz(tz).endOf('day');

        const report = await AnalyticsService.getReport({
          businessId,
          from: from.toDate(),
          to: to.toDate(),
        });

        const busiestService = [...report.byService].sort((a, b) => b.count - a.count)[0] ?? null;

        return JSON.stringify({
          from: report.from,
          to: report.to,
          timezone: report.timezone,
          currency: report.currency,
          totals: report.totals,
          busiest_service: busiestService,
          by_service: report.byService.slice(0, 10),
          by_day_of_week: report.byDayOfWeek,
        });
      }

      case 'list_bookings': {
        const business = await BusinessService.getById(businessId);
        const tz = business?.timezone ?? 'UTC';
        const date = nextWeekdayDate(String(toolInput.date), tz);
        const dayStart = dayjs.tz(date, tz).startOf('day');
        const dayEnd = dayStart.endOf('day');
        let bookings = await BookingService.getByBusiness(
          businessId,
          dayStart.toDate(),
          dayEnd.toDate(),
        ) as AdminBooking[];
        if (toolInput.staff_id) {
          bookings = bookings.filter((b) => b.staffId === toolInput.staff_id);
        }
        return JSON.stringify({
          date,
          timezone: tz,
          count: bookings.length,
          bookings: bookings.map((b) => ({
            ref: b.ref,
            local_time: dayjs(b.startsAt).tz(tz).format('HH:mm'),
            local_datetime: dayjs(b.startsAt).tz(tz).format('dddd D MMMM, HH:mm'),
            status: b.status,
            service_name: b.serviceName,
            staff_name: b.staffName,
            customer_name: b.customerName,
          })),
        });
      }

      case 'preview_reassign_bookings': {
        const business = await BusinessService.getById(businessId);
        const tz = business?.timezone ?? 'UTC';
        const date = nextWeekdayDate(String(toolInput.date), tz);
        const target = await resolveStaffByName(businessId, String(toolInput.staff_name));
        if (!target) {
          return JSON.stringify({ error: `No staff found matching "${toolInput.staff_name}"` });
        }

        let fromStaffId: string | undefined;
        if (toolInput.from_staff_name) {
          const from = await resolveStaffByName(businessId, String(toolInput.from_staff_name));
          if (!from) {
            return JSON.stringify({ error: `No staff found matching "${toolInput.from_staff_name}"` });
          }
          fromStaffId = from.id;
        }

        const dayStart = dayjs.tz(date, tz).startOf('day');
        const dayEnd = dayStart.endOf('day');
        const bookings = await BookingService.getByBusiness(
          businessId,
          dayStart.toDate(),
          dayEnd.toDate(),
        ) as AdminBooking[];

        const candidates = bookings.filter((b) => {
          if (!['confirmed', 'pending', 'requested'].includes(b.status)) return false;
          if (fromStaffId && b.staffId !== fromStaffId) return false;
          if (b.staffId === target.id) return false;
          return true;
        });

        const movable: Array<Record<string, unknown>> = [];
        const blocked: Array<Record<string, unknown>> = [];

        for (const booking of candidates) {
          const canDoService = target.services.includes(booking.serviceId);
          if (!canDoService) {
            blocked.push({
              ref: booking.ref,
              reason: `${target.name} cannot perform ${booking.serviceName ?? 'this service'}`,
              local_time: dayjs(booking.startsAt).tz(tz).format('HH:mm'),
              customer_name: booking.customerName,
              current_staff: booking.staffName,
            });
            continue;
          }

          const conflictOnTarget = bookings.some((other) =>
            other.ref !== booking.ref
            && other.staffId === target.id
            && other.startsAt < booking.endsAt
            && other.endsAt > booking.startsAt,
          );

          // Also catch two bookings both being moved onto the same target slot.
          const conflictInBatch = movable.some((entry) =>
            entry.local_time === dayjs(booking.startsAt).tz(tz).format('HH:mm'),
          );

          const entry = {
            ref: booking.ref,
            local_time: dayjs(booking.startsAt).tz(tz).format('HH:mm'),
            customer_name: booking.customerName,
            service_name: booking.serviceName,
            current_staff: booking.staffName,
          };

          if (conflictOnTarget || conflictInBatch) {
            blocked.push({ ...entry, reason: `${target.name} already has a booking at that time` });
          } else {
            movable.push(entry);
          }
        }

        return JSON.stringify({
          dry_run: true,
          date,
          target_staff: { id: target.id, name: target.name },
          movable_count: movable.length,
          blocked_count: blocked.length,
          movable,
          blocked,
          how_to_reply:
            'Summarize movable vs blocked. Ask the owner to confirm before calling confirm_reassign_bookings with the movable refs.',
        });
      }

      case 'confirm_reassign_bookings': {
        const staffId = String(toolInput.staff_id);
        const refs = Array.isArray(toolInput.booking_refs)
          ? toolInput.booking_refs.map(String)
          : [];

        if (refs.length === 0) {
          return JSON.stringify({ error: 'No booking_refs provided' });
        }

        const moved: string[] = [];
        const failed: Array<{ ref: string; error: string }> = [];

        for (const ref of refs) {
          try {
            await BookingService.reassignStaff(businessId, ref, staffId);
            moved.push(ref);
          } catch (err) {
            failed.push({
              ref,
              error: err instanceof Error ? err.message : 'Failed',
            });
          }
        }

        return JSON.stringify({
          success: failed.length === 0,
          moved_count: moved.length,
          moved,
          failed,
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return JSON.stringify({ error: message });
  }
}

// ─── Loop ─────────────────────────────────────────────────────────────────────

export async function runAdminAgentLoop(
  messages: AgentTurnMessage[],
  systemPrompt: string,
  businessId: string,
): Promise<{ reply: string; messages: AgentTurnMessage[] }> {
  const provider = getAgentLlmProvider();
  const MAX_ITERATIONS = 10;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await provider.complete({
      systemPrompt,
      messages,
      tools: ADMIN_TOOLS,
    });

    messages.push({ role: 'assistant', parts: response.parts });

    if (response.stopReason === 'end_turn') {
      return { reply: extractReplyText(response.parts), messages };
    }

    const toolCalls = response.parts.filter(
      (p): p is Extract<typeof p, { kind: 'tool_call' }> => p.kind === 'tool_call',
    );

    const toolResults = await Promise.all(
      toolCalls.map(async (call) => ({
        kind: 'tool_result' as const,
        id: call.id,
        name: call.name,
        result: await dispatchAdminTool(call.name, call.args, { businessId }),
      })),
    );

    messages.push({ role: 'user', parts: toolResults });
  }

  return {
    reply: 'Sorry, I had trouble completing that request. Please try again.',
    messages,
  };
}
