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
        scheduleHours(config.same_day_open_snapshot_schedule),
        "same-day open snapshot",
        chaseGroups,
        "conditional",
      );
    }

    // The three summaries, each with its own schedule and its own destination
    // column ahead of the shared fallback.
    const summaries: { flag: string; schedule: string; column: string; cadence: string }[] = [
      {
        flag: "daily_safety_summary_enabled",
        schedule: "daily_safety_summary_schedule",
        column: "daily_safety_summary_whatsapp_group_ids",
        cadence: "past-days safety summary",
      },
      {
        flag: "daily_safety_company_summary_enabled",
        schedule: "daily_safety_company_summary_schedule",
        column: "daily_safety_company_summary_whatsapp_group_ids",
        cadence: "…split by company",
      },
      {
        flag: "daily_safety_chatgroup_summary_enabled",
        schedule: "daily_safety_chatgroup_summary_schedule",
        column: "daily_safety_chatgroup_summary_whatsapp_group_ids",
        cadence: "…split by chat group",
      },
    ];

    for (const summary of summaries) {
      if (config[summary.flag] !== true) continue;
      // Statistics, not exceptions: the report goes out whether or not there
      // were issues, so it is scheduled.
      add(
        scheduleHours(config[summary.schedule]),
        summary.cadence,
        countFirst(config, [summary.column, ...SUMMARY_FALLBACK]),
        "scheduled",
      );
    }

    if (config.novade_name_list_check_enabled === true) {
      // Weekly, and the weekday lives in an EventBridge rule rather than in
      // the config — the service's docblock says the schedule is deliberately
      // not hard-coded. Nothing here can place it on a day, let alone an hour.
      ambient.push({
        service: "issueChaser",
        projectCode,
        reason: "Weekly Novade name reminder — its day and hour are in the scheduler, not the config",
        groups: countFirst(config, ["novade_name_list_check_whatsapp_group_ids", "whatsapp_group_ids"]),
      });
    }

    return { occurrences, ambient };
  },
};
