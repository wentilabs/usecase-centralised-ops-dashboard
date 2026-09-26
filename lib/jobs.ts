import type { ProjectConfigRow, ServiceKey } from "./services";

/**
 * Jobs HALO can trigger on the alert services.
 *
 * These endpoints already exist on the deployed Lambdas; HALO only collects the
 * inputs and forwards them. It proxies rather than calling from the browser so
 * the service URLs stay server-side and HALO's own editor permission applies.
 *
 * Two things vary per job and must not be unified:
 *
 * 1. **Payload shape.** The noise endpoints take `project_code` / `start_date` /
 *    `end_date`; `wbgt-sheet-fill` takes `projectCode` / `from` / `to`; and
 *    `wbgt-scrape` takes `projectCode` / `from` / `to` *plus* a mandatory
 *    `historical: true` opt-in. Each `buildPayload` matches the handler it
 *    targets, verified against the alert repos.
 * 2. **Precondition.** A sheet job is pointless without a sheet id; a historical
 *    scrape is pointless without an upstream to scrape. Both are re-checked
 *    server-side, because in each case the job reports success while doing
 *    nothing when the precondition is unmet.
 */

export type JobKey =
  | "noise-bootstrap"
  | "noise-sync"
  | "wbgt-fill"
  | "wbgt-scrape"
  | "wbgt-water-parade"
  | "wbgt-monthly-report"
  | "noise-monthly-report"
  | "chaser-refresh-images"
  | "chaser-project-check"
  | "chaser-preview"
  | "chaser-summary-preview"
  | "chaser-novade-sync"
  | "chaser-company-sync";

export type JobFlag = { key: string; label: string; help: string };

/** The months a monthly report can be asked for, newest first, as `YYYY-MM`. */
export const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The last twelve COMPLETED Singapore calendar months.
 *
 * Twelve, and completed, because that is exactly the set both endpoints can
 * address. Noise takes `YYYY-MM` and would accept any past month; WBGT takes a
 * bare `mmm` and resolves it to the most recent occurrence at or before last
 * month, so "Aug" can only ever mean the Aug within the last twelve. Offering a
 * thirteenth month would let someone pick Aug 2025 on WBGT and silently be sent
 * Aug 2026 — a plausible, wrong workbook, which is worse than not offering it.
 *
 * Computed rather than stored, because the set moves every month.
 */
export function completedMonths(now: Date = new Date(), count = 12): string[] {
  // Singapore is UTC+8 and never shifts, so the calendar month there is the
  // UTC month of the same instant shifted forward — no timezone library needed.
  const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const months: string[] = [];
  for (let back = 1; back <= count; back += 1) {
    const date = new Date(Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth() - back, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

/** "2026-08" → "Aug", the only month format the WBGT route accepts. */
export function monthAbbreviation(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTH_ABBREVIATIONS[index] ?? "";
}

/** "2026-08" → "Aug 2026", for the picker. */
export function monthLabel(month: string): string {
  return `${monthAbbreviation(month)} ${month.slice(0, 4)}`;
}

/**
 * One choice among several, for a job that does more than one thing.
 *
 * A flag is a boolean the endpoint accepts; a choice picks WHICH endpoint, or
 * which style the one endpoint runs. Both the Issue Chaser previews need it:
 * one report exists in three splits (plain, by company, by chat group) that
 * live at three paths, and the chase preview takes the style in its body.
 *
 * Exactly one option is always selected — the first is the default — so there
 * is no "nothing chosen" state to handle.
 */
export type JobChoice = {
  label: string;
  help: string;
  options: { value: string; label: string; help?: string }[];
};

export type JobInput = {
  projectCode: string;
  startDate: string;
  endDate: string;
  /** The selected `choice` option's value, when the job declares one. */
  choice?: string;
  /** The chosen completed calendar month as `YYYY-MM`, for a `monthly` job. */
  month?: string;
  flags?: Record<string, boolean>;
};

/**
 * An inclusive range split into pieces of at most `chunkDays`.
 *
 * `chunkDays` of 1 gives one entry per date, which is what a `perDay` endpoint
 * needs. Undefined gives the whole range as a single piece.
 */
export function eachChunk(
  startDate: string,
  endDate: string,
  chunkDays?: number,
): { startDate: string; endDate: string }[] {
  const size = Math.max(1, Math.floor(chunkDays ?? 0));
  if (!chunkDays || size <= 0) return [{ startDate, endDate }];

  const out: { startDate: string; endDate: string }[] = [];
  const last = Date.parse(`${endDate}T00:00:00Z`);
  for (let at = Date.parse(`${startDate}T00:00:00Z`); at <= last; at += size * 86_400_000) {
    const chunkEnd = Math.min(at + (size - 1) * 86_400_000, last);
    out.push({
      startDate: new Date(at).toISOString().slice(0, 10),
      endDate: new Date(chunkEnd).toISOString().slice(0, 10),
    });
  }
  return out;
}


/**
 * What must already be true of a project before the job can do its work.
 * `read` returns a short description of the satisfying value, or null if unmet.
 */
export type JobPrecondition = {
  label: string;
  read: (row: ProjectConfigRow) => string | null;
  unmet: (projectCode: string) => string;
  /**
   * Which of several conditions is the one that failed, when `read` is null.
   * A job gated on one sheet id does not need this; one gated on three separate
   * things does, because "not ready" alone leaves an operator guessing which.
   */
  detail?: (row: ProjectConfigRow, projectCode: string) => string | null;
};

export type JobDefinition = {
  key: JobKey;
  service: ServiceKey;
  /** Button label on the service's action row. */
  label: string;
  title: string;
  description: string;
  /** Env var holding the service's base URL, e.g. https://…/prod */
  baseUrlEnv: "NOISE_API_URL" | "WBGT_API_URL" | "ISSUE_CHASER_API_URL";
  /**
   * The endpoint, or one endpoint per `choice` option keyed by its value.
   *
   * A map rather than a second list of paths beside a resolver: `jobPaths`
   * derives the full set from this one field, so the contract check cannot be
   * looking at a different list from the one the route posts to.
   */
  path: string | Record<string, string>;
  /** A single choice the operator makes, when the job does more than one thing. */
  choice?: JobChoice;
  /**
   * How to show what came back.
   *
   * `counts` is right for a job that writes: the question is how much it wrote.
   * A PREVIEW has no counts worth reading — its whole value is the message
   * text — and a diagnostic's value is its fields, so summarising either into
   * "nothing to write" would throw away the only output that mattered.
   */
  resultView?: "counts" | "messages" | "json";
  precondition: JobPrecondition;
  /**
   * This endpoint takes no date range: it acts on current state.
   *
   * Absent means a range is required, which is the safe default — forgetting
   * the flag on a dateless job makes the dialog demand two dates the endpoint
   * would ignore, which is visible immediately. A default of "no dates" would
   * fail the other way, silently dropping the range from a job that needs one
   * and running it over whatever the endpoint assumes instead.
   *
   * A dateless job is never chunked, because there is nothing to divide.
   */
  dateless?: true;
  /**
   * Asks for one completed calendar month instead of a date range.
   *
   * Implies `dateless` — there is no range to chunk — but is kept separate,
   * because the dialog must render a month picker rather than nothing. A job
   * that is merely dateless asks for no period at all.
   *
   * The chosen month reaches `buildPayload` as `month`, canonical `YYYY-MM`.
   * Converting it to whatever the endpoint wants belongs there: noise takes
   * `YYYY-MM` and WBGT takes a bare `mmm`, and the picker should not have to
   * know that.
   */
  monthly?: true;
  /** Inclusive day limit the endpoint itself enforces, if any. */
  maxSpanDays?: number;
  /**
   * The longest range HALO will put in ONE request, in days.
   *
   * Not a limit the endpoint imposes — a limit the PLATFORM imposes. Amplify
   * runs these routes on SSR compute with a fixed request timeout, and a job
   * asked to walk half a year in one call was killed part-way: the browser got
   * an empty body and "Unexpected end of JSON input", which describes a parser
   * and not the problem. Chunking keeps every request short; the client walks
   * the chunks, so a run can take twenty minutes without any single request
   * needing to.
   *
   * Absent means the whole range goes in one request, which is right for the
   * jobs that finish quickly — and REQUIRED for any job that is not additive.
   *
   * Chunking is only safe when each request adds to what the last one left. A
   * job that lays a range out from a fixed origin writes the same cells every
   * time, so two chunks overwrite each other:
   *
   *   Sep 1–7   → Overview!BE4:BK4      7 columns
   *   Sep 8–14  → Overview!BE4:BK4      the SAME 7 columns
   *   Sep 1–14  → Overview!AX4:BK4      14 columns, one call
   *
   * That is measured, not assumed. Before adding `chunkDays` to a job, send it
   * two consecutive ranges and check the second writes different cells.
   */
  chunkDays?: number;
  /**
   * How long one request to this job may take, when 25s is not enough.
   *
   * Only for a job that cannot be chunked — see `chunkDays`. The platform caps
   * this regardless of what is asked for, so it buys headroom, not a promise.
   */
  timeoutMs?: number;
  /** Optional booleans the endpoint accepts. */
  flags?: JobFlag[];
  /**
   * This job PREVIEWS unless the named flag is ticked.
   *
   * The flag is phrased as the destructive act (`apply`) rather than as
   * `dryRun`, because the route forwards only flags that are `true`: an
   * unticked `dryRun` would arrive as absent, indistinguishable from never
   * having been offered, and the job would write. Positive phrasing makes the
   * absent case the safe one by construction.
   *
   * Named here rather than inferred from the flag list so the dialog can say
   * which mode it is in, in words. An unticked checkbox is not a statement,
   * and "will this actually send?" is the question an operator has in their
   * hand before pressing the button.
   */
  appliesWhen?: string;
  /**
   * List only the projects the precondition passes.
   *
   * The default is the opposite, and deliberately so: a project that cannot
   * run is normally still listed with the reason, because "why is that one
   * missing" is otherwise unanswerable from the screen. The Issue Chaser
   * maintenance jobs are the exception — their picker is meant to BE the list
   * of projects set up on the service, and a row that is switched off is not
   * one of them however clearly it is annotated.
   */
  hideUnready?: true;
  /** Extra warning shown in the dialog for jobs that do more than write a sheet. */
  caution?: string;
  buildPayload: (input: JobInput) => Record<string, unknown>;
};

const PLACEHOLDERS = new Set(["null", "undefined", "blank", "empty", "-", "n/a", "na"]);

/**
 * Whether a value is a usable Google Sheet id.
 *
 * Mirrors normalizeGoogleSheetId() in the noise repo, which treats literal
 * "null"/"undefined"/"blank"/"empty" as unset — real rows contain those, plus
 * "-" and "".
 */
export function readSheetId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || PLACEHOLDERS.has(raw.toLowerCase())) return null;
  // Accept a pasted spreadsheet URL as well as a bare id.
  const fromUrl = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  const id = fromUrl ? fromUrl[1] : raw;
  return /^[A-Za-z0-9_-]{20,}$/.test(id) ? id : null;
}

/**
 * The Water Parade rebuild needs three separate things, each failing differently
 * and none of them loudly:
 *
 *  - `enabled` — loadProjectConfigByCode() filters on it, so a disabled project
 *    comes back as `project_not_found`.
 *  - `water_parade_enabled` — the rebuild returns `water_parade_disabled` and
 *    writes nothing. Only opted-in projects have a log to rebuild.
 *  - `monthly_sheet_id` — the Water Parade Log tab lives in the *monthly*
 *    workbook, not the manpower one. Without the id, syncCycleSheets returns
 *    `missing_monthly_sheet_id` per cycle while the run still reports
 *    `completed`, which is the worst of the three to debug from the outside.
 */
function waterParadePrecondition(): JobPrecondition {
  const sheetId = (row: ProjectConfigRow) => readSheetId(row.monthly_sheet_id);
  return {
    label: "Water Parade log",
    read: (row) => {
      if (row.enabled === false) return null;
      if (row.water_parade_enabled !== true) return null;
      const id = sheetId(row);
      return id ? `writes to ${id.slice(0, 12)}…` : null;
    },
    detail: (row, projectCode) => {
      if (row.enabled === false) {
        return `${projectCode} is disabled, and the route loads enabled projects only — it would answer project_not_found.`;
      }
      if (row.water_parade_enabled !== true) {
        return `Water Parade is off on ${projectCode}. The route answers water_parade_disabled and writes nothing — turn it on in the project's editor first.`;
      }
      if (!sheetId(row)) {
        return `${projectCode} has no Monthly sheet ID, and the Water Parade Log tab lives in that workbook. Every cycle would come back unwritten while the run still reported completed.`;
      }
      return null;
    },
    unmet: (projectCode) => `${projectCode} is not ready for a Water Parade rebuild.`,
  };
}

/** The default option — the one selected when nothing has been chosen yet. */
export function defaultChoice(job: { choice?: JobChoice }): string | undefined {
  return job.choice?.options[0]?.value;
}

/**
 * Where this job posts, for the option given.
 *
 * An absent or unrecognised choice falls back to the first declared option
 * rather than throwing: a chat-planned run carries no choice, and the primary
 * option is the right default for both jobs that have one. The response echoes
 * the URL it used, so the fallback is visible rather than silent.
 */
export function jobPath(job: { path: string | Record<string, string>; choice?: JobChoice }, choice?: string): string {
  if (typeof job.path === "string") return job.path;
  return job.path[choice ?? ""] ?? job.path[defaultChoice(job) ?? ""] ?? Object.values(job.path)[0];
}

/** Every endpoint this job can reach — what the contract check verifies. */
export function jobPaths(job: { path: string | Record<string, string> }): string[] {
  return typeof job.path === "string" ? [job.path] : [...new Set(Object.values(job.path))];
}

/**
 * What "set up on Issue Chaser" means, for the maintenance jobs.
 *
 * Two conditions, and the second is not the obvious one. A Safety workbook is
 * needed because every one of these routes reads it — `listProjectConfigs`
 * filters on `safety_sheet_id` and silently drops the rest.
 *
 * `enabled` is checked HERE rather than upstream, because upstream does not
 * check it at all: the service's `listProjectConfigs` has no `enabled` filter,
 * so a switched-off project would be read, matched and written to exactly like
 * a live one. That makes hiding it a real guard rather than a cosmetic one.
 */
function chaserPrecondition(): JobPrecondition {
  const sheetId = (row: ProjectConfigRow) => readSheetId(row.safety_sheet_id);
  return {
    label: "Issue Chaser setup",
    read: (row) => {
      if (row.enabled === false) return null;
      const id = sheetId(row);
      return id ? `Safety workbook ${id.slice(0, 12)}…` : null;
    },
    detail: (row, projectCode) => {
      if (row.enabled === false) {
        return `${projectCode} is switched off in Issue Chaser. The service reads it anyway — its project list is not filtered on enabled — so it is kept out of this picker rather than left runnable.`;
      }
      if (!sheetId(row)) {
        return `${projectCode} has no Safety workbook ID, and every one of these routes reads that workbook. The service drops the project before it starts.`;
      }
      return null;
    },
    unmet: (projectCode) => `${projectCode} is not set up on Issue Chaser.`,
  };
}

function sheetPrecondition(column: string, label: string): JobPrecondition {
  return {
    label,
    read: (row) => {
      const id = readSheetId(row[column]);
      return id ? `${id.slice(0, 12)}…` : null;
    },
    unmet: (projectCode) =>
      `${label} is not configured on ${projectCode}. Set it in the project's editor first — the job would write nothing.`,
  };
}

export const JOBS: Record<JobKey, JobDefinition> = {
  "noise-bootstrap": {
    key: "noise-bootstrap",
    service: "noise",
    label: "⤓ Bootstrap sheet",
    title: "Bootstrap the noise workbook",
    description:
      "Builds the workbook structure for a date range. Occasional, not per-day — run it when a project's sheet needs its tabs and date columns laid out.",
    baseUrlEnv: "NOISE_API_URL",
    path: "/api/noise-sheet-bootstrap",
    precondition: sheetPrecondition("google_sheet_id", "Analysis sheet ID"),
    // NOT chunked, and it must stay that way. Bootstrap lays the workbook out
    // from a fixed origin: the date columns start at the same place whatever
    // start_date it is given, so a second chunk rewrites the first one's
    // columns rather than extending them. Recorded against SKW —
    //
    //   Sep 1–7   Overview!BE4:BK4
    //   Sep 8–14  Overview!BE4:BK4   <- same cells
    //   Sep 1–14  Overview!AX4:BK4   <- what one call does
    //
    // It also rebuilds the month-band header merges per call, sized from the
    // range, so the second call's bands partially overlap the first's and
    // Google rejects the batch: "You must select all cells in a merged range".
    // That is the error a chunked bootstrap produces, and it leaves the sheet
    // half-written because batchUpdate stops at the failing request.
    //
    // Sync IS additive — it writes the dates it is given — so it keeps its
    // chunking. This job trades that for one longer request.
    timeoutMs: 55_000,
    buildPayload: ({ projectCode, startDate, endDate }) => ({
      project_code: projectCode,
      start_date: startDate,
      end_date: endDate,
    }),
  },
  "noise-sync": {
    key: "noise-sync",
    service: "noise",
    label: "⟳ Sync sheet",
    title: "Sync the noise analysis sheet",
    description: "Writes each day's readings into the analysis workbook for the range given. Idempotent.",
    baseUrlEnv: "NOISE_API_URL",
    path: "/api/noise-sheet-sync",
    precondition: sheetPrecondition("google_sheet_id", "Analysis sheet ID"),
    /**
     * A range per call, four days at a time.
     *
     * `7562c33` in the noise repo taught this endpoint `start_date`/`end_date`.
     * Before that it took one `date`, so HALO walked the range a day at a time —
     * and the cost of that was almost all overhead: measured against the live
     * service on P105, the estate's heaviest project at 11 meters, a single day
     * cold is 13.2s while four days together are 12.3s, and fifteen are 30.1s.
     * Per day that is 13.2s → 3.1s → 2.0s. The config load and the workbook read
     * happen once per CALL, not once per date, so the fewer calls the better.
     *
     * Four rather than more because the request still has to answer inside the
     * platform's own limit: 8 days measured 23.3s and 15 days 30.1s, which is
     * already at it. Four leaves room for a cold start on the first call of a
     * batch, which costs about ten seconds on its own.
     */
    chunkDays: 4,
    buildPayload: ({ projectCode, startDate, endDate }) => ({
      project_code: projectCode,
      start_date: startDate,
      end_date: endDate,
    }),
  },
  "wbgt-fill": {
    key: "wbgt-fill",
    service: "wbgt",
    label: "⟳ Sync sheets",
    title: "Fill the WBGT monthly sheet",
    description:
      "Fills each hour column from the stored readings for every day in the range. Idempotent, and ungated by site hours or cadence.",
    baseUrlEnv: "WBGT_API_URL",
    path: "/api/wbgt-sheet-fill",
    precondition: sheetPrecondition("monthly_sheet_id", "Monthly sheet ID"),
    // A month per request, for the same platform-timeout reason as the noise
    // bootstrap. resolveDates() enumerates the range it is given.
    chunkDays: 31,
    // camelCase, and `from`/`to` rather than start/end — resolveDates() in
    // sheet-fill-job.js only enumerates a range when given body.from + body.to.
    buildPayload: ({ projectCode, startDate, endDate }) => ({
      projectCode,
      from: startDate,
      to: endDate,
    }),
  },
  "wbgt-monthly-report": {
    key: "wbgt-monthly-report",
    service: "wbgt",
    label: "✉ Monthly report",
    title: "Send the monthly WBGT workbook",
    description:
      "Exports last month's tab of the monthly sheet as xlsx and sends it to the monthly report groups as a WhatsApp document. The production cron runs this with an empty body; this is the same route driven by hand.",
    caution:
      "Each recipient is recorded per project and month, so a second run does not send the workbook twice to a group that already has it. Only completed months are offered — the current one is never exported.",
    baseUrlEnv: "WBGT_API_URL",
    path: "/api/generate-and-send-monthly-wbgt-report",
    // The route gained a `month` parameter in b9862c9; it was previously fixed
    // to the previous month, and this was dateless.
    monthly: true,
    // An export, an upload and a document send per recipient, four projects at
    // a time — the same headroom the other sheet-touching jobs get.
    timeoutMs: 55_000,
    precondition: {
      label: "Monthly report",
      // The route filters on this flag, so a project without it is not merely
      // unlikely to send — it is not in the run at all.
      read: (row) => (row.enable_monthly_wbgt_report === true ? "enabled" : null),
      unmet: (projectCode) =>
        `${projectCode} has its monthly report switched off, so this route skips it entirely. Turn on "Monthly report" in the editor first — it also needs a monthly sheet ID and at least one report group.`,
    },
    // Deliberately NOT hideUnready. That is the Issue Chaser exception, and it
    // exists because the Chaser service does not filter on `enabled` itself, so
    // an unready project there is a hazard rather than a note. This route does
    // filter on its own flag, so an opted-out project is simply skipped — and
    // listing it with the reason above is what tells someone the switch is off,
    // where hiding it just makes the picker mysteriously short.
    appliesWhen: "apply",
    flags: [
      {
        key: "apply",
        label: "apply",
        help: "Actually send the workbook. Leave off to export it and report who would receive it without posting anything.",
      },
    ],
    /**
     * Why the two keys are not symmetrical.
     *
     * The route resolves `body.dryRun === true || (overrideSupplied ?
     * body.dryRunOverride : isDryRun())`. So sending `dryRun: false` does NOT
     * mean "send it" — with no override it falls through to the service's own
     * `DRY_RUN_NOTIFICATION`, and a deployment with that set would silently
     * preview a run the operator asked to be real.
     *
     * `dryRunOverride: false` is the only value that forces a live send, and
     * `dryRun: true` is the only one that forces a preview. Naming each
     * explicitly leaves the service's environment out of a decision made here.
     */
    /**
     * `month` goes as a bare `mmm`, which is the only form this route takes —
     * it resolves the abbreviation to the most recent occurrence at or before
     * last month. That is why only twelve months are offered: a thirteenth
     * would resolve to the wrong year without complaining.
     */
    buildPayload: ({ projectCode, month, flags }) => ({
      projectCode,
      ...(month ? { month: monthAbbreviation(month) } : {}),
      ...(flags?.apply === true ? { dryRunOverride: false } : { dryRun: true }),
    }),
  },
  "noise-monthly-report": {
    key: "noise-monthly-report",
    service: "noise",
    label: "✉ Monthly report",
    title: "Send the monthly Noise workbook",
    description:
      "Exports one completed month of the analysis workbook as xlsx and sends it to the monthly report groups as a WhatsApp document. The cron sends last month; here you pick which.",
    caution:
      "Each recipient is recorded per project and month, so a second run does not send the same month twice to a group that already has it. Only completed months are offered.",
    baseUrlEnv: "NOISE_API_URL",
    path: "/api/noise-monthly-report",
    monthly: true,
    // An export, an upload and a document send per recipient — the same
    // headroom the other sheet-touching jobs get.
    timeoutMs: 55_000,
    precondition: {
      label: "Monthly report",
      // The route filters on this flag, so a project without it is not merely
      // unlikely to send — it is not in the run at all.
      read: (row) => (row.enable_monthly_noise_report === true ? "enabled" : null),
      unmet: (projectCode) =>
        `${projectCode} has its monthly report switched off, so this route skips it entirely. Turn on "Monthly report" in the editor first — it also needs an analysis sheet and at least one report group.`,
    },
    appliesWhen: "apply",
    flags: [
      {
        key: "apply",
        label: "apply",
        help: "Actually send the workbook. Leave off to export it and report who would receive it without posting anything.",
      },
    ],
    /**
     * snake_case, and `month` as `YYYY-MM` — noise differs from WBGT on both.
     *
     * Its dry-run resolution is also the simpler of the two:
     * `body.dryRun === true || (body.dryRun === undefined && resolveDryRun())`.
     * An explicit `false` therefore DOES force a live send here, where on WBGT
     * it would fall through to the service's own environment. Sending the key
     * explicitly either way keeps that difference out of the caller's head.
     */
    buildPayload: ({ projectCode, month, flags }) => ({
      project_code: projectCode,
      ...(month ? { month } : {}),
      dryRun: flags?.apply !== true,
    }),
  },
  "wbgt-scrape": {
    key: "wbgt-scrape",
    service: "wbgt",
    label: "⟲ Historical scrape",
    title: "Replay a historical WBGT scrape",
    description:
      "Drives CloudLynx's own date fields, walks the result pages and upserts the recovered raw readings. Use it to backfill a gap.",
    caution:
      "This logs into CloudLynx and can run for a while. It recovers readings only — the monthly sheet is filled separately by Sync sheets.",
    baseUrlEnv: "WBGT_API_URL",
    path: "/api/wbgt-scrape",
    // parseScrapeRequest() rejects anything longer, before starting a scrape.
    maxSpanDays: 31,
    precondition: {
      label: "CloudLynx scraping",
      // The job filters on enable_scrape !== false and skips with
      // project_scrape_disabled_<code>; a manual project has no upstream.
      read: (row) => (row.enable_scrape === false ? null : "enabled"),
      unmet: (projectCode) =>
        `${projectCode} runs on manual photo ingestion (Scrape CloudLynx is off), so there is no upstream to replay.`,
    },
    flags: [
      {
        key: "force",
        label: "force",
        help: "Bypass the scraper's own skip conditions. Leave off unless a normal run refused.",
      },
    ],
    // `historical: true` is a mandatory opt-in: parseScrapeRequest() rejects
    // from/to without it, and treats a bare projectCode as a normal
    // current-window scrape.
    buildPayload: ({ projectCode, startDate, endDate, flags }) => ({
      historical: true,
      projectCode,
      from: startDate,
      to: endDate,
      ...(flags?.force ? { force: true } : {}),
    }),
  },
  "wbgt-water-parade": {
    key: "wbgt-water-parade",
    service: "wbgt",
    label: "⟳ Water Parade log",
    title: "Rebuild the Water Parade log",
    description:
      "Reprojects the stored cycles and events for a date range into the Water Parade Log tab, refreshing each confirmed photo's URL on the way. Idempotent, and it dispatches nothing.",
    caution:
      "The endpoint enforces no span limit: every cycle in the range is rebuilt and written individually, so a wide range is a long run. It reprojects stored state only — company matching and vision decisions are not re-run.",
    baseUrlEnv: "WBGT_API_URL",
    path: "/api/water-parade-rebuild",
    precondition: waterParadePrecondition(),
    flags: [
      {
        key: "dryRun",
        label: "dryRun",
        help: "Preview only — reports what each cycle would write, touching neither Supabase nor the sheet.",
      },
    ],
    // camelCase `fromDate`/`toDate`: rebuildDateRange() accepts `from`/`to` as
    // aliases, but the named pair is what the docs use.
    buildPayload: ({ projectCode, startDate, endDate, flags }) => ({
      projectCode,
      fromDate: startDate,
      toDate: endDate,
      ...(flags?.dryRun ? { dryRun: true } : {}),
    }),
  },
  "chaser-refresh-images": {
    key: "chaser-refresh-images",
    service: "issueChaser",
    label: "⟳ Refresh photo links",
    title: "Refresh the Safety workbook's photo links",
    description:
      "Re-signs the Supabase photo link behind every open row's Image formula, so photos that have gone blank display again. Idempotent, and it sends nothing.",
    caution:
      "Monthly archive tabs only (Safety-Sep 2026 and the like) — the live Safety tab is deliberately left alone. It also touches open rows only: a closed row whose photo has expired stays expired.",
    baseUrlEnv: "ISSUE_CHASER_API_URL",
    path: "/api/refresh-safety-image-links",
    // No range: the job acts on whatever the workbook holds right now.
    dateless: true,
    // It reads every archive tab of the workbook in one batchGet, signs each
    // link ten at a time and writes the formulas back in one batch. A year of
    // archives is a lot of rows, and there is no range to chunk it by, so it
    // gets the same headroom as the noise bootstrap.
    timeoutMs: 55_000,
    precondition: chaserPrecondition(),
    hideUnready: true,
    appliesWhen: "apply",
    flags: [
      {
        key: "apply",
        label: "apply",
        help: "Write the refreshed formulas into the workbook. Leave off to list the cells that would change without signing a URL or touching the sheet.",
      },
    ],
    // snake_case `project_code`: the handler reads `project_code` first and
    // `projectCode` as an alias. Always scoped to one project, though the
    // endpoint would take every mapped workbook if the key were omitted —
    // every other job here runs one project at a time, and an estate-wide
    // sheet write is not something to reach by leaving a field blank.
    buildPayload: ({ projectCode, flags }) => ({
      project_code: projectCode,
      dryRun: flags?.apply !== true,
    }),
  },
  "chaser-project-check": {
    key: "chaser-project-check",
    service: "issueChaser",
    label: "◇ Diagnose project",
    title: "Check a project against its Safety workbook",
    description:
      "Reads the workbook and reports what the service can actually see: tabs found, open rows, how many are addressable, and which gates would stop a run right now. Reads only — nothing is sent or written.",
    baseUrlEnv: "ISSUE_CHASER_API_URL",
    path: "/api/issue-chaser-project-check",
    dateless: true,
    // The fields ARE the answer here. Counted into one line, a diagnostic
    // saying "312 rows, 40 open, 6 with no serial number" becomes "nothing to
    // write", which is both useless and false.
    resultView: "json",
    // It reads every discovered tab of the workbook before answering.
    timeoutMs: 55_000,
    precondition: chaserPrecondition(),
    hideUnready: true,
    buildPayload: ({ projectCode }) => ({ project_code: projectCode }),
  },
  "chaser-preview": {
    key: "chaser-preview",
    service: "issueChaser",
    label: "◎ Preview a chase",
    title: "Preview what a chaser style would send",
    description:
      "Builds the exact messages a style would post right now, per destination group, and returns them. The endpoint cannot deliver at all — it never calls the listener.",
    baseUrlEnv: "ISSUE_CHASER_API_URL",
    path: "/api/issue-chaser-preview",
    dateless: true,
    resultView: "messages",
    timeoutMs: 55_000,
    precondition: chaserPrecondition(),
    hideUnready: true,
    choice: {
      label: "Style",
      help: "Which chaser to build. This is the one route that reads `style` from the body — the two scheduled routes each hard-code their own.",
      options: [
        {
          value: "severity_cadence",
          label: "Severity cadence (P1/P2/P3)",
          help: "The forever-open chaser, one reminder per issue that is due now.",
        },
        {
          value: "same_day_open",
          label: "Same-day open snapshot",
          help: "One group summary of issues opened today and still open.",
        },
      ],
    },
    // `style` goes in the body; `dryRun` is redundant on a route that cannot
    // deliver, and sent anyway so the request says what it is for.
    buildPayload: ({ projectCode, choice }) => ({
      project_code: projectCode,
      style: choice,
      dryRun: true,
    }),
  },
  "chaser-summary-preview": {
    key: "chaser-summary-preview",
    service: "issueChaser",
    label: "▤ Preview a summary",
    title: "Preview a Safety summary",
    description:
      "Builds one of the scheduled reports as it would read right now and returns the message instead of sending it. A project with that report switched off comes back as feature_disabled, which is the honest answer rather than an empty preview.",
    caution:
      "Preview only. HALO deliberately offers no live send for these — the crons own that, and a second manual run would post the same report to a site group twice.",
    baseUrlEnv: "ISSUE_CHASER_API_URL",
    // One report in three splits, plus the weekly Novade audit. Four paths, one
    // button: they answer the same question and differ only in the grouping.
    path: {
      plain: "/api/past-days-safety-summary",
      company: "/api/past-days-company-safety-summary",
      chatgroup: "/api/past-days-chatgroup-safety-summary",
      novade: "/api/remind-write-novade-names",
    },
    dateless: true,
    resultView: "messages",
    timeoutMs: 55_000,
    precondition: chaserPrecondition(),
    hideUnready: true,
    choice: {
      label: "Report",
      help: "Which report to build. The first three are the same statistics split differently; the last is the weekly name-list audit.",
      options: [
        { value: "plain", label: "Past-days safety summary", help: "The whole site, over `summary_days` days." },
        { value: "company", label: "…split by company", help: "Each day's open issues grouped by the workbook's Company column." },
        { value: "chatgroup", label: "…split by chat group", help: "Grouped by the ChatGroup column; rows without one are left out." },
        { value: "novade", label: "Novade name reminder", help: "Counts rows with a phone number and WhatsApp name but no Novade name." },
      ],
    },
    /**
     * `scheduled: false` is the load-bearing key.
     *
     * Omitted, it defaults to TRUE on these routes, and a scheduled run only
     * fires when the project's local hour matches its schedule — so a preview
     * asked for at 14:00 against an 08:00 report would come back skipped and
     * look like a broken configuration. False means "build it now regardless".
     *
     * The Novade reminder has no scheduled mode and ignores the key.
     */
    buildPayload: ({ projectCode }) => ({
      project_code: projectCode,
      scheduled: false,
      dryRun: true,
    }),
  },
  "chaser-novade-sync": {
    key: "chaser-novade-sync",
    service: "issueChaser",
    label: "⇄ Sync Novade names",
    title: "Replace temporary names in the PIC column",
    description:
      "Looks up each PIC's real Novade name in the workbook's Novade Name List tab and rewrites the PIC cell across every discovered Safety tab. Previews by default; the result lists every cell it would change, old value and new.",
    caution:
      "Ticking apply writes to the Safety workbook. A PIC with no Novade name is left alone, and an ambiguous name — one phone matching two Novade names — is skipped rather than guessed.",
    baseUrlEnv: "ISSUE_CHASER_API_URL",
    path: "/api/sync-novade-names",
    dateless: true,
    // `updates` is the output worth reading: which cell, from what, to what.
    resultView: "json",
    timeoutMs: 55_000,
    precondition: chaserPrecondition(),
    hideUnready: true,
    appliesWhen: "apply",
    flags: [
      {
        key: "apply",
        label: "apply",
        help: "Write the names into the workbook. Leave off to preview the changes first.",
      },
    ],
    /**
     * `dryRun` is sent EXPLICITLY on every call.
     *
     * The service's own OpenAPI says it "defaults to true; only `false`
     * writes". Its code says otherwise — `dryRunRequested` is
     * `body.dryRun === true`, so an omitted key WRITES. Sending the value
     * every time means HALO's flag decides rather than a default that its
     * documentation and its implementation disagree about.
     */
    buildPayload: ({ projectCode, flags }) => ({
      project_code: projectCode,
      dryRun: flags?.apply !== true,
    }),
  },
  "chaser-company-sync": {
    key: "chaser-company-sync",
    service: "issueChaser",
    label: "⇄ Sync company names",
    title: "Fill the Company column from each row's PIC",
    description:
      "Resolves every Safety row's PIC through the workbook's Novade Name List and writes that person's company into the Company column. A row whose PIC resolves to several people gets all their companies, comma-separated. Previews by default.",
    caution:
      "Ticking apply writes to the Safety workbook, and a tab that has no Company column gets one INSERTED at column I — a structural change, not just cell values. A PIC that cannot be resolved, or that is ambiguous, is left alone rather than guessed at. Unlike every other Chaser feature this one has no per-project flag: it runs wherever a Safety workbook is mapped.",
    baseUrlEnv: "ISSUE_CHASER_API_URL",
    path: "/api/sync-company-names",
    dateless: true,
    // `columns_to_insert` and the per-tab counts are the answer, and the
    // column insertion is the part worth reading before ticking apply.
    resultView: "json",
    timeoutMs: 55_000,
    precondition: chaserPrecondition(),
    hideUnready: true,
    appliesWhen: "apply",
    flags: [
      {
        key: "apply",
        label: "apply",
        help: "Write the companies into the workbook, inserting a Company column where a tab has none. Leave off to preview both.",
      },
    ],
    // Explicit for the same reason as the Novade sync beside it: an omitted
    // `dryRun` writes.
    buildPayload: ({ projectCode, flags }) => ({
      project_code: projectCode,
      dryRun: flags?.apply !== true,
    }),
  },
};

/**
 * Exports are a different shape from the other jobs: they return a file rather
 * than a report, and each needs a read-only preflight first because the Drive
 * scope they depend on may not be granted yet. They are declared here so the
 * action row and the permission model stay in one place, and carried by their
 * own dialog rather than JobDialog.
 */
export const EXPORTS: Record<"wbgt-export" | "noise-export", ExportDefinition> = {
  "wbgt-export": {
    key: "wbgt-export",
    service: "wbgt",
    label: "⤓ Export",
    title: "Export a monthly record",
    description:
      "Exports one month's monitoring record exactly as the Google Sheet renders it — conditional formatting, merges and legend included.",
    baseUrlEnv: "WBGT_API_URL",
    path: "/api/wbgt-sheet-export",
    choose: "tab",
  },
  "noise-export": {
    key: "noise-export",
    service: "noise",
    label: "⤓ Export",
    title: "Export the analysis workbook",
    description:
      "Exports the whole analysis workbook as Google renders it. A straight read — nothing is copied or modified.",
    baseUrlEnv: "NOISE_API_URL",
    path: "/api/noise-sheet-export",
    choose: "workbook",
  },
};

export type ExportKey = keyof typeof EXPORTS;

export type ExportDefinition = {
  key: ExportKey;
  service: ServiceKey;
  label: string;
  title: string;
  description: string;
  baseUrlEnv: "NOISE_API_URL" | "WBGT_API_URL";
  path: string;
  /**
   * What the operator picks. `tab` is a single sheet, selected by `gid` on the
   * export URL. `workbook` needs no choice at all.
   *
   * Both are pure reads. The service also supports a date-window scope, but it
   * needs a writable scratch folder for the copy, so it is deliberately not
   * offered here — see the noise repo's sheet-export-job.js.
   */
  choose: "tab" | "workbook";
};

export function isExportKey(value: string): value is ExportKey {
  return Object.prototype.hasOwnProperty.call(EXPORTS, value);
}

export function exportsForService(service: ServiceKey): ExportDefinition[] {
  return (Object.keys(EXPORTS) as ExportKey[]).map((key) => EXPORTS[key]).filter((entry) => entry.service === service);
}

/** One blocker as the alert services report it. */
export type ExportBlocker = { code: string; summary: string; remedy: string; detail?: string };

/** Formats that preserve the sheet's appearance. */
export const EXPORT_FORMATS = [
  { key: "pdf", label: "PDF (.pdf)", help: "Google renders the page itself, so this is the most faithful to the sheet." },
  { key: "xlsx", label: "Excel (.xlsx)", help: "Editable, and verified to keep the conditional formatting." },
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number]["key"];

export type ExportPreflight = {
  /**
   * A boolean means the service answered. Anything else — undefined, absent —
   * means we never got a readiness report, which is NOT the same as "not ready"
   * and must be surfaced rather than silently disabling the button.
   */
  ready?: boolean;
  blockers?: ExportBlocker[];
  service_account_email?: string | null;
  /** Whether the date-window scope is available (it needs a scratch folder). */
  can_trim?: boolean;
  trim_blocker?: ExportBlocker | null;
  workbook_name?: string | null;
  spreadsheet_id?: string | null;
  tabs?: string[];
  available_dates?: string[];
  earliest_date?: string | null;
  latest_date?: string | null;
  tabs_error?: string;
};

export const JOB_KEYS = Object.keys(JOBS) as JobKey[];

export function isJobKey(value: string): value is JobKey {
  return Object.prototype.hasOwnProperty.call(JOBS, value);
}

/** Jobs offered on a given service's tab, in display order. */
/**
 * How long one request to a job may take.
 *
 * 25s is the default and the right answer for a chunked job: each request
 * stays short and the run takes as long as the range needs. A job that cannot
 * be chunked — see `chunkDays` — has to do the whole range in one call
 * instead, so it declares its own budget.
 *
 * The platform caps this regardless. Amplify runs the route on SSR compute,
 * and `maxDuration` in the jobs route is a request rather than a guarantee, so
 * a budget here buys headroom and never a promise.
 */
export const DEFAULT_JOB_TIMEOUT_MS = 25_000;

export function budgetFor(job: { timeoutMs?: number }): number {
  return job.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
}

export function jobsForService(service: ServiceKey): JobDefinition[] {
  return JOB_KEYS.map((key) => JOBS[key]).filter((job) => job.service === service);
}

export type JobTarget = {
  projectCode: string;
  /** Description of the satisfied precondition, or null when unmet. */
  ready: string | null;
  /** When unmet, which condition failed — see JobPrecondition.detail. */
  reason: string | null;
};

/**
 * Every project on the job's service, with whether its precondition holds.
 * Projects that cannot run are still listed — the dialog says why rather than
 * hiding them, which is the more diagnosable choice.
 */
export function jobTargets(job: JobDefinition, rows: ProjectConfigRow[]): JobTarget[] {
  const targets = rows
    .map((row) => {
      const projectCode = String(row.project_code ?? "");
      const ready = job.precondition.read(row);
      return {
        projectCode,
        ready,
        reason: ready ? null : (job.precondition.detail?.(row, projectCode) ?? null),
      };
    })
    .filter((target) => target.projectCode)
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode));

  // Filtered here rather than in the dialog so the chat plan and the server
  // re-check see the same list the picker does.
  return job.hideUnready ? targets.filter((target) => target.ready) : targets;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Inclusive day count, matching how the endpoints measure a range. */
export function spanDays(startDate: string, endDate: string): number {
  const from = Date.parse(`${startDate}T00:00:00Z`);
  const to = Date.parse(`${endDate}T00:00:00Z`);
  return (to - from) / 86_400_000 + 1;
}

/** Everything wrong with the form, in the order a human would fix it. */
export function validateJobInput(
  input: Partial<JobInput>,
  { job, ready, reason }: { job?: JobDefinition; ready?: string | null; reason?: string | null } = {},
): string[] {
  const problems: string[] = [];
  if (!input.projectCode) problems.push("Choose a project.");

  // A choice the job does not declare is dropped by the route; one it does
  // declare has to be a real option, or the path lookup would quietly fall
  // back to the first and run something the caller did not ask for.
  if (job?.choice && input.choice !== undefined) {
    if (!job.choice.options.some((option) => option.value === input.choice)) {
      problems.push(
        `${input.choice} is not one of ${job.choice.label.toLowerCase()}: ` +
          `${job.choice.options.map((option) => option.value).join(", ")}.`,
      );
    }
  }

  /**
   * A month, and only one the endpoints can actually address.
   *
   * Not merely "looks like YYYY-MM": WBGT takes a bare `mmm` and resolves it to
   * the most recent occurrence at or before last month, so a month outside the
   * offered twelve does not fail — it silently resolves to a different year and
   * sends a plausible, wrong workbook. Checking membership rather than shape is
   * what makes that impossible.
   */
  if (job?.monthly) {
    const offered = completedMonths();
    if (!input.month) problems.push("Choose a month.");
    else if (!offered.includes(input.month)) {
      problems.push(
        `${input.month} is not one of the last twelve completed months (${offered[offered.length - 1]} to ${offered[0]}).`,
      );
    }
  }

  // A dateless or monthly job has no range to check, and asking for one would
  // block a job whose endpoint does not accept it. The precondition still applies.
  if (!job?.dateless && !job?.monthly) {
    if (!input.startDate || !isIsoDate(input.startDate)) problems.push("Start date must be YYYY-MM-DD.");
    if (!input.endDate || !isIsoDate(input.endDate)) problems.push("End date must be YYYY-MM-DD.");
  }

  if (!job?.dateless && input.startDate && input.endDate && isIsoDate(input.startDate) && isIsoDate(input.endDate)) {
    if (input.startDate > input.endDate) {
      problems.push("Start date is after the end date.");
    } else if (job?.maxSpanDays) {
      const span = spanDays(input.startDate, input.endDate);
      if (span > job.maxSpanDays) {
        // The endpoint rejects this outright, so catch it before the round trip.
        problems.push(`Range is ${span} days; this job accepts at most ${job.maxSpanDays}.`);
      }
    }
  }

  if (input.projectCode && !ready) {
    // The specific reason when the job supplied one, so the operator is told
    // which condition failed rather than only that something did.
    problems.push(reason ?? (job ? job.precondition.unmet(input.projectCode) : "Precondition not met."));
  }
  return problems;
}
