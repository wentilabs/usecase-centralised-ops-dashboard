-- =============================================================================
-- ops.config_audit — one shared history of every project-config change across
-- all seven centralised services, creations included.
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

-- Older installs predate the insert trigger and have no `action`, so this is
-- additive rather than part of the create above.
alter table ops.config_audit
  add column if not exists action text not null default 'update';

create index if not exists config_audit_at_idx on ops.config_audit (at desc);
create index if not exists config_audit_row_idx on ops.config_audit (table_name, row_id, at desc);
-- Lookup key the dashboard uses to annotate the row its own write produced.
create index if not exists config_audit_match_idx on ops.config_audit (table_name, row_id, new_updated_at);

-- -----------------------------------------------------------------------------
-- Trigger function: record only the columns that actually changed.
-- updated_at is excluded from the diff (it changes on every write and would
-- bury the interesting columns), but is kept as new_updated_at for matching.
--
-- On INSERT there is no previous row to diff against. Recording every column as
-- a change would put a twenty-line entry at the bottom of every card, burying
-- the edits above it; what a reader wants there is "this project was created".
-- So an insert writes a single `created` marker and `action = 'insert'`, and the
-- columns it was created with are the row itself.
-- -----------------------------------------------------------------------------
create or replace function ops.record_config_change()
returns trigger
language plpgsql
security definer
set search_path = ops, pg_catalog
as $$
declare
  -- `old` is NULL on insert; to_jsonb of it would be NULL and every comparison
  -- below would then be `distinct from`, which is the twenty-line diff this
  -- avoids. The insert branch returns before that can happen.
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

-- -----------------------------------------------------------------------------
-- Attach to every config table, on INSERT as well as UPDATE, so a project's
-- history starts where the project does rather than at its first edit.
--
-- The trigger argument names the identity column (ailytics keys on a uuid `id`;
-- everything else on project_code).
-- -----------------------------------------------------------------------------
drop trigger if exists config_audit_trg on "wbgts".wbgt_project_configs;
create trigger config_audit_trg after insert or update on "wbgts".wbgt_project_configs
  for each row execute function ops.record_config_change('project_code');

drop trigger if exists config_audit_trg on "noise-meters".noise_project_configs;
create trigger config_audit_trg after insert or update on "noise-meters".noise_project_configs
  for each row execute function ops.record_config_change('project_code');

drop trigger if exists config_audit_trg on "haze".haze_project_configs;
create trigger config_audit_trg after insert or update on "haze".haze_project_configs
  for each row execute function ops.record_config_change('project_code');

drop trigger if exists config_audit_trg on "lightning".lightning_project_configs;
create trigger config_audit_trg after insert or update on "lightning".lightning_project_configs
  for each row execute function ops.record_config_change('project_code');

drop trigger if exists config_audit_trg on "ailytics".project_configs;
create trigger config_audit_trg after insert or update on "ailytics".project_configs
  for each row execute function ops.record_config_change('id');

-- Subcon Activities (schema still named after the repo's original scope).
drop trigger if exists config_audit_trg on "manpower_activity".project_configs;
create trigger config_audit_trg after insert or update on "manpower_activity".project_configs
  for each row execute function ops.record_config_change('id');

-- Issue Chaser was added to the estate after this file was last written, so it
-- had no trigger at all and its cards showed no history whatsoever.
drop trigger if exists config_audit_trg on "issue_chaser".project_configs;
create trigger config_audit_trg after insert or update on "issue_chaser".project_configs
  for each row execute function ops.record_config_change('project_code');

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

-- =============================================================================
-- ops.whatsapp_group_names — chat id → human group name.
--
-- The names live in the listener project's whatsapp_listener table (~1.9M rows,
-- shared with live WhatsApp traffic), where "latest row per group" is an
-- expensive query. The dashboard resolves them on demand and stores the result
-- here, so every user reads one small shared table instead of each serverless
-- instance re-querying the message log.
-- =============================================================================

create table if not exists ops.whatsapp_group_names (
  chat_id text primary key,
  chat_name text,
  refreshed_at timestamptz not null default now()
);

create index if not exists whatsapp_group_names_refreshed_idx
  on ops.whatsapp_group_names (refreshed_at desc);

grant select, insert, update on ops.whatsapp_group_names to service_role;
grant select on ops.whatsapp_group_names to anon, authenticated;

alter table ops.whatsapp_group_names enable row level security;

drop policy if exists whatsapp_group_names_read on ops.whatsapp_group_names;
create policy whatsapp_group_names_read on ops.whatsapp_group_names
  for select to anon, authenticated using (true);

-- Inspect:
--   select chat_id, chat_name, refreshed_at from ops.whatsapp_group_names
--   order by refreshed_at desc;

-- Expose the schema to PostgREST (Supabase → Settings → API → Exposed schemas),
-- or run:
--   alter role authenticator set pgrst.db_schemas = 'public,graphql_public,wbgts,noise-meters,haze,lightning,ailytics,manpower_activity,issue_chaser,ops';
--   notify pgrst, 'reload config';

-- Sanity check:
--   select at, table_name, row_id, actor_email, source, changes from ops.config_audit order by at desc limit 20;
