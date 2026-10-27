-- Additive service schedule evidence and Vibration PPV acceptance evidence.
-- Review and run using a privileged Supabase SQL session after deploying the corresponding services.

-- usecase-haze-alerts
-- Service-owned bounded completion evidence; applies independently of job data.
create table if not exists haze.service_schedule_heartbeats (
  route text not null, method text not null, last_finished_at timestamptz not null,
  primary key (method, route)
);
alter table haze.service_schedule_heartbeats enable row level security;
revoke all on haze.service_schedule_heartbeats from anon, authenticated;
grant select on haze.service_schedule_heartbeats to service_role;

create or replace function haze.record_service_schedule_completion(p_route text, p_method text)
returns void language plpgsql security definer set search_path = pg_catalog, haze as $$
begin
  if p_route is null or length(p_route) > 200 or left(p_route, 1) <> '/' or p_method not in ('GET', 'POST') then
    raise exception 'Invalid schedule route';
  end if;
  insert into haze.service_schedule_heartbeats as existing (route, method, last_finished_at)
  values (p_route, p_method, clock_timestamp())
  on conflict (method, route) do update
    set last_finished_at = greatest(existing.last_finished_at, excluded.last_finished_at);
end;
$$;
revoke all on function haze.record_service_schedule_completion(text, text) from public, anon, authenticated;
grant execute on function haze.record_service_schedule_completion(text, text) to service_role;


-- usecase-lightning-alerts
-- Service-owned bounded completion evidence; applies independently of job data.
create table if not exists lightning.service_schedule_heartbeats (
  route text not null, method text not null, last_finished_at timestamptz not null,
  primary key (method, route)
);
alter table lightning.service_schedule_heartbeats enable row level security;
revoke all on lightning.service_schedule_heartbeats from anon, authenticated;
grant select on lightning.service_schedule_heartbeats to service_role;

create or replace function lightning.record_service_schedule_completion(p_route text, p_method text)
returns void language plpgsql security definer set search_path = pg_catalog, lightning as $$
begin
  if p_route is null or length(p_route) > 200 or left(p_route, 1) <> '/' or p_method not in ('GET', 'POST') then
    raise exception 'Invalid schedule route';
  end if;
  insert into lightning.service_schedule_heartbeats as existing (route, method, last_finished_at)
  values (p_route, p_method, clock_timestamp())
  on conflict (method, route) do update
    set last_finished_at = greatest(existing.last_finished_at, excluded.last_finished_at);
end;
$$;
revoke all on function lightning.record_service_schedule_completion(text, text) from public, anon, authenticated;
grant execute on function lightning.record_service_schedule_completion(text, text) to service_role;


-- usecase-wohhup-wbgt-alerts
-- Service-owned bounded completion evidence; applies independently of job data.
create table if not exists wbgts.service_schedule_heartbeats (
  route text not null, method text not null, last_finished_at timestamptz not null,
  primary key (method, route)
);
alter table wbgts.service_schedule_heartbeats enable row level security;
revoke all on wbgts.service_schedule_heartbeats from anon, authenticated;
grant select on wbgts.service_schedule_heartbeats to service_role;

create or replace function wbgts.record_service_schedule_completion(p_route text, p_method text)
returns void language plpgsql security definer set search_path = pg_catalog, wbgts as $$
begin
  if p_route is null or length(p_route) > 200 or left(p_route, 1) <> '/' or p_method not in ('GET', 'POST') then
    raise exception 'Invalid schedule route';
  end if;
  insert into wbgts.service_schedule_heartbeats as existing (route, method, last_finished_at)
  values (p_route, p_method, clock_timestamp())
  on conflict (method, route) do update
    set last_finished_at = greatest(existing.last_finished_at, excluded.last_finished_at);
end;
$$;
revoke all on function wbgts.record_service_schedule_completion(text, text) from public, anon, authenticated;
grant execute on function wbgts.record_service_schedule_completion(text, text) to service_role;


-- usecase-wohhup-vibration
-- Service-owned bounded completion evidence; applies independently of job data.
create table if not exists vibration.service_schedule_heartbeats (
  route text not null, method text not null, last_finished_at timestamptz not null,
  primary key (method, route)
);
alter table vibration.service_schedule_heartbeats enable row level security;
revoke all on vibration.service_schedule_heartbeats from anon, authenticated;
grant select on vibration.service_schedule_heartbeats to service_role;

create or replace function vibration.record_service_schedule_completion(p_route text, p_method text)
returns void language plpgsql security definer set search_path = pg_catalog, vibration as $$
begin
  if p_route is null or length(p_route) > 200 or left(p_route, 1) <> '/' or p_method not in ('GET', 'POST') then
    raise exception 'Invalid schedule route';
  end if;
  insert into vibration.service_schedule_heartbeats as existing (route, method, last_finished_at)
  values (p_route, p_method, clock_timestamp())
  on conflict (method, route) do update
    set last_finished_at = greatest(existing.last_finished_at, excluded.last_finished_at);
end;
$$;
revoke all on function vibration.record_service_schedule_completion(text, text) from public, anon, authenticated;
grant execute on function vibration.record_service_schedule_completion(text, text) to service_role;


-- mdw-lambda-ailytics
-- Service-owned bounded completion evidence; applies independently of job data.
create table if not exists ailytics.service_schedule_heartbeats (
  route text not null, method text not null, last_finished_at timestamptz not null,
  primary key (method, route)
);
alter table ailytics.service_schedule_heartbeats enable row level security;
revoke all on ailytics.service_schedule_heartbeats from anon, authenticated;
grant select on ailytics.service_schedule_heartbeats to service_role;

create or replace function ailytics.record_service_schedule_completion(p_route text, p_method text)
returns void language plpgsql security definer set search_path = pg_catalog, ailytics as $$
begin
  if p_route is null or length(p_route) > 200 or left(p_route, 1) <> '/' or p_method not in ('GET', 'POST') then
    raise exception 'Invalid schedule route';
  end if;
  insert into ailytics.service_schedule_heartbeats as existing (route, method, last_finished_at)
  values (p_route, p_method, clock_timestamp())
  on conflict (method, route) do update
    set last_finished_at = greatest(existing.last_finished_at, excluded.last_finished_at);
end;
$$;
revoke all on function ailytics.record_service_schedule_completion(text, text) from public, anon, authenticated;
grant execute on function ailytics.record_service_schedule_completion(text, text) to service_role;


-- usecase-issue-chaser
-- Service-owned bounded completion evidence; applies independently of job data.
create table if not exists issue_chaser.service_schedule_heartbeats (
  route text not null, method text not null, last_finished_at timestamptz not null,
  primary key (method, route)
);
alter table issue_chaser.service_schedule_heartbeats enable row level security;
revoke all on issue_chaser.service_schedule_heartbeats from anon, authenticated;
grant select on issue_chaser.service_schedule_heartbeats to service_role;

create or replace function issue_chaser.record_service_schedule_completion(p_route text, p_method text)
returns void language plpgsql security definer set search_path = pg_catalog, issue_chaser as $$
begin
  if p_route is null or length(p_route) > 200 or left(p_route, 1) <> '/' or p_method not in ('GET', 'POST') then
    raise exception 'Invalid schedule route';
  end if;
  insert into issue_chaser.service_schedule_heartbeats as existing (route, method, last_finished_at)
  values (p_route, p_method, clock_timestamp())
  on conflict (method, route) do update
    set last_finished_at = greatest(existing.last_finished_at, excluded.last_finished_at);
end;
$$;
revoke all on function issue_chaser.record_service_schedule_completion(text, text) from public, anon, authenticated;
grant execute on function issue_chaser.record_service_schedule_completion(text, text) to service_role;


-- Vibration PPV acceptance evidence
-- Apply after migrate_ppv_alert_delivery.sql. Existing rows remain unknown.
alter table vibration.vibration_alert_deliveries
  add column if not exists health_deliveries jsonb;

-- Atomically finish the claimed alert and retain sanitized acceptance evidence.
-- The old finish_ppv_alert remains available during a rolling deployment.
create or replace function vibration.finish_ppv_alert_with_evidence(
  p_id bigint, p_sent boolean, p_error text, p_evidence jsonb
) returns void language plpgsql security definer
set search_path = pg_catalog, vibration as $$
begin
  if p_evidence is not null and jsonb_typeof(p_evidence) <> 'array' then
    raise exception 'PPV delivery evidence must be an array';
  end if;
  update vibration.vibration_alert_deliveries
  set status = case when p_sent then 'sent' else 'failed' end,
      completed_at = now(),
      last_error = case when p_sent then null else left(p_error, 500) end,
      health_deliveries = p_evidence
  where id = p_id and status = 'claimed';
  if not found then raise exception 'PPV alert % is not claimed', p_id; end if;
end;
$$;

revoke all on function vibration.finish_ppv_alert_with_evidence(bigint, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function vibration.finish_ppv_alert_with_evidence(bigint, boolean, text, jsonb) to service_role;


-- usecase-wohhup-noise-meter-alerts/supabase/migrate_service_health_events.sql
-- Additive Data Health anomaly evidence owned by noise-meters.
-- Apply before deploying the writer. Only service-role clients may read or insert.
create table if not exists "noise-meters".service_health_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('handler_failure', 'run_failure', 'delivery_failure')),
  route text,
  project_code text,
  reason text not null check (length(reason) between 1 and 500),
  occurred_at timestamptz not null default now()
);
create index if not exists service_health_events_occurred_at_idx
  on "noise-meters".service_health_events (occurred_at desc);
alter table "noise-meters".service_health_events enable row level security;
revoke all on "noise-meters".service_health_events from anon, authenticated;
grant select, insert on "noise-meters".service_health_events to service_role;


-- usecase-wohhup-noise-meter-alerts/supabase/migrate_schedule_heartbeats.sql
-- One bounded row per Noise scheduled route. This proves a handler returned,
-- including invocations that correctly had no project work.
create table if not exists "noise-meters".noise_schedule_heartbeats (
  route text primary key check (length(route) between 1 and 150),
  last_seen_at timestamptz not null
);
alter table "noise-meters".noise_schedule_heartbeats enable row level security;
revoke all on "noise-meters".noise_schedule_heartbeats from anon, authenticated;
grant select, insert, update on "noise-meters".noise_schedule_heartbeats to service_role;


-- usecase-subcon-manpower-activities/supabase/migrations/20261027_service_health_events.sql
-- Additive Data Health anomaly evidence owned by manpower_activity.
-- Apply before deploying the writer. Only service-role clients may read or insert.
create table if not exists "manpower_activity".service_health_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('handler_failure', 'run_failure', 'delivery_failure')),
  route text,
  project_code text,
  reason text not null check (length(reason) between 1 and 500),
  occurred_at timestamptz not null default now()
);
create index if not exists service_health_events_occurred_at_idx
  on "manpower_activity".service_health_events (occurred_at desc);
alter table "manpower_activity".service_health_events enable row level security;
revoke all on "manpower_activity".service_health_events from anon, authenticated;
grant select, insert on "manpower_activity".service_health_events to service_role;


-- usecase-subcon-manpower-activities/supabase/migrations/20261027_schedule_heartbeats.sql
-- One bounded completion watermark per externally scheduled Subcon rule.
create table if not exists manpower_activity.subcon_schedule_heartbeats (
  schedule_key text primary key check (length(schedule_key) between 1 and 100),
  route text not null check (length(route) between 1 and 150),
  last_seen_at timestamptz not null,
  last_started_at timestamptz not null
);
alter table manpower_activity.subcon_schedule_heartbeats enable row level security;
revoke all on manpower_activity.subcon_schedule_heartbeats from anon, authenticated;
grant select, insert, update on manpower_activity.subcon_schedule_heartbeats to service_role;

