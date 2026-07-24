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
      'Count real free capacity for a date. Pass natural language only (tomorrow / monday / αύριο) — never invent YYYY-MM-DD. Returns total openings for a reference service, plus per-staff counts AND free_local_times. Do NOT add per-service counts together.',
    parameters: {
      type: 'object',
      required: ['date'],
      properties: {
        date: {
          type: 'string',
          description: 'Natural language only: "tomorrow", "αύριο", "monday", "Δευτέρα". Prefer words over YYYY-MM-DD.',
        },
        service_id: {
          type: 'string',
          description: 'Optional service UUID. If omitted, uses the shortest active service as the capacity unit.',
        },
        staff_id: { type: 'string', description: 'Optional staff UUID filter' },
        staff_name: { type: 'string', description: 'Optional staff name filter, e.g. "Maria"' },
      },
    },
  },
  {
    name: 'list_free_slots',
    description:
      'List the actual free clock times for a date (and optional staff/service). REQUIRED when the owner asks "what times / τι ώρες". Never invent times — only report local_times from this tool.',
    parameters: {
      type: 'object',
      required: ['date'],
      properties: {
        date: {
          type: 'string',
          description: 'Natural language: "tomorrow", "monday", "Δευτέρα", etc.',
        },
        staff_name: { type: 'string', description: 'Optional staff name, e.g. "Eleni"' },
        staff_id: { type: 'string', description: 'Optional staff UUID' },
        service_id: { type: 'string', description: 'Optional service UUID' },
        service_name: { type: 'string', description: 'Optional service name filter, e.g. "Blow Dry"' },
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
        staff_id: { type: 'string', description: 'Optional staff UUID filter' },
        staff_name: { type: 'string', description: 'Optional staff name filter, e.g. "Eleni"' },
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
- These absolute dates are authoritative. Never call Monday "tomorrow" unless Tomorrow above is Monday.

ROLE:
- Help the business owner/staff with operational questions and safe schedule changes.
- Always use tools for counts and lists — never invent numbers or dates.
- When reporting a day, use date_searched / local_date from the tool result (weekday + YYYY-MM-DD).
- Keep answers concise and practical (bullet points when listing).
- Reply in ${language} unless the owner writes in another language — then follow them.

FREE SLOTS RULES:
- For "how many free slots…", call count_available_slots with date="tomorrow" or date="monday" (natural language).
- For "what times / τι ώρες / free hours", you MUST call list_free_slots (with staff_name when a person is named).
- NEVER invent clock times (e.g. 07:00, 16:30). Only quote local_times / free_local_times returned by tools.
- If free_local_times is empty, say they have no free slots — do not guess from the booking list.
- Never invent a YYYY-MM-DD yourself.
- Use total_free_slots from the tool as the headline number. That is real capacity for the reference service.
- Do NOT add by_service counts together — the same staff time appears under multiple services.
- When asked "by who", use by_staff from the tool (include their free_local_times).

CAPABILITIES:
- Free slot counts for a day (with per-staff breakdown and real times)
- Exact free times via list_free_slots
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
- "How many free slots on monday and by who?" → count_available_slots date=monday (then report by_staff + free_local_times)
- "ελεύθερα τι έχει / τι ώρες ελεύθερη η Ελένη;" → list_free_slots date=monday staff_name=Eleni
- "τι ώρες έχει κλεισμένες η Ελένη;" → list_bookings date=monday (booked times, not free)
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

/**
 * Resolve admin date phrases in the business timezone.
 * Prefers natural language (tomorrow / monday) over model-invented YYYY-MM-DD.
 */
function resolveAdminDate(input: string, tz: string): string {
  const now = dayjs().tz(tz);
  const lower = input
    .toLowerCase()
    .trim()
    .replace(/[?.!,;:'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    lower === 'tomorrow'
    || lower === 'αύριο'
    || lower === 'αυριο'
    || lower.includes('tomorrow')
    || lower.includes('αύριο')
    || lower.includes('αυριο')
  ) {
    return now.add(1, 'day').format('YYYY-MM-DD');
  }

  if (
    lower === 'today'
    || lower === 'σήμερα'
    || lower === 'σημερα'
    || lower.includes('today')
    || lower.includes('σήμερα')
    || lower.includes('σημερα')
  ) {
    return now.format('YYYY-MM-DD');
  }

  const weekdays: Array<{ keys: string[]; dow: number }> = [
    { keys: ['sunday', 'sun', 'κυριακή', 'κυριακη'], dow: 0 },
    { keys: ['monday', 'mon', 'δευτέρα', 'δευτερα'], dow: 1 },
    { keys: ['tuesday', 'tue', 'τρίτη', 'τριτη'], dow: 2 },
    { keys: ['wednesday', 'wed', 'τετάρτη', 'τεταρτη'], dow: 3 },
    { keys: ['thursday', 'thu', 'πέμπτη', 'πεμπτη'], dow: 4 },
    { keys: ['friday', 'fri', 'παρασκευή', 'παρασκευη'], dow: 5 },
    { keys: ['saturday', 'sat', 'σάββατο', 'σαββατο'], dow: 6 },
  ];

  for (const day of weekdays) {
    if (day.keys.some((key) => lower === key || lower.includes(` ${key}`) || lower.startsWith(`${key} `) || lower.includes(key))) {
      // Upcoming matching weekday; if today matches, keep today.
      let cursor = now.startOf('day');
      for (let i = 0; i < 7; i++) {
        if (cursor.day() === day.dow) return cursor.format('YYYY-MM-DD');
        cursor = cursor.add(1, 'day');
      }
    }
  }

  // Accept explicit ISO dates, but reject clearly wrong far-future hallucinations
  // more than 14 days out (models sometimes invent training-data dates).
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    const parsed = dayjs.tz(lower, tz);
    if (!parsed.isValid()) return now.format('YYYY-MM-DD');
    const daysAhead = parsed.startOf('day').diff(now.startOf('day'), 'day');
    if (daysAhead < 0 && Math.abs(daysAhead) > 7) {
      return now.add(1, 'day').format('YYYY-MM-DD');
    }
    if (daysAhead > 14) {
      return now.add(1, 'day').format('YYYY-MM-DD');
    }
    return lower;
  }

  return resolveBookingDate(input, tz);
}

function nextWeekdayDate(input: string, tz: string): string {
  return resolveAdminDate(input, tz);
}

async function resolveServiceForAdmin(
  businessId: string,
  toolInput: Record<string, unknown>,
) {
  const services = await ServiceService.list(businessId);
  if (services.length === 0) return { services, referenceService: null as null };

  if (toolInput.service_id) {
    const match = services.find((s) => s.id === toolInput.service_id);
    if (match) return { services, referenceService: match };
  }

  if (toolInput.service_name) {
    const q = transliterateGreek(String(toolInput.service_name));
    const match = services.find((s) => transliterateGreek(s.name).includes(q));
    if (match) return { services, referenceService: match };
  }

  const shortest = [...services].sort((a, b) => a.durationMinutes - b.durationMinutes)[0]!;
  return { services, referenceService: shortest };
}

async function resolveStaffIdForAdmin(
  businessId: string,
  toolInput: Record<string, unknown>,
): Promise<{ staffId?: string; error?: string }> {
  if (toolInput.staff_id) return { staffId: String(toolInput.staff_id) };
  if (!toolInput.staff_name) return {};
  const named = await resolveStaffByName(businessId, String(toolInput.staff_name));
  if (!named) return { error: `No staff found matching "${toolInput.staff_name}"` };
  return { staffId: named.id };
}

function formatSlotsByStaff(
  slots: Array<{ startsAt: Date; staffId: string; staffName: string }>,
  tz: string,
) {
  const byStaffMap = new Map<string, {
    staff_id: string;
    staff_name: string;
    free_slots: number;
    free_local_times: string[];
  }>();

  const ordered = [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const slot of ordered) {
    const current = byStaffMap.get(slot.staffId) ?? {
      staff_id: slot.staffId,
      staff_name: slot.staffName,
      free_slots: 0,
      free_local_times: [],
    };
    current.free_slots += 1;
    current.free_local_times.push(dayjs(slot.startsAt).tz(tz).format('HH:mm'));
    byStaffMap.set(slot.staffId, current);
  }

  return [...byStaffMap.values()].sort((a, b) => b.free_slots - a.free_slots);
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
        const now = dayjs().tz(tz);
        const date = resolveAdminDate(String(toolInput.date ?? 'tomorrow'), tz);

        const staffResolved = await resolveStaffIdForAdmin(businessId, toolInput);
        if (staffResolved.error) return JSON.stringify({ error: staffResolved.error });
        const staffId = staffResolved.staffId;

        const { services, referenceService } = await resolveServiceForAdmin(businessId, toolInput);
        if (!referenceService) {
          return JSON.stringify({ error: 'No matching services', date });
        }

        const referenceSlots = await SlotService.getAvailableSlots({
          businessId,
          serviceId: referenceService.id,
          date,
          staffId,
          presentation: 'customer',
          limit: undefined,
        });

        const byStaff = formatSlotsByStaff(referenceSlots, tz);

        const byService: Array<{
          service_id: string;
          service_name: string;
          duration_minutes: number;
          free_slots: number;
          note?: string;
        }> = [];

        for (const service of services) {
          if (service.id === referenceService.id) {
            byService.push({
              service_id: service.id,
              service_name: service.name,
              duration_minutes: service.durationMinutes,
              free_slots: referenceSlots.length,
              note: 'reference_capacity_unit',
            });
            continue;
          }
          const slots = await SlotService.getAvailableSlots({
            businessId,
            serviceId: service.id,
            date,
            staffId,
            presentation: 'customer',
            limit: undefined,
          });
          byService.push({
            service_id: service.id,
            service_name: service.name,
            duration_minutes: service.durationMinutes,
            free_slots: slots.length,
            note: 'do_not_add_to_total',
          });
        }

        return JSON.stringify({
          date_requested: toolInput.date,
          date_searched: date,
          local_date: dayjs.tz(date, tz).format('dddd D MMMM YYYY'),
          today: now.format('YYYY-MM-DD'),
          tomorrow: now.add(1, 'day').format('YYYY-MM-DD'),
          timezone: tz,
          reference_service: {
            id: referenceService.id,
            name: referenceService.name,
            duration_minutes: referenceService.durationMinutes,
          },
          total_free_slots: referenceSlots.length,
          by_staff: byStaff,
          by_service: byService,
          how_to_reply:
            'Report total_free_slots and local_date. Use by_staff (+ free_local_times) when asked who/when is free. Never invent HH:mm. Never sum by_service into a new total.',
        });
      }

      case 'list_free_slots': {
        const business = await BusinessService.getById(businessId);
        const tz = business?.timezone ?? 'UTC';
        const now = dayjs().tz(tz);
        const date = resolveAdminDate(String(toolInput.date ?? 'tomorrow'), tz);

        const staffResolved = await resolveStaffIdForAdmin(businessId, toolInput);
        if (staffResolved.error) return JSON.stringify({ error: staffResolved.error });
        const staffId = staffResolved.staffId;

        const { referenceService } = await resolveServiceForAdmin(businessId, toolInput);
        if (!referenceService) {
          return JSON.stringify({ error: 'No matching services', date });
        }

        const slots = await SlotService.getAvailableSlots({
          businessId,
          serviceId: referenceService.id,
          date,
          staffId,
          presentation: 'customer',
          limit: undefined,
        });

        const byStaff = formatSlotsByStaff(slots, tz);
        const localTimes = byStaff.flatMap((row) => row.free_local_times);

        return JSON.stringify({
          date_requested: toolInput.date,
          date_searched: date,
          local_date: dayjs.tz(date, tz).format('dddd D MMMM YYYY'),
          today: now.format('YYYY-MM-DD'),
          tomorrow: now.add(1, 'day').format('YYYY-MM-DD'),
          timezone: tz,
          service: {
            id: referenceService.id,
            name: referenceService.name,
            duration_minutes: referenceService.durationMinutes,
          },
          staff_filter: staffId ?? null,
          total_free_slots: slots.length,
          local_times: localTimes,
          by_staff: byStaff,
          how_to_reply:
            'ONLY quote exact HH:mm values from local_times / free_local_times. Do not invent ranges (e.g. 07:00-09:00) or times not listed. If local_times is empty, say there are no free slots.',
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
        const staffResolved = await resolveStaffIdForAdmin(businessId, toolInput);
        if (staffResolved.error) return JSON.stringify({ error: staffResolved.error });
        if (staffResolved.staffId) {
          bookings = bookings.filter((b) => b.staffId === staffResolved.staffId);
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
