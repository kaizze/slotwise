#!/usr/bin/env bash
# Set every staff member's working_hours endTime for a business.
#
# Why: defaults used to be 18:00 while test fills / salon days often stop at
# 17:00, which left a phantom "2 free slots" (17:00, 17:30) after a "full" day.
#
# Usage (from repo root on the server):
#
#   ./apps/api/scripts/set-staff-end-time.sh salon-eleni 17:00
#   ./apps/api/scripts/set-staff-end-time.sh salon-eleni 18:00
#
set -euo pipefail

BUSINESS_SLUG="${1:-salon-eleni}"
END_TIME="${2:-17:00}"

if [[ ! "$END_TIME" =~ ^[0-2][0-9]:[0-5][0-9]$ ]]; then
  echo "Invalid end time '$END_TIME' (expected HH:MM)" >&2
  exit 1
fi

cd "$(dirname "$0")/../../.."

docker compose exec -T postgres psql -U slotwise -d slotwise <<SQL
\set ON_ERROR_STOP on

DO \$\$
DECLARE
  v_slug        text := '${BUSINESS_SLUG}';
  v_end         text := '${END_TIME}';
  v_business_id uuid;
  v_updated     int := 0;
BEGIN
  SELECT id INTO v_business_id FROM businesses WHERE slug = v_slug;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Business not found for slug=%', v_slug;
  END IF;

  UPDATE staff s
  SET working_hours = COALESCE((
    SELECT jsonb_agg(
      CASE
        WHEN elem ? 'endTime' THEN jsonb_set(elem, '{endTime}', to_jsonb(v_end))
        ELSE elem
      END
      ORDER BY ordinality
    )
    FROM jsonb_array_elements(COALESCE(s.working_hours, '[]'::jsonb))
      WITH ORDINALITY AS t(elem, ordinality)
  ), '[]'::jsonb),
      updated_at = now()
  WHERE s.business_id = v_business_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Updated endTime=% for % staff row(s) on business %',
    v_end, v_updated, v_slug;
END \$\$;

SELECT
  s.name,
  wh->>'dayOfWeek' AS dow,
  wh->>'startTime' AS start_time,
  wh->>'endTime' AS end_time
FROM staff s
JOIN businesses b ON b.id = s.business_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.working_hours, '[]'::jsonb)) AS wh
WHERE b.slug = '${BUSINESS_SLUG}'
  AND s.is_active = TRUE
ORDER BY s.name, (wh->>'dayOfWeek')::int;
SQL
