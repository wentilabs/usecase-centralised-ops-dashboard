import type { ServiceKey } from "./services";

/**
 * What each endpoint sends, when it is switched on.
 *
 * `message-previews.ts` answers "what does this formatter option send?" and is keyed
 * by a config column. A developer holding an endpoint has the other question: "what
 * lands in the group when `/daily-manpower-summary` runs?" Most endpoints have no
 * formatter column to hang that on — the manpower reports, the lightning kickoff, the
 * data-health reminders — so this registry is keyed by the route instead.
 *
 * Two kinds of source, and neither is written from memory:
 *
 *  - `{ column }` reuses the formatter / switch previews that already exist, so a
 *    route that is driven by `hourly_formatter` shows every option in one place and
 *    cannot drift from the `?` panel.
 *  - `{ sample }` points into `endpoint-samples.generated.ts`, which
 *    `scripts/build-endpoint-previews.mjs` lifts from a service's own message
 *    document or produces by running its own builder.
 *
 * A route that delivers something HALO cannot show carries a `gap` that says why,
 * so the page lists it instead of leaving a developer to wonder whether it was
 * forgotten. `tests/endpoint-previews.test.ts` makes the choice mandatory: every
 * route in the pinned contracts either has an entry here or an entry in
 * `NOT_A_MESSAGE`.
 */

/** How a config column counts as "on": a boolean flag, or a non-blank list of groups. */
export type SwitchRule = { column: string; as: "flag" | "text" };

export type EndpointSource = { column: string } | { sample: string };

export type EndpointPreview = {
  service: ServiceKey;
  /** The path as the service's contract spells it. */
  path: string;
  title: string;
  /** One line: who receives it, and when. */
  summary: string;
  sends: "text" | "image" | "document";
  /**
   * The columns that must hold for a project to receive this — in addition to the
   * project's own `enabled`, which every service gates on and which is not repeated here.
   *
   * `null` when the service documents no single switch for it, so HALO cannot say which
   * projects receive it and shows no count rather than a wrong one.
   */
  enabledBy: SwitchRule[] | null;
  sources: EndpointSource[];
  /** Why there is nothing to show, for a route that delivers. */
  gap?: string;
};

const flag = (column: string): SwitchRule => ({ column, as: "flag" });
const text = (column: string): SwitchRule => ({ column, as: "text" });

export const ENDPOINT_PREVIEWS: EndpointPreview[] = [
  // ── Noise ────────────────────────────────────────────────────────────────
  {
    service: "noise", path: "/api/noise-5min", title: "5-minute readings", sends: "text",
    summary: "Every 5 minutes. Whether it speaks only on a breach or on every cycle is the formatter.",
    enabledBy: [flag("enable_5min")], sources: [{ column: "five_min_formatter" }],
  },
  {
    service: "noise", path: "/api/noise-half-hourly", title: "Half-hourly Leq1hr", sends: "text",
    summary: "Every half hour. Extra groups can receive the same message when it carries a warning.",
    enabledBy: [flag("enable_half_hourly")], sources: [{ column: "half_hourly_formatter" }],
  },
  {
    service: "noise", path: "/api/noise-hourly", title: "Hourly report", sends: "text",
    summary: "Every hour, in whichever wording the project's hourly formatter selects.",
    enabledBy: [flag("enable_hourly")], sources: [{ column: "hourly_formatter" }],
  },
  {
    service: "noise", path: "/api/noise-hourly-app-screenshot", title: "Hourly app screenshot", sends: "image",
    summary: "Hourly, inside the project's own start/end window.",
    enabledBy: [flag("noise_hourly_app_screenshot")], sources: [],
    gap: "An image, not text: the “Noise Readings (dBA)” card rendered as a PNG with no caption, so there is no message body to show.",
  },
  {
    service: "noise", path: "/api/noise-3hour-summary", title: "Three-hour summary", sends: "text",
    summary: "Every three hours.",
    enabledBy: [flag("enable_three_hour_summary")], sources: [{ column: "three_hour_formatter" }],
  },
  {
    service: "noise", path: "/api/noise-morning-summary", title: "Morning summary", sends: "text",
    summary: "Once each morning, covering the overnight band.",
    enabledBy: [flag("enable_morning_summary")], sources: [{ column: "morning_formatter" }],
  },
  {
    service: "noise", path: "/api/noise-evening-summary", title: "Evening summary", sends: "text",
    summary: "Once each evening, covering the daytime band.",
    enabledBy: [flag("enable_evening_summary")], sources: [{ column: "evening_formatter" }],
  },
  {
    service: "noise", path: "/api/noise-15min-average-exceedance", title: "15-minute average exceedance", sends: "text",
    summary: "At :17, :32 and :47. Silent unless a meter's three-slot average exceeds its limit.",
    enabledBy: [flag("enable_15min_average_exceedance")], sources: [{ sample: "noise.fifteen-minute-average" }],
  },
  {
    service: "noise", path: "/api/noise-sunday-leq12hr-hourly", title: "Sunday Leq12hr", sends: "text",
    summary: "Hourly on Sundays from 07:00 to 19:00, bypassing the Sunday mute.",
    enabledBy: [flag("enable_sunday_leq12h_hourly")], sources: [{ sample: "noise.sunday-leq12hr" }],
  },
  {
    service: "noise", path: "/api/noise-7am-7pm-leq12hr-table", title: "7AM–7PM Leq12hr table", sends: "text",
    summary: "Invoked hourly from 08:00 to 19:00: one row per hour from 07:00 to 18:00, ending with the running Leq12hr. Not chosen through hourly_formatter.",
    enabledBy: [flag("enable_7am_7pm_leq12hr_table")], sources: [{ column: "enable_7am_7pm_leq12hr_table" }],
  },
  {
    service: "noise", path: "/api/noise-data-health", title: "Data health reminder", sends: "text",
    summary: "Internal only: goes to the data-health groups, never to the client groups.",
    enabledBy: [text("data_health_group_ids")], sources: [{ sample: "noise.data-health" }],
  },
  {
    service: "noise", path: "/api/noise-monthly-report", title: "Monthly noise report", sends: "document",
    summary: "Once a month, to the monthly-report groups.",
    enabledBy: [flag("enable_monthly_noise_report")], sources: [],
    gap: "A generated workbook sent as a document. The service documents no caption or message body for it.",
  },

  // ── WBGT & Water Parade ──────────────────────────────────────────────────
  {
    service: "wbgt", path: "/api/wbgt-hourly", title: "Hourly WBGT advisory", sends: "text",
    summary: "Every hour on site hours. The same body is repeated quarter-hourly when intermittent reports are on.",
    enabledBy: [flag("enable_hourly")], sources: [{ column: "hourly_message_formatter" }, { column: "intermittent_reports_formatter" }],
  },
  {
    service: "wbgt", path: "/api/wbgt-5min", title: "5-minute exceedance alert", sends: "text",
    summary: "On a zone crossing only, not on a schedule.",
    enabledBy: [flag("enable_5min_alerts")], sources: [{ column: "five_min_alert_formatter" }],
  },
  {
    service: "wbgt", path: "/api/wbgt-data-health", title: "Data health reminder", sends: "text",
    summary: "Internal only: goes to the data-health groups, never to the project groups.",
    enabledBy: [text("data_health_group_ids")], sources: [{ sample: "wbgt.data-health" }],
  },
  {
    service: "wbgt", path: "/api/generate-and-send-monthly-wbgt-report", title: "Monthly WBGT report", sends: "document",
    summary: "Once a month, to the monthly-report groups.",
    enabledBy: [flag("enable_monthly_wbgt_report")], sources: [],
    gap: "A generated workbook sent as a document. The service documents no caption or message body for it.",
  },
  {
    service: "wbgt", path: "/api/water-parade-reminder", title: "Water Parade reminder", sends: "text",
    summary: "Each invocation recomputes who is outstanding for the current hour; the cadence is the scheduler's.",
    enabledBy: [flag("water_parade_enabled"), flag("water_parade_reminders_enabled")], sources: [{ sample: "wbgt.water-parade-reminder" }],
  },
  {
    service: "wbgt", path: "/api/water-parade-daily-summary", title: "Water Parade daily summary", sends: "text",
    summary: "Once a day, at the project's configured hour.",
    enabledBy: [flag("water_parade_enabled"), flag("water_parade_daily_summary_enabled")], sources: [{ sample: "wbgt.water-parade-summary" }],
  },
  {
    service: "wbgt", path: "/api/wbgt-telegram-retry", title: "Telegram relay retry", sends: "text",
    summary: "Recovers each Telegram alert's WhatsApp recipients that the listener has not yet accepted.",
    enabledBy: null, sources: [],
    gap: "The body is the incoming Telegram text, so it has no fixed shape.",
  },

  // ── Haze ─────────────────────────────────────────────────────────────────
  {
    service: "haze", path: "/api/haze-hourly", title: "Hourly haze advisory", sends: "text",
    summary: "Hourly, or every four hours, depending on the project.",
    enabledBy: [], sources: [{ column: "advisory_format" }],
  },
  {
    service: "haze", path: "/api/haze-kickoff", title: "Daily kickoff", sends: "text",
    summary: "Once a day for enabled projects except those with four_hourly or hourly_always. Ignores working hours and severity floors, but honors calendar mutes and fresh-reading checks.",
    enabledBy: [], sources: [{ sample: "haze.kickoff" }],
  },
  {
    service: "haze", path: "/api/haze-retry", title: "Retry of a failed advisory", sends: "text",
    summary: "Re-sends this hour's advisory while it is still pending or failed. Off unless the service's HAZE_RETRY_ENABLED is true, and it never reaches back to an earlier hour.",
    enabledBy: [], sources: [{ column: "advisory_format" }],
  },
  {
    service: "haze", path: "/api/haze-report-now", title: "On-demand report", sends: "text",
    summary: "The hourly advisory on request. It ignores the severity gate, four-hourly and both calendar mutes, so it also sends on a muted Sunday or a public holiday.",
    enabledBy: [], sources: [{ column: "advisory_format" }],
  },

  // ── Lightning ────────────────────────────────────────────────────────────
  {
    service: "lightning", path: "/api/lightning-tick", title: "Lightning alerts", sends: "text",
    summary: "On an edge, not on a schedule: a storm is a handful of messages, not one per strike.",
    enabledBy: [], sources: [{ sample: "lightning.tick" }, { column: "amber_enabled" }],
  },
  {
    service: "lightning", path: "/api/lightning-kickoff", title: "Daily kickoff", sends: "text",
    summary: "Once a day at a fixed time. Does not look at NEA, detections or current site state.",
    enabledBy: [], sources: [{ sample: "lightning.kickoff" }],
  },
  {
    service: "lightning", path: "/api/lightning-sms", title: "SMS gateway relay", sends: "text",
    summary: "Relays a signed inbound SMS to the project's group.",
    enabledBy: [flag("enable_sms_lightning_alerts")], sources: [{ column: "sms_lightning_format" }],
  },

  // ── Subcon ───────────────────────────────────────────────────────────────
  {
    service: "subcon", path: "/daily-manpower-summary", title: "Daily manpower summary", sends: "text",
    summary: "Plain per-company worker and machine totals. Sent again only when the message has changed.",
    enabledBy: [flag("enable_manpower_summary")], sources: [{ column: "manpower_summary_format" }],
  },
  {
    service: "subcon", path: "/daily-activity-summary", title: "Morning activity summary", sends: "text",
    summary: "Activities and manpower for the day, from the Manpower tab.",
    enabledBy: [flag("enable_activity_summary")], sources: [{ sample: "subcon.activity-summary" }],
  },
  {
    service: "subcon", path: "/daily-housekeeping-report", title: "Nightly housekeeping report", sends: "text",
    summary: "A per-company checklist to the project's safety groups. Outstanding PICs are @-mentioned.",
    enabledBy: [flag("enable_housekeeping")], sources: [{ sample: "subcon.housekeeping-report" }],
  },

  // ── Ailytics ─────────────────────────────────────────────────────────────
  {
    service: "ailytics", path: "/ailytics-safety/status-summary", title: "Safety status summary", sends: "text",
    summary: "Today's and total Pending and Non-Compliant counts.",
    enabledBy: [flag("status_summary_enabled")], sources: [{ sample: "ailytics.status-summary" }],
  },
  {
    service: "ailytics", path: "/ailytics-safety/yesterday-24h-summary", title: "Yesterday summary", sends: "text",
    summary: "Once a day at the project's configured hour, for the previous calendar date.",
    enabledBy: [flag("yesterday_summary_enabled")], sources: [{ sample: "ailytics.yesterday-summary" }],
  },
  {
    service: "ailytics", path: "/ailytics-safety/retry-pending-deliveries", title: "Pending image retry", sends: "image",
    summary: "Re-forwards a Pending image that was not delivered.",
    enabledBy: [], sources: [],
    gap: "An image forwarded with its original Telegram caption, so there is no fixed text. The caption shape is in the service's MESSAGE_SHAPES.md.",
  },

  // ── Issue Chaser ─────────────────────────────────────────────────────────
  {
    service: "issueChaser", path: "/api/issue-chaser-severity-cadence", title: "Severity-cadence reminders", sends: "text",
    summary: "One reminder per due issue, repeating on the severity's cadence until it closes.",
    enabledBy: [flag("severity_cadence_chaser_enabled")], sources: [{ column: "severity_cadence_chaser_enabled" }, { column: "issues_format" }],
  },
  {
    service: "issueChaser", path: "/api/issue-chaser-same-day-open", title: "Same-day open snapshot", sends: "text",
    summary: "A count header, then one reminder per open issue.",
    enabledBy: [flag("same_day_open_snapshot_enabled")], sources: [{ column: "same_day_open_snapshot_enabled" }],
  },
  {
    service: "issueChaser", path: "/api/issue-chaser-company-open", title: "Company open backlog", sends: "text",
    summary: "On demand only: nothing schedules it.",
    enabledBy: [flag("company_open_backlog_enabled")], sources: [{ column: "company_open_backlog_enabled" }],
  },
  {
    service: "issueChaser", path: "/api/past-days-safety-summary", title: "Past-days safety summary", sends: "text",
    summary: "The plain summary, to the daily-summary groups.",
    enabledBy: [flag("daily_safety_summary_enabled")], sources: [{ column: "daily_safety_summary_enabled" }],
  },
  {
    service: "issueChaser", path: "/api/past-days-company-safety-summary", title: "Past-days summary by company", sends: "text",
    summary: "The same report split by the workbook's Company cell.",
    enabledBy: [flag("daily_safety_company_summary_enabled")], sources: [{ column: "daily_safety_company_summary_enabled" }],
  },
  {
    service: "issueChaser", path: "/api/past-days-chatgroup-safety-summary", title: "Past-days summary by chat group", sends: "text",
    summary: "The same report split by the workbook's ChatGroup cell.",
    enabledBy: [flag("daily_safety_chatgroup_summary_enabled")], sources: [{ column: "daily_safety_chatgroup_summary_enabled" }],
  },
  {
    service: "issueChaser", path: "/api/remind-write-novade-names", title: "Novade Name List reminder", sends: "text",
    summary: "Once to each project group, only when rows are missing a Novade name.",
    enabledBy: [flag("novade_name_list_check_enabled")], sources: [{ column: "novade_name_list_check_enabled" }],
  },
  {
    service: "issueChaser", path: "/api/issue-chaser-operator-send", title: "Operator send", sends: "text",
    summary: "The one operator route that delivers to real groups: it sends a run built by the operator preview.",
    enabledBy: [], sources: [],
    gap: "It sends whatever the operator preview built, so its messages are the ones from the styles above.",
  },

  // ── Vibration ────────────────────────────────────────────────────────────
  {
    service: "vibration", path: "/api/vibration-scrape", title: "PPV threshold alerts", sends: "text",
    summary: "After scraping, a meter entering or rising to a warning band sends one alert when the Lambda alert switch is on. Same-band readings stay silent.",
    enabledBy: null, sources: [{ sample: "vibration.ppv-alert" }],
  },
  {
    service: "vibration", path: "/api/vibration-report", title: "Latest PPV report", sends: "text",
    summary: "Manual only. Previews each prepared meter's latest stored PPV; send: true delivers to the site's configured groups.",
    enabledBy: null, sources: [],
    gap: "The message is built from the latest persisted PPV and observation time per meter, so no static sample can stand in for live readings.",
  },
  {
    service: "vibration", path: "/api/vibration-kickoff", title: "Morning scrape and PPV check", sends: "text",
    summary: "Once each morning, reports the latest project scrape outcome and stored PPV for every prepared meter.",
    enabledBy: [flag("vibration_kickoff_enabled")], sources: [{ sample: "vibration.kickoff" }],
  },
  {
    service: "vibration", path: "/api/vibration-alert-preview", title: "Alert format preview and test", sends: "text",
    summary: "Previews all three tiers using one meter's saved limits. An explicit test send targets one configured group and labels each message as a test.",
    enabledBy: null, sources: [{ sample: "vibration.ppv-alert" }],
  },
];

/**
 * The config column whose `?` shows an endpoint's message, for endpoints that have no
 * formatter column of their own. It is the switch that turns the message on — or, for
 * the data-health reminders, the recipient list — so the explanation sits beside the
 * control a developer is about to change.
 *
 * Only endpoints whose message comes from a `{ sample }` need one: a `{ column }` source
 * already has its own `?` on that column. Keyed `service:path`.
 */
export const HELP_COLUMNS: Record<string, string> = {
  "noise:/api/noise-15min-average-exceedance": "enable_15min_average_exceedance",
  "noise:/api/noise-sunday-leq12hr-hourly": "enable_sunday_leq12h_hourly",
  "noise:/api/noise-data-health": "data_health_group_ids",
  "wbgt:/api/wbgt-data-health": "data_health_group_ids",
  "wbgt:/api/water-parade-reminder": "water_parade_reminders_enabled",
  "wbgt:/api/water-parade-daily-summary": "water_parade_daily_summary_enabled",
  "subcon:/daily-activity-summary": "enable_activity_summary",
  "subcon:/daily-housekeeping-report": "enable_housekeeping",
  "ailytics:/ailytics-safety/status-summary": "status_summary_enabled",
  "ailytics:/ailytics-safety/yesterday-24h-summary": "yesterday_summary_enabled",
  "vibration:/api/vibration-kickoff": "vibration_kickoff_enabled",
};

/**
 * Routes that are in a service's contract and are neither diagnostics nor reads, but
 * are not an outbound message — each with the reason, so a route cannot be left off
 * the page by omission. The test fails on a route that is in neither this map nor
 * `ENDPOINT_PREVIEWS`, and on an entry here that is no longer in the contract.
 *
 * Keyed `service:path`.
 */
export const NOT_A_MESSAGE: Record<string, string> = {
  "ailytics:/telegram-webhook": "Inbound Telegram intake.",
  "ailytics:/ailytics-safety/whatsapp-events": "Inbound WhatsApp events; it classifies replies and closes issues.",
  "haze:/api/haze-ingest": "Ingests readings from the public feed.",
  "issueChaser:/api/sync-novade-names": "A workbook write. The service documents it as having no WhatsApp message shape.",
  "issueChaser:/api/refresh-safety-image-links": "Re-signs image links in the workbook; sends no messages.",
  "issueChaser:/api/sync-company-names": "A workbook write.",
  "issueChaser:/api/issue-chaser-preview": "Returns the messages it would send, without sending.",
  "issueChaser:/api/issue-chaser-project-check": "A read-only configuration check.",
  "issueChaser:/api/issue-chaser-operator-preview": "Builds a run for the operator to inspect; sends nothing.",
  "lightning:/api/episodes-list": "A read of stored episodes.",
  "lightning:/api/episodes-evidence": "A read of stored detections.",
  "noise:/api/scrape-noiselynx": "Ingests readings.",
  "noise:/api/noise-limit-refresh": "Refreshes limits from the source of record.",
  "noise:/api/noise-sheet-bootstrap": "Creates the project workbook.",
  "noise:/api/noise-sheet-export": "Writes readings to the workbook.",
  "noise:/api/noise-sheet-sync": "Writes readings to the workbook.",
  "noise:/api/noise-sheet-sync-master-template": "Writes the master template workbook.",
  "subcon:/housekeeping-intake": "Inbound WhatsApp envelopes.",
  "subcon:/daily-housekeeping-sheet": "Projects housekeeping state into the workbook.",
  "subcon:/refresh-housekeeping-photos": "Refreshes stored photo links.",
  "wbgt:/api/wbgt-scrape": "Ingests readings.",
  "wbgt:/api/wbgt-sheet-fill": "Writes readings to the workbook.",
  "wbgt:/api/wbgt-sheet-export": "Writes readings to the workbook.",
  "wbgt:/api/wbgt-telegram": "Inbound Telegram intake.",
  "wbgt:/api/wbgt-telegram-external-channels": "Inbound, HMAC-verified Telegram relay from the external listener.",
  "wbgt:/api/wbgt-whatsapp": "Inbound WhatsApp intake.",
  "wbgt:/api/water-parade-intake": "Inbound confirmations from the listener.",
  "wbgt:/api/water-parade-rebuild": "Reprojects stored state into the Water Parade Log tab.",
  "wbgt:/api/water-parade-photo-refresh": "Refreshes stored photo links.",
};

/** The route kinds that never need an entry: they answer a caller, they do not deliver. */
export const QUIET_KINDS: ReadonlySet<string> = new Set(["diagnostic", "read"]);


