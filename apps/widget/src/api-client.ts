// Minimal, dependency-free API client for the public booking endpoints.
// Mirrors the shapes returned by apps/api/src/routes/{slots,bookings,business}.ts —
// kept as plain interfaces here rather than importing @slotwise/types, since this
// bundle ships standalone to third-party sites and must not pull in workspace deps.

export interface ApiService {
  id: string;
  name: string;
  description?: string;
  durationMinutes: number;
  price: number;
  currency: string;
  color: string;
}

export interface ApiSlot {
  startsAt: string; // ISO 8601
  endsAt: string;
  staffId: string;
  staffName: string;
  score: number;
}

export interface ApiBusiness {
  name: string;
  type: string;
  timezone: string;
  locale: string;
  agentEnabled: boolean;
}

export interface CreateBookingInput {
  serviceId: string;
  staffId: string;
  slotDatetime: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  notes?: string;
}

export interface ApiBooking {
  id: string;
  ref: string;
  startsAt: string;
  endsAt: string;
  status: string;
}

export interface ApiCustomer {
  id: string;
  name: string;
  phone: string;
  email?: string;
}

export interface CustomerAuthResult {
  customer: ApiCustomer;
  accessToken: string;
}

export interface AgentChatResult {
  reply: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  history: unknown[];
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export class SlotWiseApiClient {
  private accessToken: string | null = null;

  constructor(
    private baseUrl: string,
    private businessSlug: string
  ) {}

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new ApiError(body.error ?? 'Something went wrong', response.status);
    }

    return body.data as T;
  }

  async getBusiness(): Promise<ApiBusiness> {
    return this.request<ApiBusiness>(`/api/v1/businesses/${this.businessSlug}`);
  }

  async getServices(): Promise<ApiService[]> {
    return this.request<ApiService[]>(`/api/v1/slots/${this.businessSlug}/services`);
  }

  async getSlots(serviceId: string, date: string): Promise<ApiSlot[]> {
    const params = new URLSearchParams({ serviceId, date });
    return this.request<ApiSlot[]>(`/api/v1/slots/${this.businessSlug}?${params}`);
  }

  async createBooking(input: CreateBookingInput): Promise<ApiBooking> {
    return this.request<ApiBooking>(`/api/v1/bookings`, {
      method: 'POST',
      body: JSON.stringify({ businessSlug: this.businessSlug, ...input }),
    });
  }

  async joinWaitlist(input: {
    serviceId: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    preferredDate?: string;
    staffId?: string;
  }): Promise<{ id: string }> {
    return this.request<{ id: string }>(`/api/v1/waitlist`, {
      method: 'POST',
      body: JSON.stringify({ businessSlug: this.businessSlug, ...input }),
    });
  }

  async registerCustomer(input: {
    name: string;
    phone: string;
    email: string;
    password: string;
  }): Promise<CustomerAuthResult> {
    return this.request<CustomerAuthResult>(`/api/v1/customer-auth/register`, {
      method: 'POST',
      body: JSON.stringify({ businessSlug: this.businessSlug, ...input }),
    });
  }

  async loginCustomer(input: {
    identifier: string;
    password: string;
  }): Promise<CustomerAuthResult> {
    return this.request<CustomerAuthResult>(`/api/v1/customer-auth/login`, {
      method: 'POST',
      body: JSON.stringify({ businessSlug: this.businessSlug, ...input }),
    });
  }

  async getCustomerMe(): Promise<{ customer: ApiCustomer }> {
    return this.request<{ customer: ApiCustomer }>(`/api/v1/customer-auth/me`);
  }

  async chatWithAgent(input: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    history?: unknown[];
  }): Promise<AgentChatResult> {
    // Agent chat returns a flat { reply, messages, history } payload (not { data }).
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}/api/v1/agent/${this.businessSlug}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: input.messages,
        ...(input.history && input.history.length > 0 ? { history: input.history } : {}),
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new ApiError(
        body.message ?? body.error ?? 'Something went wrong',
        response.status,
      );
    }

    return body as AgentChatResult;
  }
}
