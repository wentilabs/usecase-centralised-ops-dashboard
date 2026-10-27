-- Optional one-shot rollout bundle in the shared config Supabase project.
-- The authoritative per-schema migrations and migration plans live in each
-- service repository. This bundle applies the same additive DDL in one pass.
-- Each service owns its own schema and table; HALO reads them as a bridge.
-- The older ops.service_handler_failures table remains readable during rollout.
do $$
declare service_schema text;
begin
  foreach service_schema in array array[
    'wbgts', 'noise-meters', 'haze', 'lightning', 'ailytics',
    'manpower_activity', 'issue_chaser', 'vibration'
  ] loop
    execute format($sql$
      create table if not exists %I.service_health_events (
        id uuid primary key default gen_random_uuid(),
        event_type text not null check (event_type in ('handler_failure', 'run_failure', 'delivery_failure')),
        route text,
        project_code text,
        reason text not null check (length(reason) between 1 and 500),
        occurred_at timestamptz not null default now()
      )
    $sql$, service_schema);
    execute format('create index if not exists service_health_events_occurred_at_idx on %I.service_health_events (occurred_at desc)', service_schema);
    execute format('alter table %I.service_health_events enable row level security', service_schema);
    execute format('revoke all on %I.service_health_events from anon, authenticated', service_schema);
    execute format('grant select, insert on %I.service_health_events to service_role', service_schema);
  end loop;
end $$;

-- Arrange routine deletion of rows older than 30 days in database operations.
