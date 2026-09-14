import type { ProjectConfigRow } from "../../services";
import type { Pill } from "../pill-types";
import { subconReports } from "../schedule";

/** Service-owned capability pills for the project card. */
export function subconPills(config: ProjectConfigRow): Pill[] {
  const on = (value: unknown) => Boolean(value);
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
}
