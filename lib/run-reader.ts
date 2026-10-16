import { colourForStatus, type HealthColour } from "./health-status";
import { logLines } from "./log-lines";
import { readPaged } from "./paged-read";
import type { ServiceKey } from "./services";

/**
 * Did this project's job actually run, cycle by cycle?
 *
 * The companion to `delivery-reader`. Noise and WBGT are the two services that
 * do not record a per-project delivery ledger, but they are the two that keep a
 * per-project RUN log — so between the two readers every covered project has a
 * history to draw.
 *
 * **Only those two, deliberately.** Haze and Lightning are tracked on delivery
 * alone. Their ingestion is one public NEA feed for the whole estate, so a
 * failed scrape or tick is not a fact about any project: it is the same fact
 * about all of them, and putting it on thirty-one cards would say nothing while
 * burying the one thing that is per-project, which is whether the message went
 * out. Noise and WBGT scrape per site, so their runs ARE per-project and belong
 * on the strip. Lightning's `lightning_tick_audit` is estate-wide for exactly
 * this reason and is deliberately not read here.
 *
 * The statuses are not interpreted here. `completed_with_meter_issues`,
 * `skipped_outside_project_cadence_window` and `failed_config_validation` are
 * the service's own words, and `colourForStatus` resolves them from the
 * service's contract, so a status added upstream shows up without a change
 * here.
 */

type RunLog = {
  schema: string;
  table: string;
  timeColumn: string;
  /**
   * One readable line per problem — e.g. "MBS IR2 (WC-55): reading 38 minutes
   * old; production delivery suppressed". The sibling `details` column is a
   * large JSON blob and is deliberately not read: it would multiply the payload
   * for a strip that only needs to say what went wrong.
   */
  errorColumn: string;
};

const RUN_LOGS: Partial<Record<ServiceKey, RunLog>> = {
  noise: { schema: "noise-meters", table: "noise_job_runs", timeColumn: "started_at", errorColumn: "errors" },
  wbgt: { schema: "wbgts", table: "wbgt_job_runs", timeColumn: "started_at", errorColumn: "errors" },
};

export function servicesWithRunLog(): ServiceKey[] {
  return Object.keys(RUN_LOGS) as ServiceKey[];
}

export async function readRunWindow(
  service: ServiceKey,
  request: (path: string, init: { schema: string }) => Promise<{ ok: boolean; body: unknown }>,
  perProject: number,
  sinceIso: string,
): Promise<{ projectCode: string; at: string; colour: HealthColour; status: string; log: string[] }[]> {
  const log = RUN_LOGS[service];
  if (!log) return [];

  const { schema, table, timeColumn, errorColumn } = log;
  // Paged, but stopped as soon as every project in hand has its quota. Noise
  // writes several run rows per project per hour, so one 1000-row page holds
  // only a few hours — and paging the rest of a time window was pure latency,
  // because everything past the newest fifty per project is sliced off anyway.
  const rows = await readPaged(
    request,
    (before, limit) =>
      `${table}?select=project_code,status,${timeColumn},${errorColumn}` +
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
      // target — the forty-eight-hour floor usually ends the walk first, and on
      // a high-volume service a sparse project may show fewer bars than the
      // window holds rather than hold the read open for them.
      maxPages: Math.ceil((perProject * 40) / 1000),
      cursorOf: (row) => String(row[timeColumn] ?? ""),
    },
  );

  return rows.flatMap((row) => {
    const projectCode = String(row.project_code ?? "").trim();
    const at = String(row[timeColumn] ?? "");
    if (!projectCode || !at) return [];
    const status = String(row.status ?? "").trim();
    return [{
      projectCode,
      at,
      colour: colourForStatus(service, status).colour,
      status,
      log: logLines(row[errorColumn]),
    }];
  });
}
