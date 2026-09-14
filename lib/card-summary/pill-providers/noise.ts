import type { ProjectConfigRow } from "../../services";
import type { Pill } from "../pill-types";
import { describeSelection, includesEveryMeter } from "../../meter-selection";

/** Service-owned capability pills for the project card. */
export function noisePills(config: ProjectConfigRow): Pill[] {
  const on = (value: unknown) => Boolean(value);
  return [
    { label: "5-min", on: on(config.enable_5min) },
    { label: "half-hourly", on: on(config.enable_half_hourly) },
    { label: "hourly", on: on(config.enable_hourly) },
    { label: "3-hr summary", on: on(config.enable_three_hour_summary) },
    { label: "morning summary", on: on(config.enable_morning_summary) },
    { label: "evening summary", on: on(config.enable_evening_summary) },
    { label: "Sunday Leq12h", on: on(config.enable_sunday_leq12h_hourly) },
    { label: "Leq12hr table", on: on(config.enable_7am_7pm_leq12hr_table) },
    { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
    { label: "mute PH", on: on(config.remove_ph_notifications) },
    { label: "expiry alerts", on: on(config.allow_expiry_alert) },
    // Shown only when set. It is opt-in and off nearly everywhere, so a
    // struck-through pill would take a slot on every card to say nothing —
    // the same reasoning as the meter filter below. Info-toned because it
    // is a routing choice, not a cadence.
    ...(config.half_hourly_send_if_exceed
      ? [{ label: "warning relay", on: true, tone: "info" as const }]
      : []),
    // Only when a filter is actually set. Blank is the norm on every
    // project, so a pill saying so would be noise on 30 cards; a filter is
    // the notable state, and it is a caution rather than a feature being on.
    ...(includesEveryMeter(config.noise_meters_included)
      ? []
      : [
          {
            label: describeSelection(config.noise_meters_included, null),
            on: true,
            tone: "warn" as const,
          },
        ]),
  ];
}
