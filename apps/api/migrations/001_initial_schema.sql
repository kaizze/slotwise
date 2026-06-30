-- SlotWise PostgreSQL Schema
-- Run: psql $DATABASE_URL -f schema.sql

-- ─── Extensions ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- fuzzy search on customer names

-- ─── Businesses (tenants) ─────────────────────────────────────────────────────

CREATE TABLE businesses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL DEFAULT 'other',
  timezone      TEXT NOT NULL DEFAULT 'Europe/Athens',
  locale        TEXT NOT NULL DEFAULT 'el',
  settings      JSONB NOT NULL DEFAULT '{}',
  plan          TEXT NOT NULL DEFAULT 'starter', -- starter | pro | business
  plan_expires  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Staff ────────────────────────────────────────────────────────────────────

CREATE TABLE staff (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  service_ids   UUID[] NOT NULL DEFAULT '{}',
  working_hours JSONB NOT NULL DEFAULT '[]',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX staff_business_idx ON staff(business_id);

-- ─── Services ────────────────────────────────────────────────────────────────

CREATE TABLE services (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  price            NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'EUR',
  color            TEXT NOT NULL DEFAULT '#6366f1',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX services_business_idx ON services(business_id);

-- ─── Customers ────────────────────────────────────────────────────────────────

CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  email           TEXT,
  no_show_count   INTEGER NOT NULL DEFAULT 0,
  total_bookings  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, phone)
);

CREATE INDEX customers_business_idx ON customers(business_id);
CREATE INDEX customers_phone_idx ON customers(business_id, phone);
CREATE INDEX customers_name_trgm ON customers USING gin(name gin_trgm_ops);

-- ─── Bookings ────────────────────────────────────────────────────────────────

CREATE TABLE bookings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ref           TEXT NOT NULL UNIQUE,       -- "SW-2024-4821"
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id    UUID NOT NULL REFERENCES services(id),
  staff_id      UUID NOT NULL REFERENCES staff(id),
  customer_id   UUID NOT NULL REFERENCES customers(id),
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'confirmed',
  channel       TEXT NOT NULL DEFAULT 'widget',
  notes         TEXT,
  no_show_risk  NUMERIC(3,2) NOT NULL DEFAULT 0.1,
  slot_score    INTEGER,                    -- optimizer score at time of booking
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bookings_status CHECK (status IN ('pending','confirmed','cancelled','completed','no_show')),
  CONSTRAINT bookings_channel CHECK (channel IN ('widget','agent','whatsapp','admin','api')),
  CONSTRAINT bookings_times   CHECK (ends_at > starts_at)
);

CREATE INDEX bookings_business_idx  ON bookings(business_id);
CREATE INDEX bookings_staff_day_idx ON bookings(staff_id, starts_at);
CREATE INDEX bookings_customer_idx  ON bookings(customer_id);
CREATE INDEX bookings_status_idx    ON bookings(business_id, status);
-- Fast slot availability queries
CREATE INDEX bookings_slot_range_idx ON bookings USING gist (
  business_id, tstzrange(starts_at, ends_at)
) WHERE status NOT IN ('cancelled');

-- ─── Waitlist ────────────────────────────────────────────────────────────────

CREATE TABLE waitlist (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id           UUID NOT NULL REFERENCES customers(id),
  service_id            UUID NOT NULL REFERENCES services(id),
  staff_id              UUID REFERENCES staff(id),
  preferred_window_start TIMESTAMPTZ,
  preferred_window_end   TIMESTAMPTZ,
  notified              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Agent sessions ───────────────────────────────────────────────────────────

CREATE TABLE agent_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL DEFAULT 'widget',
  messages        JSONB NOT NULL DEFAULT '[]',
  collected_data  JSONB NOT NULL DEFAULT '{}',
  booking_id      UUID REFERENCES bookings(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Notifications log ───────────────────────────────────────────────────────

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id  UUID REFERENCES bookings(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  type        TEXT NOT NULL,   -- confirmation | reminder | cancellation | rebook_offer
  channel     TEXT NOT NULL,   -- sms | email | whatsapp
  status      TEXT NOT NULL DEFAULT 'pending',
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER businesses_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
