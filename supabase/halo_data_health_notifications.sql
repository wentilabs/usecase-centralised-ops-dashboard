-- Apply as the owner of the ops schema. A unique event key is an atomic delivery claim.
create table if not exists ops.data_health_notifications (
  event_key text primary key,
  outcome text not null check (outcome in ('claimed', 'queued', 'sent', 'unconfirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists data_health_notifications_created_at_idx
  on ops.data_health_notifications (created_at desc);

grant select, insert, update on ops.data_health_notifications to service_role;
