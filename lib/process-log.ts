import { colourForStatus, type HealthColour } from "./health-status";
import { logLines } from "./log-lines";
import { readPaged } from "./paged-read";
import type { ServiceKey } from "./services";

/**
 * Where each service records what it did, process by process.
 *
 * This was two modules — one for delivery ledgers, one for run logs — and they
 * were the same function twice: same keyset paging, same cursor encoding, same
 * row mapping, differing only in which columns to name. The run log is simply a
 * source whose project column happens to be `project_code` and whose status
 * column happens to be `status`. One table of sources and one reader says the
 * same thing in half the code, and there is now one place where a new service
 * is added.
 *
 * **What `signal` means.** `delivery` answers "did the service accept the send";
 * `run` answers "did the job execute". The distinction is not cosmetic: a
 * project's ingestion is reported separately from its readings age, so a run
 * source must not also be read as a delivery or the project is counted twice.
 *
 * **Why some services are absent.** Deliberately, so the board says "nothing
 * reads this service" instead of showing a green it has not earned:
 *
 *   ailytics  keys deliveries by `project_config_id`, a uuid, not `project_code`
 *
 * Subcon reads from its RUN log rather than its delivery ledger. Both exist, but
 * only the run log records the projects that did nothing — which is most of
 * them, and the whole reason this service was invisible: a delivery ledger can
 * only log a send that happened, so a correct skip and a cron that never fired
 * look identical in it.
 *
 * **Why Haze and Lightning are delivery-only.** Their ingestion is one public
 * NEA feed for the whole estate, so a failed fetch is the same fact about all
 * thirty-one projects rather than a fact about any one of them. Putting it on
 * every card would say nothing while burying the part that IS per-project,
 * which is whether the message was accepted. Noise and WBGT scrape per site, so
 * their runs are per-project and belong on the strip.
 *
 * This mapping lives in HALO because it is an integration detail — which table,
 * which column. What the statuses MEAN stays with each service, in its contract,
 * and is read through `colourForStatus`.
 */

type Source = {
  schema: string;
  table: string;
  projectColumn: string;
  statusColumn: string;
  /** Newest-first ordering key, and the keyset cursor. */
  timeColumn: string;
  /**
   * What the service wrote about a failure. Shapes differ — an array of
   * sentences in the run logs, a single string in the ledgers — and `logLines`
   * normalises them. The run logs' sibling `details` column is deliberately not
   * read: a large JSON blob per row, for a strip that only needs to say what
   * went wrong.
   */
  errorColumn: string;
  /** Additional fields needed to read the service's existing error text. */
  extraColumns?: readonly string[];
  signal: "delivery" | "run";
};

const SOURCES: Partial<Record<ServiceKey, Source>> = {
  haze: {
    schema: "haze",
    table: "haze_notification_events",
    projectColumn: "project_code",
    statusColumn: "delivery_status",
    timeColumn: "created_at",
    errorColumn: "last_error",
    signal: "delivery",
  },
  lightning: {
    schema: "lightning",
    table: "lightning_events",
    projectColumn: "project_code",
    statusColumn: "delivery_status",
    timeColumn: "created_at",
    errorColumn: "last_delivery_error",
    extraColumns: ["delivery_attempts"],
    signal: "delivery",
  },
  issueChaser: {
    schema: "issue_chaser",
    table: "outbound_submissions",
    projectColumn: "project_code",
    statusColumn: "status",
    timeColumn: "submitted_at",
    errorColumn: "error",
    signal: "delivery",
  },
  noise: {
    schema: "noise-meters",
    table: "noise_job_runs",
    projectColumn: "project_code",
    statusColumn: "status",
    timeColumn: "started_at",
    errorColumn: "errors",
    signal: "run",
  },
  wbgt: {
    schema: "wbgts",
    table: "wbgt_job_runs",
    projectColumn: "project_code",
    statusColumn: "status",
    timeColumn: "started_at",
    errorColumn: "errors",
    signal: "run",
  },
  subcon: {
    schema: "manpower_activity",
    table: "job_runs",
    projectColumn: "project_code",
    statusColumn: "status",
    timeColumn: "started_at",
    errorColumn: "errors",
    signal: "run",
  },
};

export const PROCESS_SERVICES = Object.keys(SOURCES) as ServiceKey[];

/**
 * The services whose newest process is a DELIVERY verdict.
 *
 * Exported so the board can tell them from the run sources, whose ingestion is
 * already reported from the readings-age check.
 */
export const DELIVERY_SERVICES = PROCESS_SERVICES.filter((service) => SOURCES[service]?.signal === "delivery");

export type ProcessSample = {
  projectCode: string;
  at: string;
  colour: HealthColour;
  /** The service's own word, never rewritten — this is what a reader greps. */
  status: string;
  log: string[];
};

/**
 * The newest `perProject` processes for one service, since `sinceIso`.
 *
 * Bounded by COUNT per project and by TIME, and paged by keyset — see
 * `lib/paged-read.ts` for why none of those three is optional.
 */
export async function readProcessWindow(
  service: ServiceKey,
  request: (path: string, init: { schema: string }) => Promise<{ ok: boolean; body: unknown }>,
  perProject: number,
  sinceIso: string,
): Promise<ProcessSample[]> {
  const source = SOURCES[service];
  if (!source) return [];

  const { schema, table, projectColumn, statusColumn, timeColumn, errorColumn, extraColumns = [] } = source;
  const rows = await readPaged(
    request,
    (before, limit) =>
      `${table}?select=${[projectColumn, statusColumn, timeColumn, errorColumn, ...extraColumns].join(",")}` +
      `&${timeColumn}=gte.${sinceIso}` +
      `&order=${timeColumn}.desc&limit=${limit}` +
      // Encoded: PostgREST returns timestamps as `2026-10-16T20:13:34.12+08:00`,
      // and a raw `+` in a query string decodes to a space — the next page comes
      // back `22007 invalid input syntax`, and since a failed page discards the
      // window that empties every strip on the dashboard.
      (before ? `&${timeColumn}=lt.${encodeURIComponent(before)}` : ""),
    {
      schema,
      // Derived from the quota rather than fixed: a hundred processes for each
      // of roughly forty projects is four 1000-row pages. It is a BUDGET, not a
      // target — the window floor usually ends the walk first, and on a
      // high-volume service a sparse project may show fewer bars than the window
      // holds rather than hold the read open for them.
      maxPages: Math.ceil((perProject * 40) / 1000),
      cursorOf: (row) => String(row[timeColumn] ?? ""),
    },
  );

  return rows.flatMap((row) => {
    const projectCode = String(row[projectColumn] ?? "").trim();
    const at = String(row[timeColumn] ?? "");
    // A row with no project code belongs to no strip, and one with no timestamp
    // can be neither ordered nor labelled.
    if (!projectCode || !at) return [];
    const status = String(row[statusColumn] ?? "").trim();
    const log = service === "lightning"
      ? lightningErrorLines(status, row[errorColumn], row.delivery_attempts)
      : logLines(row[errorColumn]);
    return [{ projectCode, at, colour: colourForStatus(service, status).colour, status, log }];
  });
}

/** Lightning stores one event for several targets; the final target may have no error. */
function lightningErrorLines(status: string, lastError: unknown, attempts: unknown): string[] {
  const parent = logLines(lastError);
  if (!["PARTIAL", "FAILED", "UNCONFIRMED"].includes(status.toUpperCase()) || !Array.isArray(attempts)) return parent;

  const latestByTarget = new Map<string, Record<string, unknown>>();
  for (const attempt of attempts) {
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) continue;
    const record = attempt as Record<string, unknown>;
    const target = String(record.target ?? "").trim();
    if (target) latestByTarget.set(target, record);
  }

  const errors = [...parent];
  for (const attempt of latestByTarget.values()) {
    if (!["FAILED", "UNCONFIRMED"].includes(String(attempt.delivery_status ?? "").toUpperCase())) continue;
    for (const line of logLines(attempt.last_error ?? attempt.error)) {
      if (!errors.includes(line)) errors.push(line);
    }
  }
  return errors;
}


/**
 * A standing fault: something a project is stuck in RIGHT NOW, rather than
 * something that happened at a moment.
 *
 * It exists because a strip draws processes, and the worst failure has no
 * process to draw. Lightning rejects SGK's configuration on every tick and has
 * never once evaluated it, so SGK has no delivery, no run and no event of any
 * kind — its strip is a hundred calm grey columns, which reads as "nothing to
 * report" for a site that has no lightning protection at all. The state is real
 * and current; there is just no instant to hang it on.
 *
 * So it is read as state, from the column the service already writes it to, and
 * shown beside the strip rather than inside it.
 */
type FaultSource = {
  schema: string;
  table: string;
  projectColumn: string;
  errorColumn: string;
};

const FAULT_SOURCES: Partial<Record<ServiceKey, FaultSource>> = {
  lightning: {
    schema: "lightning",
    table: "lightning_project_runtime",
    projectColumn: "project_code",
    errorColumn: "last_error",
  },
};

export const FAULT_SERVICES = Object.keys(FAULT_SOURCES) as ServiceKey[];

export type ProjectFault = {
  projectCode: string;
  /** The service's own words, unrewritten: this is what a reader greps for. */
  message: string;
};

export async function readProjectFaults(
  service: ServiceKey,
  request: (path: string, init: { schema: string }) => Promise<{ ok: boolean; body: unknown }>,
): Promise<ProjectFault[]> {
  const source = FAULT_SOURCES[service];
  if (!source) return [];

  const { schema, table, projectColumn, errorColumn } = source;
  // `not.is.null` rather than reading every row: one project in thirty-one is
  // at fault at most, and the answer is a handful of rows however large the
  // estate grows.
  const res = await request(`${table}?select=${projectColumn},${errorColumn}&${errorColumn}=not.is.null`, { schema });
  // An unreadable table returns no faults. That is the weaker answer and worth
  // stating plainly: this cannot tell "nothing is wrong" from "could not look",
  // so a fault is shown when it is found and its absence proves nothing. It
  // matches the rest of this module, which prefers a missing pill to a wrong one.
  if (!res.ok || !Array.isArray(res.body)) return [];

  return (res.body as Record<string, unknown>[]).flatMap((row) => {
    const projectCode = String(row[projectColumn] ?? "").trim();
    const [message] = logLines(row[errorColumn]);
    return projectCode && message ? [{ projectCode, message }] : [];
  });
}
