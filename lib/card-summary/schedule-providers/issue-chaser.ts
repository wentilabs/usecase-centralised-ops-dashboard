import type { ProjectConfigRow } from "../../services";
import type { ScheduleProvider } from "../schedule-types";
import { splitList } from "../groups";
import { mutesSuffix, reportSchedule, severityWindow } from "../schedule-helpers";

/** Service-owned card schedule and cadence semantics. */
export const issueChaserScheduleProvider: ScheduleProvider = {
  firesAt(config: ProjectConfigRow): string {
    const parts: string[] = [];
    if (config.severity_cadence_chaser_enabled) {
          // The windows are configuration now, not constants. This line used to say
          // "P2 daily and P3 weekly within 07:00–19:00" and that became wrong the
          // moment the columns landed: `configuredWindow` returns null when neither
          // end is set and `isInSendWindow` then returns true, so an unset window is
          // round the clock — the opposite of the old fixed hours. lib/cadence.js
          // still exports DAY_WINDOW_START/END but no longer reads them.
          parts.push(
            `P1 every 3h ${severityWindow(config, "severity_p1_window_start", "severity_p1_window_end")}` +
              `, P2 daily and P3 weekly ${severityWindow(config, "severity_p2_p3_window_start", "severity_p2_p3_window_end")}`,
          );
        }
    if (config.same_day_open_snapshot_enabled) {
          // The schedule decides both when it runs and how far each run looks
          // back; `include_days_before_snapshot` is only the manual-call value now.
          const schedule = reportSchedule(config.same_day_open_snapshot_schedule);
          const lookback = schedule.lookback ?? Number(config.include_days_before_snapshot ?? 0);
          // The exclusion list belongs on this clause and no other: it narrows the
          // snapshot alone, so putting it in the shared suffix would read as a
          // project-wide mute.
          const excluded = splitList(config.exclude_whatsapp_group_ids).length;
          parts.push(
            `same-day open snapshot${schedule.times.length ? ` at ${schedule.times.join(" and ")}` : ""}` +
              (Number.isFinite(lookback) && lookback > 0
                ? ` covering the previous ${lookback} day${lookback === 1 ? "" : "s"} too`
                : "") +
              (excluded ? `, skipping ${excluded} group${excluded === 1 ? "" : "s"}` : ""),
          );
        }
    const summaries: string[] = [];
    if (config.novade_name_list_check_enabled) summaries.push("weekly Novade name reminder");
    if (config.daily_safety_summary_enabled) summaries.push("past-days safety summary");
    if (config.daily_safety_company_summary_enabled) {
          summaries.push(summaries.length ? "the same split by company" : "past-days summary by company");
        }
    if (!parts.length && !summaries.length) return "No chaser style enabled — nothing is sent";
    const clauses: string[] = [];
    if (parts.length) {
          // Worth stating: the destination is usually not a configured group at all.
          clauses.push(
            `${parts.join(" · ")} — ${
              config.send_to_originating_groups === false
                ? "replies to the configured groups"
                : "replies in each issue's originating group"
            }`,
          );
        }
    if (summaries.length) {
          // Both summaries have their own schedule and can run at different hours.
          // Named once when they agree, which is every project today.
          const plans = [
            config.daily_safety_summary_enabled ? reportSchedule(config.daily_safety_summary_schedule) : null,
            config.daily_safety_company_summary_enabled
              ? reportSchedule(config.daily_safety_company_summary_schedule)
              : null,
          ].filter((plan): plan is { times: string[]; lookback: number | null } => Boolean(plan));
          const times = [...new Set(plans.flatMap((plan) => plan.times))];
          const lookbacks = [...new Set(plans.map((plan) => plan.lookback))];
          const scheduled = lookbacks.length === 1 && lookbacks[0] !== null ? lookbacks[0] + 1 : null;
          const days = scheduled ?? Number(config.summary_days ?? 5);
          const span = Number.isFinite(days) && days > 0 ? days : 5;
          clauses.push(
            `${summaries.join(" and ")}${times.length ? ` at ${times.join(" and ")}` : ""} over ${span} day${span === 1 ? "" : "s"}` +
              // Never the originating group, and since 807adfc not necessarily the
              // main list either — the summaries have their own destination, with
              // the main list as the fallback.
              (String(config.safety_summary_whatsapp_group_ids ?? "").trim()
                ? ", to the summary groups"
                : ", to the configured groups"),
          );
        }
    return `Reads the Safety workbook — ${clauses.join("; ")}${mutesSuffix(config, "nothing sent on")}`;
  },
  hasCadence(config: ProjectConfigRow): boolean {
    return Boolean(
          config.severity_cadence_chaser_enabled ||
            config.same_day_open_snapshot_enabled ||
            // A summary is scheduled work too. Without these, a project running
            // only the 08:00 report would sink to the bottom as "nothing
            // scheduled" while it is messaging a site every morning.
            config.daily_safety_summary_enabled ||
            config.daily_safety_company_summary_enabled,
        );
  },
};
