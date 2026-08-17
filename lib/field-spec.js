"use strict";

/**
 * Curated overlay on top of the live PostgREST schema introspection.
 *
 * Introspection supplies the truth about types, pg-enum values and defaults.
 * This file supplies the human layer: which fields are editable, how they are
 * grouped and labelled, and the allowed values for columns constrained by a
 * CHECK rather than a pg enum (introspection can't see those).
 *
 * Anything NOT listed here still shows up in the editor under "Other" using
 * its introspected type — so a column added to Supabase tomorrow is editable
 * today, it just lacks a pretty label.
 */

// Columns the dashboard must never write: identity, audit stamps, and
// runtime state owned by the alert jobs.
const READONLY = {
  wbgt: [
    "project_code",
    "created_at",
    "updated_at",
    "top_of_hour_band",
    "last_5min_alert_level",
    "last_5min_alert_at",
  ],
  noise: ["project_code", "created_at", "updated_at"],
};

// Allowed values for CHECK-constrained (non-enum) columns. Keep in sync with
// the alert repos' setup.sql — a wrong value here is rejected by Postgres
// anyway, so the worst case is a failed save, not bad data.
const CHECK_ENUMS = {
  wbgt: {
    intermittent_reports_formatter: ["red15", "red30"],
    monthly_sheet_fill_mode: ["window", "nearest"],
    source_type: ["default", "whgd", "svs", "pentaocean"],
  },
  noise: {
    source_type: ["default", "whgd", "svs", "pentaocean"],
  },
};

// Field-level hints:
//   label   — human name
//   help    — one-line explainer under the control
//   widget  — "toggle" | "select" | "number" | "text" | "hhmm" | "csv"
//   hidden  — never render (identity, audit stamps, job state, unused ids)
//   showIf  — { field, equals }: only render while another field has a value,
//             re-evaluated live as you toggle
//   row     — fields sharing a row key render side by side on one compact row
const FIELDS = {
  wbgt: {
    enabled: { label: "Project enabled", help: "Master switch — off means no job touches this project." },
    source_type: { label: "Login profile", help: "Which CloudLynx credentials + Browserbase context to scrape with." },
    timezone: { label: "Timezone" },

    enable_scrape: { label: "Scrape CloudLynx", help: "Off = manual-only project; readings arrive via photo ingestion." },
    enable_hourly: { label: "Hourly message", help: "Baseline :00 heartbeat." },
    enable_intermittent_reports: { label: "Intermittent reports", help: "Sub-hour fires at :15/:30/:45." },
    intermittent_reports_formatter: {
      label: "Intermittent cadence",
      help: "red15 → :30 on Moderate+, :15/:45 on High. red30 → :30 on High only.",
      showIf: { field: "enable_intermittent_reports", equals: true },
    },
    enable_5min_alerts: { label: "5-min exceedance alerts", help: "🟠 >32°C, 🔴 >33°C, 🟢 recovery <31°C." },
    five_min_alert_formatter: {
      label: "5-min alert format",
      showIf: { field: "enable_5min_alerts", equals: true },
    },

    site_hours_start: { label: "Site hours start", help: "SGT hour, 0–23. Scraping opens 10 min earlier.", row: "site_hours" },
    site_hours_end: { label: "Site hours end", help: "SGT hour, exclusive.", row: "site_hours" },
    skip_lunch_hour: { label: "Skip lunch (12:00)", row: "mutes" },
    remove_sunday_notifications: { label: "Mute Sundays", row: "mutes" },
    remove_ph_notifications: { label: "Mute public holidays", row: "mutes" },

    instance_name: { label: "WhatsApp instance", row: "wa_identity" },
    client_id: { label: "Client ID", row: "wa_identity" },
    whatsapp_group_id: { label: "WhatsApp group IDs", widget: "csv", help: "Comma-separated; one message per group." },
    lambda_url: { label: "Send-message proxy URL" },
    telegram_chat_ids: {
      label: "Telegram source chats",
      widget: "csv",
      help: "Chats we listen to for WBGT meter photos.",
    },

    enable_red_band_poc_mentions: { label: "@mention POCs on 🔴" },
    poc_phone_numbers: {
      label: "POC phone numbers",
      widget: "csv",
      showIf: { field: "enable_red_band_poc_mentions", equals: true },
    },
    poc_alert_wa_groups: {
      label: "POC mention groups",
      widget: "csv",
      showIf: { field: "enable_red_band_poc_mentions", equals: true },
    },

    whatsapp_wbgt_source_chat_ids: { label: "Photo source chats", widget: "csv", help: "Chats whose meter photos are ingested." },
    whatsapp_manual_sensor_label: { label: "WhatsApp manual sensor label" },
    telegram_manual_sensor_label: { label: "Telegram manual sensor label" },
    whatsapp_authoritative_client_identifier: {
      label: "Authoritative WhatsApp client",
      help: "Only photos forwarded by this client identifier are accepted for ingestion.",
    },

    monthly_sheet_id: { label: "Monthly sheet ID", widget: "sheet" },
    monthly_sheet_fill_mode: { label: "Sheet fill mode", help: "window = cap + grace window. nearest = closest reading." },

    // Hidden: unused ids, identity, audit stamps and job state the alert jobs own.
    monthly_sheet_template_id: { hidden: true },
    debug_google_sheet_id: { hidden: true },
    project_code: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
    top_of_hour_band: { hidden: true },
    last_5min_alert_level: { hidden: true },
    last_5min_alert_at: { hidden: true },
  },

  noise: {
    enabled: { label: "Project enabled", help: "Master switch — off means no job touches this project." },
    source_type: { label: "Login profile" },
    timezone: { label: "Timezone" },

    // --- 5-minute cadence: dependents follow the enable flag
    enable_5min: { label: "5-min messages" },
    five_min_formatter: { label: "5-min format", showIf: { field: "enable_5min", equals: true } },
    five_min_start_hhmm: { label: "Window start", widget: "hhmm", row: "5min_window", showIf: { field: "enable_5min", equals: true } },
    five_min_end_hhmm: { label: "Window end", widget: "hhmm", row: "5min_window", showIf: { field: "enable_5min", equals: true } },

    // --- Half-hourly cadence
    enable_half_hourly: { label: "Half-hourly messages" },
    half_hourly_formatter: { label: "Half-hourly format", showIf: { field: "enable_half_hourly", equals: true } },
    half_hourly_start_hhmm: { label: "Window start", widget: "hhmm", row: "hh_window", showIf: { field: "enable_half_hourly", equals: true } },
    half_hourly_end_hhmm: { label: "Window end", widget: "hhmm", row: "hh_window", showIf: { field: "enable_half_hourly", equals: true } },
    'assessment_readings_mm_array("35,45,55")': {
      label: "Minute marks",
      widget: "csv",
      help: "Minutes past the hour the half-hourly assessment fires, e.g. 35,45,55.",
      showIf: { field: "enable_half_hourly", equals: true },
    },

    // --- Hourly cadence
    enable_hourly: { label: "Hourly messages" },
    hourly_formatter: { label: "Hourly format", showIf: { field: "enable_hourly", equals: true } },
    hourly_start_hhmm: { label: "Window start", widget: "hhmm", row: "hr_window", showIf: { field: "enable_hourly", equals: true } },
    hourly_end_hhmm: { label: "Window end", widget: "hhmm", row: "hr_window", showIf: { field: "enable_hourly", equals: true } },
    hourly_exceedance_only: {
      label: "Exceedances only",
      help: "Suppress the hourly message unless a limit was exceeded.",
      showIf: { field: "enable_hourly", equals: true },
    },

    // --- Unique configs
    enable_three_hour_summary: { label: "3-hour summary" },
    three_hour_formatter: { label: "3-hour summary format", showIf: { field: "enable_three_hour_summary", equals: true } },
    enable_morning_summary: { label: "Morning summary" },
    morning_formatter: { label: "Morning summary format", showIf: { field: "enable_morning_summary", equals: true } },
    morning_summary_start_hhmm: {
      label: "Morning summary start",
      widget: "hhmm",
      showIf: { field: "enable_morning_summary", equals: true },
    },
    enable_sunday_leq12h_hourly: { label: "Sunday Leq12h hourly" },
    enable_7am_7pm_leq12hr_table: { label: "Leq12hr table @ 07:00/19:00" },

    remove_sunday_notifications: { label: "Mute Sundays", row: "mutes" },
    remove_ph_notifications: { label: "Mute public holidays", row: "mutes" },

    instance_name: { label: "WhatsApp instance", row: "wa_identity" },
    client_id: { label: "Client ID", row: "wa_identity" },
    whatsapp_group_id: { label: "WhatsApp group IDs", widget: "csv" },
    lambda_url: { label: "Send-message proxy URL" },

    allow_expiry_alert: { label: "Meter expiry alerts" },
    days_left_before_alerting: {
      label: "Warn when days left ≤",
      widget: "number",
      showIf: { field: "allow_expiry_alert", equals: true },
    },
    alert_whatsapp_gid: {
      label: "Expiry alert group",
      widget: "csv",
      showIf: { field: "allow_expiry_alert", equals: true },
    },

    google_sheet_id: { label: "Analysis sheet ID", widget: "sheet" },

    // Hidden: unused ids, identity and audit stamps.
    debug_google_sheet_id: { hidden: true },
    project_code: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },
};

// Ordered groups. Any column not named here lands in "Other".
const GROUPS = {
  wbgt: [
    { title: "Status", fields: ["enabled", "source_type", "timezone"] },
    {
      title: "Cadences",
      fields: [
        "enable_scrape",
        "enable_hourly",
        "enable_intermittent_reports",
        "intermittent_reports_formatter",
        "enable_5min_alerts",
        "five_min_alert_formatter",
      ],
    },
    {
      title: "Site hours & mutes",
      fields: ["site_hours_start", "site_hours_end", "skip_lunch_hour", "remove_sunday_notifications", "remove_ph_notifications"],
    },
    { title: "Delivery", fields: ["whatsapp_group_id", "instance_name", "client_id", "lambda_url"] },
    { title: "POC escalation", fields: ["enable_red_band_poc_mentions", "poc_alert_wa_groups", "poc_phone_numbers"] },
    {
      title: "Manual photo ingestion",
      fields: [
        "whatsapp_wbgt_source_chat_ids",
        "telegram_chat_ids",
        "whatsapp_authoritative_client_identifier",
        "whatsapp_manual_sensor_label",
        "telegram_manual_sensor_label",
      ],
    },
    { title: "Sheets", fields: ["monthly_sheet_id", "monthly_sheet_fill_mode"] },
  ],
  noise: [
    { title: "Status", fields: ["enabled", "source_type", "timezone"] },
    // Each cadence keeps its own flag, format and window together, so turning
    // one off collapses everything that belongs to it.
    {
      title: "5-minute messages",
      fields: ["enable_5min", "five_min_formatter", "five_min_start_hhmm", "five_min_end_hhmm"],
    },
    {
      title: "Half-hourly messages",
      fields: [
        "enable_half_hourly",
        "half_hourly_formatter",
        "half_hourly_start_hhmm",
        "half_hourly_end_hhmm",
        'assessment_readings_mm_array("35,45,55")',
      ],
    },
    {
      title: "Hourly messages",
      fields: ["enable_hourly", "hourly_formatter", "hourly_start_hhmm", "hourly_end_hhmm", "hourly_exceedance_only"],
    },
    {
      title: "Unique configs",
      fields: [
        "enable_three_hour_summary",
        "three_hour_formatter",
        "enable_morning_summary",
        "morning_formatter",
        "morning_summary_start_hhmm",
        "enable_sunday_leq12h_hourly",
        "enable_7am_7pm_leq12hr_table",
      ],
    },
    { title: "Mutes", fields: ["remove_sunday_notifications", "remove_ph_notifications"] },
    { title: "Delivery", fields: ["whatsapp_group_id", "instance_name", "client_id", "lambda_url"] },
    { title: "Meter expiry alerts", fields: ["allow_expiry_alert", "days_left_before_alerting", "alert_whatsapp_gid"] },
    { title: "Sheets", fields: ["google_sheet_id"] },
  ],
};

// Merge introspected columns with the curated overlay into a render-ready spec.
function buildFieldSpec(usecase, introspected) {
  const readonly = new Set(READONLY[usecase] || []);
  const checkEnums = CHECK_ENUMS[usecase] || {};
  const hints = FIELDS[usecase] || {};
  const groups = GROUPS[usecase] || [];

  const fields = {};
  for (const [name, col] of Object.entries(introspected)) {
    const hint = hints[name] || {};
    const options = col.enum || checkEnums[name] || null;
    let widget = hint.widget;
    if (!widget) {
      if (col.type === "boolean") widget = "toggle";
      else if (options) widget = "select";
      else if (col.type === "integer" || col.type === "number") widget = "number";
      else widget = "text";
    }
    fields[name] = {
      name,
      label: hint.label || name,
      help: hint.help || "",
      type: col.type,
      widget,
      options,
      default: col.default ?? null,
      readonly: readonly.has(name),
      hidden: Boolean(hint.hidden),
      showIf: hint.showIf || null,
      row: hint.row || null,
    };
  }

  // Group in curated order; sweep anything left into "Other". Hidden fields
  // are dropped from every group so they never reach the editor.
  const visible = (f) => fields[f] && !fields[f].hidden;
  const claimed = new Set();
  const rendered = [];
  for (const g of groups) {
    const present = g.fields.filter(visible);
    g.fields.forEach((f) => claimed.add(f));
    if (present.length) rendered.push({ title: g.title, fields: present });
  }
  const leftovers = Object.keys(fields).filter((f) => !claimed.has(f) && visible(f)).sort();
  if (leftovers.length) rendered.push({ title: "Other", fields: leftovers });

  return { fields, groups: rendered };
}

module.exports = { buildFieldSpec, READONLY, CHECK_ENUMS };
