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

/**
 * A visibility condition. `anyOf` is an OR — needed where one setting belongs to
 * several toggles at once, as `summary_days` does to both issue-chaser summary
 * flags. Hiding it behind just one of them would leave it unreachable for a
 * project running only the other.
 */
export type ShowIf =
  | { field: string; equals: unknown }
  | { anyOf: { field: string; equals: unknown }[] };

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
  showIf: ShowIf | null;
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

/**
 * Columns a service writes to ITSELF as it runs. Not settings, and not an
 * operator's doing: WBGT stamps `top_of_hour_band` on every :00 fire and the
 * two `last_5min_alert_*` columns on every zone crossing, which that repo's own
 * CONFIG_SCHEMA.md calls job state.
 *
 * They are read-only in the editor, and — the reason this list is exported —
 * excluded from the audit trail, where they were 1187 of the first 1730 rows.
 * A card's history was a machine log with the occasional human edit buried in
 * it, every entry marked "changed outside the dashboard", which was true and
 * useless.
 *
 * The Postgres trigger in supabase/config_audit_setup.sql skips the same names,
 * so nothing new is recorded. This list is what keeps rows recorded BEFORE that
 * ran from rendering, and a test asserts the two agree.
 */
export const JOB_STATE_COLUMNS = [
  "top_of_hour_band",
  "last_5min_alert_level",
  "last_5min_alert_at",
  // `noise_limits.imported_at`, stamped by the limits refresh on every row it
  // merges — including the protected rows whose values it left alone. Without
  // it, every refresh would write one audit entry per protected row saying
  // nothing but "imported_at moved".
  "imported_at",
] as const;

/**
 * One audit entry's `changes` with the job-state keys removed, or null when
 * nothing else was in it — the entry is then a service stamping its own scratch
 * column, which is not a change anyone made.
 *
 * Keys are dropped rather than whole rows. The services write these columns on
 * their own today, so in practice an affected entry holds nothing else, but an
 * entry that did carry a real edit alongside one keeps the edit.
 *
 * It lives here rather than in the repository because the repository is
 * `server-only` and this is a policy about a list, testable on its own.
 */
export function auditChangesWithoutJobState<T>(
  changes: Record<string, T> | null | undefined,
): Record<string, T> | null {
  const entries = Object.entries(changes ?? {});
  if (!entries.some(([column]) => (JOB_STATE_COLUMNS as readonly string[]).includes(column))) {
    return changes ?? {};
  }
  const kept = entries.filter(([column]) => !(JOB_STATE_COLUMNS as readonly string[]).includes(column));
  return kept.length ? Object.fromEntries(kept) : null;
}

const READONLY: Record<string, string[]> = {
  // Job state is read-only for the same reason it goes unaudited: nobody sets it.
  wbgt: ["project_code", "created_at", "updated_at", ...JOB_STATE_COLUMNS],
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
    // A real pg enum (`wbgts.wbgt_5min_alert_threshold`), so introspection
    // normally supplies these and `col.enum` wins. Listed anyway because
    // migrate_five_min_alert_threshold.sql adds the column as plain text before
    // converting it — a half-applied migration would otherwise render free text
    // on a column the database will reject.
    five_min_alert_threshold: ["yellow", "orange", "red"],
    // `text not null default 'red'` with a CHECK, so introspection cannot see
    // the values and a free-text box would offer ones Postgres rejects.
    poc_alert_minimum_band: ["yellow", "orange", "red"],
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
/** Exported alongside `GROUPS`, for the same coverage test. */
export const FIELDS: Record<string, Record<string, Partial<FieldSpec>>> = {
  wbgt: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    enabled: { label: "Project enabled", help: "Master switch — off means no job touches this project." },
    source_type: {
      label: "Login profile",
      help: "Which CloudLynx account this project logs in with — `default`, `whgd`, `svs` or `pentaocean`. A grouping of credentials and a Browserbase context: not a data source and not a gate, so changing it does not change which meters are read, only who reads them. `pentaocean` needs its own credentials configured; the legacy value `noiselynx` normalises to `default`.",
    },
    timezone: { label: "Timezone" },

    enable_scrape: { label: "Scrape CloudLynx", help: "Off = manual-only project; readings arrive via photo ingestion." },
    enable_hourly: { label: "Hourly message", help: "Baseline :00 heartbeat." },
    // Also governs the 5-minute message whenever `five_min_alert_formatter` is
    // `full`, which is why the help names it: the inheritance is invisible from
    // either field on its own.
    hourly_message_formatter: {
      label: "Hourly wording",
      help:
        "wohhup_full → the full MOM advisory, up to ten points. pentaocean_full → same reading and footer, advisory cut to one to three points. wohhup_full_15min_waterparade_photo → wohhup_full plus the Water Parade photo prompt, at or above the POC mention band. Also used by the 5-min alert when its format is `full`; an unrecognised value falls back to wohhup_full rather than failing.",
      showIf: { field: "enable_hourly", equals: true },
    },
    enable_intermittent_reports: { label: "Intermittent reports", help: "Sub-hour fires at :15/:30/:45." },
    intermittent_reports_formatter: {
      label: "Intermittent cadence",
      help: "red15 → :30 on Moderate+, :15/:45 on High. red30 → :30 on High only.",
      showIf: { field: "enable_intermittent_reports", equals: true },
    },
    enable_5min_alerts: {
      label: "5-min exceedance alerts",
      help: "🟠 >32°C, 🔴 >33°C, 🟢 recovery <31°C. Which of those actually send is set by the minimum severity below.",
    },
    // Nullable on purpose: blank is not "unset pending a choice", it is the
    // historical orange-only behaviour every project had before the column
    // existed. Saying so here stops a blank reading as a misconfiguration.
    five_min_alert_threshold: {
      label: "5-min minimum severity",
      help: "Lowest crossing that sends. Blank = orange, the long-standing behaviour. yellow also alerts on entering 31–<32°C, the band that is otherwise silent; red waits for 33°C. A filtered crossing still records its zone, so a later move into a higher zone alerts, and recovery is sent only on leaving a zone that met this threshold.",
      showIf: { field: "enable_5min_alerts", equals: true },
    },
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

    enable_red_band_poc_mentions: {
      label: "@mention POCs",
      help: "Off by default. All four have to hold before anyone is mentioned: this flag, a valid minimum band, at least one valid number, and the group listed below.",
    },
    poc_alert_minimum_band: {
      label: "Mention from band",
      widget: "select",
      // Named after the column's own default, because the column was added
      // with `'red'` so that every project already running kept the 🔴-only
      // behaviour the toggle used to be named after.
      help: "Lowest severity that mentions POCs, and every band above it. red is the long-standing behaviour; orange also mentions on 🟠, and yellow from 🟡 up.",
      showIf: { field: "enable_red_band_poc_mentions", equals: true },
    },
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
      help: "Where the reminder goes. A comma-separated list since migrate_water_parade_multiple_groups.sql dropped the single-group CHECK: ids are trimmed and de-duplicated, each group gets its own reminder, and each keeps its own delivery row and outbound message id so quoted replies correlate per group. Often NOT one of the alert groups.",
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
    source_type: {
      label: "Login profile",
      help: "Which NoiseLynx account this project logs in with — `default`, `whgd`, `svs` or `pentaocean`. A grouping of credentials and a Browserbase context: not a data source and not a gate, so changing it does not change which meters are read, only who reads them. `pentaocean` needs its own credentials configured; the legacy value `noiselynx` normalises to `default`.",
    },
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
    enable_sms_lightning_alerts: {
      label: "Forward SMS lightning alerts",
      help: "Controls signed SMS Gateway thunderstorm alerts only. SMS is still parsed and retained when off; this does not affect normal NEA lightning alerts or the project enabled switch (INV-LTG-23).",
      row: "sms",
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
      label: "Housekeeping",
      // Widened on 11 Sep 2026 (5df3928). It used to gate the intake route
      // alone, and this help said so — which is now the opposite of what the
      // service does. INV-HK-01 exists because the surface reading is still
      // the old one.
      help: "The whole housekeeping feature, not just intake (INV-HK-01): forwarded messages, the nightly report, HOUSEKEEPING sheet generation and the photo refresh all stop when this is off, and the routes answer `skipped` without reading or writing anything. Existing events and sheet rows are kept, so turning it back on resumes rather than rebuilds. Only an explicit yes counts. Separate from Scheduled reports, which gates outbound delivery and does not switch housekeeping off — and separate from the two summaries, which have their own flags.",
    },
    // `enabled` covers BOTH scheduled reports, which the old wording hid by
    // naming only one of them. The service runs two routes off one flag:
    // POST /daily-activity-summary and POST /daily-manpower-summary, each
    // gated by `project.enabled !== false` and each falling back to the same
    // outbound group.
    enabled: {
      label: "Scheduled reports",
      help: "Gates outbound delivery of both morning reports, but does not select them — each is its own opt-in below, and with both off this being on sends nothing. Intake continues either way; this is not a master switch (INV-HK-01).",
    },
    // Each report is an explicit opt-in: the service checks
    // `config[column] === true`, so off is the safe state and a project can be
    // enabled while sending nothing. Worth saying on the controls, because
    // "Scheduled reports is on" no longer implies a report goes out.
    enable_activity_summary: {
      label: "Activity + manpower report",
      help: "POST /daily-activity-summary — the morning activity/manpower message. Explicit opt-in: off means this report is not sent, whatever Scheduled reports says. With Scheduled reports off it still reads Sheets and writes its Supabase summary; only delivery is suppressed.",
      showIf: { field: "enabled", equals: true },
    },
    enable_manpower_summary: {
      label: "Manpower + machines report",
      help: "POST /daily-manpower-summary — the plain per-company headcount, which also reads the `Machines` tab when it exists. Explicit opt-in, independent of the report above: either can run without the other, and with both off the project sends no morning report at all. With Scheduled reports off it still reads the workbook and writes its summary state; only the message is withheld.",
      showIf: { field: "enabled", equals: true },
    },
    // Both directions since 140b1e9: `housekeepingOutboundIds` now returns
    // `safetyGroupIds`, so this one list routes forwarded messages IN and is
    // where the nightly housekeeping report goes OUT. It used to be inbound
    // only, and the old help said so in bold — worth being explicit that
    // editing it now moves a destination as well as a source.
    safety_group_ids: {
      label: "Housekeeping groups (in and out)",
      widget: "groups",
      help: "Both directions. Inbound: the only thing that routes a forwarded message to this project — no client-identifier fallback, and several project codes may share a listener client (INV-HK-10). Outbound: where the nightly housekeeping report is sent. Editing this list changes both at once. Comma-separated; empty means nothing arrives AND the housekeeping report has nowhere to go, which is the default on a fresh row.",
    },
    spreadsheet_id: {
      label: "Manpower workbook",
      widget: "sheet",
      help: "Required, and must be shared with the service account — read access is enough. It initialises the housekeeping roster once per project per SGT date and remains the morning report's input (INV-HK-05, INV-HK-12). Read-only since Supabase became canonical: the service no longer creates or writes any tab, including the `Daily Activity` projection it used to maintain. It reads `Manpower`, and `Machines` when present; both belong to the base template.",
    },
    manpower_activity_outbound_group_id: {
      label: "Morning report group",
      widget: "groups",
      help: "Where the two morning summaries are sent — and only those. The nightly housekeeping report stopped falling back to this column in 140b1e9 and now uses the housekeeping groups instead. Empty by default while Scheduled reports defaults on, so a fresh row is switched on with nowhere to send and nothing errors (INV-HK-09). A report request may override it with groupId/groupIds.",
    },
    // Same column name as WBGT's, and a DIFFERENT filter: this one governs the
    // housekeeping roster and the manpower summary, WBGT's governs the Water
    // Parade roster. Both default on, and both exist because Woh Hup is the main
    // contractor rather than a participant.
    exclude_wohhup_from_manpower: {
      label: "Exclude Woh Hup from the roster",
      help: "On by default, which is the historical behaviour: Woh Hup, Wohhup and WHPL rows are dropped when the central `Manpower` tab is read. Applies to the plain report, the activity + manpower summary, and the first housekeeping-roster capture of the day (INV-HK-12). Off only where those rows are genuine participants.",
    },

    // Delivery-only, and they cover all THREE outbound reports — the two
    // morning summaries and the nightly housekeeping report — because the
    // service evaluates them inside each send path. Intake is untouched: a
    // forwarded message on a Sunday is still accepted and still recorded in
    // Supabase, and the day's roster is still captured. The day is not skipped,
    // only unannounced.
    remove_sunday_notifications: {
      label: "Mute Sundays",
      row: "mutes",
      help: "Suppresses all three outbound reports on SGT Sundays. Intake, the Supabase record and the roster capture continue, and a dry run still returns its message. Only checked when Scheduled reports is on, so it changes nothing on a project that sends nothing.",
    },
    remove_ph_notifications: {
      label: "Mute public holidays",
      row: "mutes",
      help: "The same, for the Singapore holiday list kept in the service's `utils/notification-calendar.js`, which currently ends on 2027-12-25. A date past the end of that list is treated as an ordinary working day rather than guessed at, so the list has to be extended before it can be relied on for a later year.",
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
      help: "Source of all issue state. The service finds the `Safety` tab and any `Safety-MMM YYYY` archives and reads rows by header name. It also WRITES to one column of it now — `POST /api/sync-novade-names` fills blank `Novade Name` cells from `Whatsapp Name`, and only when the sync below is switched on. Nothing else in the service writes here.",
    },
    // Each style says it needs `enabled` first, on the style itself. Saying it
    // only on `enabled` was not enough: the operator toggling a style is looking
    // at the style, and the database refuses the save
    // (issue_chaser_feature_requires_enabled_check) with a constraint name, not
    // a sentence. This is the inverse of every sibling service, where you
    // configure first and switch on last.
    severity_cadence_chaser_enabled: {
      label: "Severity cadence chaser",
      help: "P1 every 3 hours, P2 daily, P3 weekly — all round the clock by default. The old fixed 07:00–19:00 hours were retired when per-priority send windows became configurable; where those columns exist they appear here, and a due time outside a set window waits for the next in-window tick. Cannot be turned on until Project enabled is on.",
    },
    same_day_open_snapshot_enabled: {
      label: "Same-day open snapshot",
      help: "09:00 and 21:00 SGT. Issues opened today and still open — deliberately does not chase older ones. Cannot be turned on until Project enabled is on.",
    },
    // Each style's own settings sit directly under it and are hidden until the
    // style is on, so the group reads as three cadences rather than eleven
    // switches. `time` columns get the default text widget deliberately: the
    // `hhmm` widget caps input at four characters, and while four digits are now
    // the documented way to WRITE these, Postgres hands back `07:00:00` — so a
    // four-character cap would silently truncate the value already stored.
    include_days_before_snapshot: {
      label: "Snapshot lookback (days)",
      help: "How many earlier SGT dates the snapshot also covers. 0 — the default — is today only. A request may override it per call with `include_days_before`; this is the standing value. Negative is refused by the database (issue_chaser_snapshot_lookback_check).",
      showIf: { field: "same_day_open_snapshot_enabled", equals: true },
    },
    severity_p1_window_start: {
      label: "P1 window start",
      row: "p1_window",
      help: "Optional SGT gate for the P1 cadence, which otherwise runs round the clock. Enter it as four digits — 0700, 1900 — though Supabase shows the stored value back as 07:00:00 and the service reads either. The window is half-open [start, end), so 0700 is eligible and 1900 is not, and an overnight pair like 2200–0600 is supported. Set BOTH ends or neither, and they must differ: the database refuses one alone or two the same (issue_chaser_p1_window_check).",
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
      help: "Optional SGT gate shared by the P2 and P3 cadences. Same rules as P1 — four digits, half-open, overnight allowed, both ends or neither and they must differ (issue_chaser_p2_p3_window_check).",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
    },
    severity_p2_p3_window_end: {
      label: "P2/P3 window end",
      row: "p2p3_window",
      showIf: { field: "severity_cadence_chaser_enabled", equals: true },
      help: "Leave both ends empty for 24-hour eligibility.",
    },
    // Summaries are informational reports, not chasers: they read the workbook,
    // never touch delivery_events, and never chase anyone. Two CHECKs bite on
    // save — issue_chaser_feature_requires_enabled_check (needs `enabled`) and
    // issue_chaser_summary_destination_check (needs a group), and the second is
    // the surprising one, because it holds even when the project otherwise
    // replies in each issue's originating group.
    daily_safety_summary_enabled: {
      label: "Past-days safety summary",
      help: "08:00 SGT daily. Read-only report: total, open and closed plus P1/P2/P3 counts across the last few SGT dates, and each date's open count. Goes to Summary destination, and falls back to WhatsApp group IDs when that is blank — one of the two has to be set, and a summary is a project-level report, so it never replies in an issue's originating group.",
    },
    daily_safety_company_summary_enabled: {
      label: "Past-days summary by company",
      help: "The same 08:00 SGT report with an Open issues by company section under each date. A separate route and flag, so it can run instead of, or alongside, the plain summary. A row naming several companies counts once for each, so company totals can exceed the project total; blank cells show as Unknown company, and a workbook with no Company column produces the plain report.",
    },
    summary_days: {
      label: "Summary window (days)",
      help: "How many consecutive SGT dates each summary covers, counting the end date itself — so 5, the default, is today plus the four before it. Shared by both summaries. Must be at least 1; the database refuses 0 (issue_chaser_summary_days_check).",
      showIf: {
        anyOf: [
          { field: "daily_safety_summary_enabled", equals: true },
          { field: "daily_safety_company_summary_enabled", equals: true },
        ],
      },
    },
    // priority_one_escalation_enabled is retired too, and was the last one
    // still described here. `migrate_issue_chaser_latest.sql` drops it in the
    // same statement as the four below, `setup.sql` never creates it, and no
    // code in that repo reads it — so the P1 escalation digest is gone, not
    // merely off. It rendered as a permanently-unlit pill on every card, which
    // is the exact trap the note below is about.
    //
    // include_issue_images, mention_sender_fallback, pic_mentions_enabled and
    // require_origin_chat_identity were REMOVED from issue_chaser.project_configs
    // by 412256d ("harden reminder routing and mentions"): PIC resolution and
    // image delivery are built in now, reporter mentions are the final PIC
    // fallback rather than a setting, and the single configured-group origin
    // fallback is unconditional. `deliveryConfig` in that repo's config/index.js
    // explicitly deletes all four, so they are behaviour, not configuration.
    // Snapshot-only, which is the whole point of it: the severity chaser still
    // replies wherever an issue came from, and the summaries still go to the
    // full group list. Naming it "exclude groups" without saying from WHAT would
    // read as a project-wide mute.
    exclude_whatsapp_group_ids: {
      label: "Excluded from the snapshot",
      widget: "groups",
      help: "Groups the 09:00/21:00 same-day snapshot skips. Nothing else: severity reminders still reply in each issue's originating group, and both daily summaries still go to their own destination. Matching is trimmed and case-insensitive, and an empty list excludes nothing.",
    },
    // Not a report: it sends no WhatsApp message and needs no destination, which
    // is why it sits apart from the summaries and their group requirement.
    safety_summary_whatsapp_group_ids: {
      label: "Summary destination",
      widget: "groups",
      // Added by 807adfc so a daily report can go somewhere other than the
      // group the chasers use. Blank is not "nowhere": it falls back, which is
      // what kept every project working when the column was introduced.
      // Shown whether or not the summaries are on. A destination is something
      // you decide before you switch a report on, not after — and gating it on
      // the flag meant the only way to set it was to turn the report on first,
      // which sends it to the fallback in the meantime.
      help: "Where both past-days summaries go when they are on. Blank falls back to WhatsApp group IDs, which is what every project did before this field existed. Separate from the chaser groups on purpose: a management summary and an issue reminder rarely belong in the same chat.",
    },
    novade_name_list_check_whatsapp_group_ids: {
      label: "Reminder destination",
      widget: "groups",
      // Same, and more so: no project has the weekly reminder on, so gating
      // this on the flag hid it on every row in the estate.
      help: "Where the weekly Novade name reminder goes when it is on. Blank falls back to WhatsApp group IDs.",
    },
    novade_name_sync_enabled: {
      label: "Write back Novade names",
      help: "Lets `POST /api/sync-novade-names` fill blank `Novade Name` cells in the workbook from `Whatsapp Name`. The only thing in this service that writes to the sheet. Off, the route refuses; on, it is still dry-run unless the request sets `dryRun: false`, and it skips any WhatsApp name that normalises ambiguously. Sends no message, so it needs no group.",
    },
    // The column does not exist in Supabase yet — supabase/migrate_novade_name_list_check.sql
    // in the issue-chaser repo is unrun, so `row.novade_name_list_check_enabled`
    // reads undefined and the weekly reminder can never fire. Named here anyway:
    // the editor renders from live introspection, so this shows nothing until
    // the migration lands and then appears already labelled.
    novade_name_list_check_enabled: {
      label: "Weekly Novade name reminder",
      help: "`POST /api/remind-write-novade-names` — one weekly message counting `Novade Name List` rows that have a phone and a WhatsApp name but no Novade name. Read-only, and silent when the count is zero. Goes to Reminder destination, and falls back to WhatsApp group IDs when that is blank — one of the two has to be set, because it is a project-level report rather than a reply to an issue.",
    },
    send_to_originating_groups: {
      label: "Reply in the originating group",
      help: "On, each reminder goes to the group recovered from the sheet's `Message Id Serialized`. When that cannot be recovered it falls back to the group list below ONLY if exactly one group is configured — with several it is reported as an ambiguous-routing error and skipped, rather than guessed at. Off, everything goes to the group list, which is then required. Applies to reminders only: the daily summaries ignore this and use Summary destination — or the group list when that is blank — so one project report is never copied into every issue's origin group.",
    },
    whatsapp_group_ids: {
      label: "WhatsApp group IDs",
      widget: "groups",
      // No longer "the only destination for the daily summaries" — 807adfc gave
      // the summaries and the weekly Novade reminder their own, and this became
      // the fallback for both. The old wording sent an operator here to fix a
      // routing problem the two fields below now solve.
      help: "The default destination: fallback for reminders, and for the two report destinations below when they are blank. Required to enable the project unless Reply in the originating group is on. A report with its own destination set does not need this one as well.",
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
    // Delivery-only, and unlike the chaser styles they are NOT gated by
    // `enabled` — the service evaluates them at send time in both runProject and
    // runSummaryProject, so they cover the reminders and both daily summaries.
    // Everything upstream of the send still runs: the workbook is read, issues
    // are selected, cadence is calculated, and a dryRun request returns its
    // normal preview. A muted real run is reported as suppressed rather than as
    // nothing due.
    remove_sunday_notifications: {
      label: "Mute Sundays",
      row: "mutes",
      help: "Suppresses every outbound message on SGT Sundays — reminders and both daily summaries. The sheet is still read and the run still reports what it would have sent, so a Sunday looks like a suppression in the logs, not like an empty day.",
    },
    remove_ph_notifications: {
      label: "Mute public holidays",
      row: "mutes",
      help: "The same, for the Singapore holiday list kept in the service's `lib/time.js`, which currently ends on 2027-12-25. A date past the end of that list is treated as an ordinary working day, so the list has to be extended before it can be relied on for a later year.",
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
/**
 * Exported for `tests/auth-policy.test.ts` only.
 *
 * A group naming a column with no `FIELDS` entry renders that column with its
 * raw name and no explanation, and nothing else notices — 19 noise hints were
 * once deleted in a bad edit and the whole suite still passed. The test pairs
 * the two maps so neither can lose an entry quietly.
 */
export const GROUPS: Record<string, FieldGroup[]> = {
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
        "five_min_alert_threshold",
        "five_min_alert_formatter",
      ],
    },
    {
      title: "Site hours & mutes",
      fields: ["site_hours_start", "site_hours_end", "skip_lunch_hour", "remove_sunday_notifications", "remove_ph_notifications"],
    },
    { title: "Delivery", fields: ["whatsapp_group_id", "instance_name", "client_id", "lambda_url"] },
    {
      title: "POC escalation",
      fields: ["enable_red_band_poc_mentions", "poc_alert_minimum_band", "poc_alert_wa_groups", "poc_phone_numbers"],
    },
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
    { title: "SMS Gateway", fields: ["enable_sms_lightning_alerts"] },
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
    // Renamed from "Intake": the group list in here is now a destination too,
    // so filing it under intake alone understated what editing it does.
    { title: "Housekeeping", fields: ["enable_housekeeping", "safety_group_ids"] },
    // The Woh Hup filter sits with the workbook it filters, not with the report,
    // because it also shapes the first roster capture of the day — which happens
    // whether or not the morning report is switched on.
    { title: "Google Sheets", fields: ["spreadsheet_id", "exclude_wohhup_from_manpower"] },
    {
      title: "Scheduled reports",
      fields: [
        "enabled",
        "enable_activity_summary",
        "enable_manpower_summary",
        "manpower_activity_outbound_group_id",
        "instance_name",
        "client_id",
        "lambda_url",
      ],
    },
    // Their own section rather than a line inside "Scheduled reports": they
    // also silence the nightly housekeeping report, which is configured two
    // groups up, so filing them under either one would understate their reach.
    { title: "Mutes", fields: ["remove_sunday_notifications", "remove_ph_notifications"] },
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
      ],
    },
    {
      title: "Daily summaries",
      fields: [
        "daily_safety_summary_enabled",
        "daily_safety_company_summary_enabled",
        "safety_summary_whatsapp_group_ids",
        "summary_days",
      ],
    },
    // Its own section: one reads the Name List and one writes to it, and neither
    // is a chaser or a summary.
    {
      title: "Novade names",
      fields: [
        "novade_name_list_check_enabled",
        "novade_name_list_check_whatsapp_group_ids",
        "novade_name_sync_enabled",
      ],
    },
    // Each report's destination sits directly under the switch that turns the
    // report on, rather than together down here: you are choosing where THIS
    // report goes, and reading the two side by side is what makes the fallback
    // legible. What matters is that none of them is hidden — they used to be
    // gated on their own flag, which put the Novade destination out of reach on
    // every project in the estate.
    {
      title: "Delivery",
      fields: [
        "send_to_originating_groups",
        "whatsapp_group_ids",
        "exclude_whatsapp_group_ids",
        "instance_name",
        "client_id",
        "lambda_url",
      ],
    },
    // Below Delivery, and covering everything above it: the chasers and both
    // summaries stop on a muted date, whichever destination they would use.
    { title: "Mutes", fields: ["remove_sunday_notifications", "remove_ph_notifications"] },
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
