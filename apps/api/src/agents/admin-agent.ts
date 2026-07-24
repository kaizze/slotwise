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
      'REQUIRED for free/available clock times (τι ώρες κενές, ελεύθερα, available hours). Returns local_times as exact HH:mm. Do NOT use list_bookings for this — bookings are occupied times, not free ones. Never invent times.',
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
    description:
      'List OCCUPIED bookings only (confirmed/pending/etc). Never use this to answer free/available/κενές times — use list_free_slots instead.',
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
- For free/available times ("τι ώρες κενές", "ελεύθερα", "available hours", or when the owner challenges a free-slot count), you MUST call list_free_slots (with staff_name when a person is named).
- NEVER call list_bookings to answer free/κενές questions — that tool only returns occupied appointments.
- NEVER invent clock times (e.g. 07:00, 08:00, 08:30, 16:30). Only quote local_times / free_local_times from tools, verbatim.
- Do not invent "before first booking" or "after last booking" ranges. If the tool says 17:00 and 17:30, say exactly that.
- Free times can be after the last calendar booking when staff working_hours end later (e.g. bookings until 17:00, hours until 18:00). That is normal — quote the tool times and mention working_hours_for_day if present.
- If local_times / free_local_times is empty, say they have no free slots — do not guess.
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
- "τι ώρες κενές έχει η Ελένη;" / "ελεύθερα τι έχει" → list_free_slots date=monday staff_name=Eleni
- "παραπάνω μου είπες ότι έχει 2 κενά" → list_free_slots again; quote local_times only
- "τι ώρες έχει κλεισμένες η Ελένη;" → list_bookings date=monday (occupied only)
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
    // Prefer long names; short keys (mon/sun) must be whole tokens so
    // "this month" does not resolve as Monday.
    const keys = [...day.keys].sort((a, b) => b.length - a.length);
    const matched = keys.some((key) => {
      if (lower === key) return true;
      if (key.length <= 3) {
        return new RegExp(`(?:^|\\s)${key}(?:\\s|$)`).test(lower);
      }
      return lower.includes(key);
    });
    if (!matched) continue;
    // Upcoming matching weekday; if today matches, keep today.
    let cursor = now.startOf('day');
    for (let i = 0; i < 7; i++) {
      if (cursor.day() === day.dow) return cursor.format('YYYY-MM-DD');
      cursor = cursor.add(1, 'day');
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

async function workingHoursForDay(
  businessId: string,
  date: string,
  tz: string,
  staffId?: string,
) {
  const dayOfWeek = dayjs.tz(date, tz).day();
  const staff = await StaffService.list(businessId);
  const rows = staff
    .filter((s) => (staffId ? s.id === staffId : true) && s.isActive)
    .map((s) => {
      const wh = s.workingHours.find((h) => h.dayOfWeek === dayOfWeek);
      if (!wh) {
        return {
          staff_id: s.id,
          staff_name: s.name,
          works_this_day: false as const,
        };
      }
      return {
        staff_id: s.id,
        staff_name: s.name,
        works_this_day: true as const,
        start_time: wh.startTime,
        end_time: wh.endTime,
        break_start: wh.breakStart ?? null,
        break_end: wh.breakEnd ?? null,
      };
    });
  return rows;
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

        const { referenceService } = await resolveServiceForAdmin(businessId, toolInput);
        if (!referenceService) {
          return JSON.stringify({ error: 'No matching services', date });
        }

        // Admin capacity must use the full ranked list — never the customer
        // morning-biased presentation path.
        const referenceSlots = await SlotService.getAvailableSlots({
          businessId,
          serviceId: referenceService.id,
          date,
          staffId,
        });

        const byStaff = formatSlotsByStaff(referenceSlots, tz);
        const localTimes = byStaff.flatMap((row) => row.free_local_times);
        const workingHours = await workingHoursForDay(businessId, date, tz, staffId);

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
          // Only expose a flat time list when a single staff filter is set —
          // otherwise the model can attribute another person's slot to Eleni.
          ...(staffId ? { local_times: localTimes } : {}),
          by_staff: byStaff,
          working_hours_for_day: workingHours,
          how_to_reply:
            'Report total_free_slots and local_date. Quote free times ONLY from by_staff.free_local_times (or local_times when staff-filtered). Never invent HH:mm.',
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
        });

        const byStaff = formatSlotsByStaff(slots, tz);
        const localTimes = byStaff.flatMap((row) => row.free_local_times);
        const workingHours = await workingHoursForDay(businessId, date, tz, staffId);

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
          ...(staffId ? { local_times: localTimes } : {}),
          by_staff: byStaff,
          working_hours_for_day: workingHours,
          how_to_reply:
            'ONLY quote exact HH:mm from local_times / by_staff.free_local_times. If times are after the last booking, explain using working_hours_for_day end_time. Never invent morning times. If empty, say none free.',
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

// ─── Reply enforcement ────────────────────────────────────────────────────────

type FreeSlotToolPayload = {
  tool: 'count_available_slots' | 'list_free_slots';
  local_date?: string;
  total_free_slots?: number;
  local_times?: string[];
  by_staff?: Array<{
    staff_name: string;
    free_slots: number;
    free_local_times: string[];
  }>;
  working_hours_for_day?: Array<{
    staff_name: string;
    works_this_day: boolean;
    start_time?: string;
    end_time?: string;
  }>;
  reference_service?: { name: string };
  service?: { name: string };
};

function normalizeClockToken(hour: string, minute: string): string {
  return `${hour.padStart(2, '0')}:${minute}`;
}

function extractClockTokens(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      out.push(normalizeClockToken(String(hour), match[2]!));
    }
  }
  return out;
}

function allowedFreeTimes(payload: FreeSlotToolPayload): Set<string> {
  const allow = new Set<string>();
  for (const t of payload.local_times ?? []) allow.add(t);
  for (const row of payload.by_staff ?? []) {
    for (const t of row.free_local_times ?? []) allow.add(t);
  }
  return allow;
}

function formatAuthoritativeFreeSlotReply(payload: FreeSlotToolPayload): string {
  const dateLabel = payload.local_date ?? 'that day';
  const serviceName = payload.service?.name ?? payload.reference_service?.name;
  const staffRows = payload.by_staff ?? [];
  const hours = payload.working_hours_for_day ?? [];

  if ((payload.total_free_slots ?? 0) === 0 || staffRows.every((r) => r.free_slots === 0)) {
    return `No free slots on ${dateLabel}${serviceName ? ` for ${serviceName}` : ''}.`;
  }

  const lines: string[] = [
    `${payload.total_free_slots} free slot${payload.total_free_slots === 1 ? '' : 's'} on ${dateLabel}${serviceName ? ` (${serviceName})` : ''}:`,
  ];

  for (const row of staffRows) {
    if (row.free_slots === 0) continue;
    const times = row.free_local_times.join(', ');
    lines.push(`- ${row.staff_name}: ${row.free_slots} — ${times}`);
    const wh = hours.find((h) => h.staff_name === row.staff_name && h.works_this_day);
    if (wh?.start_time && wh.end_time) {
      lines.push(`  Working hours: ${wh.start_time}–${wh.end_time}`);
    }
  }

  return lines.join('\n');
}

/**
 * Hard guard: if free-slot tools ran this turn, the model may not invent HH:mm
 * values. Any reply that mentions a clock time outside the tool allowlist is
 * replaced with a server-formatted answer from the tool JSON.
 */
function enforceFreeSlotReply(
  reply: string,
  freeSlotPayloads: FreeSlotToolPayload[],
): string {
  if (freeSlotPayloads.length === 0) return reply;

  const latest = freeSlotPayloads[freeSlotPayloads.length - 1]!;
  const allow = allowedFreeTimes(latest);
  const mentioned = extractClockTokens(reply);
  const invented = mentioned.filter((t) => !allow.has(t));

  // list_free_slots answers must be exact — always use authoritative text.
  // count_available_slots: only rewrite when the model invents times.
  if (latest.tool === 'list_free_slots' || invented.length > 0) {
    return formatAuthoritativeFreeSlotReply(latest);
  }

  return reply;
}

function parseFreeSlotToolResult(
  name: string,
  result: string,
): FreeSlotToolPayload | null {
  if (name !== 'count_available_slots' && name !== 'list_free_slots') return null;
  try {
    const parsed = JSON.parse(result) as FreeSlotToolPayload & { error?: string };
    if (parsed.error) return null;
    return { ...parsed, tool: name };
  } catch {
    return null;
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
  const freeSlotPayloads: FreeSlotToolPayload[] = [];

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await provider.complete({
      systemPrompt,
      messages,
      tools: ADMIN_TOOLS,
    });

    messages.push({ role: 'assistant', parts: response.parts });

    if (response.stopReason === 'end_turn') {
      const raw = extractReplyText(response.parts);
      const reply = enforceFreeSlotReply(raw, freeSlotPayloads);
      // Dashboard renders `messages`, not `reply` — keep them in sync when we
      // replace invented clock times with the tool-backed answer.
      if (reply !== raw) {
        const last = messages[messages.length - 1];
        if (last?.role === 'assistant') {
          last.parts = [{ kind: 'text', text: reply }];
        }
      }
      return { reply, messages };
    }

    const toolCalls = response.parts.filter(
      (p): p is Extract<typeof p, { kind: 'tool_call' }> => p.kind === 'tool_call',
    );

    const toolResults = await Promise.all(
      toolCalls.map(async (call) => {
        const result = await dispatchAdminTool(call.name, call.args, { businessId });
        const freePayload = parseFreeSlotToolResult(call.name, result);
        if (freePayload) freeSlotPayloads.push(freePayload);
        return {
          kind: 'tool_result' as const,
          id: call.id,
          name: call.name,
          result,
        };
      }),
    );

    messages.push({ role: 'user', parts: toolResults });
  }

  return {
    reply: 'Sorry, I had trouble completing that request. Please try again.',
    messages,
  };
}
