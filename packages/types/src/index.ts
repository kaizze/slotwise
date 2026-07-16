// ─── Business / Tenant ───────────────────────────────────────────────────────

export interface Business {
  id: string;
  name: string;
  slug: string;
  type: BusinessType;
  timezone: string;
  locale: string;
  settings: BusinessSettings;
  createdAt: Date;
}

export type BusinessType =
  | 'hair_salon'
  | 'nail_salon'
  | 'medical'
  | 'dental'
  | 'beauty'
  | 'fitness'
  | 'other';

export interface BusinessSettings {
  slotDurationMinutes: number;
  bufferMinutes: number;       // gap between bookings
  maxAdvanceDays: number;      // how far ahead clients can book
  requiresDeposit: boolean;
  depositAmount?: number;
  smsEnabled: boolean;
  emailEnabled: boolean;
  agentEnabled: boolean;
  noShowThreshold: number;     // risk score above which extra reminder fires
}

// ─── Users (dashboard login accounts) ────────────────────────────────────────
// Distinct from Staff: a User can log into the admin dashboard. A Staff member
// is a bookable resource. They may be linked (staffId) but aren't the same thing.

export interface User {
  id: string;
  businessId: string;
  email: string;
  name: string;
  role: UserRole;
  staffId?: string;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
}

export type UserRole = 'owner' | 'staff';

export interface AuthTokenPayload {
  userId: string;
  businessId: string;
  role: UserRole;
}

// ─── Staff ───────────────────────────────────────────────────────────────────

export interface Staff {
  id: string;
  businessId: string;
  name: string;
  email: string;
  phone?: string;
  services: string[];          // service IDs this staff member can perform
  workingHours: WorkingHours[];
  isActive: boolean;
}

export interface WorkingHours {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday
  startTime: string;  // "09:00"
  endTime: string;    // "18:00"
  breakStart?: string;
  breakEnd?: string;
}

// ─── Services ────────────────────────────────────────────────────────────────

export interface Service {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  durationMinutes: number;
  price: number;
  currency: string;
  color: string;               // for calendar display
  isActive: boolean;
}

// ─── Bookings ────────────────────────────────────────────────────────────────

export interface Booking {
  id: string;
  ref: string;                 // human-readable e.g. "SW-2024-4821"
  businessId: string;
  serviceId: string;
  staffId: string;
  customerId: string;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  channel: BookingChannel;
  notes?: string;
  noShowRisk: number;          // 0-1 score
  createdAt: Date;
  updatedAt: Date;
}

export type BookingStatus =
  | 'pending'
  | 'requested'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show';

export type BookingChannel =
  | 'widget'
  | 'agent'
  | 'whatsapp'
  | 'admin'
  | 'api';

// ─── Customers ───────────────────────────────────────────────────────────────

export type CustomerEmailStatus = 'valid' | 'invalid' | 'complained';

export interface Customer {
  id: string;
  businessId: string;
  name: string;
  phone: string;
  email?: string;
  emailStatus?: CustomerEmailStatus;
  noShowCount: number;
  totalBookings: number;
  createdAt: Date;
}

// ─── Slots ───────────────────────────────────────────────────────────────────

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  staffId: string;
  staffName: string;
  score: number;               // optimizer score 0-100
  scoreReasons: ScoreReason[];
}

export interface ScoreReason {
  factor: 'adjacency' | 'gap_penalty' | 'fragmentation' | 'end_of_day' | 'staff_continuity';
  delta: number;
  label: string;
}

// ─── Waitlist ─────────────────────────────────────────────────────────────────

export interface WaitlistEntry {
  id: string;
  businessId: string;
  customerId: string;
  serviceId: string;
  staffId?: string;
  preferredWindowStart?: Date;
  preferredWindowEnd?: Date;
  createdAt: Date;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentSession {
  sessionId: string;
  businessId: string;
  channel: BookingChannel;
  messages: AgentMessage[];
  collectedData: Partial<AgentCollectedData>;
  createdAt: Date;
}

export interface AgentCollectedData {
  serviceName: string;
  serviceId: string;
  preferredDate: string;
  preferredTime: string;
  staffId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  selectedSlot: Slot;
}

// ─── API responses ────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
}
