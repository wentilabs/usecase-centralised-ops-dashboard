import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";

/** Service-owned semantic overlay; live introspection still owns physical columns. */
export const noiseFieldProvider: ServiceFieldProvider = {
  readonlyFields: ["project_code", "created_at", "updated_at"],
  checkEnums: {
    company: [...COMPANIES],
    source_type: ["default", "whgd", "svs", "geoscan", "trackmaster", "alphalab"],
  },
  fields: {
    company: {
      label: "Company",
      help: "Labelling only — nothing reads it. Blank means it could not be worked out when the project was set up.",
    },
    // Not quite a master switch any more: the scrape endpoint deliberately
    // includes TEST even when disabled, so it can mirror ZRA's live locations
    // as a pipeline test destination (noise repo, "Mirror ZRA scrapes into
    // TEST"). Everything else still stops.
    enabled: {
      label: "Project enabled",
      help: "Master switch for the notification cadences — off means none of them run, whatever the toggles below say. One exception: scraping continues for the internal TEST project while it is disabled.",
    },
    source_type: {
      label: "Upstream source",
      help: "Selects the upstream adapter and its isolated credentials or browser context. NoiseLynx profiles are `default`, `whgd`, and `svs`; the other supported adapters are `geoscan`, `trackmaster`, and `alphalab`. The legacy value `noiselynx` normalises to `default`; unknown values are rejected rather than silently routed.",
    },
    timezone: { label: "Timezone" },

    // --- 5-minute cadence: dependents follow the enable flag
    enable_5min: { label: "5-min messages" },
    five_min_formatter: { label: "5-min format", showIf: { field: "enable_5min", equals: true } },
    five_min_start_hhmm: { label: "Window start", widget: "hhmm", row: "5min_window", showIf: { field: "enable_5min", equals: true } },
    five_min_end_hhmm: { label: "Window end", widget: "hhmm", row: "5min_window", showIf: { field: "enable_5min", equals: true } },

    // --- Half-hourly cadence
    fifteen_min_average_start_hhmm: {
      label: "Window start",
      widget: "hhmm",
      row: "15min_window",
      help: "Optional HHMM start; blank on both ends means unrestricted, and an end at or before the start wraps overnight (INV-NOISE-05).",
      showIf: { field: "enable_15min_average_exceedance", equals: true },
    },
    fifteen_min_average_end_hhmm: {
      label: "Window end",
      widget: "hhmm",
      row: "15min_window",
      help: "Exclusive HHMM end; end at or before start wraps overnight (INV-NOISE-05).",
      showIf: { field: "enable_15min_average_exceedance", equals: true },
    },
    enable_15min_average_exceedance: {
      label: "15-min average exceedance",
      help: "An extra alert at :17, :32 and :47 SGT. Each run averages the three 5-minute readings that just closed and sends only the meters whose average is over their Leq5min limit. Opt-in and additive — it changes nothing about the 5-minute messages. A slot with no reading is left out of the average rather than counted as zero.",
    },
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
    hourly_exceeded_meters_only: {
      label: "Only exceeded meters",
      help: "Filters rows in an hourly message to meters with a five-minute, Leq1hr, or Leq12hr exceedance. It does not change scraping, calculations, or stored readings.",
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
    data_health_group_ids: {
      label: "Data Health groups",
      widget: "groups",
      help: "Internal operations groups for automatic Data Health reminders. They never receive the project’s normal client alerts; leave blank to keep monitoring visible but silent.",
    },
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
  groups: [
    { title: "Status", fields: ["enabled", "company", "source_type", "timezone"] },
    // Each cadence keeps its own flag, format and window together, so turning
    // one off collapses everything that belongs to it.
    {
      title: "5-minute messages",
      fields: ["enable_5min", "five_min_formatter", "five_min_start_hhmm", "five_min_end_hhmm"],
    },
    // Its own section: it averages the 5-minute readings but is not the
    // 5-minute cadence, fires on its own three minute marks, and can run with
    // every other cadence off.
    {
      title: "15-minute average exceedance",
      fields: [
        "enable_15min_average_exceedance",
        "fifteen_min_average_start_hhmm",
        "fifteen_min_average_end_hhmm",
      ],
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
      fields: ["enable_hourly", "hourly_formatter", "hourly_start_hhmm", "hourly_end_hhmm", "hourly_exceedance_only", "hourly_exceeded_meters_only"],
    },
    // Was one section called "Unique configs", which named nothing and held
    // five separate cadences — while the 5-minute, half-hourly and hourly ones
    // each had a section of their own. Split the way they actually differ:
    // three periodic summaries, then the two Leq12h tables, which report a
    // twelve-hour figure rather than summarising a window.
    {
      title: "Summaries",
      fields: [
        "enable_three_hour_summary",
        "three_hour_formatter",
        "enable_morning_summary",
        "morning_formatter",
        "morning_summary_start_hhmm",
        "enable_evening_summary",
        "evening_formatter",
      ],
    },
    {
      title: "Leq12h tables",
      fields: ["enable_sunday_leq12h_hourly", "enable_7am_7pm_leq12hr_table"],
    },
    { title: "Mutes", fields: ["remove_sunday_notifications", "remove_ph_notifications"] },
    // Titled for the decision, not repeated from the field: a section and a
    // control with the same words read as a rendering mistake.
    { title: "Meters", fields: ["noise_meters_included"] },
    { title: "Delivery", fields: ["whatsapp_group_id", "data_health_group_ids", "instance_name", "client_id", "lambda_url"] },
    { title: "Meter expiry alerts", fields: ["allow_expiry_alert", "days_left_before_alerting", "alert_whatsapp_gid"] },
    { title: "Sheets", fields: ["google_sheet_id"] },
  ],
};
