const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'developer';
}

export interface PlatformBusiness {
  id: string;
  name: string;
  slug: string;
  type: string;
  timezone: string;
  locale: string;
  plan: string | null;
  planExpires: string | null;
  createdAt: string;
  staffCount: number;
  servicesCount: number;
  bookings7d: number;
  smsEnabled: boolean;
  emailEnabled: boolean;
  agentEnabled: boolean;
  smsProvider: string | null;
}

export interface PlatformHealth {
  status: 'ok' | 'degraded';
  ts: string;
  db: { healthy: boolean };
  env: Record<string, boolean>;
  notifications: {
    pending: number;
    processing: number;
    failed24h: number;
    sent24h: number;
  };
  fleet: {
    businesses: number;
    activeStaff: number;
    bookingsToday: number;
  };
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (json as { error?: string }).error ?? res.statusText);
  }
  return (json as { data: T }).data;
}

export const platformApi = {
  async login(email: string, password: string) {
    const data = await request<{ accessToken: string; user: PlatformUser }>(
      '/api/v1/platform/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    );
    setAccessToken(data.accessToken);
    return data;
  },

  async restoreSession() {
    try {
      const data = await request<{ accessToken: string; user: PlatformUser }>(
        '/api/v1/platform/auth/refresh',
        { method: 'POST', body: '{}' },
      );
      setAccessToken(data.accessToken);
      return data;
    } catch {
      setAccessToken(null);
      return null;
    }
  },

  async logout() {
    try {
      await request('/api/v1/platform/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      setAccessToken(null);
    }
  },

  me() {
    return request<{ user: PlatformUser }>('/api/v1/platform/auth/me');
  },

  listBusinesses(q?: string) {
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    return request<{ businesses: PlatformBusiness[] }>(`/api/v1/platform/businesses${qs}`);
  },

  health() {
    return request<PlatformHealth>('/api/v1/platform/health');
  },
};
