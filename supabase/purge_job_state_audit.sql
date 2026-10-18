-- =============================================================================
-- Purge the job-state rows that were recorded before the trigger skipped them.
--
-- config_audit_setup.sql stopped RECORDING `top_of_hour_band`,
-- `last_5min_alert_level`, `last_5min_alert_at` and `imported_at`, and HALO's
-- History strips them on read — so nothing new accumulates and nothing shows.
-- What remains is the backlog written before that: 1498 of 3307 rows when this
-- was written, every one WBGT, the newest from 2026-09-08.
--
-- They are not harmless. listAudit fetches at most 1000 rows before filtering,
-- so on a table-wide history the backlog crowds real edits out of the window:
-- 135 of the 244 genuine WBGT edits sat beyond the newest 1000 WBGT rows.
--
-- A row is deleted only if ALL of these hold, so a human edit can never go:
--   * every column in `changes` is job state (none is configuration), and
--   * no operator annotated it (actor_email is null), and
--   * it carries no note.
-- A row mixing job state with a real change is not touched.
--
-- Keep the column list in step with JOB_STATE_COLUMNS in lib/job-state-policy.ts
-- and the skip list in config_audit_setup.sql; tests/job-state-policy.test.ts
-- fails when they drift.
--
-- Run in the Supabase SQL editor. Step 1 is read-only; step 2 deletes.
-- Idempotent: a second run deletes nothing.
-- =============================================================================

-- Step 1 — preview. Expect `purgeable` to match what you intend to remove, and
-- `kept_with_real_changes` to be every row that is not purgeable.
select
  count(*) filter (where purgeable)     as purgeable,
  count(*) filter (where not purgeable) as kept_with_real_changes,
  min(at) filter (where purgeable)      as oldest_purgeable,
  max(at) filter (where purgeable)      as newest_purgeable
from (
  select
    at,
    jsonb_typeof(changes) = 'object'
      and changes <> '{}'::jsonb
      and actor_email is null
      and note is null
      and not exists (
        select 1 from jsonb_object_keys(changes) as k
        where k not in ('top_of_hour_band', 'last_5min_alert_level', 'last_5min_alert_at', 'imported_at')
      ) as purgeable
  from ops.config_audit
) classified;

-- Step 2 — delete. Returns how many rows went.
with gone as (
  delete from ops.config_audit
  where jsonb_typeof(changes) = 'object'
    and changes <> '{}'::jsonb
    and actor_email is null
    and note is null
    and not exists (
      select 1 from jsonb_object_keys(changes) as k
      where k not in ('top_of_hour_band', 'last_5min_alert_level', 'last_5min_alert_at', 'imported_at')
    )
  returning 1
)
select count(*) as deleted from gone;
