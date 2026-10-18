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
  /**
   * Which job in this run log PRODUCES the readings the health check ages.
   *
   * Only Noise and WBGT have one. It is how the health reader tells "the service
   * chose not to produce anything" from "the service produced nothing": a
   * maintenance job completing, or a five-minute alert run reading data already
   * stored, is not evidence the pipeline works or fails — only the scrape is.
   * Both services name it `scrape-…`, and that is stated here rather than guessed
   * at in the reader.
   */
  producer?: { jobTypeColumn: string; jobTypePrefix: string };
  /**
   * Whether the newest bar of a project's strip also enters the estate board.
   *
   * True for almost everything. False only for Noise and WBGT, whose ingestion
   * is already reported from the readings-age check — taking their newest run
   * bar as well would count one project twice. It used to be decided by `signal`
   * alone, which silently kept every run source off the board: a subcon,
   * ailytics or chaser run that ended `completed_with_errors` was red on its
   * card and never reached the board.
   */
  board: boolean;
  /**
   * Read INSTEAD of this source, but only while this source's table cannot be
   * read at all — it has not been created yet.
   *
   * Deliberately not "when this one is empty". A service whose cron has stopped
   * firing has an empty run log, and falling back to older delivery rows would
   * show green bars for a service that has gone silent: the exact failure the
   * run log exists to expose.
   */
  fallback?: Source;
};

const SOURCES: Partial<Record<ServiceKey, Source>> = {
  haze: {
    // One bar per project per hourly run, including the hours whose correct
    // action was to send nothing — which the delivery ledger below cannot show,
    // and which are indistinguishable there from a cron that never fired.
    // Delivery trouble is carried inside the run: a group that did not get its
    // advisory makes the hour `completed_with_errors` and names the group and the
    // listener's own words.
    //
    // Haze's NEA scrape is still not tracked: it is one public feed for the whole
    // estate, so a failed fetch is the same fact about every project. This is the
    // per-project send job, which is a different thing.
    schema: "haze",
    table: "haze_job_runs",
    projectColumn: "project_code",
    statusColumn: "status",
    timeColumn: "started_at",
    errorColumn: "errors",
    signal: "run",
    board: true,
    fallback: {
      schema: "haze",
      table: "haze_notification_events",
      projectColumn: "project_code",
      statusColumn: "delivery_status",
      timeColumn: "created_at",
      errorColumn: "last_error",
      signal: "delivery",
      board: true,
    },
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
    board: true,
  },
  issueChaser: {
    // The run log first, for the same reason as haze: it records the projects
    // that did nothing, which the submissions ledger cannot.
    schema: "issue_chaser",
    table: "job_runs",
    projectColumn: "project_code",
    statusColumn: "status",
    timeColumn: "started_at",
    errorColumn: "errors",
    signal: "run",
    board: true,
    fallback: {
      schema: "issue_chaser",
      table: "outbound_submissions",
      projectColumn: "project_code",
      statusColumn: "status",
      timeColumn: "submitted_at",
      errorColumn: "error",
      signal: "delivery",
      board: true,
    },
  },
  ailytics: {
    // Previously absent: its deliveries are keyed by `project_config_id`, a uuid,
    // not `project_code`. Its run log is keyed by code, so it can finally be read.
    schema: "ailytics",
    table: "job_runs",
    projectColumn: "project_code",
    statusColumn: "status",
    timeColumn: "started_at",
    errorColumn: "errors",
    signal: "run",
    board: true,
  },
  noise: {
    schema: "noise-meters",
    table: "noise_job_runs",
    projectColumn: "project_code",
    statusColumn: "status",
    timeColumn: "started_at",
    errorColumn: "errors",
    signal: "run",
    producer: { jobTypeColumn: "job_type", jobTypePrefix: "scrape" },
    // Ingestion is reported from the readings-age check; see `Source.board`.
    board: false,
  },
  wbgt: {
    schema: "wbgts",
    table: "wbgt_job_runs",
    projectColumn: "project_code",
    statusColumn: "status",
    timeColumn: "started_at",
    errorColumn: "errors",
    signal: "run",
    producer: { jobTypeColumn: "job_type", jobTypePrefix: "scrape" },
    board: false,
  },
  subcon: {
    schema: "manpower_activity",
    table: "job_runs",
    projectColumn: "project_code",
    statusColumn: "status",
    timeColumn: "started_at",
    errorColumn: "errors",
    signal: "run",
    // No readings-age check covers subcon, so a failed run has to reach the board
    // from here or nowhere.
    board: true,
  },
};

export const PROCESS_SERVICES = Object.keys(SOURCES) as ServiceKey[];

/**
 * The services whose newest process also enters the estate board, and under
 * which signal.
 *
 * `null` for Noise and WBGT, whose ingestion is already reported from the
 * readings-age check: their newest run bar as well would count one project
 * twice. Everything else is on the board — including the run-log services, which
 * this used to exclude by treating "run" as "already covered", so that a subcon
 * run ending `completed_with_errors` was red on its card and absent from the
 * board.
 */
export function boardSignalFor(service: ServiceKey): "delivery" | "run" | null {
  const source = SOURCES[service];
  return source?.board ? source.signal : null;
}

/**
 * Where a service writes its per-project RUN log, if it has one.
 *
 * Exported for the health reader, which uses it as testimony: when a project
 * looks stale, the service's own runs can say whether it was meant to be
 * producing anything.
 */
export function runLogOf(service: ServiceKey): {
  schema: string;
  table: string;
  projectColumn: string;
  statusColumn: string;
  timeColumn: string;
  producer: { jobTypeColumn: string; jobTypePrefix: string };
} | null {
  const source = SOURCES[service];
  // Only a log that says which job produces the readings can explain their absence.
  if (!source || source.signal !== "run" || !source.producer) return null;
  const { schema, table, projectColumn, statusColumn, timeColumn, producer } = source;
  return { schema, table, projectColumn, statusColumn, timeColumn, producer };
}

export const BOARD_SERVICES = PROCESS_SERVICES.filter((service) => boardSignalFor(service) !== null);

async function tableReadable(
  source: Source,
  request: (path: string, init: { schema: string }) => Promise<{ ok: boolean; body: unknown }>,
): Promise<boolean> {
  const res = await request(`${source.table}?select=${source.timeColumn}&limit=1`, { schema: source.schema });
  return res.ok;
}

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
  let source = SOURCES[service];
  if (!source) return [];

  // Use the fallback ONLY when the primary's table cannot be read at all. One
  // tiny request, and the whole result is cached for five minutes. Not "when it
  // is empty" — see `Source.fallback`.
  if (source.fallback && !(await tableReadable(source, request))) source = source.fallback;

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
