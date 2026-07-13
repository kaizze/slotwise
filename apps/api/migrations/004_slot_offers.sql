-- Slot offers: track rebook/waitlist offers that customers can accept.
-- Prevents double-booking the same freed slot and enables YES/token acceptance.

CREATE TABLE slot_offers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id),
  offer_type      TEXT NOT NULL,  -- rebook | waitlist
  booking_id      UUID REFERENCES bookings(id),   -- set for rebook offers
  waitlist_id     UUID REFERENCES waitlist(id),   -- set for waitlist offers
  service_id      UUID NOT NULL REFERENCES services(id),
  staff_id        UUID NOT NULL REFERENCES staff(id),
  slot_starts_at  TIMESTAMPTZ NOT NULL,
  slot_ends_at    TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | expired | cancelled
  offer_token     TEXT NOT NULL UNIQUE,
  incentive       TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX slot_offers_pending_customer_idx
  ON slot_offers (customer_id, status)
  WHERE status = 'pending';

CREATE INDEX slot_offers_token_idx ON slot_offers (offer_token);

CREATE INDEX slot_offers_slot_pending_idx
  ON slot_offers (business_id, staff_id, slot_starts_at)
  WHERE status = 'pending';
