import { colourForStatus, type HealthColour } from "./health-status";
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
 * The statuses are not interpreted here. `completed_with_meter_issues`,
 * `skipped_outside_project_cadence_window` and `failed_config_validation` are
 * the service's own words, and `colourForStatus` resolves them from the
 * service's contract, so a status added upstream shows up without a change
 * here.
 */

type RunLog = { schema: string; table: string; timeColumn: string };

const RUN_LOGS: Partial<Record<ServiceKey, RunLog>> = {
  noise: { schema: "noise-meters", table: "noise_job_runs", timeColumn: "started_at" },
  wbgt: { schema: "wbgts", table: "wbgt_job_runs", timeColumn: "started_at" },
};

export function servicesWithRunLog(): ServiceKey[] {
  return Object.keys(RUN_LOGS) as ServiceKey[];
}

export async function readRunWindow(
  service: ServiceKey,
  request: (path: string, init: { schema: string }) => Promise<{ ok: boolean; body: unknown }>,
  sinceIso: string,
  maxPages = 10,
): Promise<{ projectCode: string; at: string; colour: HealthColour }[]> {
  const log = RUN_LOGS[service];
  if (!log) return [];

  const { schema, table, timeColumn } = log;
  // Paged, like the delivery window: Noise writes several run rows per project
  // per hour, so one 1000-row page covers only a few hours of the window.
  const rows = await readPaged(
    request,
    (offset, limit) =>
      `${table}?select=project_code,status,${timeColumn}&${timeColumn}=gte.${sinceIso}` +
      `&order=${timeColumn}.desc&limit=${limit}&offset=${offset}`,
    { schema, maxPages },
  );

  return rows.flatMap((row) => {
    const projectCode = String(row.project_code ?? "").trim();
    const at = String(row[timeColumn] ?? "");
    if (!projectCode || !at) return [];
    return [{ projectCode, at, colour: colourForStatus(service, String(row.status ?? "").trim()).colour }];
  });
}
