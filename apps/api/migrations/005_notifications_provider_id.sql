-- Persist Twilio/Brevo message IDs for delivery debugging.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS provider_id TEXT;

CREATE INDEX IF NOT EXISTS notifications_provider_id_idx
  ON notifications (provider_id)
  WHERE provider_id IS NOT NULL;
