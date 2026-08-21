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

export type JobKey = "noise-bootstrap" | "noise-sync" | "wbgt-fill" | "wbgt-scrape";

export type JobFlag = { key: string; label: string; help: string };

export type JobInput = {
  projectCode: string;
  startDate: string;
  endDate: string;
  flags?: Record<string, boolean>;
};

/**
 * What must already be true of a project before the job can do its work.
 * `read` returns a short description of the satisfying value, or null if unmet.
 */
export type JobPrecondition = {
  label: string;
  read: (row: ProjectConfigRow) => string | null;
  unmet: (projectCode: string) => string;
};

export type JobDefinition = {
  key: JobKey;
  service: ServiceKey;
  /** Button label on the service's action row. */
  label: string;
  title: string;
  description: string;
  /** Env var holding the service's base URL, e.g. https://…/prod */
  baseUrlEnv: "NOISE_API_URL" | "WBGT_API_URL";
  path: string;
  precondition: JobPrecondition;
  /** Inclusive day limit the endpoint itself enforces, if any. */
  maxSpanDays?: number;
  /** Optional booleans the endpoint accepts. */
  flags?: JobFlag[];
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
    // camelCase, and `from`/`to` rather than start/end — resolveDates() in
    // sheet-fill-job.js only enumerates a range when given body.from + body.to.
    buildPayload: ({ projectCode, startDate, endDate }) => ({
      projectCode,
      from: startDate,
      to: endDate,
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
    label: "⤓ Export xlsx",
    title: "Export a monthly record as xlsx",
    description:
      "Exports one month's monitoring record exactly as the Google Sheet renders it — conditional formatting, merges and legend included.",
    baseUrlEnv: "WBGT_API_URL",
    path: "/api/wbgt-sheet-export",
    choose: "tab",
  },
  "noise-export": {
    key: "noise-export",
    service: "noise",
    label: "⤓ Export xlsx",
    title: "Export the analysis workbook as xlsx",
    description:
      "Exports the analysis workbook trimmed to a date window. Date columns outside the window are removed from a temporary copy; the original is untouched.",
    baseUrlEnv: "NOISE_API_URL",
    path: "/api/noise-sheet-export",
    choose: "range",
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
  /** Whether the operator picks a workbook tab or a date range. */
  choose: "tab" | "range";
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
export function jobsForService(service: ServiceKey): JobDefinition[] {
  return JOB_KEYS.map((key) => JOBS[key]).filter((job) => job.service === service);
}

export type JobTarget = {
  projectCode: string;
  /** Description of the satisfied precondition, or null when unmet. */
  ready: string | null;
};

/**
 * Every project on the job's service, with whether its precondition holds.
 * Projects that cannot run are still listed — the dialog says why rather than
 * hiding them, which is the more diagnosable choice.
 */
export function jobTargets(job: JobDefinition, rows: ProjectConfigRow[]): JobTarget[] {
  return rows
    .map((row) => ({
      projectCode: String(row.project_code ?? ""),
      ready: job.precondition.read(row),
    }))
    .filter((target) => target.projectCode)
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode));
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
  { job, ready }: { job?: JobDefinition; ready?: string | null } = {},
): string[] {
  const problems: string[] = [];
  if (!input.projectCode) problems.push("Choose a project.");
  if (!input.startDate || !isIsoDate(input.startDate)) problems.push("Start date must be YYYY-MM-DD.");
  if (!input.endDate || !isIsoDate(input.endDate)) problems.push("End date must be YYYY-MM-DD.");

  if (input.startDate && input.endDate && isIsoDate(input.startDate) && isIsoDate(input.endDate)) {
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
    problems.push(job ? job.precondition.unmet(input.projectCode) : "Precondition not met.");
  }
  return problems;
}
