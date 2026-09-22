import { CRONS, within } from "../crons";
import { countFirst, countIn, isEnabled, scheduleHours, windowHours } from "../helpers";
import type { Ambient, LoadProvider, Occurrence, RowLoad } from "../types";
import type { ProjectConfigRow } from "../../services";

/**
 * Read from the issue-chaser repo's `usecases/issue_chaser/index.js`,
 * `lib/cadence.js` and `lib/hourly-schedule.js`.
 *
 * The severity chaser ticks every thirty minutes and applies a per-issue
 * cursor: P1 every three hours, P2 daily, P3 weekly, each inside its own
 * configured window. The snapshot and the three summaries each carry their own
 * `HH00,lookback` schedule, and the hour in it is what places them.
 *
 * The summaries resolve their destination through a fallback chain — the
 * style's own column, then the shared summary list, then the legacy list — and
 * `countFirst` follows it rather than adding the columns up.
 */
const SUMMARY_FALLBACK = ["safety_summary_whatsapp_group_ids", "whatsapp_group_ids"];

export const issueChaserLoadProvider: LoadProvider = {
  forRow(config: ProjectConfigRow): RowLoad {
    if (!isEnabled(config)) return { occurrences: [], ambient: [] };

    const projectCode = String(config.project_code ?? "");
    const occurrences: Occurrence[] = [];
    const ambient: Ambient[] = [];

    const add = (hours: number[], cadence: string, sends: number, certainty: Occurrence["certainty"]) => {
      if (sends <= 0) return;
      for (const hour of hours) {
        occurrences.push({ service: "issueChaser", projectCode, cadence, hour, sends, certainty });
      }
    };

    /**
     * Where a chase lands is usually NOT a configured group.
     *
     * By default both the severity chaser and the snapshot reply in each
     * issue's own originating group, so the destination count is however many
     * distinct groups currently hold an open issue — a figure that lives in a
     * spreadsheet, not in this row. Only `send_to_originating_groups: false`
     * redirects them to the configured list, and only then can they be counted.
     */
    const chasesAreCountable = config.send_to_originating_groups === false;
    const chaseGroups = chasesAreCountable ? countIn(config, "whatsapp_group_ids") : 0;
    const chaseStyles = [
      config.severity_cadence_chaser_enabled === true ? "severity chase" : null,
      config.same_day_open_snapshot_enabled === true ? "same-day open snapshot" : null,
    ].filter((label): label is string => Boolean(label));

    if (chaseStyles.length && !chasesAreCountable) {
      ambient.push({
        service: "issueChaser",
        projectCode,
        reason: `${chaseStyles.join(" and ")} reply in each issue's own originating group — the count is in the workbook, not the config`,
        groups: 0,
      });
    }

    if (config.severity_cadence_chaser_enabled === true && chasesAreCountable) {
      // The rule runs every 30 minutes, all day, so the P1 window is the only
      // constraint on the hour.
      // A P1 comes due every three hours at most, so one hour carries at most
      // one round of reminders. How many issues are in that round is the
      // workbook's business; one per group is the floor and the only figure
      // this row supports.
      add(
        windowHours(config.severity_p1_window_start, config.severity_p1_window_end),
        "P1 chase (≥1 per group)",
        chaseGroups,
        "conditional",
      );
    }

    if (config.same_day_open_snapshot_enabled === true && chasesAreCountable) {
      // One group summary per destination, at each scheduled hour. Conditional
      // because a day with nothing opened has nothing to snapshot.
      add(
        within(scheduleHours(config.same_day_open_snapshot_schedule), CRONS.issueChaser.sameDayOpen),
        "same-day open snapshot",
        chaseGroups,
        "conditional",
      );
    }

    /**
     * The three summaries, each with its own `HH00,lookback` schedule.
     *
     * A pair like `0800,3` means: at 08:00 the report goes to every group this
     * style resolves to, covering three days back. The lookback changes what
     * the message SAYS, never how many are sent, so only the hour matters
     * here — and one entry per hour named, since a schedule may carry several.
     *
     * The rule each one runs on is not the same, which is why `within` is
     * applied rather than trusting the column: two of them run hourly, so any
     * hour the column names really does fire, while the chat-group split runs
     * ONCE a day at 08:00 Singapore. A project whose chat-group schedule says
     * `1600,3` therefore sends nothing at all — the rule is not running at
     * 16:00 to read it.
     */
    const summaries: { flag: string; schedule: string; column: string; cadence: string; rule: { hours: readonly number[] } }[] = [
      {
        flag: "daily_safety_summary_enabled",
        schedule: "daily_safety_summary_schedule",
        column: "daily_safety_summary_whatsapp_group_ids",
        cadence: "past-days safety summary",
        rule: CRONS.issueChaser.safetySummary,
      },
      {
        flag: "daily_safety_company_summary_enabled",
        schedule: "daily_safety_company_summary_schedule",
        column: "daily_safety_company_summary_whatsapp_group_ids",
        cadence: "…split by company",
        rule: CRONS.issueChaser.companySummary,
      },
      {
        flag: "daily_safety_chatgroup_summary_enabled",
        schedule: "daily_safety_chatgroup_summary_schedule",
        column: "daily_safety_chatgroup_summary_whatsapp_group_ids",
        cadence: "…split by chat group",
        rule: CRONS.issueChaser.chatgroupSummary,
      },
    ];

    for (const summary of summaries) {
      if (config[summary.flag] !== true) continue;
      const named = scheduleHours(config[summary.schedule]);
      const firing = within(named, summary.rule);
      // Statistics, not exceptions: the report goes out whether or not there
      // were issues, so it is scheduled.
      add(firing, summary.cadence, countFirst(config, [summary.column, ...SUMMARY_FALLBACK]), "scheduled");

      // A configured hour its rule never runs in is a silent misconfiguration
      // — the project looks scheduled and sends nothing. Worth saying out loud
      // rather than leaving as a bar that is simply absent.
      const stranded = named.filter((hour) => !firing.includes(hour));
      if (stranded.length) {
        ambient.push({
          service: "issueChaser",
          projectCode,
          reason:
            `${summary.cadence} is scheduled for ${stranded.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(", ")}, ` +
            `but its rule only runs at ${summary.rule.hours.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(", ")} — it never sends`,
          groups: 0,
        });
      }
    }

    if (config.company_open_backlog_enabled === true) {
      // The only style with no rule at all: nothing in the console invokes
      // `/api/issue-chaser-company-open`, so it contributes no hour. Still
      // worth naming — it is a bounded batch per company group, and somebody
      // running it puts real traffic on the estate at a time this cannot
      // predict.
      ambient.push({
        service: "issueChaser",
        projectCode,
        reason: "Company open backlog — on demand only, and its destinations come from the request rather than the config",
        groups: 0,
      });
    }

    return { occurrences, ambient };
  },
};
