-- History for hand-edited noise limits. OPTIONAL, and not yet run.
--
-- [WRITE NOISE LIMITS] shipped without this: the editor works, and edits made
-- before this runs simply have no history. Run it whenever SQL access allows.
-- Nothing in HALO changes when it does — the trigger is the only writer of audit
-- rows, exactly as it is for the seven project_configs tables, and the card
-- history reads whatever is there.
--
-- Apply AFTER supabase/config_audit_setup.sql, which creates ops.config_audit
-- and ops.record_config_change().
--
-- -----------------------------------------------------------------------------
-- Why this is not simply the same trigger as the other seven
-- -----------------------------------------------------------------------------
--
-- `noise_limits` is not a config table an operator edits a few times a month. It
-- holds ~4,900 rows and the NoiseLynx refresh upserts almost all of them on every
-- run. A blanket `after insert or update` trigger would write thousands of audit
-- rows per refresh and bury the handful a person actually made — the same failure
-- that made WBGT's job-state columns 1187 of the first 1730 rows in that table.
--
-- Two things keep it proportionate:
--
-- 1. A WHEN clause, so only rows carrying the manual-source-of-truth marker are
--    recorded. A row that follows NoiseLynx is the vendor's data and its history
--    is that page, not this table. An edit that ADDS the marker is caught by the
--    `new` half; one that somehow removed it by the `old` half.
--
-- 2. `imported_at` joins the skipped columns below. The refresh stamps it on
--    every row it merges, INCLUDING protected rows whose values it left alone —
--    so without this, every refresh would write an audit entry per protected row
--    saying nothing but "imported_at moved". The existing empty-diff guard then
--    drops those runs entirely.
-- -----------------------------------------------------------------------------

-- 1. Stop `imported_at` being recorded as a change. Additive and idempotent:
--    re-running config_audit_setup.sql afterwards would revert it, so this file
--    has to be applied last, or the same column added to the list there.
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

-- 2. Record only rows that are, or are becoming, a manual source of truth.
--    `row_id` is the meter rather than the bigserial `id`, so a card's history
--    reads as one meter's story instead of 48 unrelated row ids.
--    Two triggers rather than one `insert or update`: Postgres refuses a WHEN
--    clause that references OLD on an INSERT trigger, and the update case needs
--    OLD so that removing the marker is still recorded.
--
--    `new_updated_at` will be null on these entries — noise_limits has no
--    `updated_at` column. That is only used by HALO's annotate step, which does
--    not run for limits, so it costs nothing here.
drop trigger if exists config_audit_ins_trg on "noise-meters".noise_limits;
create trigger config_audit_ins_trg
  after insert on "noise-meters".noise_limits
  for each row
  when (coalesce(new.source_file, '') ilike '%manual source of truth%')
  execute function ops.record_config_change('full_identifier');

drop trigger if exists config_audit_upd_trg on "noise-meters".noise_limits;
create trigger config_audit_upd_trg
  after update on "noise-meters".noise_limits
  for each row
  when (
    coalesce(new.source_file, '') ilike '%manual source of truth%'
    or coalesce(old.source_file, '') ilike '%manual source of truth%'
  )
  execute function ops.record_config_change('full_identifier');

-- An older single-trigger attempt, removed if it is there.
drop trigger if exists config_audit_trg on "noise-meters".noise_limits;

-- -----------------------------------------------------------------------------
-- Check it did what it should: a protected save writes ONE entry per row it
-- changed, and a limits refresh writes none.
-- -----------------------------------------------------------------------------
-- select at, row_id, project_code, changes
-- from ops.config_audit
-- where table_name = 'noise_limits'
-- order by at desc
-- limit 20;
