import type { ProjectConfigRow } from "../../services";
import type { Pill } from "../pill-types";
import { splitList } from "../groups";

/**
 * The Water Parade daily summary hour, as a clock time.
 *
 * The column is NOT NULL with a default of 18, but a row read before that
 * migration ran still arrives undefined — so the fallback is the database's own
 * default rather than a blank, which would read as "no summary time set" when
 * the service would in fact send at 18:00.
 */
function summaryHour(config: ProjectConfigRow): string {
  const raw = Number(config.water_parade_daily_summary_hour ?? 18);
  const hour = Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : 18;
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Whether WBGT POC mentions are resolved from the Manpower sheet sentinel. */
export function usesManpowerSheetPocs(config: ProjectConfigRow): boolean {
  return String(config.poc_phone_numbers ?? "").trim().toLowerCase() === "manpower-sheet";
}
/** Service-owned capability pills for the project card. */
export function wbgtPills(config: ProjectConfigRow): Pill[] {
  const on = (value: unknown) => Boolean(value);
  return [
    ...(config.water_parade_enabled
      ? [
          { label: "💧 Water Parade", on: true, tone: "info" as const },
          // Only shown where Water Parade runs: on a project without it the
          // flag is inert, and a struck-through pill on 20 cards would be
          // noise. Lit or unlit here is a real difference in how often a
          // site is asked.
          // Blue, like 💧 Water Parade above it: tone marks the feature
          // these pills belong to, and all three are Water Parade only.
          { label: "cooldown 2h", on: on(config.water_parade_cooldown_enabled), tone: "info" as const },
          // Unlit is the point here, as with cooldown: a site asked all day
          // but never told which companies missed is a real difference, and
          // the hour is what someone checks before asking why it was quiet.
          {
            label: `daily summary ${summaryHour(config)}`,
            on: on(config.water_parade_daily_summary_enabled),
            tone: "info" as const,
          },
        ]
      : []),
    // A second id used to be a corrupted send and carried a warning here.
    // It is an ordinary second recipient now, so it is reported as a count
    // rather than a problem.
    ...(splitList(config.water_parade_outbound_group_id).length > 1
      ? [{
          label: `${splitList(config.water_parade_outbound_group_id).length} reminder groups`,
          on: true,
          tone: "info" as const,
        }]
      : []),
    { label: "hourly", on: on(config.enable_hourly) },
    { label: "intermittent", on: on(config.enable_intermittent_reports) },
    { label: "5-min alerts", on: on(config.enable_5min_alerts) },
    // Only when it is not the default. A pill saying "min orange" on every
    // card would be noise — the whole point is to spot the two projects
    // that differ. Blue for the same reason as `cooldown 2h`: it modifies a
    // feature rather than switching one on.
    ...(config.enable_5min_alerts &&
    ["yellow", "red"].includes(String(config.five_min_alert_threshold ?? "").trim().toLowerCase())
      ? [
          {
            label: `min ${String(config.five_min_alert_threshold).toLowerCase()} ${
              String(config.five_min_alert_threshold).toLowerCase() === "yellow" ? "31" : "33"
            }°C`,
            on: true,
            tone: "info" as const,
          },
        ]
      : []),
    { label: "scrape", on: config.enable_scrape !== false },
    { label: "skip lunch", on: on(config.skip_lunch_hour) },
    { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
    { label: "mute PH", on: on(config.remove_ph_notifications) },
    // Where the numbers come from matters: the sentinel resolves them from
    // the Manpower sheet each day, so an empty list is not a misconfiguration.
    ...(usesManpowerSheetPocs(config)
      ? [{ label: "🔴 POC from sheet", on: true, tone: "info" as const }]
      : [{ label: "POC mentions", on: on(config.enable_red_band_poc_mentions) }]),
    // Only where the Manpower tab is actually read — Water Parade, or POC
    // numbers resolved from the sheet. Elsewhere the flag is inert and a
    // pill on every card would say nothing. Lit is the default (Woh Hup
    // filtered out as the main contractor); struck means a project counts
    // it as a participant, which today is MBS alone.
    ...(config.water_parade_enabled || usesManpowerSheetPocs(config)
      ? [
          {
            label: "excl. Woh Hup",
            on: config.exclude_wohhup_from_manpower !== false,
            tone: "info" as const,
          },
        ]
      : []),
  ];
}
