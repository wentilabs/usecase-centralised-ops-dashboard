-- Apply once against the shared Supabase project before exposing the HALO field.
alter table wbgts.wbgt_project_configs
  add column if not exists data_health_message_template text;

alter table "noise-meters".noise_project_configs
  add column if not exists data_health_message_template text;
