create schema if not exists data_health;

create table if not exists data_health.project_health_configs (
  id uuid primary key default gen_random_uuid(),
  canonical_project_id uuid not null references ops.projects(id),
  source_service text not null check (source_service in ('wbgt','noise','haze','lightning','ailytics','subcon','issueChaser')),
  project_code text not null,
  enabled boolean not null default false,
  data_checks text[] not null default array['staleness','volume_trend'],
  delivery_checks text[] not null default array['expected_attempt','provider_acceptance'],
  sensitivity text not null default 'standard' check (sensitivity in ('relaxed','standard','strict')),
  recipient_group_ids text[] not null default '{}',
  notification_cooldown_minutes integer not null default 360 check (notification_cooldown_minutes >= 0),
  notify_on_recovery boolean not null default true,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_project_id, source_service)
);

create table if not exists data_health.probe_observations (
  id uuid primary key default gen_random_uuid(), policy_id uuid not null references data_health.project_health_configs(id),
  health_dimension text not null check (health_dimension in ('data','delivery')), outcome text not null,
  evaluated_at timestamptz not null default now(), reason jsonb not null default '{}'
);
create index if not exists probe_observations_latest_idx on data_health.probe_observations (policy_id, evaluated_at desc);
create table if not exists data_health.incidents (id uuid primary key default gen_random_uuid(), policy_id uuid not null references data_health.project_health_configs(id), condition_key text not null, severity text not null, opened_at timestamptz not null default now(), resolved_at timestamptz, unique (policy_id, condition_key, resolved_at));
create table if not exists data_health.notification_deliveries (id uuid primary key default gen_random_uuid(), incident_id uuid not null references data_health.incidents(id), recipient_chat_id text not null, message_kind text not null, attempted_at timestamptz not null default now(), outcome text not null);

drop trigger if exists config_audit_trg on data_health.project_health_configs;
create trigger config_audit_trg after insert or update on data_health.project_health_configs
  for each row execute function ops.record_config_change('id');

revoke all on all tables in schema data_health from anon, authenticated;
grant usage on schema data_health to service_role;
grant select, insert, update on data_health.project_health_configs to service_role;
grant select, insert on data_health.probe_observations, data_health.incidents, data_health.notification_deliveries to service_role;
