import type { ProjectConfigRow } from "../../services";
import type { Pill } from "../pill-types";


/** Service-owned capability pills for the project card. */
export function hazePills(config: ProjectConfigRow): Pill[] {
  const on = (value: unknown) => Boolean(value);
  return [
    { label: String(config.nea_region ?? "no region"), on: on(config.nea_region) },
    // No cadence pill. Every haze project runs hourly — there is no second
    // cadence to distinguish it from — so a pill reading "hourly" would be
    // true of all 25 and tell a reader nothing. It said "4-hourly" vs
    // "hourly" while `four_hourly` meant "only at those four hours"; it now
    // means an override on top of the hourly run (INV-HAZE-01).
    //
    // Labelled 2-hourly because that is what it does since ca13cbd. The
    // column kept its old name, but a pill is read at a glance and "4" for
    // seven sends is simply wrong; the editor's help explains the mismatch.
    {
      label: "🕓 2-hourly override",
      on: on(config.four_hourly),
    },
    // The floor still governs every other hour, so it is reported as stored
    // whether or not the override is on. Saying "every band" here was right
    // when four-hourly was the whole cadence and is wrong now: it would
    // claim the 09:00 and 10:00 sends ignore the gate too.
    {
      label: config.alert_only_when_at_least
        ? `≥ ${String(config.alert_only_when_at_least).replace(/_/g, " ")}`
        : "every band",
      on: on(config.alert_only_when_at_least),
    },
    { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
    { label: "mute PH", on: on(config.remove_ph_notifications) },
    { label: "POC mentions", on: on(config.enable_poc_mentions) },
    { label: `${String(config.advisory_format ?? "default")} format`, on: config.advisory_format === "wohhup" },
  ];
}
