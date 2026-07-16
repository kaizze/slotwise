-- Add "requested" booking status (awaiting salon confirmation).

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_status
  CHECK (status IN ('pending', 'requested', 'confirmed', 'cancelled', 'completed', 'no_show'));
