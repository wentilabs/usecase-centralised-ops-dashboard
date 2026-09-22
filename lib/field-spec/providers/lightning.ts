import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";

/** Service-owned semantic overlay; live introspection still owns physical columns. */
export const lightningFieldProvider: ServiceFieldProvider = {
  readonlyFields: ["project_code", "created_at", "updated_at"],
  checkEnums: {
    company: [...COMPANIES],
    red_detection_types: ["G", "C"],
    amber_detection_types: ["G", "C"],
    // lightning_sms_lightning_format_check: null, or this one value. The
    // select renders "— not set —" as null, which is the legacy behaviour.
    sms_lightning_format: ["TRI-style"],
  },
  fields: {
    company: {
      label: "Company",
      help: "Labelling only — nothing reads it. Blank means it could not be worked out when the project was set up.",
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
    red_dwell_seconds: {
      label: "🔴 Red dwell (s)",
      widget: "number",
      row: "red",
      // Since INV-LTG-08 this is the all-clear clearance window as well, and
      // it does not honour the strike types below: a project set to G only
      // still cannot go green while a C strike sits inside the red ring.
      help: "How long the alert state persists after the last qualifying strike — and how long BOTH ground and cloud strikes must stay outside the red ring before an all-clear is allowed, whatever the strike types below say.",
    },
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
    sms_lightning_format: {
      label: "SMS source format",
      help: "Leave unset for the legacy alert-only forwarding. TRI-style also recognises that gateway's All-Clear message, so the site is told when the alert lifts rather than left waiting.",
      row: "sms",
    },
    sms_whatsapp_group_id: {
      label: "SMS destination",
      widget: "groups",
      // Shown whether or not forwarding is on, like every other destination:
      // where a thing goes is decided before it is switched on.
      help: "Where forwarded SMS alerts go. Blank falls back to the WhatsApp group IDs above. SMS-only in both directions: normal NEA alerts, kickoffs and everything else always use the main list and never this one.",
    },

    whatsapp_group_id: { label: "WhatsApp group IDs", widget: "groups", help: "Comma-separated; one message per group." },
    instance_name: { label: "WhatsApp instance", row: "wa_identity" },
    client_id: { label: "Client ID", row: "wa_identity" },
    lambda_url: { label: "Send-message proxy URL" },

    enable_red_band_poc_mentions: {
      // Red-only when the column was named; it has since taken amber and then
      // the signed SMS alerts. The name is not worth a migration to change.
      label: "⚠️ Warning POC mentions",
      // Postgres rejects the save outright if either list is blank, so say so
      // rather than letting the editor surface a raw constraint error.
      help: "Tags the POCs on every warning: AMBER, RED/STOP, and signed thunderstorm SMS alerts. Postgres requires the mention groups and a phone source below to be non-empty before this can be turned on — fill them in the same save.",
    },
    enable_green_band_poc_mentions: {
      label: "✅ All-clear POC mentions",
      /**
       * Hidden until the warning switch is on, because it now does nothing
       * without it.
       *
       * `shouldMentionPocs` used to read the two flags independently, so
       * warnings-off with green-on was reachable and would mention people on
       * the all-clear and never on the stop that preceded it. `40db522` in the
       * lightning repo made the warning flag the master switch and left green
       * to narrow it, so hiding this one is now the UI agreeing with the
       * service rather than second-guessing it.
       *
       * It defaults to TRUE in Postgres, the opposite of every other flag
       * here, so it is ON for a row nobody has touched — which is why it says
       * so rather than leaving that to be discovered.
       */
      showIf: { field: "enable_red_band_poc_mentions", equals: true },
      help: "Narrows the switch above rather than acting on its own: while warnings tag the POCs, this decides whether the all-clear does too, including TRI-style SMS all-clears. On by default, so leaving it alone keeps the existing behaviour; turn it off for a site that wants to be told when to stop but not when to resume.",
    },
    poc_phone_numbers: {
      label: "POC phone numbers",
      widget: "csv",
      help: "Comma-separated international numbers, e.g. 6591234567. Or the exact word `manpower-sheet` to tag whoever is on that day's Manpower tab instead of a fixed list — then fill in the Manpower sheet below.",
      showIf: { field: "enable_red_band_poc_mentions", equals: true },
    },
    manpower_sheet_id: {
      label: "Manpower sheet",
      // Deliberately NOT gated on the mentions switch, unlike the two
      // lists beside it. Two reasons. It is a resource pointer, and this
      // repo already holds that where a thing is read from is decided
      // before it is switched on — the SMS destination says so in as many
      // words. And the constraint wants both POC lists non-blank in the
      // SAME save, so the sheet has to be fillable before the switch is
      // flipped rather than after.
      //
      // It also matters that the column is already populated: the seed
      // migration filled it from ops.projects for every matching project,
      // so hiding it behind an off switch hid a value that was already
      // there on most rows.
      help: "Where “whoever is on site today” is read from, when POC phone numbers is the exact word `manpower-sheet`. Seeded once from this project's Manpower workbook in Common Resources; the service keeps its own copy and does not follow that one afterwards, so changing it there will not change it here.",
    },
    poc_alert_wa_groups: {
      label: "POC mention groups",
      widget: "groups",
      help: "Which of the groups above may carry mentions. Blank fails closed to no mentions at all, and it is required when mentions are on.",
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
    { title: "SMS Gateway", fields: ["enable_sms_lightning_alerts", "sms_lightning_format", "sms_whatsapp_group_id"] },
    {
      title: "POC escalation",
      fields: [
        "enable_red_band_poc_mentions",
        "enable_green_band_poc_mentions",
        "poc_alert_wa_groups",
        "poc_phone_numbers",
        "manpower_sheet_id",
      ],
    },
  ],
};
