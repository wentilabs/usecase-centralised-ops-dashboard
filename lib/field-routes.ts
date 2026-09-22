import type { ServiceKey } from "./services";

/**
 * Which endpoint a configuration column actually steers.
 *
 * The gap this closes: a newcomer can list every route a service exposes, and
 * can read every column in HALO's editor, and still not know which column
 * reaches which route. `enable_half_hourly` and `enable_hourly` sit next to
 * each other and are read by two different Lambdas on two different schedules;
 * nothing about the names says so.
 *
 * So each column that steers a route carries that route as subtext, in the
 * `METHOD /path` form the service's own contract uses. No base URL: which
 * deployment it is, is an environment question and changes nothing about which
 * handler reads the column.
 *
 * **Coverage is deliberate, not total.** A column gets a route when knowing
 * the route tells you something — a feature flag, a schedule, a formatter, a
 * destination. Identity and delivery plumbing (`lambda_url`, `instance_name`,
 * `client_id`) is read by every outbound route, so naming them all would be a
 * wall of text that means "all of them"; those carry a single summary line
 * instead. Columns that are pure labelling carry nothing.
 *
 * **This is a mirror and mirrors drift**, like `lib/row-rules.ts` and
 * `lib/load-model/crons.ts`. The guard is that `tests/field-routes.test.ts`
 * checks every route string against the service's pinned contract and every
 * column name against that contract's field list — so a renamed route or a
 * misremembered column fails the build rather than misleading a reader.
 */
export type RouteBinding = {
  /** `METHOD /path`, exactly as the service contract spells it. */
  routes: string[];
  columns: string[];
};

/** Shown for delivery plumbing, which every outbound route reads. */
export const EVERY_OUTBOUND_ROUTE = "every outbound route";

const FIELD_ROUTES: Record<ServiceKey, RouteBinding[]> = {
  wbgt: [
    {
      routes: ["POST /api/wbgt-hourly"],
      columns: [
        "enable_hourly",
        "hourly_message_formatter",
        "enable_intermittent_reports",
        "intermittent_reports_formatter",
        "silence_green_alerts",
        "top_of_hour_band",
      ],
    },
    {
      routes: ["POST /api/wbgt-5min"],
      columns: [
        "enable_5min_alerts",
        "five_min_alert_formatter",
        "five_min_alert_threshold",
        "last_5min_alert_level",
        "last_5min_alert_at",
      ],
    },
    // Both cadences read the site's clock, so both are named rather than one.
    {
      routes: ["POST /api/wbgt-hourly", "POST /api/wbgt-5min"],
      columns: ["site_hours_start", "site_hours_end", "skip_lunch_hour", "delivery_scope", "sensor_delivery_groups"],
    },
    { routes: ["POST /api/wbgt-scrape"], columns: ["enable_scrape"] },
    { routes: ["POST /api/wbgt-telegram"], columns: ["telegram_chat_ids", "telegram_manual_sensor_label"] },
    { routes: ["POST /api/wbgt-whatsapp"], columns: ["whatsapp_wbgt_source_chat_ids", "whatsapp_manual_sensor_label"] },
    {
      routes: ["POST /api/wbgt-sheet-fill", "POST /api/wbgt-sheet-export"],
      columns: ["monthly_sheet_id", "monthly_sheet_template_id", "monthly_sheet_fill_mode"],
    },
    {
      routes: ["POST /api/water-parade-reminder"],
      columns: ["water_parade_enabled", "water_parade_outbound_group_id", "water_parade_cooldown_enabled"],
    },
    {
      routes: ["POST /api/water-parade-daily-summary"],
      columns: ["water_parade_daily_summary_enabled", "water_parade_daily_summary_hour"],
    },
    // `/api/water-parade-intake` has no binding: the column that would carry
    // it, `water_parade_photo_group_id`, is not in WBGT's service contract —
    // HALO knows it only from live introspection and from its own
    // NON_DELIVERY_CHAT_COLUMNS list. Naming an undeclared column here would
    // defeat the check that makes this registry trustworthy.
    { routes: ["POST /api/water-parade-rebuild"], columns: ["manpower_spreadsheet_id"] },
    {
      routes: ["POST /api/wbgt-hourly", "POST /api/wbgt-5min"],
      columns: ["poc_phone_numbers", "poc_alert_wa_groups", "enable_red_band_poc_mentions", "poc_alert_minimum_band"],
    },
  ],

  noise: [
    { routes: ["POST /api/noise-5min"], columns: ["enable_5min", "five_min_formatter", "five_min_start_hhmm", "five_min_end_hhmm"] },
    {
      routes: ["POST /api/noise-half-hourly"],
      columns: [
        "enable_half_hourly",
        "half_hourly_formatter",
        "half_hourly_start_hhmm",
        "half_hourly_end_hhmm",
        "half_hourly_send_if_exceed",
        "exceedance_half_hourly_wa_groups",
        'assessment_readings_mm_array("35,45,55")',
      ],
    },
    {
      routes: ["POST /api/noise-hourly"],
      columns: [
        "enable_hourly",
        "hourly_formatter",
        "hourly_start_hhmm",
        "hourly_end_hhmm",
        "hourly_exceedance_only",
        "hourly_exceeded_meters_only",
      ],
    },
    { routes: ["POST /api/noise-3hour-summary"], columns: ["enable_three_hour_summary", "three_hour_formatter"] },
    { routes: ["POST /api/noise-morning-summary"], columns: ["enable_morning_summary", "morning_formatter", "morning_summary_start_hhmm"] },
    { routes: ["POST /api/noise-evening-summary"], columns: ["enable_evening_summary", "evening_formatter"] },
    {
      routes: ["POST /api/noise-15min-average-exceedance"],
      columns: ["enable_15min_average_exceedance", "fifteen_min_average_start_hhmm", "fifteen_min_average_end_hhmm"],
    },
    { routes: ["POST /api/noise-sunday-leq12hr-hourly"], columns: ["enable_sunday_leq12h_hourly"] },
    { routes: ["POST /api/noise-7am-7pm-leq12hr-table"], columns: ["enable_7am_7pm_leq12hr_table"] },
    { routes: ["POST /api/noise-limit-refresh"], columns: ["allow_expiry_alert", "days_left_before_alerting", "alert_whatsapp_gid"] },
    { routes: ["POST /api/scrape-noiselynx"], columns: ["source_type", "noise_meters_included"] },
    {
      routes: ["POST /api/noise-sheet-bootstrap", "POST /api/noise-sheet-sync", "POST /api/noise-sheet-export"],
      columns: ["google_sheet_id"],
    },
    { routes: ["POST /api/noise-sheet-sync"], columns: ["debug_google_sheet_id"] },
  ],

  haze: [
    {
      routes: ["POST /api/haze-hourly"],
      columns: [
        "alert_only_when_at_least",
        "advisory_format",
        "four_hourly",
        "working_hours_start_hhmm",
        "working_hours_end_hhmm",
        "enable_poc_mentions",
        "poc_mentions_at_least",
        "poc_phone_numbers",
        "poc_alert_wa_groups",
        "manpower_sheet_id",
      ],
    },
    { routes: ["POST /api/haze-kickoff"], columns: ["four_hourly"] },
    { routes: ["POST /api/haze-ingest", "GET /api/haze-readings"], columns: ["nea_region", "latitude", "longitude", "site_address"] },
  ],

  lightning: [
    {
      routes: ["POST /api/lightning-tick"],
      columns: [
        "red_radius_m",
        "red_dwell_seconds",
        "red_detection_types",
        "amber_enabled",
        "amber_radius_m",
        "amber_dwell_seconds",
        "amber_detection_types",
        "site_extent_radius_m",
        "ground_uncertainty_m",
        "cloud_uncertainty_m",
        "feed_stale_after_seconds",
        "max_consecutive_fetch_failures",
        "latitude",
        "longitude",
        "working_hours_start_hhmm",
        "working_hours_end_hhmm",
      ],
    },
    {
      routes: ["POST /api/lightning-sms"],
      columns: ["enable_sms_lightning_alerts", "sms_lightning_format", "sms_whatsapp_group_id"],
    },
    {
      routes: ["POST /api/lightning-tick", "POST /api/lightning-sms"],
      columns: [
        "enable_red_band_poc_mentions",
        "enable_green_band_poc_mentions",
        "poc_phone_numbers",
        "poc_alert_wa_groups",
        "manpower_sheet_id",
      ],
    },
    { routes: ["GET /api/lightning-report", "POST /api/episodes-list"], columns: ["config_version"] },
  ],

  ailytics: [
    { routes: ["POST /telegram-webhook"], columns: ["telegram_chat_id", "upstream_bot_username", "expected_chat_title"] },
    {
      routes: ["POST /ailytics-safety/whatsapp-events", "POST /ailytics-safety/retry-pending-deliveries"],
      columns: ["forward_pending_to_whatsapp", "whatsapp_group_ids"],
    },
    { routes: ["POST /ailytics-safety/status-summary"], columns: ["status_summary_enabled"] },
    {
      routes: ["POST /ailytics-safety/yesterday-24h-summary"],
      columns: ["yesterday_summary_enabled", "yesterday_summary_hour", "yesterday_summary_group_ids"],
    },
    {
      routes: ["POST /ailytics-safety/status-summary", "POST /ailytics-safety/yesterday-24h-summary"],
      columns: ["spreadsheet_id", "activity_history_tab", "safety_sheet_tab"],
    },
  ],

  subcon: [
    {
      routes: ["POST /housekeeping-intake", "POST /daily-housekeeping-report"],
      columns: ["enable_housekeeping", "safety_group_ids"],
    },
    { routes: ["POST /daily-activity-summary"], columns: ["enable_activity_summary"] },
    { routes: ["POST /daily-manpower-summary"], columns: ["enable_manpower_summary", "exclude_wohhup_from_manpower"] },
    {
      routes: ["POST /daily-activity-summary", "POST /daily-manpower-summary"],
      columns: ["morning_report_start_hour", "manpower_activity_outbound_group_id"],
    },
    {
      routes: ["POST /daily-housekeeping-sheet", "POST /refresh-housekeeping-photos"],
      columns: ["spreadsheet_id"],
    },
  ],

  issueChaser: [
    {
      routes: ["POST /api/issue-chaser-severity-cadence"],
      columns: [
        "severity_cadence_chaser_enabled",
        "severity_p1_window_start",
        "severity_p1_window_end",
        "severity_p2_p3_window_start",
        "severity_p2_p3_window_end",
        "severity_only_last_x_days",
      ],
    },
    {
      routes: ["POST /api/issue-chaser-same-day-open"],
      columns: ["same_day_open_snapshot_enabled", "same_day_open_snapshot_schedule", "include_days_before_snapshot", "exclude_whatsapp_group_ids"],
    },
    { routes: ["POST /api/issue-chaser-company-open"], columns: ["company_open_backlog_enabled"] },
    {
      routes: ["POST /api/past-days-safety-summary"],
      columns: ["daily_safety_summary_enabled", "daily_safety_summary_schedule", "daily_safety_summary_whatsapp_group_ids"],
    },
    {
      routes: ["POST /api/past-days-company-safety-summary"],
      columns: [
        "daily_safety_company_summary_enabled",
        "daily_safety_company_summary_schedule",
        "daily_safety_company_summary_whatsapp_group_ids",
      ],
    },
    {
      routes: ["POST /api/past-days-chatgroup-safety-summary"],
      columns: [
        "daily_safety_chatgroup_summary_enabled",
        "daily_safety_chatgroup_summary_schedule",
        "daily_safety_chatgroup_summary_whatsapp_group_ids",
      ],
    },
    {
      routes: [
        "POST /api/past-days-safety-summary",
        "POST /api/past-days-company-safety-summary",
        "POST /api/past-days-chatgroup-safety-summary",
      ],
      columns: ["summary_days", "safety_summary_whatsapp_group_ids"],
    },
    {
      routes: ["POST /api/remind-write-novade-names"],
      columns: ["novade_name_list_check_enabled", "novade_name_list_check_whatsapp_group_ids"],
    },
    { routes: ["POST /api/sync-novade-names"], columns: ["novade_name_sync_enabled"] },
    {
      routes: ["POST /api/issue-chaser-severity-cadence", "POST /api/issue-chaser-same-day-open"],
      columns: ["send_to_originating_groups"],
    },
    // Everything reads the workbook, so the check that reports on it is the
    // useful thing to name rather than all fifteen routes.
    { routes: ["POST /api/issue-chaser-project-check"], columns: ["safety_sheet_id"] },
  ],
};

/** Columns read by every outbound route rather than by one in particular. */
const DELIVERY_PLUMBING = new Set(["lambda_url", "instance_name", "client_id", "enabled"]);

/**
 * The routes this column steers, as `METHOD /path`.
 *
 * An empty array means the column is not route-specific — either it is pure
 * labelling, or it is delivery plumbing, which `isDeliveryPlumbing` separates
 * so the editor can say "every outbound route" instead of listing them.
 */
export function routesForField(service: ServiceKey, column: string): string[] {
  const routes = (FIELD_ROUTES[service] ?? [])
    .filter((binding) => binding.columns.includes(column))
    .flatMap((binding) => binding.routes);
  return [...new Set(routes)];
}

export function isDeliveryPlumbing(column: string): boolean {
  return DELIVERY_PLUMBING.has(column);
}

/** What to render under a field's label, or null when there is nothing to say. */
export function routeHint(service: ServiceKey, column: string): string | null {
  if (isDeliveryPlumbing(column)) return EVERY_OUTBOUND_ROUTE;
  const routes = routesForField(service, column);
  return routes.length ? routes.join(" · ") : null;
}

/** Every binding for a service, for the tests and for a whole-service view. */
export function bindingsFor(service: ServiceKey): RouteBinding[] {
  return FIELD_ROUTES[service] ?? [];
}
