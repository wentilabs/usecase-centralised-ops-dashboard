import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";

/** Service-owned semantic overlay; live introspection still owns physical columns. */
export const hazeFieldProvider: ServiceFieldProvider = {
  readonlyFields: ["project_code", "created_at", "updated_at"],
  checkEnums: {
    company: [...COMPANIES],
    nea_region: ["north", "south", "east", "west", "central"],
    poc_mentions_at_least: ["good", "moderate", "unhealthy", "very_unhealthy", "hazardous"],
  },
  fields: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    enabled: { label: "Project enabled", help: "Master switch — off means no advisory is sent." },
    nea_region: { label: "NEA region", help: "Which of the five regional 24-hour PSI readings this site follows." },
    // `four_hourly` is the column name and no longer the behaviour: ca13cbd
    // widened it to every two hours as an interim measure for periods of high
    // haze frequency. The name was left alone in the service, so the label
    // still matches the column an operator sees, and the help carries the truth.
    four_hourly: {
      label: "Four-hourly override (now every 2 hours)",
      help:
        "Guarantees a send every two hours — 08:00, 10:00, 12:00, 14:00, 16:00, 18:00 and 20:00 SGT — on top of the hourly advisory. Seven slots, not four: the column is still called `four_hourly` but was widened as an interim measure for periods of high haze frequency. Those hours ignore both the band gate below and the working-hours window, so 20:00 fires even on a site that closes at 19:00. Every other hour follows the ordinary rules. The check is on the hour, not the minute, and the cron runs at :02, so the messages land at 08:02, 10:02 and so on. The project is also left out of the once-a-day kickoff message.",
    },
    alert_only_when_at_least: {
      label: "Alert only when at least",
      help:
        "Suppress the hourly advisory unless the 24-hour PSI band reaches this level. Unset = send every hour. Still applies with the two-hourly override on — it is bypassed only at those seven hours, not for the rest of the day.",
    },
    timezone: { label: "Timezone" },

    site_address: { label: "Site address" },
    latitude: { label: "Latitude", widget: "number", row: "latlng" },
    longitude: { label: "Longitude", widget: "number", row: "latlng" },

    // The hourly job began enforcing these; before that they were stored and
    // ignored. Both have to be set — one on its own leaves the project
    // unrestricted rather than half-gated.
    working_hours_start_hhmm: {
      label: "Working hours start",
      widget: "hhmm",
      row: "hours",
      help: "Set both ends, or neither: one alone leaves the advisory running all day. A start after the end wraps past midnight.",
    },
    working_hours_end_hhmm: { label: "Working hours end", widget: "hhmm", row: "hours" },
    remove_sunday_notifications: { label: "Mute Sundays", row: "mutes" },
    remove_ph_notifications: { label: "Mute public holidays", row: "mutes" },

    wa_group_ids: { label: "WhatsApp group IDs", widget: "groups", help: "Comma-separated; one message per group." },
    instance_name: { label: "WhatsApp instance", row: "wa_identity" },
    client_id: { label: "Client ID", row: "wa_identity" },
    lambda_url: { label: "Send-message proxy URL" },
    advisory_format: {
      label: "Advisory format",
      help: "Message template. `wohhup` is the Woh Hup house wording; `default` is the generic advisory.",
    },

    enable_poc_mentions: {
      label: "POC mentions",
      help: "Tag the people below in the advisory once the PSI band is high enough.",
    },
    poc_mentions_at_least: {
      label: "Mention from band",
      help: "Lowest PSI band that triggers a mention. Unset = mention on every advisory that is sent.",
      showIf: { field: "enable_poc_mentions", equals: true },
    },
    poc_phone_numbers: {
      label: "POC phone numbers",
      widget: "csv",
      help: "Comma-separated international numbers, e.g. 6591234567. These are mentioned, not messaged directly.",
      showIf: { field: "enable_poc_mentions", equals: true },
    },
    poc_alert_wa_groups: {
      label: "POC mention groups",
      widget: "groups",
      help: "Which of the groups above may carry mentions. Comma-separated.",
      showIf: { field: "enable_poc_mentions", equals: true },
    },

    project_code: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },
  groups: [
    // Identity only, as on every other service. It used to carry the band
    // gate, the two-hourly override and the wording as well — four settings
    // that decide what this project sends, filed under the heading a reader
    // skims past looking for the company.
    { title: "Status", fields: ["enabled", "company", "timezone"] },
    // The region is derived FROM the point, so it belongs with it rather than
    // three fields away among the alerting settings.
    { title: "Site", fields: ["site_address", "latitude", "longitude", "nea_region"] },
    {
      title: "When it sends",
      fields: ["alert_only_when_at_least", "four_hourly", "advisory_format"],
    },
    { title: "Working hours & mutes", fields: ["working_hours_start_hhmm", "working_hours_end_hhmm", "remove_sunday_notifications", "remove_ph_notifications"] },
    { title: "Delivery", fields: ["wa_group_ids", "instance_name", "client_id", "lambda_url"] },
    {
      title: "POC escalation",
      fields: ["enable_poc_mentions", "poc_mentions_at_least", "poc_alert_wa_groups", "poc_phone_numbers"],
    },
  ],
};
