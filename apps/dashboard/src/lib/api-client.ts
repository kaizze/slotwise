// Mirrors apps/api response shapes. Kept as plain interfaces (not imported
// from @slotwise/types) to keep this client's surface explicit and decoupled
// from backend internals the dashboard doesn't need (e.g. raw DB row shapes).

export interface DashboardUser {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'staff';
}

export interface DashboardBusiness {
  id: string;
  name: string;
  slug: string;
  type: string;
  timezone: string;
  locale: string;
  settings: Record<string, unknown>;
}

export interface DashboardBooking {
  id: string;
  ref: string;
  startsAt: string;
  endsAt: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  channel: string;
  noShowRisk: number;
  serviceName?: string;
  serviceColor?: string;
  staffName?: string;
  customerName?: string;
  customerPhone?: string;
}

export interface WorkingHours {
  dayOfWeek: number; // 0 = Sunday
  startTime: string; // "09:00"
  endTime: string;   // "18:00"
  breakStart?: string;
  breakEnd?: string;
}

export interface DashboardStaff {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  services: string[]; // service IDs
  workingHours: WorkingHours[];
  isActive: boolean;
}

export interface DashboardService {
  id: string;
  name: string;
  description?: string;
  durationMinutes: number;
  price: number;
  currency: string;
  color: string;
  isActive: boolean;
}

export interface BusinessSettings {
  slotDurationMinutes: number;
  bufferMinutes: number;
  maxAdvanceDays: number;
  requiresDeposit: boolean;
  depositAmount?: number;
  smsEnabled: boolean;
  emailEnabled: boolean;
  agentEnabled: boolean;
  noShowThreshold: number;
}

export interface DashboardWaitlistEntry {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  serviceName: string;
  staffName?: string;
  notified: boolean;
  preferredWindowStart?: string;
  preferredWindowEnd?: string;
  createdAt: string;
}

export interface DashboardSlotOffer {
  id: string;
  offerType: 'rebook' | 'waitlist';
  status: string;
  offerToken: string;
  slotStartsAt: string;
  slotEndsAt: string;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
  incentive?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  serviceName: string;
  staffName: string;
  bookingRef?: string;
}

export interface AnalyticsBucket {
  key: string;
  label: string;
  count: number;
  revenue: number;
}

export interface AnalyticsReport {
  from: string;
  to: string;
  timezone: string;
  currency: string;
  totals: {
    reservations: number;
    revenue: number;
    cancelled: number;
    noShows: number;
    completed: number;
    confirmed: number;
    pending: number;
  };
  byHour: AnalyticsBucket[];
  byDayOfWeek: AnalyticsBucket[];
  byService: AnalyticsBucket[];
  byChannel: AnalyticsBucket[];
}

export interface TodayOverview {
  date: string;
  timezone: string;
  currency: string;
  totals: {
    bookingsToday: number;
    revenueToday: number;
    occupancyPercent: number | null;
    upcomingIn30Min: number;
    waitlistActive: number;
    cancelledToday: number;
  };
  timeline: DashboardBooking[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Token state ────────────────────────────────────────────────────────────
// Access token lives in memory only (module-level variable) — never
// localStorage, never sessionStorage. A page refresh loses it, which is
// expected: the app calls /auth/refresh on boot using the httpOnly cookie
// to silently re-establish a session.

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// ─── Core request with auto-refresh-on-401 ────────────────────────────────────

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  // Coalesce concurrent refresh attempts (e.g. several requests 401 at once)
  // into a single in-flight call rather than racing multiple refreshes.
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // sends the httpOnly refresh cookie
      });
      if (!response.ok) return false;

      const body = await response.json();
      setAccessToken(body.data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function request<T>(path: string, init?: RequestInit, isRetry = false): Promise<T> {
  // Only set JSON content-type when there is a body. Fastify rejects empty
  // bodies with Content-Type: application/json (breaks logout / other POSTs).
  const hasBody = init?.body != null && init.body !== '';
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 401 && !isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(path, init, true);
    }
  }

  // 204/205 have no body — don't try to parse JSON
  if (response.status === 204 || response.status === 205) {
    if (!response.ok) {
      throw new ApiError('Request failed', response.status);
    }
    return undefined as T;
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(body.error ?? 'Request failed', response.status);
  }

  return body.data as T;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export const authApi = {
  async login(email: string, password: string) {
    const data = await request<{ user: DashboardUser; business: DashboardBusiness; accessToken: string }>(
      '/api/v1/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) }
    );
    setAccessToken(data.accessToken);
    return data;
  },

  async signup(input: {
    businessName: string;
    businessSlug: string;
    businessType: string;
    ownerName: string;
    ownerEmail: string;
    ownerPassword: string;
    timezone?: string;
    locale?: string;
  }) {
    const data = await request<{ user: DashboardUser; business: DashboardBusiness; accessToken: string }>(
      '/api/v1/auth/signup',
      { method: 'POST', body: JSON.stringify(input) }
    );
    setAccessToken(data.accessToken);
    return data;
  },

  async logout() {
    try {
      await request('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // Still drop the local session if the network/API call fails.
    } finally {
      setAccessToken(null);
    }
  },

  /** Called on app boot — attempts silent re-auth via the refresh cookie. */
  async restoreSession(): Promise<{ user: DashboardUser; business: DashboardBusiness } | null> {
    const refreshed = await tryRefresh();
    if (!refreshed) return null;

    try {
      return await request('/api/v1/auth/me');
    } catch {
      return null;
    }
  },
};

// ─── Bookings ───────────────────────────────────────────────────────────────

export const bookingsApi = {
  async list(from: string, to: string): Promise<DashboardBooking[]> {
    const params = new URLSearchParams({ from, to });
    return request<DashboardBooking[]>(`/api/v1/bookings?${params}`);
  },

  async cancel(ref: string, reason?: string): Promise<void> {
    await request(`/api/v1/bookings/${ref}/admin-cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
};

// ─── Staff ──────────────────────────────────────────────────────────────────

export const staffApi = {
  async list(includeInactive = false): Promise<DashboardStaff[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return request<DashboardStaff[]>(`/api/v1/staff${params}`);
  },

  async create(input: {
    name: string;
    email?: string;
    phone?: string;
    serviceIds: string[];
    workingHours: WorkingHours[];
  }): Promise<DashboardStaff> {
    return request<DashboardStaff>('/api/v1/staff', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async update(
    id: string,
    updates: Partial<{
      name: string;
      email: string;
      phone: string;
      serviceIds: string[];
      workingHours: WorkingHours[];
      isActive: boolean;
    }>
  ): Promise<DashboardStaff> {
    return request<DashboardStaff>(`/api/v1/staff/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async deactivate(id: string): Promise<void> {
    await request(`/api/v1/staff/${id}`, { method: 'DELETE' });
  },
};

// ─── Services ───────────────────────────────────────────────────────────────

export const servicesApi = {
  async list(includeInactive = false): Promise<DashboardService[]> {
    const params = includeInactive ? '?includeInactive=true' : '';
    return request<DashboardService[]>(`/api/v1/services${params}`);
  },

  async create(input: {
    name: string;
    description?: string;
    durationMinutes: number;
    price: number;
    color?: string;
  }): Promise<DashboardService> {
    return request<DashboardService>('/api/v1/services', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async update(
    id: string,
    updates: Partial<{
      name: string;
      description: string;
      durationMinutes: number;
      price: number;
      color: string;
      isActive: boolean;
    }>
  ): Promise<DashboardService> {
    return request<DashboardService>(`/api/v1/services/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async deactivate(id: string): Promise<void> {
    await request(`/api/v1/services/${id}`, { method: 'DELETE' });
  },
};

// ─── Business settings ────────────────────────────────────────────────────────

export const businessSettingsApi = {
  async get(): Promise<DashboardBusiness> {
    return request<DashboardBusiness>('/api/v1/businesses/me');
  },

  async update(updates: Partial<BusinessSettings>): Promise<DashboardBusiness> {
    return request<DashboardBusiness>('/api/v1/businesses/me/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },
};

// ─── Waitlist & offers (slot-filling visibility) ─────────────────────────────

export const waitlistApi = {
  async list(includeNotified = false): Promise<DashboardWaitlistEntry[]> {
    const params = new URLSearchParams();
    if (includeNotified) params.set('includeNotified', 'true');
    const qs = params.toString();
    return request<DashboardWaitlistEntry[]>(`/api/v1/waitlist${qs ? `?${qs}` : ''}`);
  },

  async remove(id: string): Promise<void> {
    await request(`/api/v1/waitlist/${id}`, { method: 'DELETE' });
  },
};

export const offersApi = {
  async list(status: 'pending' | 'accepted' | 'expired' | 'cancelled' | 'all' = 'all'): Promise<DashboardSlotOffer[]> {
    const params = new URLSearchParams({ status });
    return request<DashboardSlotOffer[]>(`/api/v1/offers?${params}`);
  },
};

export const analyticsApi = {
  async get(from: string, to: string): Promise<AnalyticsReport> {
    const params = new URLSearchParams({ from, to });
    return request<AnalyticsReport>(`/api/v1/analytics?${params}`);
  },

  async today(): Promise<TodayOverview> {
    return request<TodayOverview>('/api/v1/analytics/today');
  },
};
