import { describeSelection, includesEveryMeter } from "../meter-selection";
import type { ProjectConfigRow, ServiceKey } from "../services";
import { splitList } from "./groups";
import { subconReports } from "./schedule";

/**
 * `on` means the switch is on; an off pill renders struck through.
 *
 * A `tone` marks a pill that is neither of those:
 * - `warn` — active, but worth noticing rather than celebrating (a meter filter).
 * - `info` — a capability the project has, called out so it is not lost among
 *   the cadence switches.
 *
 * Toned pills are rendered before the rest, and survive the mobile cap.
 */
export type Pill = { label: string; on: boolean; tone?: "warn" | "info" };

/** The at-a-glance switches for a project, per service. */
/**
 * Whether POC mentions are resolved from the Manpower sheet rather than a list.
 *
 * `poc_phone_numbers` accepts either digits or the single exact value
 * `manpower-sheet`. Mixing them is not a partial success: the service returns NO
 * numbers, so nobody is mentioned and nothing errors. Detected here so the card
 * can distinguish "reads the sheet daily" from "someone left this blank".
 */
export function usesManpowerSheetPocs(config: ProjectConfigRow): boolean {
  return String(config.poc_phone_numbers ?? "").trim().toLowerCase() === "manpower-sheet";
}
export function pillsFor(service: ServiceKey, config: ProjectConfigRow): Pill[] {
  const on = (value: unknown) => Boolean(value);
  switch (service) {
    case "wbgt":
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
    case "noise":
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
    case "haze":
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
    case "lightning":
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
    case "subcon":
      return [
        // Named for the feature, not the route: since 5df3928 this one switch
        // also stops the nightly report, the HOUSEKEEPING sheet and the photo
        // refresh, so a pill reading "intake" understates what turning it off
        // does.
        { label: "housekeeping", on: config.enable_housekeeping === true },
        // One pill per report rather than a single "morning report". They read
        // different tabs and answer different questions, and a project can end
        // up with one and not the other once the columns exist.
        {
          label: "activity + manpower",
          on: subconReports(config).includes("activity + manpower"),
        },
        {
          label: "manpower + machines",
          on: subconReports(config).includes("manpower + machines"),
        },
        { label: "manpower workbook", on: on(config.spreadsheet_id) },
        // Same wording as WBGT's pill and a different filter behind it: this one
        // shapes the housekeeping roster and the manpower summary. Info-toned
        // because it is a scoping choice, not a cadence, and shown always rather
        // than only when off — a roster that silently includes or excludes the
        // main contractor changes every headcount on the report.
        {
          label: "excl. Woh Hup",
          on: config.exclude_wohhup_from_manpower !== false,
          tone: "info" as const,
        },
        {
          // What it answers: does anything reach this project, and does the
          // nightly housekeeping report have anywhere to go? Since 140b1e9 one
          // list answers both, so "message source" understated it — an empty
          // list now means no intake AND no housekeeping report.
          //
          // Lit by the group list alone. Project routing is group-based; the
          // listener middleware owns any client-level gating upstream, and a
          // project with no groups is not routed.
          label: "housekeeping in/out",
          on: on(config.safety_group_ids),
        },
        // Last, and after the intake pill deliberately: they silence the three
        // outbound reports and leave intake running, so they belong at the end
        // of the row rather than next to the switch they do not affect.
        { label: "mute Sundays", on: on(config.remove_sunday_notifications) },
        { label: "mute PH", on: on(config.remove_ph_notifications) },
      ];
    case "issueChaser":
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
    default:
      // Ailytics. Three pills were dropped as noise rather than signal:
      // `telegram source`, `sheet` and `whatsapp relay` were on for every
      // project, because a row without a Telegram chat, a spreadsheet or a
      // group is not a working project at all — they reported the setup being
      // complete, which is the normal case, instead of a choice someone made.
      // What is left is the two switches that actually differ between projects.
      return [
        // Outbound-only switch: PENDING alerts are stored and written to history
        // either way, so "off" does not mean nothing is happening.
        { label: "forward PENDING", on: on(config.forward_pending_to_whatsapp) },
        // The project-local Pending/open count that
        // POST /ailytics-safety/status-summary sends to whatsapp_group_ids.
        // Defaults to false and differs per project, which is what earns it a
        // pill: 2 of the 4 projects have it on.
        { label: "daily summary", on: on(config.status_summary_enabled) },
      ];
  }
}
