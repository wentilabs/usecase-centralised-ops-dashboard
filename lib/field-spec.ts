import type { ServiceKey } from "./services";

export type FieldWidget =
  | "toggle"
  | "select"
  | "number"
  | "text"
  | "hhmm"
  | "csv"
  | "sheet"
  | "multi"
  // Comma-separated WhatsApp chat ids, edited as searchable pills. Stored
  // exactly like "csv" — the widget only changes how it is typed.
  | "groups"
  // Comma-separated NoiseLynx RecIDs, edited as pill toggles labelled by meter
  // name. Also stored exactly like "csv".
  | "meters";

export type FieldSpec = {
  name: string;
  label: string;
  help: string;
  type?: string;
  widget: FieldWidget;
  options: string[] | null;
  default: unknown;
  readonly: boolean;
  hidden: boolean;
  showIf: { field: string; equals: unknown } | null;
  row: string | null;
};

export type FieldGroup = { title: string; fields: string[] };

export type ServiceFieldSpec = {
  fields: Record<string, FieldSpec>;
  groups: FieldGroup[];
};

export type IntrospectedColumn = {
  type?: string;
  format?: string;
  enum?: string[] | null;
  default?: unknown;
};

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
/**
 * Operating companies, offered as a dropdown for the `company` column.
 *
 * The column is plain nullable text in Postgres with no CHECK, on purpose — a new
 * company should not need a migration. These values are HALO's guidance only, so
 * a hand-set value outside the list is stored and shown rather than rejected.
 */
export const COMPANIES = ["Wohhup", "Obayashi", "PentaOcean"] as const;

const READONLY: Record<string, string[]> = {
  wbgt: [
    "project_code",
    "created_at",
    "updated_at",
    "top_of_hour_band",
    "last_5min_alert_level",
    "last_5min_alert_at",
  ],
  noise: ["project_code", "created_at", "updated_at"],
  haze: ["project_code", "created_at", "updated_at"],
  lightning: ["project_code", "created_at", "updated_at"],
  // ailytics identity is a uuid; project_code is a human label but still the
  // row's business key, so it stays read-only here too.
  ailytics: ["id", "project_code", "created_at", "updated_at"],
  // Same shape as ailytics: uuid identity, project_code is how the intake
  // resolves a forwarded message to this row.
  subcon: ["id", "project_code", "created_at", "updated_at"],
  issueChaser: ["project_code", "created_at", "updated_at"],
};

// Allowed values for CHECK-constrained (non-enum) columns. Keep in sync with
// the alert repos' setup.sql — a wrong value here is rejected by Postgres
// anyway, so the worst case is a failed save, not bad data.
const CHECK_ENUMS: Record<string, Record<string, string[]>> = {
  wbgt: {
    company: [...COMPANIES],
    intermittent_reports_formatter: ["red15", "red30"],
    monthly_sheet_fill_mode: ["window", "nearest"],
    source_type: ["default", "whgd", "svs", "pentaocean"],
  },
  noise: {
    company: [...COMPANIES],
    source_type: ["default", "whgd", "svs", "pentaocean"],
  },
  haze: {
    company: [...COMPANIES],
    nea_region: ["north", "south", "east", "west", "central"],
    // Same five PSI bands as alert_only_when_at_least, but this one is a CHECK
    // rather than a pg enum, so introspection cannot see the values.
    poc_mentions_at_least: ["good", "moderate", "unhealthy", "very_unhealthy", "hazardous"],
  },
  lightning: {
    company: [...COMPANIES],
    // text[] columns constrained to <@ array['G','C']
    red_detection_types: ["G", "C"],
    amber_detection_types: ["G", "C"],
  },
  ailytics: {
    company: [...COMPANIES],},
  subcon: {
    company: [...COMPANIES],},
  issueChaser: {
    company: [...COMPANIES],
    // `check (timezone = 'Asia/Singapore')` — a single-valued CHECK. Rendered as
    // a one-option select rather than free text so it cannot be typed into a
    // rejected save; it stays editable rather than readonly, so relaxing the
    // constraint upstream needs no change here beyond this list.
    timezone: ["Asia/Singapore"],
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
const FIELDS: Record<string, Record<string, Partial<FieldSpec>>> = {
  wbgt: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    enabled: { label: "Project enabled", help: "Master switch — off means no job touches this project." },
    source_type: { label: "Login profile", help: "Which CloudLynx credentials + Browserbase context to scrape with." },
    timezone: { label: "Timezone" },

    enable_scrape: { label: "Scrape CloudLynx", help: "Off = manual-only project; readings arrive via photo ingestion." },
    enable_hourly: { label: "Hourly message", help: "Baseline :00 heartbeat." },
    // Also governs the 5-minute message whenever `five_min_alert_formatter` is
    // `full`, which is why the help names it: the inheritance is invisible from
    // either field on its own.
    hourly_message_formatter: {
      label: "Hourly wording",
      help:
        "wohhup_full → the full MOM advisory, up to ten points. pentaocean_full → same reading and footer, advisory cut to one to three points. Also used by the 5-min alert when its format is `full`.",
      showIf: { field: "enable_hourly", equals: true },
    },
    enable_intermittent_reports: { label: "Intermittent reports", help: "Sub-hour fires at :15/:30/:45." },
    intermittent_reports_formatter: {
      label: "Intermittent cadence",
      help: "red15 → :30 on Moderate+, :15/:45 on High. red30 → :30 on High only.",
      showIf: { field: "enable_intermittent_reports", equals: true },
    },
    enable_5min_alerts: { label: "5-min exceedance alerts", help: "🟠 >32°C, 🔴 >33°C, 🟢 recovery <31°C." },
    five_min_alert_formatter: {
      label: "5-min alert format",
      help: "short → one line per crossing. full → the whole hourly advisory, in whichever Hourly wording the project uses.",
      showIf: { field: "enable_5min_alerts", equals: true },
    },

    site_hours_start: { label: "Site hours start", help: "SGT hour, 0–23. Scraping opens 10 min earlier.", row: "site_hours" },
    site_hours_end: { label: "Site hours end", help: "SGT hour, exclusive.", row: "site_hours" },
    skip_lunch_hour: { label: "Skip lunch (12:00)", row: "mutes" },
    remove_sunday_notifications: { label: "Mute Sundays", row: "mutes" },
    remove_ph_notifications: { label: "Mute public holidays", row: "mutes" },

    instance_name: { label: "WhatsApp instance", row: "wa_identity" },
    client_id: { label: "Client ID", row: "wa_identity" },
    whatsapp_group_id: { label: "WhatsApp group IDs", widget: "groups", help: "Comma-separated; one message per group." },
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
      // The sentinel is exact-match and unmixable, and getting it wrong fails
      // silently — a value containing `manpower-sheet` alongside anything else
      // resolves to NO numbers, so nobody is mentioned and nothing complains.
      help: "Digits only, comma-separated, 8+ digits each. Or the single value `manpower-sheet` to take today's sender/PIC phones from the Manpower tab of the Manpower sheet — on its own, never mixed with numbers, or no one is mentioned at all.",
      showIf: { field: "enable_red_band_poc_mentions", equals: true },
    },
    poc_alert_wa_groups: {
      label: "POC mention groups",
      widget: "groups",
      help: "Per-group opt-in, fail-closed: empty means nothing is mentioned anywhere.",
      showIf: { field: "enable_red_band_poc_mentions", equals: true },
    },

    whatsapp_wbgt_source_chat_ids: { label: "Photo source chats", widget: "groups", help: "Chats whose meter photos are ingested." },
    whatsapp_manual_sensor_label: { label: "WhatsApp manual sensor label" },
    telegram_manual_sensor_label: { label: "Telegram manual sensor label" },
    whatsapp_authoritative_client_identifier: {
      label: "Authoritative WhatsApp client",
      help: "Only photos forwarded by this client identifier are accepted for ingestion.",
    },

    water_parade_enabled: {
      label: "Water Parade",
      help: "Outbound only — off still records cycles, roster snapshots, inbound events, photo decisions and reminder audits. It just stops the reminders and the sheet projections.",
    },
    water_parade_outbound_group_id: {
      label: "Water Parade reminder group",
      widget: "groups",
      help: "The dedicated reminder group, and exactly one — unlike the WBGT alert groups above, this is not a list. The reminder is posted to this value as a single chat id, so a second id makes the whole string an invalid group. Often NOT one of the alert groups.",
    },
    water_parade_cooldown_enabled: {
      label: "Cooldown between cycles",
      help: "Off by default. On, a new cycle is not created when one already exists in either of the two preceding hour bands of the same day — so a long hot spell asks the site once, not every hour. Suppressed cycles are logged as `cooldown_active`; nothing is sent and no reminder is due.",
    },
    exclude_wohhup_from_manpower: {
      label: "Exclude Woh Hup from the roster",
      help: "On by default, which is the historical behaviour: Woh Hup, Wohhup and WHPL rows are dropped when the `Manpower` tab is read, because Woh Hup is the main contractor rather than a Water Parade participant. Off includes them — MBS is the project that needs that. Affects the Water Parade roster AND `manpower-sheet` POC resolution, since both read the same tab.",
    },
    manpower_spreadsheet_id: {
      label: "Manpower spreadsheet ID",
      widget: "sheet",
      help: "Holds the Manpower tab and the Sender Phone values used for PIC mentions. Separate from the monthly sheet.",
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
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    // Not quite a master switch any more: the scrape endpoint deliberately
    // includes TEST even when disabled, so it can mirror ZRA's live locations
    // as a pipeline test destination (noise repo, "Mirror ZRA scrapes into
    // TEST"). Everything else still stops.
    enabled: {
      label: "Project enabled",
      help: "Master switch for the notification cadences — off means none of them run, whatever the toggles below say. One exception: the scrape endpoint still scrapes the internal TEST project while it is disabled.",
    },
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
    // Routing, not a cadence. The message forwarded is the same one the
    // ordinary groups already received; there is no second scrape and no extra
    // run, which is why it sits with the half-hourly settings rather than among
    // the cadence toggles where it would read as another thing that fires.
    half_hourly_send_if_exceed: {
      label: "Relay warnings to extra groups",
      help: "Only when the half-hourly message carries a 🟠 or 🔴. Clean all-✅ messages are not relayed, and the ordinary groups still receive every message either way.",
      showIf: { field: "enable_half_hourly", equals: true },
    },
    exceedance_half_hourly_wa_groups: {
      label: "Warning relay groups",
      widget: "groups",
      help: "Extra recipients for warning-bearing half-hourly messages only. A group already on the ordinary list is not sent to twice.",
      showIf: { field: "half_hourly_send_if_exceed", equals: true },
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

    // --- Unique configs. Each of these is its own endpoint and cron family in
    // the noise repo, opt-in per project (default false) — unlike the three
    // cadences above, which default on.
    enable_three_hour_summary: {
      label: "3-hour summary",
      help: "Rollup of the last 3 completed hourly Leq1hr values per meter, each with that meter's current 12-hour state.",
    },
    three_hour_formatter: { label: "3-hour summary format", showIf: { field: "enable_three_hour_summary", equals: true } },
    enable_morning_summary: {
      label: "Morning summary",
      help: "The overnight rollup: same shape as the 3-hour summary but across the overnight range, closing with the completed overnight Leq12hr.",
    },
    morning_formatter: { label: "Morning summary format", showIf: { field: "enable_morning_summary", equals: true } },
    morning_summary_start_hhmm: {
      label: "Morning summary start",
      widget: "hhmm",
      help: "When the summary is sent, and which range it covers — it starts from either 00:00 or 22:00.",
      showIf: { field: "enable_morning_summary", equals: true },
    },
    enable_evening_summary: {
      label: "Evening summary",
      help: "The daytime closeout: every completed hourly Leq1hr from 07:00 through 18:00, ending with Leq12hr(7AM–7PM). Fixed 07:00–19:00, so there is no start-time setting — the job is scheduled at 19:00 SGT.",
    },
    evening_formatter: { label: "Evening summary format", showIf: { field: "enable_evening_summary", equals: true } },
    enable_sunday_leq12h_hourly: {
      label: "Sunday Leq12h hourly",
      help: "Hourly Sunday daytime Leq12hr (07:00–19:00). Deliberately IGNORES “Mute Sundays” — that is the point of it, so a project with Sundays muted still gets these.",
    },
    enable_7am_7pm_leq12hr_table: { label: "Leq12hr table @ 07:00/19:00" },

    remove_sunday_notifications: { label: "Mute Sundays", row: "mutes" },
    remove_ph_notifications: { label: "Mute public holidays", row: "mutes" },

    instance_name: { label: "WhatsApp instance", row: "wa_identity" },
    client_id: { label: "Client ID", row: "wa_identity" },
    whatsapp_group_id: { label: "WhatsApp group IDs", widget: "groups" },
    lambda_url: { label: "Send-message proxy URL" },

    noise_meters_included: {
      label: "Meters sent to the client",
      widget: "meters",
      help: "Client-facing messages only — scraping, calculations, Sheets and the ops fail-safes always keep every meter. Blank means all meters, and keeps including any added later.",
    },

    allow_expiry_alert: { label: "Meter expiry alerts" },
    days_left_before_alerting: {
      label: "Warn when days left ≤",
      widget: "number",
      showIf: { field: "allow_expiry_alert", equals: true },
    },
    alert_whatsapp_gid: {
      label: "Expiry alert group",
      widget: "groups",
      showIf: { field: "allow_expiry_alert", equals: true },
    },

    google_sheet_id: { label: "Analysis sheet ID", widget: "sheet" },

    // Hidden: unused ids, identity and audit stamps.
    debug_google_sheet_id: { hidden: true },
    project_code: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },

  haze: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    enabled: { label: "Project enabled", help: "Master switch — off means no advisory is sent." },
    nea_region: { label: "NEA region", help: "Which of the five regional 24-hour PSI readings this site follows." },
    four_hourly: {
      label: "Four-hourly override",
      help:
        "Guarantees a send in the 08:00, 12:00, 16:00 and 20:00 SGT hours, on top of the hourly advisory. Those four ignore both the band gate below and the working-hours window — 20:00 fires even on a site that closes at 19:00. Every other hour follows the ordinary rules. The check is on the hour, not the minute, and the cron runs at :35, so the messages land at 08:35, 12:35, 16:35 and 20:35. The project is also left out of the once-a-day kickoff message.",
    },
    alert_only_when_at_least: {
      label: "Alert only when at least",
      help:
        "Suppress the hourly advisory unless the 24-hour PSI band reaches this level. Unset = send every hour. Still applies with Four-hourly override on — it is bypassed only at those four hours, not for the rest of the day.",
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

  lightning: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    enabled: { label: "Project enabled", help: "Master switch — off means no lightning alert is sent." },
    timezone: { label: "Timezone" },
    config_version: { label: "Config version", widget: "number", help: "Bump when policy changes; recorded on alerts." },

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

    amber_enabled: { label: "Amber alerts enabled", help: "Off = red-only site; amber thresholds are ignored." },
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

  ailytics: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    enabled: { label: "Project enabled", help: "Master switch — off means CCTV events are ignored." },
    timezone: { label: "Timezone" },

    telegram_chat_id: { label: "Telegram chat ID", help: "Chat the Ailytics CCTV bot posts into." },
    upstream_bot_username: { label: "Upstream bot username", row: "tg_identity" },
    expected_chat_title: { label: "Expected chat title", row: "tg_identity", help: "Guards against a renamed or wrong chat." },

    spreadsheet_id: { label: "Spreadsheet ID", widget: "sheet" },
    safety_sheet_tab: { label: "Safety sheet tab", row: "tabs" },
    activity_history_tab: { label: "Activity history tab", row: "tabs" },

    whatsapp_group_ids: { label: "WhatsApp group IDs", widget: "groups", help: "Comma-separated; one message per group." },
    forward_pending_to_whatsapp: {
      label: "Forward PENDING alerts",
      help: "Outbound only — every matching alert is stored as PENDING and written to activity history either way. This decides whether it also reaches WhatsApp.",
    },
    // Added by supabase/migrate_status_summary.sql in the ailytics repo.
    status_summary_enabled: {
      label: "Daily status summary",
      help: "Lets POST /ailytics-safety/status-summary read this project's sheets and send its own Pending/open counts to the WhatsApp groups above. Project-local — it never aggregates across projects, and a disabled project is not sent one.",
    },
    instance_name: { label: "WhatsApp instance", row: "wa_identity" },
    client_id: { label: "Client ID", row: "wa_identity" },
    lambda_url: { label: "Send-message proxy URL" },
    reply_lambda_url: { label: "Reply proxy URL" },
    lambda_url_image: { label: "Image proxy URL" },

    id: { hidden: true },
    project_code: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },

  subcon: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    // Two routes: POST /housekeeping-intake accepts forwarded messages, and
    // POST /daily-activity-manpower-summary sends the morning report. Water
    // Parade belongs to WBGT, and the base template still owns manpower
    // classification and the Manpower/Machines tabs.
    enable_housekeeping: {
      label: "Housekeeping intake",
      help: "Off means forwarded housekeeping messages are ignored. Independent of Morning report — neither implies the other, and there is no master switch (INV-HK-01).",
    },
    enabled: {
      label: "Morning report",
      help: "Governs outbound delivery of the daily activity + manpower summary. Intake continues either way; this is not a master switch (INV-HK-01).",
    },
    safety_group_ids: {
      label: "Source group IDs",
      widget: "groups",
      help: "Inbound only, and the only thing that routes a message to this project — there is no client-identifier fallback, and several project codes may share a listener client (INV-HK-10). Comma-separated. Empty means nothing arrives, which is the default on a fresh row.",
    },
    spreadsheet_id: {
      label: "Manpower workbook",
      widget: "sheet",
      help: "Required, and must be shared with the service account as Editor. It initialises the housekeeping roster once per project per SGT date and remains the morning report's input (INV-HK-05, INV-HK-12). This service writes the `Daily Activity` tab; `Manpower` and `Machines` belong to the base template.",
    },
    manpower_activity_outbound_group_id: {
      label: "Morning report group",
      widget: "groups",
      help: "Where the daily summary is sent. Empty by default while Morning report defaults on, so a fresh row is switched on with nowhere to send and nothing errors (INV-HK-09). A report request may override it with groupId/groupIds.",
    },
    // Same column name as WBGT's, and a DIFFERENT filter: this one governs the
    // housekeeping roster and the manpower summary, WBGT's governs the Water
    // Parade roster. Both default on, and both exist because Woh Hup is the main
    // contractor rather than a participant.
    exclude_wohhup_from_manpower: {
      label: "Exclude Woh Hup from the roster",
      help: "On by default, which is the historical behaviour: Woh Hup, Wohhup and WHPL rows are dropped when the central `Manpower` tab is read. Applies to the plain report, the activity + manpower summary, and the first housekeeping-roster capture of the day (INV-HK-12). Off only where those rows are genuine participants.",
    },

    // The delivery trio, on every service. Named here because a blank one is
    // silent: the report is generated, the send fails, and the card looks fine.
    instance_name: {
      label: "WhatsApp instance",
      row: "wa_identity",
      help: "Listener instance behind the proxy. Blank means the morning report cannot be delivered.",
    },
    client_id: {
      label: "Client ID",
      row: "wa_identity",
      help: "Selects the sending account on that instance.",
    },
    lambda_url: {
      label: "Send-message proxy URL",
      help: "The project listener's /send-message endpoint. Blank means nothing is delivered, however the toggles read.",
    },

    // Editable here, unlike every sibling service, because `id` is the primary
    // key and HALO edits by it — so renaming the code does not orphan the row.
    // It is still how a forwarded message resolves to this project, so a rename
    // moves the routing with it.
    project_code: {
      label: "Project code",
      help: "How a forwarded message resolves to this project. Unique, and not the primary key here — HALO edits by `id`, so this can be corrected without recreating the row.",
    },
    id: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },
  issueChaser: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    // Two CHECK constraints shape everything here, and both bite on save rather
    // than at run time:
    //   issue_chaser_enabled_delivery_check — `enabled` is refused unless the
    //     sheet id and the full delivery set are present.
    //   issue_chaser_feature_requires_enabled_check — a style toggle is refused
    //     unless `enabled` is already true. That is the inverse of every sibling
    //     service, where you configure first and switch on last.
    enabled: {
      label: "Project enabled",
      help: "Refused unless the Safety sheet ID, an https send URL, instance and client are all set. Must be on before any chaser style can be turned on.",
    },
    safety_sheet_id: {
      label: "Safety workbook",
      widget: "sheet",
      help: "Source of all issue state. The service finds the `Safety` tab and any `Safety-MMM YYYY` archives, reads rows by header name, and never writes to it.",
    },
    // Each style says it needs `enabled` first, on the style itself. Saying it
    // only on `enabled` was not enough: the operator toggling a style is looking
    // at the style, and the database refuses the save
    // (issue_chaser_feature_requires_enabled_check) with a constraint name, not
    // a sentence. This is the inverse of every sibling service, where you
    // configure first and switch on last.
    severity_cadence_chaser_enabled: {
      label: "Severity cadence chaser",
      help: "P1 every 3 hours, P2 daily, P3 weekly. Each pair of window columns below gates its own priorities; leave a window unset for round-the-clock eligibility, which is now the default — the old fixed 07:00–19:00 hours were retired when the windows became configurable. A due time outside a set window waits for the next in-window tick. Cannot be turned on until Project enabled is on.",
    },
    same_day_open_snapshot_enabled: {
      label: "Same-day open snapshot",
      help: "09:00 and 21:00 SGT. Issues opened today and still open — deliberately does not chase older ones. Cannot be turned on until Project enabled is on.",
    },
    // Each style's own settings sit directly under it and are hidden until the
    // style is on, so the group reads as three cadences rather than eleven
    // switches. `time` columns get the default text widget deliberately: the
    // `hhmm` widget caps input at four characters, which would silently truncate
    // the `07:00:00` Postgres hands back.
    include_days_before_snapshot: {
      label: "Snapshot lookback (days)",
      help: "How many earlier SGT dates the snapshot also covers. 0 — the default — is today only. A request may override it per call with `include_days_before`; this is the standing value. Negative is refused by the database (issue_chaser_snapshot_lookback_check).",
      showIf: { field: "same_day_open_snapshot_enabled", equals: true },
    },
    severity_p1_window_start: {
      label: "P1 window start",
      row: "p1_window",
      help: "Optional SGT gate for the P1 cadence, which otherwise runs round the clock. Set BOTH ends or neither, and they must differ — the database refuses one alone or two the same (issue_chaser_p1_window_check). Format HH:MM.",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
    },
    severity_p1_window_end: {
      label: "P1 window end",
      row: "p1_window",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
      help: "Leave both ends empty for 24-hour eligibility.",
    },
    severity_p2_p3_window_start: {
      label: "P2/P3 window start",
      row: "p2p3_window",
      help: "Optional SGT gate shared by the P2 and P3 cadences. Same rule as P1: both ends or neither, and they must differ (issue_chaser_p2_p3_window_check). Format HH:MM.",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
    },
    severity_p2_p3_window_end: {
      label: "P2/P3 window end",
      row: "p2p3_window",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
      help: "Leave both ends empty for 24-hour eligibility.",
    },
    priority_one_escalation_enabled: {
      label: "P1 escalation digest",
      help: "Every 2 hours, 09:00–18:00 SGT. Today's P1 issues still open after 3 hours. Cannot be turned on until Project enabled is on.",
    },
    include_issue_images: { label: "Include issue images", help: "Sends the sheet's `Image` for each issue." },
    mention_sender_fallback: {
      label: "Mention the sender",
      help: "Tags the issue's `Sender Phone` when no PIC phone is available.",
    },
    pic_mentions_enabled: {
      label: "Mention the PIC",
      help: "Resolves each issue's `PIC` name against a `Novade Name List` tab in the same workbook and tags the phones it finds. Off, no PIC is ever tagged whatever the sheet holds. If that tab is missing or unreadable the run continues with no PIC mentions and only a warning in the log.",
    },
    send_to_originating_groups: {
      label: "Reply in the originating group",
      help: "Recovers the group from the sheet's `Message Id Serialized`, so no per-project group is needed. Off — or when that column is missing — delivery falls back to the group list below.",
    },
    require_origin_chat_identity: {
      label: "Only reply in the originating group",
      help: "Strict mode: an issue whose row has no recoverable origin chat is DROPPED rather than falling back to the group list below. It also suppresses the P1 empty-state message, which would otherwise go to the group list. Use it where a chase must never reach the wrong site; expect silence on rows the sheet cannot identify.",
    },
    whatsapp_group_ids: {
      label: "WhatsApp group IDs",
      widget: "groups",
      help: "Fallback destinations. Required to enable the project unless Reply in the originating group is on.",
    },
    // All three are part of issue_chaser_enabled_delivery_check, so a blank one
    // is not a missing nicety — it makes `enabled` unsavable. The URL's shape is
    // checked by the database too, which is worth saying before a save fails on
    // a trailing slash.
    instance_name: {
      label: "WhatsApp instance",
      row: "wa_identity",
      help: "Required before the project can be enabled.",
    },
    client_id: {
      label: "Client ID",
      row: "wa_identity",
      help: "Required before the project can be enabled.",
    },
    lambda_url: {
      label: "Send-message proxy URL",
      help: "Must be https and end in /send-message — the database checks the shape, so a trailing slash or an http URL makes Project enabled unsavable.",
    },
    timezone: {
      label: "Timezone",
      help: "Pinned to Asia/Singapore by a CHECK; the reference projects are all SGT and nothing else will save.",
    },

    project_code: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },
};

// Ordered groups. Any column not named here lands in "Other".
const GROUPS: Record<string, FieldGroup[]> = {
  wbgt: [
    { title: "Status", fields: ["company", "enabled", "source_type", "timezone"] },
    {
      title: "Cadences",
      fields: [
        "enable_scrape",
        "enable_hourly",
        "hourly_message_formatter",
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
    {
      title: "Water Parade",
      fields: [
        "water_parade_enabled",
        "water_parade_cooldown_enabled",
        "water_parade_outbound_group_id",
        "manpower_spreadsheet_id",
        "exclude_wohhup_from_manpower",
      ],
    },
  ],
  noise: [
    { title: "Status", fields: ["company", "enabled", "source_type", "timezone"] },
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
        // The relay belongs to this cadence, not to Delivery: it forwards this
        // message and no other. Listed here in the order they are set, because
        // a field absent from every group falls into the catch-all "OTHER"
        // section at the bottom of the form, where it reads as unrelated to the
        // cadence it governs.
        "half_hourly_send_if_exceed",
        "exceedance_half_hourly_wa_groups",
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
        "enable_evening_summary",
        "evening_formatter",
        "enable_sunday_leq12h_hourly",
        "enable_7am_7pm_leq12hr_table",
      ],
    },
    { title: "Mutes", fields: ["remove_sunday_notifications", "remove_ph_notifications"] },
    { title: "Meters sent to the client", fields: ["noise_meters_included"] },
    { title: "Delivery", fields: ["whatsapp_group_id", "instance_name", "client_id", "lambda_url"] },
    { title: "Meter expiry alerts", fields: ["allow_expiry_alert", "days_left_before_alerting", "alert_whatsapp_gid"] },
    { title: "Sheets", fields: ["google_sheet_id"] },
  ],

  haze: [
    {
      title: "Status",
      fields: ["company", "enabled", "nea_region", "four_hourly", "alert_only_when_at_least", "advisory_format", "timezone"],
    },
    { title: "Site", fields: ["site_address", "latitude", "longitude"] },
    { title: "Working hours & mutes", fields: ["working_hours_start_hhmm", "working_hours_end_hhmm", "remove_sunday_notifications", "remove_ph_notifications"] },
    { title: "Delivery", fields: ["wa_group_ids", "instance_name", "client_id", "lambda_url"] },
    {
      title: "POC escalation",
      fields: ["enable_poc_mentions", "poc_mentions_at_least", "poc_alert_wa_groups", "poc_phone_numbers"],
    },
  ],

  lightning: [
    { title: "Status", fields: ["company", "enabled", "timezone", "config_version"] },
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
    {
      title: "POC escalation",
      fields: ["enable_red_band_poc_mentions", "poc_alert_wa_groups", "poc_phone_numbers"],
    },
  ],

  ailytics: [
    { title: "Status", fields: ["company", "enabled", "timezone"] },
    { title: "Telegram source", fields: ["telegram_chat_id", "upstream_bot_username", "expected_chat_title"] },
    { title: "Google Sheet", fields: ["spreadsheet_id", "safety_sheet_tab", "activity_history_tab"] },
    {
      title: "Delivery",
      fields: [
        "whatsapp_group_ids",
        "forward_pending_to_whatsapp",
        "status_summary_enabled",
        "instance_name",
        "client_id",
        "lambda_url",
        "reply_lambda_url",
        "lambda_url_image",
      ],
    },
  ],

  subcon: [
    { title: "Project", fields: ["company", "project_code"] },
    { title: "Intake", fields: ["enable_housekeeping", "safety_group_ids"] },
    // The Woh Hup filter sits with the workbook it filters, not with the report,
    // because it also shapes the first roster capture of the day — which happens
    // whether or not the morning report is switched on.
    { title: "Google Sheets", fields: ["spreadsheet_id", "exclude_wohhup_from_manpower"] },
    {
      title: "Morning report",
      fields: ["enabled", "manpower_activity_outbound_group_id", "instance_name", "client_id", "lambda_url"],
    },
  ],
  issueChaser: [
    { title: "Status", fields: ["company", "enabled", "timezone"] },
    { title: "Safety sheet", fields: ["safety_sheet_id"] },
    {
      title: "Chaser styles",
      fields: [
        "severity_cadence_chaser_enabled",
        "severity_p1_window_start",
        "severity_p1_window_end",
        "severity_p2_p3_window_start",
        "severity_p2_p3_window_end",
        "same_day_open_snapshot_enabled",
        "include_days_before_snapshot",
        "priority_one_escalation_enabled",
      ],
    },
    {
      title: "Message content",
      fields: ["include_issue_images", "mention_sender_fallback", "pic_mentions_enabled"],
    },
    {
      title: "Delivery",
      fields: [
        "send_to_originating_groups",
        "require_origin_chat_identity",
        "whatsapp_group_ids",
        "instance_name",
        "client_id",
        "lambda_url",
      ],
    },
  ],
};

// Merge introspected columns with the curated overlay into a render-ready spec.
export function buildFieldSpec(
  usecase: ServiceKey | string,
  introspected: Record<string, IntrospectedColumn>,
): ServiceFieldSpec {
  const readonly = new Set(READONLY[usecase] || []);
  const checkEnums = CHECK_ENUMS[usecase] || {};
  const hints = FIELDS[usecase] || {};
  const groups = GROUPS[usecase] || [];

  const fields: Record<string, FieldSpec> = {};
  for (const [name, col] of Object.entries(introspected)) {
    const hint = hints[name] || {};
    const options = col.enum || checkEnums[name] || null;
    let widget: FieldWidget | undefined = hint.widget;
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
  const visible = (f: string) => fields[f] && !fields[f].hidden;
  const claimed = new Set<string>();
  const rendered: FieldGroup[] = [];
  for (const g of groups) {
    const present = g.fields.filter(visible);
    g.fields.forEach((f: string) => claimed.add(f));
    if (present.length) rendered.push({ title: g.title, fields: present });
  }
  const leftovers = Object.keys(fields).filter((f) => !claimed.has(f) && visible(f)).sort();
  if (leftovers.length) rendered.push({ title: "Other", fields: leftovers });

  return { fields, groups: rendered };
}
