-- Customer account auth for the booking widget.
-- Guests keep booking as today (no password). Registered customers get a
-- password_hash so they can sign in and pre-fill contact details.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Speeds up login-by-email within a business for registered accounts only.
CREATE INDEX IF NOT EXISTS idx_customers_business_email_registered
  ON customers (business_id, lower(email))
  WHERE password_hash IS NOT NULL AND email IS NOT NULL;
