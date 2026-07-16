import { servicesApi, staffApi } from './api-client';

export interface SetupStatus {
  hasServices: boolean;
  hasStaff: boolean;
  complete: boolean;
  serviceCount: number;
  staffCount: number;
}

/** A business is ready for bookings once it has ≥1 service and ≥1 staff. */
export async function fetchSetupStatus(): Promise<SetupStatus> {
  const [services, staff] = await Promise.all([servicesApi.list(), staffApi.list()]);
  const serviceCount = services.length;
  const staffCount = staff.length;
  const hasServices = serviceCount > 0;
  const hasStaff = staffCount > 0;
  return {
    hasServices,
    hasStaff,
    complete: hasServices && hasStaff,
    serviceCount,
    staffCount,
  };
}

export function slugifyBusinessName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export const BUSINESS_TYPES: Array<{ value: string; label: string }> = [
  { value: 'hair_salon', label: 'Hair salon' },
  { value: 'nail_salon', label: 'Nail salon' },
  { value: 'beauty', label: 'Beauty / spa' },
  { value: 'medical', label: 'Medical' },
  { value: 'dental', label: 'Dental' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'other', label: 'Other' },
];

export const TIMEZONES = [
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Berlin',
  'Europe/London',
  'UTC',
];

export const DEFAULT_WEEKDAY_HOURS = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: '09:00',
  endTime: '18:00',
}));
