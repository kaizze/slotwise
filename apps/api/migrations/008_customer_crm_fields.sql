-- CRM fields on customers: notes, preferences, favourite staff.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS preferences TEXT,
  ADD COLUMN IF NOT EXISTS favourite_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS customers_business_name_idx
  ON customers (business_id, lower(name));
