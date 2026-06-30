-- Adds fields needed for a real dispatch queue:
-- payload (message content), scheduled_for (delayed sends), retry tracking, error logging.

ALTER TABLE notifications
  ADD COLUMN payload      JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN attempts     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN last_error   TEXT;

-- status now includes: pending | processing | sent | failed | cancelled
-- (no CHECK constraint added — keeping it flexible during early development)

-- Fast lookup for the queue worker: find due, unprocessed notifications
CREATE INDEX notifications_due_idx ON notifications (scheduled_for)
  WHERE status = 'pending';

CREATE INDEX notifications_business_idx ON notifications (business_id, created_at DESC);
