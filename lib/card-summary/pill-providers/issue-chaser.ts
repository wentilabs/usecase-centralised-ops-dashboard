import type { ProjectConfigRow } from "../../services";
import type { Pill } from "../pill-types";
import { splitList } from "../groups";

/** Service-owned capability pills for the project card. */
export function issueChaserPills(config: ProjectConfigRow): Pill[] {
  const on = (value: unknown) => Boolean(value);
  return [
    // A style cannot be on unless `enabled` is, so an unlit style on an
    // enabled project means nobody switched it on.
    { label: "severity cadence", on: on(config.severity_cadence_chaser_enabled) },
    { label: "same-day snapshot", on: on(config.same_day_open_snapshot_enabled) },
    // "P1 escalation" was dropped here with the column: the digest is
    // retired in the service, so an unlit pill for it only sent people
    // looking for a switch that no longer exists.
    // Reports rather than chasers, and blue for it — the same reasoning as
    // the WBGT Water Parade pills: tone separates "a different kind of
    // thing" from "another switch in the same row".
    ...(config.daily_safety_summary_enabled
      ? [{ label: "daily summary", on: true, tone: "info" as const }]
      : []),
    ...(config.daily_safety_company_summary_enabled
      ? [{ label: "summary by company", on: true, tone: "info" as const }]
      : []),
    { label: "reply in origin group", on: config.send_to_originating_groups !== false },
    // Shown only when set: an unlit "0 excluded" pill on every project would
    // be noise, and this is the exception rather than a setting most have.
    ...(splitList(config.exclude_whatsapp_group_ids).length
      ? [{
          label: `snapshot skips ${splitList(config.exclude_whatsapp_group_ids).length}`,
          on: true,
          tone: "info" as const,
        }]
      : []),
    // The only thing in this service that writes to the workbook, so it is
    // worth seeing from the card rather than only in the editor.
    ...(config.novade_name_sync_enabled
      ? [{ label: "✎ writes Novade names", on: true, tone: "warn" as const }]
      : []),
    ...(config.novade_name_list_check_enabled
      ? [{ label: "weekly name reminder", on: true, tone: "info" as const }]
      : []),
    // Not gated by `enabled` the way the styles are, so these two can be lit
    // on a project that is otherwise switched off — which is correct: they
    // describe the calendar, not the cadence.
    { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
    { label: "mute PH", on: on(config.remove_ph_notifications) },
    // "origin required", "images" and "PIC mentions" were dropped here when
    // their columns were retired from the service (412256d). Each is now
    // unconditional behaviour, and a pill for a setting that no longer exists
    // is worse than no pill: it invites someone to go looking for a switch.
  ];
}
