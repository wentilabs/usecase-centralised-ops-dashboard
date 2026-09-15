import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";

/** Service-owned semantic overlay; live introspection still owns physical columns. */
export const lightningFieldProvider: ServiceFieldProvider = {
  readonlyFields: ["project_code", "created_at", "updated_at"],
  checkEnums: {
    company: [...COMPANIES],
    red_detection_types: ["G", "C"],
    amber_detection_types: ["G", "C"],
  },
  fields: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    enabled: { label: "Project enabled", help: "Master switch — off means no lightning alert is sent." },
    timezone: { label: "Timezone" },
    config_version: {
      label: "Config version",
      widget: "number",
      help: "Bump this in the same save as every policy change. No trigger increments it; leaving it unchanged makes later evidence claim an old policy meaning (INV-LTG-16).",
    },

    site_address: { label: "Site address" },
    latitude: { label: "Latitude", widget: "number", row: "latlng" },
    longitude: { label: "Longitude", widget: "number", row: "latlng" },
    site_extent_radius_m: { label: "Site extent radius (m)", widget: "number", help: "Added to strike radii to cover the site footprint." },

    red_radius_m: { label: "🔴 Red radius (m)", widget: "number", row: "red" },
    red_dwell_seconds: { label: "🔴 Red dwell (s)", widget: "number", row: "red", help: "How long the alert state persists after the last qualifying strike." },
    red_detection_types: {
      label: "🔴 Red strike types",
      widget: "multi",
      help: "G = cloud-to-ground, C = intra-cloud.",
    },

    amber_enabled: {
      label: "Amber alerts enabled",
      help: "Off = red-only site: amber detections are not evaluated, amber thresholds are ignored, and STOP clears directly to SAFE without an intermediate WATCH (INV-LTG-13).",
    },
    amber_radius_m: {
      label: "🟠 Amber radius (m)",
      widget: "number",
      row: "amber",
      showIf: { field: "amber_enabled", equals: true },
    },
    amber_dwell_seconds: {
      label: "🟠 Amber dwell (s)",
      widget: "number",
      row: "amber",
      help: "How long amber persists after the last qualifying strike, and how long notifications are debounced.",
      showIf: { field: "amber_enabled", equals: true },
    },
    amber_detection_types: {
      label: "🟠 Amber strike types",
      widget: "multi",
      help: "G = cloud-to-ground, C = intra-cloud.",
      showIf: { field: "amber_enabled", equals: true },
    },

    ground_uncertainty_m: { label: "Ground strike uncertainty (m)", widget: "number", row: "uncert" },
    cloud_uncertainty_m: { label: "Cloud strike uncertainty (m)", widget: "number", row: "uncert" },
    feed_stale_after_seconds: { label: "Feed stale after (s)", widget: "number", row: "feed" },
    max_consecutive_fetch_failures: { label: "Max fetch failures", widget: "number", row: "feed" },

    working_hours_start_hhmm: { label: "Working hours start", widget: "hhmm", row: "hours" },
    working_hours_end_hhmm: { label: "Working hours end", widget: "hhmm", row: "hours" },
    remove_sunday_notifications: { label: "Mute Sundays", row: "mutes" },
    remove_ph_notifications: { label: "Mute public holidays", row: "mutes" },
    enable_sms_lightning_alerts: {
      label: "Forward SMS lightning alerts",
      help: "Controls signed SMS Gateway thunderstorm alerts only. SMS is still parsed and retained when off; this does not affect normal NEA lightning alerts or the project enabled switch (INV-LTG-23).",
      row: "sms",
    },
    sms_whatsapp_group_id: {
      label: "SMS destination",
      widget: "groups",
      // Shown whether or not forwarding is on, like every other destination:
      // where a thing goes is decided before it is switched on.
      help: "Where forwarded SMS alerts go. Blank falls back to the WhatsApp group IDs above. It is SMS-only in both directions — normal NEA alerts, kickoffs and every other message always use the main list and never this one, so a group here receives SMS traffic and nothing else.",
    },

    whatsapp_group_id: { label: "WhatsApp group IDs", widget: "groups", help: "Comma-separated; one message per group." },
    instance_name: { label: "WhatsApp instance", row: "wa_identity" },
    client_id: { label: "Client ID", row: "wa_identity" },
    lambda_url: { label: "Send-message proxy URL" },

    enable_red_band_poc_mentions: {
      label: "🔴 Red POC mentions",
      // Postgres rejects the save outright if either list is blank, so say so
      // rather than letting the editor surface a raw constraint error.
      help: "RED alerts only. Postgres requires BOTH lists below to be non-empty before this can be turned on — fill them in the same save.",
    },
    poc_phone_numbers: {
      label: "POC phone numbers",
      widget: "csv",
      help: "Comma-separated international numbers, e.g. 6591234567. Required when red mentions are on.",
      showIf: { field: "enable_red_band_poc_mentions", equals: true },
    },
    poc_alert_wa_groups: {
      label: "POC mention groups",
      widget: "groups",
      help: "Which of the groups above may carry RED mentions. Required when red mentions are on.",
      showIf: { field: "enable_red_band_poc_mentions", equals: true },
    },

    // Retired. Kept as an explicit `hidden` entry rather than deleted, because
    // an unlisted column falls through to the "Other" group — so it would keep
    // showing in the editor until supabase/drop_policy_note.sql is actually run.
    // Safe to delete this line once the column is gone.
    policy_note: { hidden: true },

    project_code: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },
  groups: [
    { title: "Status", fields: ["enabled", "company", "timezone", "config_version"] },
    { title: "Site", fields: ["site_address", "latitude", "longitude", "site_extent_radius_m"] },
    { title: "🔴 Red threshold", fields: ["red_radius_m", "red_dwell_seconds", "red_detection_types"] },
    {
      title: "🟠 Amber threshold",
      fields: ["amber_enabled", "amber_radius_m", "amber_dwell_seconds", "amber_detection_types"],
    },
    { title: "Detection tuning", fields: ["ground_uncertainty_m", "cloud_uncertainty_m", "feed_stale_after_seconds", "max_consecutive_fetch_failures"] },
    {
      title: "Working hours & mutes",
      fields: [
        "working_hours_start_hhmm",
        "working_hours_end_hhmm",
        "remove_sunday_notifications",
        "remove_ph_notifications",
      ],
    },
    { title: "Delivery", fields: ["whatsapp_group_id", "instance_name", "client_id", "lambda_url"] },
    { title: "SMS Gateway", fields: ["enable_sms_lightning_alerts", "sms_whatsapp_group_id"] },
    {
      title: "POC escalation",
      fields: ["enable_red_band_poc_mentions", "poc_alert_wa_groups", "poc_phone_numbers"],
    },
  ],
};
