import type { ProjectConfigRow, ServiceKey } from "../services";
import { ASSESS_COL, splitList } from "./groups";

/** How one Issue Chaser severity cadence's send window reads on a card. */
function severityWindow(config: ProjectConfigRow, startColumn: string, endColumn: string): string {
  const clip = (value: unknown) => String(value ?? "").trim().slice(0, 5);
  const start = clip((config as Record<string, unknown>)[startColumn]);
  const end = clip((config as Record<string, unknown>)[endColumn]);
  if (!start && !end) return "round the clock";
  if (!start || !end) return "on a half-set window — nothing is due until both ends are set";
  return `within ${start}–${end}`;
}

export function formatHhmm(value: unknown): string {
  const raw = String(value ?? "");
  const padded = raw.padStart(4, "0");
  return /^\d{4}$/.test(padded) ? `${padded.slice(0, 2)}:${padded.slice(2)}` : raw || "—";
}

export function formatSgt(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

/**
 * `phrase` exists for subcon, where the same two columns mean something
 * narrower. Everywhere else the whole service is outbound, so "muted Sundays"
 * describes the project. Subcon also takes messages IN on a muted date and
 * still records them, so the default wording would claim the project is dark
 * when only its reports are.
 */
function mutesSuffix(config: ProjectConfigRow, phrase = "muted"): string {
  const mutes: string[] = [];
  if (config.remove_sunday_notifications) mutes.push("Sundays");
  if (config.remove_ph_notifications) mutes.push("PH");
  return mutes.length ? ` — ${phrase} ${mutes.join(" + ")}` : "";
}

function window(start: unknown, end: unknown): string {
  return start || end ? ` (${formatHhmm(start)}–${formatHhmm(end)})` : "";
}

/** One line describing when a project's messages actually fire. */
export function firesAt(service: ServiceKey, config: ProjectConfigRow): string {
  if (service === "wbgt") {
    const parts: string[] = [];
    if (config.enable_hourly) parts.push(":00 hourly");
    if (config.enable_intermittent_reports) {
      parts.push(
        String(config.intermittent_reports_formatter ?? "red15").toLowerCase() === "red30"
          ? ":30 if High"
          : ":30 if Moderate+, :15/:45 if High",
      );
    }
    if (config.enable_5min_alerts) parts.push(`5-min on ${fiveMinCrossings(config)} crossings`);
    if (config.water_parade_enabled) {
      // The cooldown changes how often a site is asked, which is the part an
      // operator is answering questions about — worth a clause, not just a pill.
      parts.push(
        config.water_parade_cooldown_enabled
          // Phrased as the lookback the code performs — `cooldownHourBands`
          // checks the two preceding hour bands of the same day — rather than
          // "one per 3 bands", which is the same rule stated as arithmetic and
          // reads as a contradiction next to the "cooldown 2h" pill.
          ? "Water Parade reminders, skipped if a cycle ran in the previous 2 hour bands"
          : "Water Parade reminders",
      );
    }
    if (!parts.length) {
      return isManualIngestion(service, config)
        ? "Manual photo ingestion — readings arrive as photos; no scheduled message"
        : "No cadences enabled";
    }
    let line = `${parts.join(" · ")} — site hours ${config.site_hours_start}:00–${config.site_hours_end}:00`;
    if (config.skip_lunch_hour) line += ", skips 12:00";
    return line + mutesSuffix(config).replace(" — muted", ", muted");
  }

  if (service === "noise") {
    const parts: string[] = [];
    if (config.enable_5min) parts.push(`5-min${window(config.five_min_start_hhmm, config.five_min_end_hhmm)}`);
    if (config.enable_half_hourly) {
      const marks = String(config[ASSESS_COL] ?? "30")
        .split(",")
        .map((m) => m.trim().padStart(2, "0"))
        .join(" :");
      const relay = config.half_hourly_send_if_exceed ? ", warnings relayed" : "";
      parts.push(
        `half-hourly @ :${marks}${window(config.half_hourly_start_hhmm, config.half_hourly_end_hhmm)}${relay}`,
      );
    }
    if (config.enable_hourly) parts.push(`hourly${window(config.hourly_start_hhmm, config.hourly_end_hhmm)}`);
    if (config.enable_three_hour_summary) parts.push("3-hr summary");
    if (config.enable_morning_summary) {
      parts.push(
        `morning${config.morning_summary_start_hhmm ? ` @ ${formatHhmm(config.morning_summary_start_hhmm)}` : ""}`,
      );
    }
    // Fixed 07:00–19:00 closeout, scheduled at 19:00 — no configurable start.
    if (config.enable_evening_summary) parts.push("evening 7am–7pm closeout @ 19:00");
    if (config.enable_sunday_leq12h_hourly) parts.push("Sunday Leq12h hourly");
    if (config.enable_7am_7pm_leq12hr_table) parts.push("Leq12hr table @ 07:00/19:00");
    if (!parts.length) return "No cadences enabled";
    return parts.join(" · ") + mutesSuffix(config);
  }

  if (service === "haze") {
    // The service treats a half-configured window as no window at all, so one
    // end on its own must not be reported here as a range.
    const bothEnds = Boolean(config.working_hours_start_hhmm && config.working_hours_end_hhmm);
    const hours = bothEnds
      ? `${formatHhmm(config.working_hours_start_hhmm)}–${formatHhmm(config.working_hours_end_hhmm)}`
      : "all day";
    const gate = config.alert_only_when_at_least
      ? ` — only when PSI ≥ ${String(config.alert_only_when_at_least).replace(/_/g, " ")}`
      : "";
    if (config.four_hourly) {
      // Every two hours since ca13cbd, not four — the column name did not
      // change with the behaviour. Listed as a range rather than seven times,
      // which is what an operator is actually checking.
      //
      // The override sends at those hours whatever the band AND outside the
      // working-hours window, which is why the 20:00 slot fires for a project
      // whose window closes at 19:00. Every other hour follows the ordinary
      // gates, so the floor is still quoted — dropping it would imply the
      // whole day ignores it.
      return `hourly advisory during ${hours}${gate}, plus a guaranteed send every 2 hours from 08:00 to 20:00 whatever the band and outside those hours — no daily kickoff${mutesSuffix(
        config,
      )}`;
    }
    return `hourly advisory during ${hours}${gate}${mutesSuffix(config)}`;
  }

  if (service === "lightning") {
    const hours =
      config.working_hours_start_hhmm || config.working_hours_end_hhmm
        ? `${formatHhmm(config.working_hours_start_hhmm)}–${formatHhmm(config.working_hours_end_hhmm)}`
        : "all day";
    const scope = config.amber_enabled === false ? "red-only" : "red + amber";
    return `${scope} — every tick while a qualifying strike is in range, working hours ${hours}${mutesSuffix(config)}`;
  }

  if (service === "subcon") {
    // Six routes now. /housekeeping-intake accepts forwarded messages,
    // /daily-housekeeping-report sends the nightly checklist to the same groups
    // it takes intake from, /daily-housekeeping-sheet and
    // /refresh-housekeeping-photos maintain the HOUSEKEEPING sheet, and
    // /daily-activity-summary and /daily-manpower-summary send the two morning
    // summaries.
    //
    // `enable_housekeeping` gates the first four together — it was the intake
    // switch until 5df3928 widened it to the whole feature (INV-HK-01), and a
    // card that still treated the nightly report as governed by `enabled`
    // alone would promise a message that is no longer sent. `enabled` remains
    // the outbound gate on top of it.
    //
    // Naming both reports matters because they read different tabs and answer
    // different questions, and until the per-report columns exist one switch
    // sends both — so a card saying "morning report" left an operator unable to
    // tell which of the two a site actually receives.
    const parts: string[] = [];
    // `=== true` rather than `!== false`, because the service reads it that
    // way and the repo says so outright: "Only an explicit true enables it."
    const housekeeping = config.enable_housekeeping === true;
    if (housekeeping) {
      // Supabase, not a sheet tab. The service stopped writing the Daily
      // Activity projection when Supabase became canonical, so naming the tab
      // here would send someone to a document that no longer updates.
      parts.push("housekeeping events recorded in Supabase");
    }
    // A third outbound report, and the one HALO used to omit entirely. Since
    // 140b1e9 it goes to the housekeeping groups rather than the summary
    // destination, and since 5df3928 it needs Housekeeping on as well as
    // Scheduled reports — it used to need only the latter.
    const nightly =
      housekeeping && config.enabled !== false && Boolean(String(config.safety_group_ids ?? "").trim());
    if (nightly) {
      parts.push("nightly housekeeping report to the housekeeping groups");
    }
    // Each report is an explicit opt-in in the service, so a project can be
    // enabled and still send nothing.
    const reports = subconReports(config);
    // Not joined with "+": each name already contains one, and "activity +
    // manpower + manpower + machines" reads as one report with four parts.
    if (reports.length === 2) {
      parts.push("morning reports: activity + manpower, and manpower + machines");
    } else if (reports.length === 1) {
      parts.push(`only the ${reports[0]} morning report`);
    }
    if (!parts.length) return "Nothing is accepted and nothing is sent";
    let line = `Event-driven on forwarded WhatsApp — ${parts.join(" · ")}`;
    // A report with no destination is the quiet failure worth surfacing.
    if (reports.length && !String(config.manpower_activity_outbound_group_id ?? "").trim()) {
      line += " — no report group set, so nothing is delivered";
    }
    // Only when something is actually sent. On an intake-only project the mutes
    // are still stored and still true, but they suppress nothing, and saying so
    // on the card would send someone looking for a report that was never on.
    if (nightly || reports.length) {
      line += mutesSuffix(config, "no reports on");
    }
    return line;
  }
  if (service === "issueChaser") {
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

    // Said separately from the chasers, not folded into them. A summary chases
    // nobody and never uses an issue's origin group — it carries the opposite
    // routing, so sharing the chasers' suffix would state the wrong destination.
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
    // The workbook is still read on a muted date — the suppression is at the
    // send — so this qualifies the clauses above without contradicting the
    // opening verb.
    return `Reads the Safety workbook — ${clauses.join("; ")}${mutesSuffix(config, "nothing sent on")}`;
  }

  return "Event-driven — fires when the CCTV bot posts.";
}

/**
 * A WBGT project fed by photos rather than by the CloudLynx scraper.
 *
 * These have every cadence off, so the old binary "has a cadence?" test filed
 * them with the idle projects — greyed out and sunk to the bottom — even though
 * they are live sites whose readings arrive by hand. The three conditions are
 * the ones that together mean "manual": the project is on, the scraper is off,
 * and there is somewhere for photos to come from.
 */
export function isManualIngestion(service: ServiceKey, config: ProjectConfigRow): boolean {
  if (service !== "wbgt") return false;
  if (config.enabled === false) return false;
  // Scrape defaults to on, so only an explicit false means manual.
  if (config.enable_scrape !== false) return false;
  return (
    splitList(config.whatsapp_wbgt_source_chat_ids).length > 0 ||
    splitList(config.telegram_chat_ids).length > 0 ||
    // The signed external Telegram route (64d2145). It does NOT use
    // `telegram_chat_ids` — the parser registry in the service decides which
    // text belongs to which project — so a project fed entirely by it has both
    // chat lists empty and would have read as idle, which is the exact failure
    // this function exists to prevent.
    //
    // Sufficient, not necessary: the flag governs the outbound advisory and
    // readings are parsed and stored either way, so a project with it OFF may
    // still be fed this way and cannot be told apart here. On is a deliberate
    // act and means the project is working.
    config.enable_external_telegram_alerts === true
  );
}

/**
 * How prominent a card should be. Three states, not two: a manual project is
 * working, so it must not look like an idle one, but it has no schedule either.
 */
export type CardEmphasis = "active" | "manual" | "idle";

export function cardEmphasis(service: ServiceKey, config: ProjectConfigRow): CardEmphasis {
  if (hasCadence(service, config)) return "active";
  if (isManualIngestion(service, config)) return "manual";
  return "idle";
}

/** Sort weight: scheduled first, then manual, then idle. */
export function emphasisRank(service: ServiceKey, config: ProjectConfigRow): number {
  const order: Record<CardEmphasis, number> = { active: 2, manual: 1, idle: 0 };
  return order[cardEmphasis(service, config)];
}

/**
 * A report's hourly schedule, as the card says it.
 *
 * `HH00,lookback` entries separated by `;`, added by the issue-chaser repo's
 * ece9060 and backfilled from the old fixed times — so every project reads the
 * same as before until someone changes one, and ten of them already have. The
 * card used to write "09:00 and 21:00" and "at 08:00" as literals, which stopped
 * being true for those ten the moment the migration ran.
 *
 * Parsing mirrors `lib/hourly-schedule.js`: minutes are always `00` and only
 * the hour is matched, so an entry that does not fit the shape is one the
 * service will refuse. Those are dropped here rather than guessed at, and the
 * clause falls back to naming no time at all.
 */
export function reportSchedule(value: unknown): { times: string[]; lookback: number | null } {
  const entries = String(value ?? "")
    .split(";")
    .map((part) => /^(2[0-3]|[01]\d)00\s*,\s*(\d+)$/.exec(part.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match));
  if (!entries.length) return { times: [], lookback: null };
  const times = entries.map((match) => `${match[1]}:00`);
  const lookbacks = [...new Set(entries.map((match) => Number(match[2])))];
  // One number only when every run agrees; mixed lookbacks are reported per
  // entry by the editor, not summarised into a figure that is true of neither.
  return { times, lookback: lookbacks.length === 1 ? lookbacks[0] : null };
}

/**
 * Which of subcon's two morning reports a project actually receives.
 *
 * Two gates, in the service's own order. `isSummaryEnabled` in that repo is
 * `config?.[column] === true`, so a report is sent only when its switch is
 * explicitly on — the columns are an explicit opt-in, and the repo's migration
 * says so outright ("Existing rows receive false so adding this migration
 * cannot unexpectedly start new report sends"). `enabled` then gates outbound
 * delivery for whichever survived.
 *
 * Matched to `=== true` rather than `!== false` deliberately: the card has to
 * predict what the service will do, and the two differ for a null or missing
 * value. The columns are NOT NULL so real rows cannot hit that, but a card
 * built from a partial row should under-claim rather than promise a send.
 */
export function subconReports(config: ProjectConfigRow): string[] {
  if (config.enabled === false) return [];
  const reports: string[] = [];
  if (config.enable_activity_summary === true) reports.push("activity + manpower");
  if (config.enable_manpower_summary === true) reports.push("manpower + machines");
  return reports;
}

/**
 * Which 5-minute crossings actually send, given the configured minimum.
 *
 * A blank column is not "unset" — it is the orange-only behaviour every project
 * had before `five_min_alert_threshold` existed, so it reads the same as an
 * explicit orange rather than as a gap.
 */
export function fiveMinCrossings(config: ProjectConfigRow): string {
  switch (String(config.five_min_alert_threshold ?? "").trim().toLowerCase()) {
    case "yellow":
      return "31/32/33°C";
    case "red":
      return "33°C";
    default:
      return "32/33°C";
  }
}

/** Cards with nothing scheduled sink to the bottom of the grid. */
export function hasCadence(service: ServiceKey, config: ProjectConfigRow): boolean {
  if (service === "wbgt") {
    return Boolean(
      config.enable_hourly ||
        config.enable_intermittent_reports ||
        config.enable_5min_alerts ||
        // Water Parade sends its own reminders, so the project is not idle.
        config.water_parade_enabled,
    );
  }
  if (service === "noise") {
    return Boolean(
      config.enable_5min ||
        config.enable_half_hourly ||
        config.enable_hourly ||
        config.enable_three_hour_summary ||
        config.enable_morning_summary ||
        config.enable_evening_summary ||
        config.enable_sunday_leq12h_hourly ||
        config.enable_7am_7pm_leq12hr_table,
    );
  }
  if (service === "subcon") {
    // Any of the three is work — a project with housekeeping on is not idle,
    // even with both summaries off. The summaries are counted through
    // `subconReports` rather than `enabled`, so a project left enabled with
    // both switched off is not called scheduled.
    //
    // The nightly housekeeping report now needs Housekeeping as well as
    // `enabled` and a group list (INV-HK-01), which makes it a subset of the
    // first clause rather than an independent third one — a project with
    // groups but housekeeping off sends nothing at all.
    return config.enable_housekeeping === true || subconReports(config).length > 0;
  }
  if (service === "issueChaser") {
    // `enabled` alone sends nothing — a chaser style has to be on too, and a
    // CHECK means a style cannot be on unless `enabled` already is.
    return Boolean(
      config.severity_cadence_chaser_enabled ||
        config.same_day_open_snapshot_enabled ||
        // A summary is scheduled work too. Without these, a project running
        // only the 08:00 report would sink to the bottom as "nothing
        // scheduled" while it is messaging a site every morning.
        config.daily_safety_summary_enabled ||
        config.daily_safety_company_summary_enabled,
    );
  }
  return config.enabled !== false;
}
