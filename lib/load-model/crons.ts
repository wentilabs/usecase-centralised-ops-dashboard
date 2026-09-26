/**
 * The EventBridge rules that actually invoke the services, in Singapore hours.
 *
 * Read from the AWS console on 2026-09-22. This is the one thing in the load
 * model that is NOT derivable from a repository: there is no IaC anywhere in
 * the estate, the rules are configured by hand, and the service READMEs that
 * describe them are in places wrong — WBGT's contradicts itself about its own
 * hourly rule in two sections.
 *
 * **The expressions are UTC.** Every rule here was quoted with its own console
 * label, and the labels confirm the offset: `cron(0 11 * * ? *)` is named
 * "Noise Evening Summary 7PM", and 11:00 UTC is 19:00 in Singapore. So every
 * `hours` array below is the UTC hour list plus eight, wrapped.
 *
 * Why it matters. A project's configuration can only fire in an hour the cron
 * actually runs in. Before this table the model took a configured hour at face
 * value, which put the Issue Chaser chat-group summary at whatever hour its
 * schedule column named — while its rule fires once a day, so any hour but
 * 08:00 never happens at all.
 *
 * **When a rule changes in the console, it changes here.** Nothing detects
 * that automatically; the `utc` string is kept verbatim so the two can be
 * compared by eye.
 */

/** UTC hours → Singapore hours. */
export function sgtHours(...utc: number[]): number[] {
  return [...new Set(utc.map((hour) => (hour + 8) % 24))].sort((a, b) => a - b);
}

/** Every hour of the day — for a rule with no hour restriction. */
export const EVERY_HOUR: number[] = Array.from({ length: 24 }, (_, hour) => hour);

export type CronRule = {
  /** The rule's name in the console, so the two can be matched up. */
  name: string;
  route: string;
  /** The expression exactly as the console shows it. */
  utc: string;
  /** Singapore hours it fires in. Empty means it never fires on a weekday. */
  hours: number[];
};

/**
 * Only the rules that can produce an outbound message.
 *
 * Scrapes, sheet fills, retries, ingestion and health checks are left out:
 * they cost real Lambda time but they post nothing to a group, and this model
 * counts messages to groups.
 *
 * Weekly rules are left out too, by request — the Novade name reminder and its
 * sync (Saturdays), the Water Parade photo refresh (Saturdays), the noise
 * limits refresh (Sundays) and the Sunday Leq12h hourly summary. A chart of an
 * ordinary weekday should not carry them.
 */
export const CRONS = {
  wbgt: {
    hourly: { name: "WH Projects: WBGT readings hourly", route: "/api/wbgt-hourly", utc: "cron(1/15 * * * ? *)", hours: EVERY_HOUR },
    waterParadeReminder: {
      name: "Water Parade reminders every 30mins",
      route: "/api/water-parade-reminder",
      // Twice an hour, and only in UTC 03–11 — Singapore 11:00 to 19:59. The
      // model previously spread these across the whole site day.
      utc: "cron(30,56 3-11 * * ? *)",
      hours: sgtHours(3, 4, 5, 6, 7, 8, 9, 10, 11),
    },
    waterParadeSummary: { name: "water parade reminder summary", route: "/api/water-parade-daily-summary", utc: "cron(5 * * * ? *)", hours: EVERY_HOUR },
    fiveMin: { name: "WH Projects: WBGT 5mins reading", route: "/api/wbgt-5min", utc: "cron(0/5 * * * ? *)", hours: EVERY_HOUR },
  },
  noise: {
    fiveMin: { name: "WH Projects: Noise Reading 5min", route: "/api/noise-5min", utc: "cron(3/5 * * * ? *)", hours: EVERY_HOUR },
    halfHourly: { name: "WH Projects: Noise Reading Half-Hourly", route: "/api/noise-half-hourly", utc: "cron(3/5 * * * ? *)", hours: EVERY_HOUR },
    hourly: { name: "WH Projects: Noise Reading Hourly", route: "/api/noise-hourly", utc: "cron(4 * * * ? *)", hours: EVERY_HOUR },
    fifteenMinAverage: { name: "Noise every 15 mins average value and exceedance only", route: "/api/noise-15min-average-exceedance", utc: "cron(17,32,47 * * * ? *)", hours: EVERY_HOUR },
    threeHour: { name: "WH Projects: Noise 3H summaries", route: "/api/noise-3hour-summary", utc: "cron(3 2,5,8,11 * * ? *)", hours: sgtHours(2, 5, 8, 11) },
    // Fixed by the rule, not by `morning_summary_start_hhmm` — the Lambda is
    // invoked once, at 07:00 Singapore, and cannot send at any other hour.
    morning: { name: "WH Projects: Noise Morning Summary 7AM", route: "/api/noise-morning-summary", utc: "cron(0 23 * * ? *)", hours: sgtHours(23) },
    evening: { name: "WH Projects: Noise Evening Summary 7PM", route: "/api/noise-evening-summary", utc: "cron(0 11 * * ? *)", hours: sgtHours(11) },
    leq12hrTable: { name: "WH Projects: Noise Meter hourly Leq and 12hr estimate TABLE message", route: "/api/noise-7am-7pm-leq12hr-table", utc: "cron(3 0-11 * * ? *)", hours: sgtHours(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11) },
  },
  haze: {
    hourly: { name: "Haze alerts hourly", route: "/api/haze-hourly", utc: "cron(0 * * * ? *)", hours: EVERY_HOUR },
    // 23:45 UTC — 07:45 Singapore. Fixed, so it does not follow the project's
    // working-hours start the way the model used to assume.
    kickoff: { name: "Haze Alerts Kick Off", route: "/api/haze-kickoff", utc: "cron(45 23 * * ? *)", hours: sgtHours(23) },
  },
  lightning: {
    tick: { name: "lighting ticks minutely", route: "/api/lightning-tick", utc: "cron(* * * * ? *)", hours: EVERY_HOUR },
    // A real scheduled message, and the model had lightning as entirely
    // storm-driven — so this one was missing from the chart altogether.
    kickoff: { name: "lightning alerts kickoff message", route: "/api/lightning-kickoff", utc: "cron(30 23 * * ? *)", hours: sgtHours(23) },
  },
  ailytics: {
    yesterdaySummary: { name: "ailytics yesterday summary", route: "/ailytics-safety/yesterday-24h-summary", utc: "cron(0 * * * ? *)", hours: EVERY_HOUR },
    // Also missing from the model until now.
    statusSummary: { name: "Ailytics issues summary", route: "/ailytics-safety/status-summary", utc: "cron(0 10 * * ? *)", hours: sgtHours(10) },
  },
  subcon: {
    // Two rules on the SAME route, so a project past its start hour is
    // summarised twice a day. `morningReportGate` is `currentSgtHour >=
    // startHour` with no once-a-day guard anywhere near it.
    manpowerSummary: { name: "Subcon Activties: Manpower Summary + 4PM Manpower Summary", route: "/daily-manpower-summary", utc: "cron(5 2 ? * * *) + cron(5 8 ? * * *)", hours: sgtHours(2, 8) },
    activitySummary: { name: "Subcon Activities: Activity Summary", route: "/daily-activity-summary", utc: "cron(5 4 ? * * *)", hours: sgtHours(4) },
    // 14:10 UTC — 22:10 Singapore. It has a real hour after all, so it belongs
    // on the chart rather than in the "no clock position" list.
    housekeepingReminder: { name: "Subcon Activities: Housekeeping Nightly Reminder", route: "/daily-housekeeping-report", utc: "cron(10 14 ? * * *)", hours: sgtHours(14) },
  },
  issueChaser: {
    severityCadence: { name: "Issues: Check every 30mins and severity-based", route: "/api/issue-chaser-severity-cadence", utc: "cron(*/30 * * * ? *)", hours: EVERY_HOUR },
    sameDayOpen: { name: "Issues: Same day open issues reminder", route: "/api/issue-chaser-same-day-open", utc: "cron(0 * * * ? *)", hours: EVERY_HOUR },
    safetySummary: { name: "Issue chaser text only summary", route: "/api/past-days-safety-summary", utc: "cron(0 * * * ? *)", hours: EVERY_HOUR },
    companySummary: { name: "Issue chaser company text only summary", route: "/api/past-days-company-safety-summary", utc: "cron(0 * * * ? *)", hours: EVERY_HOUR },
    /**
     * The exception that proves the table is needed.
     *
     * Its rule fires ONCE a day, at 00:00 UTC — 08:00 Singapore — while the
     * other two summaries run hourly. The schedule column still decides
     * whether the project sends, so a project whose
     * `daily_safety_chatgroup_summary_schedule` names any hour but 08:00 never
     * sends this report at all, however carefully it is configured.
     */
    chatgroupSummary: { name: "daily-safety-chatgroup-safety-summary", route: "/api/past-days-chatgroup-safety-summary", utc: "cron(0 0 * * ? *)", hours: sgtHours(0) },
  },
} as const;

/** The hours a configured cadence can actually fire in. */
export function within(configured: number[], rule: { hours: readonly number[] }): number[] {
  const allowed = new Set(rule.hours);
  return configured.filter((hour) => allowed.has(hour));
}
