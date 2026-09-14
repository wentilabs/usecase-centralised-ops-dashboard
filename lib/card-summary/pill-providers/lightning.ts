import type { ProjectConfigRow } from "../../services";
import type { Pill } from "../pill-types";


/** Service-owned capability pills for the project card. */
export function lightningPills(config: ProjectConfigRow): Pill[] {
  const on = (value: unknown) => Boolean(value);
  return [
    { label: `red ${config.red_radius_m ?? "?"}m`, on: on(config.red_radius_m) },
    {
      label: config.amber_enabled === false ? "amber off" : `amber ${config.amber_radius_m ?? "?"}m`,
      on: config.amber_enabled !== false && on(config.amber_radius_m),
    },
    { label: `v${config.config_version ?? 1}`, on: true },
    { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
    { label: "mute PH", on: on(config.remove_ph_notifications) },
    { label: "🔴 POC mentions", on: on(config.enable_red_band_poc_mentions) },
  ];
}
