-- Shared service-owned error evidence for HALO. Apply in the config Supabase project.
-- Service-role clients write; HALO's server reads. Do not grant browser roles.
create table if not exists ops.service_handler_failures (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  route text,
  reason text not null check (length(reason) between 1 and 500),
  occurred_at timestamptz not null default now()
);

create index if not exists service_handler_failures_recent_idx
  on ops.service_handler_failures (occurred_at desc);

alter table ops.service_handler_failures enable row level security;
revoke all on ops.service_handler_failures from anon, authenticated;
grant select, insert on ops.service_handler_failures to service_role;

-- Retain 30 days; install the scheduled delete in the database's operations
-- workflow if pg_cron is available. No automatic deletion is implied by this DDL.
