-- =============================================================================
-- ops.projects — HALO's human-approved registry of physical sites.
--
-- This table is deliberately NOT a service configuration table. The seven
-- service-owned rows remain the source of runtime configuration and behaviour.
-- It is an additive HALO-only record that stores canonical identity, aliases,
-- and the small set of common resources an operator explicitly approves.
--
-- Prerequisite: run supabase/config_audit_setup.sql first. Its audit function
-- records registry inserts and updates alongside service configuration changes.
-- =============================================================================

create schema if not exists ops;

do $$
begin
  if to_regprocedure('ops.record_config_change()') is null then
    raise exception 'Run supabase/config_audit_setup.sql before create_canonical_projects.sql.';
  end if;
end;
$$;

create table if not exists ops.projects (
  id uuid primary key default gen_random_uuid(),
  primary_alias text not null unique,
  alternate_aliases text[] not null default '{}',
  -- { "wbgt": "CFC", "noise": "Clifford Centre", ... }. Kept here rather
  -- than in a join table so the first registry stays one comprehensible record.
  service_aliases jsonb not null default '{}'::jsonb check (jsonb_typeof(service_aliases) = 'object'),

  company text,
  site_name text,
  site_address text,
  latitude double precision,
  longitude double precision,

  safety_workbook_id text,
  manpower_workbook_id text,
  noise_workbook_id text,
  wbgt_workbook_id text,
  send_message_url text,
  reply_message_url text,
  send_document_url text,
  whatsapp_instance_name text,
  whatsapp_client_id text,
  timezone text,
  public_holiday_region text,
  general_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);

create index if not exists projects_primary_alias_lower_idx on ops.projects (lower(primary_alias));

create or replace function ops.touch_projects_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ops, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at_trg on ops.projects;
create trigger projects_touch_updated_at_trg
  before update on ops.projects
  for each row execute function ops.touch_projects_updated_at();

drop trigger if exists projects_audit_trg on ops.projects;
create trigger projects_audit_trg
  after insert or update on ops.projects
  for each row execute function ops.record_config_change('id');

grant select, insert, update on ops.projects to service_role;

alter table ops.projects enable row level security;

-- HALO uses the server-only service-role key. Browser roles get no direct table
-- access; page and API authorization remain the single public boundary.
drop policy if exists projects_service_role_only on ops.projects;
