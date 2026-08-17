-- =============================================================================
-- ops.config_audit — one shared history of every project-config change across
-- all five centralised services.
--
-- Design: the TRIGGER is the only writer of audit rows, so a change made
-- directly in the Supabase table editor is captured just as faithfully as one
-- made through the dashboard. The dashboard then *annotates* the row it caused
-- (matching on new_updated_at, which its PATCH returns) with the authenticated
-- operator's email and their note. Rows that never get annotated are, by
-- definition, changes made outside the dashboard — surfaced as such in the UI.
--
-- Idempotent: safe to re-run. Run once in the Supabase SQL editor.
-- =============================================================================

create schema if not exists ops;

create table if not exists ops.config_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  schema_name text not null,
  table_name text not null,
  row_id text not null,              -- project_code, or the uuid for ailytics
  project_code text,                 -- human label, present on every config table
  changes jsonb not null,            -- { column: { from: <old>, to: <new> } }
  new_updated_at timestamptz,        -- the row's updated_at after the change
  actor_email text,                  -- filled in by the dashboard; null = external
  note text,                         -- operator's "why", dashboard only
  source text not null default 'postgres'  -- 'postgres' until annotated, then 'dashboard'
);

create index if not exists config_audit_at_idx on ops.config_audit (at desc);
create index if not exists config_audit_row_idx on ops.config_audit (table_name, row_id, at desc);
-- Lookup key the dashboard uses to annotate the row its own write produced.
create index if not exists config_audit_match_idx on ops.config_audit (table_name, row_id, new_updated_at);

-- -----------------------------------------------------------------------------
-- Trigger function: record only the columns that actually changed.
-- updated_at is excluded from the diff (it changes on every write and would
-- bury the interesting columns), but is kept as new_updated_at for matching.
-- -----------------------------------------------------------------------------
create or replace function ops.record_config_change()
returns trigger
language plpgsql
security definer
set search_path = ops, pg_catalog
as $$
declare
  before_json jsonb := to_jsonb(old);
  after_json jsonb := to_jsonb(new);
  diff jsonb := '{}'::jsonb;
  k text;
  id_col text := coalesce(tg_argv[0], 'project_code');
begin
  for k in select jsonb_object_keys(after_json) loop
    if k in ('updated_at', 'created_at') then
      continue;
    end if;
    if (before_json -> k) is distinct from (after_json -> k) then
      diff := diff || jsonb_build_object(
        k, jsonb_build_object('from', before_json -> k, 'to', after_json -> k)
      );
    end if;
  end loop;

  -- Nothing meaningful changed (e.g. a no-op touch of updated_at only).
  if diff = '{}'::jsonb then
    return new;
  end if;

  insert into ops.config_audit (
    schema_name, table_name, row_id, project_code, changes, new_updated_at
  ) values (
    tg_table_schema,
    tg_table_name,
    coalesce(after_json ->> id_col, after_json ->> 'project_code'),
    after_json ->> 'project_code',
    diff,
    (after_json ->> 'updated_at')::timestamptz
  );

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Attach to every config table. The trigger argument names the identity column
-- (ailytics keys on a uuid `id`; everything else on project_code).
-- -----------------------------------------------------------------------------
drop trigger if exists config_audit_trg on "wbgts".wbgt_project_configs;
create trigger config_audit_trg after update on "wbgts".wbgt_project_configs
  for each row execute function ops.record_config_change('project_code');

drop trigger if exists config_audit_trg on "noise-meters".noise_project_configs;
create trigger config_audit_trg after update on "noise-meters".noise_project_configs
  for each row execute function ops.record_config_change('project_code');

drop trigger if exists config_audit_trg on "haze".haze_project_configs;
create trigger config_audit_trg after update on "haze".haze_project_configs
  for each row execute function ops.record_config_change('project_code');

drop trigger if exists config_audit_trg on "lightning".lightning_project_configs;
create trigger config_audit_trg after update on "lightning".lightning_project_configs
  for each row execute function ops.record_config_change('project_code');

drop trigger if exists config_audit_trg on "ailytics".project_configs;
create trigger config_audit_trg after update on "ailytics".project_configs
  for each row execute function ops.record_config_change('id');

-- -----------------------------------------------------------------------------
-- Access. The dashboard reads the history and annotates its own rows; nobody
-- may insert or delete through the API (the trigger owns inserts).
-- -----------------------------------------------------------------------------
grant usage on schema ops to service_role, anon, authenticated;
grant select, update on ops.config_audit to service_role;
grant select on ops.config_audit to anon, authenticated;

alter table ops.config_audit enable row level security;

drop policy if exists config_audit_read on ops.config_audit;
create policy config_audit_read on ops.config_audit
  for select to anon, authenticated using (true);

-- Expose the schema to PostgREST (Supabase → Settings → API → Exposed schemas),
-- or run:
--   alter role authenticator set pgrst.db_schemas = 'public,graphql_public,wbgts,noise-meters,haze,lightning,ailytics,ops';
--   notify pgrst, 'reload config';

-- Sanity check:
--   select at, table_name, row_id, actor_email, source, changes from ops.config_audit order by at desc limit 20;
