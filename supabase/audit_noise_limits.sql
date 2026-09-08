-- History for noise limits — hand edits AND what the refresh changes.
--
-- APPLIED 8 Sep 2026. Verified live on the TEST fixture: a value change wrote one
-- entry carrying its from/to, and an `imported_at`-only touch — what a refresh
-- does to a row it re-confirmed — wrote nothing. Re-running is harmless.
--
-- Both are wanted. A hand edit is somebody's decision; a refresh that moves a
-- limit is the vendor changing what a site is assessed against, which is the
-- evidence you need when a reading is disputed months later. Neither is
-- recoverable from anywhere else: NoiseLynx shows the current grid and no
-- history, and the refresh overwrites in place.
--
-- Apply AFTER supabase/config_audit_setup.sql, which creates ops.config_audit
-- and ops.record_config_change(). Idempotent; safe to re-run, in either order.
--
-- -----------------------------------------------------------------------------
-- What stops this being noise
-- -----------------------------------------------------------------------------
--
-- Not a filter on who wrote the row — the whole point is to catch both. It is
-- the empty-diff guard that already exists in `record_config_change`, plus one
-- column added to its skip list.
--
-- The refresh upserts nearly every row it scrapes whether or not anything moved:
-- of 4,896 rows today, 4,512 carry the same `imported_at` from a single run on
-- 2026-09-06. If `imported_at` counted as a change, every one of those would
-- write an audit entry saying nothing. Skipping it means the diff is empty for a
-- row the refresh re-confirmed, and the guard drops it before the insert.
--
-- So volume tracks REAL changes, not runs. A fortnight where NoiseLynx changed
-- nothing writes nothing. The worst case is a mass reconfiguration writing one
-- entry per hour-row it touched — up to 48 for a meter, and once a fortnight at
-- the observed cadence. That is a spike worth having rather than spam.
--
-- Not captured: DELETEs. A meter renamed on NoiseLynx has its old rows deleted
-- and re-inserted under the new identifier, so the history shows the arrival and
-- not the departure. Adding a delete branch to the shared function is the fix if
-- that ever matters.
-- -----------------------------------------------------------------------------

-- 1. Stop `imported_at` being recorded as a change.
--
--    Identical to the function in config_audit_setup.sql, which carries the same
--    skip list — so the two agree and the ORDER the files are applied in does not
--    matter. Re-running either one later cannot undo the other.
create or replace function ops.record_config_change()
returns trigger
language plpgsql
security definer
set search_path = ops, pg_catalog
as $$
declare
  before_json jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  after_json jsonb := to_jsonb(new);
  diff jsonb := '{}'::jsonb;
  k text;
  id_col text := coalesce(tg_argv[0], 'project_code');
begin
  if tg_op = 'INSERT' then
    insert into ops.config_audit (
      schema_name, table_name, row_id, project_code, changes, new_updated_at, action
    ) values (
      tg_table_schema,
      tg_table_name,
      coalesce(after_json ->> id_col, after_json ->> 'project_code'),
      after_json ->> 'project_code',
      jsonb_build_object('created', jsonb_build_object('to', after_json ->> 'project_code')),
      (after_json ->> 'updated_at')::timestamptz,
      'insert'
    );
    return new;
  end if;

  for k in select jsonb_object_keys(after_json) loop
    if k in (
      'updated_at', 'created_at',
      -- Job state, written by the service as it runs.
      'top_of_hour_band', 'last_5min_alert_level', 'last_5min_alert_at',
      -- Written by the limits refresh on every row it merges, including the
      -- protected rows whose values it deliberately left unchanged.
      'imported_at'
    ) then
      continue;
    end if;
    if (before_json -> k) is distinct from (after_json -> k) then
      diff := diff || jsonb_build_object(
        k, jsonb_build_object('from', before_json -> k, 'to', after_json -> k)
      );
    end if;
  end loop;

  if diff = '{}'::jsonb then
    return new;
  end if;

  insert into ops.config_audit (
    schema_name, table_name, row_id, project_code, changes, new_updated_at, action
  ) values (
    tg_table_schema,
    tg_table_name,
    coalesce(after_json ->> id_col, after_json ->> 'project_code'),
    after_json ->> 'project_code',
    diff,
    (after_json ->> 'updated_at')::timestamptz,
    'update'
  );

  return new;
end;
$$;

-- 2. Record every row, from whichever writer.
--
--    No WHEN clause. An earlier draft recorded only rows carrying the
--    manual-source-of-truth marker, which would have thrown away exactly the
--    evidence this is for: what the vendor changed, and when.
--
--    `row_id` is the meter rather than the bigserial `id`, so a meter's history
--    reads as one story instead of 48 unrelated row ids. `source_file` travels
--    in the diff when it moves, so an entry says whether the row became
--    protected as part of the same change.
--
--    `new_updated_at` is null on these entries — noise_limits has no
--    `updated_at`. That column is only used by HALO's annotate step, which does
--    not run for limits, so it costs nothing here.
drop trigger if exists config_audit_trg on "noise-meters".noise_limits;
create trigger config_audit_trg
  after insert or update on "noise-meters".noise_limits
  for each row
  execute function ops.record_config_change('full_identifier');

-- The two WHEN-scoped triggers from the earlier draft, removed if they were run.
drop trigger if exists config_audit_ins_trg on "noise-meters".noise_limits;
drop trigger if exists config_audit_upd_trg on "noise-meters".noise_limits;

-- -----------------------------------------------------------------------------
-- Check it did what it should. A save writes one entry per hour-row it changed;
-- a refresh that re-confirmed the same values writes nothing at all.
-- -----------------------------------------------------------------------------
-- select at, row_id, project_code, changes
-- from ops.config_audit
-- where table_name = 'noise_limits'
-- order by at desc
-- limit 20;
