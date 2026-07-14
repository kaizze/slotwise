#!/usr/bin/env bash
# Fill one day with confirmed bookings for consolidation / offer testing.
#
# Usage (from repo root on the server):
#
#   ./apps/api/scripts/fill-test-day.sh                 # tomorrow, salon-eleni
#   ./apps/api/scripts/fill-test-day.sh 2026-07-15      # specific date
#   ./apps/api/scripts/fill-test-day.sh tomorrow salon-eleni
#
# Creates bookings for ONE staff member (09:00–17:00 local), rotating these emails:
#   m1lonasdm@gmail.com, dm@cloduevo.ai, dimitris@tidesofweb.com
# Random Greek names + sequential fake phones (0100000000, 0100000001, ...).
# Skips already-booked slots.

set -euo pipefail

DAY="${1:-tomorrow}"
BUSINESS_SLUG="${2:-salon-eleni}"

cd "$(dirname "$0")/../../.."

docker compose exec -T postgres psql -U slotwise -d slotwise <<SQL
\set ON_ERROR_STOP on

DO \$\$
DECLARE
  v_day_raw          text := '${DAY}';
  v_slug             text := '${BUSINESS_SLUG}';
  v_business_id      uuid;
  v_tz               text;
  v_staff_id         uuid;
  v_staff_name       text;
  v_service_id       uuid;
  v_service_name     text;
  v_duration         int;
  v_day_local        date;
  v_slot             timestamptz;
  v_day_end          timestamptz;
  v_customer_id      uuid;
  v_name             text;
  v_phone            text;
  v_email            text;
  v_ref              text;
  v_created          int := 0;
  v_skipped          int := 0;
  v_emails           text[] := ARRAY[
    'm1lonasdm@gmail.com',
    'dm@cloduevo.ai',
    'dimitris@tidesofweb.com'
  ];
  v_first_names text[] := ARRAY[
    'Maria','Eleni','Nikos','Kostas','Sofia','Giorgos','Anna','Dimitris',
    'Christina','Panos','Katerina','Andreas','Vasiliki','Yannis','Ioanna','Petros'
  ];
  v_last_names text[] := ARRAY[
    'Papadaki','Nikolaou','Georgiou','Antoniou','Vasileiou','Christou',
    'Ioannou','Alexiou','Dimitriou','Konstantinou','Markou','Petrou'
  ];
  i int := 0;
BEGIN
  SELECT id, timezone INTO v_business_id, v_tz
  FROM businesses WHERE slug = v_slug;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Business not found for slug=%', v_slug;
  END IF;

  IF lower(v_day_raw) = 'tomorrow' THEN
    v_day_local := (timezone(v_tz, now()))::date + 1;
  ELSIF lower(v_day_raw) = 'today' THEN
    v_day_local := (timezone(v_tz, now()))::date;
  ELSE
    v_day_local := v_day_raw::date;
  END IF;

  SELECT s.id, s.name INTO v_staff_id, v_staff_name
  FROM staff s
  WHERE s.business_id = v_business_id AND s.is_active = TRUE
  ORDER BY s.name
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'No active staff for business %', v_slug;
  END IF;

  SELECT sv.id, sv.name, sv.duration_minutes
  INTO v_service_id, v_service_name, v_duration
  FROM services sv
  WHERE sv.business_id = v_business_id
    AND sv.is_active = TRUE
    AND sv.id = ANY (
      SELECT unnest(service_ids) FROM staff WHERE id = v_staff_id
    )
  ORDER BY
    CASE WHEN sv.duration_minutes = 30 THEN 0 ELSE 1 END,
    sv.duration_minutes,
    sv.name
  LIMIT 1;

  IF v_service_id IS NULL THEN
    SELECT id, name, duration_minutes
    INTO v_service_id, v_service_name, v_duration
    FROM services
    WHERE business_id = v_business_id AND is_active = TRUE
    ORDER BY duration_minutes, name
    LIMIT 1;
  END IF;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'No active services for business %', v_slug;
  END IF;

  v_slot    := (v_day_local::text || ' 09:00')::timestamp AT TIME ZONE v_tz;
  v_day_end := (v_day_local::text || ' 17:00')::timestamp AT TIME ZONE v_tz;

  RAISE NOTICE 'Filling % (%) with staff=% service=% (% min)',
    v_day_local, v_tz, v_staff_name, v_service_name, v_duration;

  WHILE v_slot + (v_duration || ' minutes')::interval <= v_day_end LOOP
    IF v_slot < now() THEN
      v_skipped := v_skipped + 1;
      v_slot := v_slot + (v_duration || ' minutes')::interval;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM bookings
      WHERE staff_id = v_staff_id
        AND status = 'confirmed'
        AND tstzrange(starts_at, ends_at) && tstzrange(v_slot, v_slot + (v_duration || ' minutes')::interval)
    ) THEN
      v_skipped := v_skipped + 1;
      v_slot := v_slot + (v_duration || ' minutes')::interval;
      CONTINUE;
    END IF;

    i := i + 1;
    v_name  := v_first_names[1 + floor(random() * array_length(v_first_names, 1))::int]
            || ' '
            || v_last_names[1 + floor(random() * array_length(v_last_names, 1))::int];
    -- Fake sequential phones — not real Greek mobiles (69… / 68…)
    v_phone := '010' || lpad(i::text, 7, '0');
    v_email := v_emails[1 + ((i - 1) % array_length(v_emails, 1))];

    INSERT INTO customers (id, business_id, name, phone, email, total_bookings)
    VALUES (uuid_generate_v4(), v_business_id, v_name, v_phone, v_email, 1)
    ON CONFLICT (business_id, phone) DO UPDATE
      SET email = EXCLUDED.email, name = EXCLUDED.name
    RETURNING id INTO v_customer_id;

    IF v_customer_id IS NULL THEN
      SELECT id INTO v_customer_id
      FROM customers WHERE business_id = v_business_id AND phone = v_phone;
    END IF;

    LOOP
      v_ref := 'SW-' || extract(year from now())::int || '-' ||
               lpad((10000 + floor(random() * 89999))::int::text, 5, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM bookings WHERE ref = v_ref);
    END LOOP;

    INSERT INTO bookings
      (id, ref, business_id, service_id, staff_id, customer_id,
       starts_at, ends_at, status, channel, notes, no_show_risk)
    VALUES
      (uuid_generate_v4(), v_ref, v_business_id, v_service_id, v_staff_id, v_customer_id,
       v_slot, v_slot + (v_duration || ' minutes')::interval,
       'confirmed', 'admin', 'test fill-day', 0.15);

    v_created := v_created + 1;
    v_slot := v_slot + (v_duration || ' minutes')::interval;
  END LOOP;

  RAISE NOTICE 'Done. created=% skipped=% staff=% day=%',
    v_created, v_skipped, v_staff_name, v_day_local;
END \$\$;

SELECT
  b.ref,
  c.name,
  c.phone,
  c.email,
  to_char(timezone(biz.timezone, b.starts_at), 'HH24:MI') AS local_time,
  st.name AS staff
FROM bookings b
JOIN customers c ON c.id = b.customer_id
JOIN staff st ON st.id = b.staff_id
JOIN businesses biz ON biz.id = b.business_id
WHERE biz.slug = '${BUSINESS_SLUG}'
  AND b.notes = 'test fill-day'
  AND b.status = 'confirmed'
  AND timezone(biz.timezone, b.starts_at)::date = CASE
    WHEN lower('${DAY}') = 'tomorrow' THEN (timezone(biz.timezone, now()))::date + 1
    WHEN lower('${DAY}') = 'today' THEN (timezone(biz.timezone, now()))::date
    ELSE '${DAY}'::date
  END
ORDER BY b.starts_at;
SQL
