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
    {
      // Amber too since `5932bce`. The column is still named for red only, and
      // a card that kept saying so would understate how often POCs are tagged.
      label: "🔴🟠 POC mentions",
      on: on(config.enable_red_band_poc_mentions),
    },
    {
      // WHO gets tagged, which is a different question from whether anyone is.
      // A fixed list and "whoever is on site today" behave very differently on
      // a Monday, and only this value tells them apart.
      label: "POCs from manpower sheet",
      on:
        on(config.enable_red_band_poc_mentions) &&
        String(config.poc_phone_numbers ?? "").trim() === "manpower-sheet",
    },
    {
      // Only the declared format understands the gateway's All-Clear message,
      // so a project without it is one that never hears the alert lift.
      label: "TRI SMS format",
      on: String(config.sms_lightning_format ?? "").trim() === "TRI-style",
    },
  ];
}
