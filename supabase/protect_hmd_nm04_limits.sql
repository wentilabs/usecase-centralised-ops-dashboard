-- Exempt HMD NM04 from the NoiseLynx limits refresh (INV-NOISE-16).
--
-- ALREADY APPLIED on 2026-09-07, through PostgREST rather than psql, because
-- the operator had no SQL access at the time. Kept as the worked example for the
-- next meter that needs it. Re-running is harmless: it writes the same value.
--
-- `mergeLimitRows` keeps a row's leq_5min / leq_1hr / leq_12hr, instead of
-- taking the scraped ones, when the stored `source_file` contains the substring
-- "manual source of truth". That string is the whole mechanism; the rest of the
-- value is free text and is the only record of where the numbers came from.
--
-- All 48 rows, because protection is decided per row: marking one day type
-- leaves the other refreshed, which is the state TRI NM01 is in today.
--
-- No values change here. NM04's stored limits already match its DeviceAdmin
-- page, so this is a no-op until something on that page changes — which is the
-- point of running it now rather than after.
update "noise-meters".noise_limits
set source_file = 'Manual source of truth - HMD NM04 Blk 831 Hougang Central RT permissible levels 2026-09-07'
where project_code = 'HMD'
  and full_identifier = 'HMD NM04 Blk 831 Hougang Central RT'
  and active is true;

-- Expect 48. Anything else means the identifier has drifted — check before
-- assuming the meter is protected.
select count(*) as protected_rows,
       count(distinct day_type_normalized) as day_types
from "noise-meters".noise_limits
where project_code = 'HMD'
  and full_identifier = 'HMD NM04 Blk 831 Hougang Central RT'
  and active is true
  and lower(source_file) like '%manual source of truth%';
