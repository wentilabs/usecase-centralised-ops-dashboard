import type { ProjectConfigRow, ServiceKey } from "./services";

/**
 * Sheet jobs HALO can trigger on the alert services.
 *
 * These endpoints already exist on the deployed Lambdas; HALO only collects the
 * inputs and forwards them. It proxies rather than calling from the browser so
 * the service URLs stay server-side and HALO's own editor permission applies.
 *
 * The payload shapes are NOT consistent between the two services, and that is
 * deliberate here rather than something to tidy: the noise endpoints take
 * `project_code` / `start_date` / `end_date`, while wbgt-sheet-fill takes
 * `projectCode` / `from` / `to`. Each `buildPayload` matches the endpoint it
 * targets, verified against the handlers in the alert repos.
 */

export type JobKey = "noise-bootstrap" | "noise-sync" | "wbgt-fill";

export type JobInput = { projectCode: string; startDate: string; endDate: string };

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
  /** Config column that must hold a sheet id before the job can do anything. */
  sheetColumn: string;
  sheetLabel: string;
  buildPayload: (input: JobInput) => Record<string, unknown>;
};

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
    sheetColumn: "google_sheet_id",
    sheetLabel: "Analysis sheet ID",
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
    sheetColumn: "google_sheet_id",
    sheetLabel: "Analysis sheet ID",
    // The job resolves a range from start_date/end_date and falls back to a
    // single `date`; a range is what the dialog always sends.
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
    sheetColumn: "monthly_sheet_id",
    sheetLabel: "Monthly sheet ID",
    // camelCase, and `from`/`to` rather than start/end — resolveDates() in
    // sheet-fill-job.js only enumerates a range when given body.from + body.to.
    buildPayload: ({ projectCode, startDate, endDate }) => ({
      projectCode,
      from: startDate,
      to: endDate,
    }),
  },
};

export const JOB_KEYS = Object.keys(JOBS) as JobKey[];

export function isJobKey(value: string): value is JobKey {
  return Object.prototype.hasOwnProperty.call(JOBS, value);
}

/** Jobs offered on a given service's tab, in display order. */
export function jobsForService(service: ServiceKey): JobDefinition[] {
  return JOB_KEYS.map((key) => JOBS[key]).filter((job) => job.service === service);
}

/**
 * Whether a config row has a usable sheet id.
 *
 * Mirrors normalizeGoogleSheetId() in the noise repo, which treats the literal
 * strings "null"/"undefined"/"blank"/"empty" as unset — they occur in real rows.
 */
const PLACEHOLDERS = new Set(["null", "undefined", "blank", "empty", "-", "n/a", "na"]);

export function readSheetId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || PLACEHOLDERS.has(raw.toLowerCase())) return null;
  // Accept a pasted spreadsheet URL as well as a bare id.
  const fromUrl = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  const id = fromUrl ? fromUrl[1] : raw;
  return /^[A-Za-z0-9_-]{20,}$/.test(id) ? id : null;
}

export type JobTarget = { projectCode: string; sheetId: string | null };

/**
 * Every project on the job's service, with whether its sheet is configured.
 * Projects without a sheet id are still listed — the dialog shows why they
 * cannot be run rather than hiding them, which is the more diagnosable choice.
 */
export function jobTargets(job: JobDefinition, rows: ProjectConfigRow[]): JobTarget[] {
  return rows
    .map((row) => ({
      projectCode: String(row.project_code ?? ""),
      sheetId: readSheetId(row[job.sheetColumn]),
    }))
    .filter((target) => target.projectCode)
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode));
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Everything wrong with the form, in the order a human would fix it. */
export function validateJobInput(
  input: Partial<JobInput>,
  { sheetId }: { sheetId?: string | null } = {},
): string[] {
  const problems: string[] = [];
  if (!input.projectCode) problems.push("Choose a project.");
  if (!input.startDate || !isIsoDate(input.startDate)) problems.push("Start date must be YYYY-MM-DD.");
  if (!input.endDate || !isIsoDate(input.endDate)) problems.push("End date must be YYYY-MM-DD.");
  if (
    input.startDate &&
    input.endDate &&
    isIsoDate(input.startDate) &&
    isIsoDate(input.endDate) &&
    input.startDate > input.endDate
  ) {
    problems.push("Start date is after the end date.");
  }
  if (input.projectCode && !sheetId) problems.push("This project has no sheet id configured.");
  return problems;
}
