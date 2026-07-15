-- Track email deliverability so bounced/complained addresses stop receiving mail.
-- email_status: valid | invalid | complained

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'valid',
  ADD COLUMN IF NOT EXISTS email_status_reason TEXT,
  ADD COLUMN IF NOT EXISTS email_status_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_email_status_check'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_email_status_check
      CHECK (email_status IN ('valid', 'invalid', 'complained'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS customers_email_lookup_idx
  ON customers (business_id, lower(email))
  WHERE email IS NOT NULL;
