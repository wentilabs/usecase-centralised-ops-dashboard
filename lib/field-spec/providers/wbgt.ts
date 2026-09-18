import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";
import { JOB_STATE_COLUMNS } from "../../job-state-policy";

/** Service-owned semantic overlay; live introspection still owns physical columns. */
export const wbgtFieldProvider: ServiceFieldProvider = {
  readonlyFields: ["project_code", "created_at", "updated_at", ...JOB_STATE_COLUMNS],
  checkEnums: {
    company: [...COMPANIES],
    five_min_alert_threshold: ["yellow", "orange", "red"],
    poc_alert_minimum_band: ["yellow", "orange", "red"],
    intermittent_reports_formatter: ["red15", "red30"],
    monthly_sheet_fill_mode: ["window", "nearest"],
    source_type: ["default", "whgd", "svs", "pentaocean"],
  },
  fields: {
    company: {
      label: "Company",
      help: "Labelling only — nothing reads it. Blank means it could not be worked out when the project was set up.",
    },
    enabled: { label: "Project enabled", help: "Master switch — off means no job touches this project." },
    source_type: {
      label: "Login profile",
      help: "Which CloudLynx login this project uses: `default`, `whgd`, `svs` or `pentaocean`. It changes who reads the meters, not which meters are read, so switching it does not change the data. `pentaocean` needs its own credentials set up first; the old value `noiselynx` behaves as `default`.",
    },
    timezone: { label: "Timezone" },

    enable_scrape: { label: "Scrape CloudLynx", help: "Off = manual-only project; readings arrive via photo ingestion. When on, scraping runs around the clock — site hours gate notifications, not scraping (INV-WBGT-06)." },
    enable_hourly: { label: "Hourly message", help: "Loads the project for the :00 heartbeat and all intermittent reports; turning it off also disables :15/:30/:45 (INV-WBGT-01)." },
    // Also governs the 5-minute message whenever `five_min_alert_formatter` is
    // `full`, which is why the help names it: the inheritance is invisible from
    // either field on its own.
    hourly_message_formatter: {
      label: "Hourly wording",
      help:
        "wohhup_full → the full MOM advisory, up to ten points. pentaocean_full → same reading and footer, advisory cut to one to three points. wohhup_full_15min_waterparade_photo → wohhup_full plus the Water Parade photo prompt, at or above the POC mention band. Also used by the 5-min alert when its format is `full`; an unrecognised value falls back to wohhup_full rather than failing.",
      showIf: { field: "enable_hourly", equals: true },
    },
    enable_intermittent_reports: { label: "Intermittent reports", help: "Allows sub-hour fires at :15/:30/:45, but only while Hourly message is also on (INV-WBGT-01)." },
    intermittent_reports_formatter: {
      label: "Intermittent cadence",
      help: "red15 → :30 on Moderate+, :15/:45 on High. red30 → :30 on High only.",
      showIf: { field: "enable_intermittent_reports", equals: true },
    },
    enable_5min_alerts: {
      label: "5-min exceedance alerts",
      help: "Alerts when a band is crossed: 🟡 from 31°C when selected, 🟠 from 32°C, 🔴 from 33°C, and 🟢 recovery below 31°C. The first reading after switching on is silent (INV-WBGT-03–05).",
    },
    // Nullable on purpose: blank is not "unset pending a choice", it is the
    // historical orange-only behaviour every project had before the column
    // existed. Saying so here stops a blank reading as a misconfiguration.
    five_min_alert_threshold: {
      label: "5-min minimum severity",
      help: "The lowest band that sends. Blank = orange and above. yellow adds the 31–<32°C band, which is otherwise silent; red waits for 33°C. A filtered crossing is still recorded, so a later move to a higher band alerts, and recovery is sent only for a band that met this threshold.",
      showIf: { field: "enable_5min_alerts", equals: true },
    },
    five_min_alert_formatter: {
      label: "5-min alert format",
      help: "short → one line per crossing. full → the whole hourly advisory, in whichever Hourly wording the project uses.",
      showIf: { field: "enable_5min_alerts", equals: true },
    },

    site_hours_start: { label: "Site hours start", help: "First notification hour in SGT, inclusive. It does not gate scraping (INV-WBGT-06).", row: "site_hours" },
    site_hours_end: { label: "Site hours end", help: "Last notification hour in SGT, exclusive. It does not gate scraping (INV-WBGT-06).", row: "site_hours" },
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
    telegram_manual_sensor_label: {
      label: "Telegram photo sensor (legacy)",
      // Reclassified by 64d2145: the new MTProto flow files readings under an
      // automatic `Telegram alerts — <source_key>` label, so this only still
      // governs photos arriving through the old Telegram Bot route.
      help: "Which sensor a photo from the old Telegram Bot route is filed against. The newer signed Telegram flow labels its own readings, so a project on that one can leave this blank.",
    },
    enable_external_telegram_alerts: {
      label: "Forward external Telegram readings",
      help: "Sends the WhatsApp advisory for signed external Telegram messages. Off still parses and stores every reading — only the outbound advisory stops. It does not widen what is ingested: which text belongs to which project is decided in the service, not here.",
    },
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
      help: "Where the Water Parade reminder goes. A comma-separated list: each group gets its own reminder and its own message, so quoted replies stay matched to the right group. Often not one of the alert groups.",
    },
    water_parade_cooldown_enabled: {
      label: "Cooldown between cycles",
      help: "Off by default. On, no new cycle starts if one already ran in either of the two previous hour bands that day — so a long hot spell asks the site once, not every hour. Suppressed cycles are logged; nothing is sent and no reminder is due.",
    },
    // Added by 49c6642 with migrate_water_parade_daily_summary.sql. The service
    // requires all three of enabled, water_parade_enabled and this one, so the
    // summary is a sub-feature of Water Parade rather than a peer of it — hence
    // its own switch inside this group with its two settings under it.
    water_parade_daily_summary_enabled: {
      label: "Daily summary",
      help: "One message at the end of the day naming the companies that did not conduct their water parade, as `Acme - 2/3`. A submission more than an hour after the alert counts as not conducted, and an exempted company is left out of the total. Nothing is sent on a day with no cycles. Goes to the Water Parade reminder group.",
    },
    // Plain number rather than the hhmm widget: the column is a smallint hour,
    // not a time, so 18 means 18:00 and there are no minutes to enter.
    water_parade_daily_summary_hour: {
      label: "Summary hour (SGT)",
      widget: "number",
      help: "The hour the summary is sent, 0–23. The job wakes every hour and only this one does anything. Each group is sent once per day, so a later run that day is skipped rather than sending twice.",
      showIf: { field: "water_parade_daily_summary_enabled", equals: true },
    },
    include_missed_timings_wp: {
      label: "Name the missed hours",
      help: "On by default: each line adds the alerts that company missed — `Acme - 1/3 (missed 10am and 2pm)`. Off leaves the count alone.",
      showIf: { field: "water_parade_daily_summary_enabled", equals: true },
    },
    exclude_wohhup_from_manpower: {
      label: "Exclude Woh Hup from the roster",
      help: "On by default: Woh Hup, Wohhup and WHPL rows are dropped when the Manpower tab is read, because Woh Hup is the main contractor rather than a Water Parade participant. Off includes them — MBS is the project that needs that. Affects both the Water Parade roster and manpower POC resolution.",
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
  groups: [
    { title: "Status", fields: ["enabled", "company", "source_type", "timezone"] },
    {
      // Every way a reading can arrive, in one place. `enable_scrape` used to
      // sit under "Cadences" — it is not a cadence, it is where the numbers
      // come from, and a project with it off is fed entirely by the routes
      // below. Splitting the two halves across sections meant "how does this
      // project get its readings" could not be answered from one screen.
      title: "Where readings come from",
      fields: [
        "enable_scrape",
        "whatsapp_wbgt_source_chat_ids",
        "telegram_chat_ids",
        "whatsapp_authoritative_client_identifier",
        "whatsapp_manual_sensor_label",
        "telegram_manual_sensor_label",
        "enable_external_telegram_alerts",
      ],
    },    {
      title: "Cadences",
      fields: [
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

    { title: "Sheets", fields: ["monthly_sheet_id", "monthly_sheet_fill_mode"] },
    {
      title: "Water Parade",
      fields: [
        "water_parade_enabled",
        "water_parade_cooldown_enabled",
        "water_parade_outbound_group_id",
        "water_parade_daily_summary_enabled",
        "water_parade_daily_summary_hour",
        "include_missed_timings_wp",
        "manpower_spreadsheet_id",
        "exclude_wohhup_from_manpower",
      ],
    },
  ],
};
