-- Optional enhancement for HALO WBGT sensor-label editing.
-- Basic label saves work against the existing table. Apply after
-- config_audit_setup.sql to add versioned audit attribution and the atomic
-- rename function that preserves any MBS sensor-to-group mapping.

alter table "wbgts".wbgt_sensors
  add column if not exists updated_at timestamptz not null default now();

create or replace function "wbgts".touch_wbgt_sensor_updated_at()
returns trigger
language plpgsql
set search_path = "wbgts", pg_catalog
as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

drop trigger if exists wbgt_sensors_touch_updated_at_trg on "wbgts".wbgt_sensors;
create trigger wbgt_sensors_touch_updated_at_trg
  before update on "wbgts".wbgt_sensors
  for each row execute function "wbgts".touch_wbgt_sensor_updated_at();

do $$
begin
  if to_regprocedure('ops.record_config_change()') is null then
    raise exception 'Run supabase/config_audit_setup.sql before wbgt_sensor_label_editor.sql.';
  end if;
end;
$$;

drop trigger if exists config_audit_trg on "wbgts".wbgt_sensors;
create trigger config_audit_trg after update on "wbgts".wbgt_sensors
  for each row execute function ops.record_config_change('id');

create or replace function ops.rename_wbgt_sensor_label(
  p_sensor_id bigint,
  p_project_code text,
  p_sensor_label text,
  p_base_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ops, "wbgts", pg_catalog
as $$
declare
  sensor_row "wbgts".wbgt_sensors%rowtype;
  config_row "wbgts".wbgt_project_configs%rowtype;
  groups jsonb;
  config_changed boolean := false;
begin
  select * into sensor_row
    from "wbgts".wbgt_sensors
   where id = p_sensor_id
     and project_code = p_project_code
     and active is true
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if sensor_row.updated_at is distinct from p_base_updated_at then
    return jsonb_build_object('status', 'conflict', 'sensor', to_jsonb(sensor_row));
  end if;

  if sensor_row.sensor_label = p_sensor_label then
    return jsonb_build_object('status', 'unchanged', 'sensor', to_jsonb(sensor_row));
  end if;

  select * into config_row
    from "wbgts".wbgt_project_configs
   where project_code = p_project_code
   for update;

  if found then
    groups := coalesce(config_row.sensor_delivery_groups, '{}'::jsonb);
    if groups ? sensor_row.sensor_label then
      if groups ? p_sensor_label then
        return jsonb_build_object('status', 'mapping_conflict');
      end if;
      update "wbgts".wbgt_project_configs
         set sensor_delivery_groups = (groups - sensor_row.sensor_label) ||
               jsonb_build_object(p_sensor_label, groups -> sensor_row.sensor_label),
             updated_at = greatest(clock_timestamp(), config_row.updated_at + interval '1 microsecond')
       where project_code = p_project_code
       returning * into config_row;
      config_changed := true;
    end if;
  end if;

  update "wbgts".wbgt_sensors
     set sensor_label = p_sensor_label
   where id = p_sensor_id
   returning * into sensor_row;

  return jsonb_build_object(
    'status', 'updated',
    'sensor', to_jsonb(sensor_row),
    'config', case when config_changed then to_jsonb(config_row) else 'null'::jsonb end,
    'config_updated_at', case when config_changed then to_jsonb(config_row.updated_at) else 'null'::jsonb end
  );
end;
$$;

revoke all on function ops.rename_wbgt_sensor_label(bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function ops.rename_wbgt_sensor_label(bigint, text, text, timestamptz) to service_role;
