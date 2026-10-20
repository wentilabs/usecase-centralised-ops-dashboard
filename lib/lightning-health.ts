import { formatSgt } from "./card-summary";
import { logLines } from "./log-lines";
import type { HealthColour } from "./health-status";

/**
 * Lightning's own heartbeat, read — never polled.
 *
 * `/api/lightning-tick` runs every minute, so a "did it run" check that mirrored it would
 * be a process per minute. It does not need to be one. The service already writes, on every
 * tick, everything a verdict needs: `lightning_service_runtime` (one row: when the last tick
 * started and finished, how many projects failed, when the NEA feed last answered) and
 * `lightning_project_runtime` (one row per project: when it was last evaluated, its state).
 * HALO reads those three small tables when the dashboard asks, from a 60-second cache — no
 * cron, no new rows, and nothing for the service to change.
 *
 * Four things can be wrong that a delivery strip cannot show, because a delivery strip only has
 * a bar when a message was sent, and a quiet strip looks the same whether it is a calm sky or a
 * service that stopped:
 *
 *   the tick stopped or failed      → a service-wide notice (amber late, red long)
 *   the NEA feed is behind          → stale (dark green), amber once sites were TOLD it is down
 *   a project is not being evaluated → a standing fault on its card
 *   a project is stuck in STOP      → a standing fault on its card: workers were told to stop and
 *                                      the all-clear never went
 *
 * Every threshold here is a constant with the reason beside it. All the functions are pure, so
 * each one can be tested at its edge.
 */

const MINUTE = 60_000;

/** The tick runs every minute. Past this, one or more were missed, which is amber. */
export const TICK_LATE_MS = 5 * MINUTE;
/** Past this the safety service has been blind for a quarter of an hour, which is red. */
export const TICK_STALLED_MS = 15 * MINUTE;
/**
 * A project not evaluated for this long while the tick is alive is stuck on its own. It is looser
 * than the tick's because a single slow evaluation is normal and a project missed by one tick is not
 * a fault; fifteen missed minutes is.
 */
export const EVALUATION_STALE_MS = 15 * MINUTE;
/** The feed is read every tick, so anything older than this is behind. */
export const FEED_QUIET_MS = 5 * MINUTE;
/**
 * How long past its own clearance time a STOP may stand before it is a fault. The service sends the
 * all-clear when it next evaluates after the 20-minute clearance, so thirty minutes past it is a
 * missed send, not a slow one.
 */
export const STOP_GRACE_MS = 30 * MINUTE;

/** Something about the whole Lightning service, not one project. */
export type LightningNotice = {
  /** `tick` is "did it run"; `feed` is "is NEA answering". */
  id: "tick" | "feed";
  colour: HealthColour;
  /** Plain sentence in the service's own terms. */
  label: string;
  /** When the thing it describes last happened, for the board's stamp. */
  detail: string | null;
};

export type ServiceRuntime = {
  last_tick_finished_at?: number | null;
  last_tick_started_at?: number | null;
  last_tick_status?: string | null;
  last_tick_projects_total?: number | null;
  last_tick_projects_failed?: number | null;
  last_fetch_success_at?: number | null;
  consecutive_fetch_failures?: number | null;
  last_fetch_error?: string | null;
};

export type ProjectRuntime = {
  project_code: string;
  last_evaluated_at?: number | null;
  last_error?: string | null;
  last_notified_state?: string | null;
  last_notified_degraded?: boolean | null;
  active_stop_until_at?: number | null;
};

const sgt = (ms: number) => `${formatSgt(new Date(ms).toISOString())} SGT`;
const minutes = (ms: number) => Math.max(1, Math.round(ms / MINUTE));
const iso = (ms: number | null | undefined) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null);
const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Did the tick run, and did it finish clean?
 *
 * Null when it is fine, and also when there is no heartbeat row to judge: a service that has never
 * ticked is not "late", it is not running, and that is the standing-fault path's to say.
 */
export function assessTick(runtime: ServiceRuntime | null, now: Date): LightningNotice | null {
  if (!runtime) return null;
  const last = runtime.last_tick_finished_at || runtime.last_tick_started_at;
  if (!last) return null;

  const age = now.getTime() - last;
  if (age >= TICK_LATE_MS) {
    return {
      id: "tick",
      colour: age >= TICK_STALLED_MS ? "red" : "amber",
      label: `No tick has finished since ${sgt(last)} (${minutes(age)} min ago); it runs every minute`,
      detail: iso(last),
    };
  }

  const status = String(runtime.last_tick_status ?? "").trim();
  const failed = Number(runtime.last_tick_projects_failed) || 0;
  const total = Number(runtime.last_tick_projects_total) || 0;
  // SKIPPED_LOCK is two ticks overlapping, which is the lock doing its job.
  if (status === "FAILED") {
    return { id: "tick", colour: "red", label: `The last tick FAILED (${sgt(last)})`, detail: iso(last) };
  }
  if (status === "COMPLETED_WITH_ERRORS" || failed > 0) {
    return {
      id: "tick",
      colour: "amber",
      label: `The last tick ${status || "finished"} with ${failed} of ${total} projects failing (${sgt(last)})`,
      detail: iso(last),
    };
  }
  return null;
}

/**
 * Is the NEA feed answering?
 *
 * Late is dark green: it is an upstream source being behind, the same fact as a late sensor. It is
 * amber once Lightning has told sites it is down — a project's `last_notified_degraded` is exactly
 * that, the service's own "WARNING IS DOWN" message having gone out — because from then on workers
 * are being told they are not covered, and that is no longer background.
 */
export function assessFeed(runtime: ServiceRuntime | null, degradedProjects: readonly string[], now: Date): LightningNotice | null {
  if (!runtime) return null;
  const answered = runtime.last_fetch_success_at || 0;
  const failures = Number(runtime.consecutive_fetch_failures) || 0;
  const age = answered ? now.getTime() - answered : Infinity;
  const behind = age >= FEED_QUIET_MS || failures > 0;

  if (degradedProjects.length) {
    const shown = degradedProjects.slice(0, 5).join(", ");
    const more = degradedProjects.length > 5 ? ` and ${degradedProjects.length - 5} more` : "";
    return {
      id: "feed",
      colour: "amber",
      label: `Sites were told the warning service is down (${shown}${more}); the NEA feed ${answered ? `last answered ${minutes(age)} min ago` : "has not answered"}`,
      detail: iso(answered),
    };
  }
  if (!behind) return null;

  const error = logLines(runtime.last_fetch_error)[0];
  return {
    id: "feed",
    colour: "stale",
    label:
      `The NEA feed ${answered ? `last answered ${minutes(age)} min ago` : "has not answered"}` +
      `${failures > 0 ? `, ${failures} failure${failures === 1 ? "" : "s"} in a row` : ""}` +
      `${error ? ` — “${clip(error)}”` : ""}`,
    detail: iso(answered),
  };
}

/**
 * The standing fault for each enabled project, if it has one.
 *
 * In priority order, because a card shows one: the service's own `last_error`; a STOP whose
 * all-clear never went; a project that has stopped being evaluated. The last two are judged only
 * while the tick is alive — if the tick itself has stopped, every project is "not evaluated" and the
 * one notice about the tick says it better than twenty-eight cards.
 *
 * `enabled` is from the project's config, because a disabled project keeps its last evaluation time
 * for ever, and would read as a fault.
 */
export function lightningProjectFaults(
  projects: readonly ProjectRuntime[],
  enabled: ReadonlySet<string>,
  runtime: ServiceRuntime | null,
  now: Date,
): Record<string, string> {
  const finished = runtime?.last_tick_finished_at || runtime?.last_tick_started_at || 0;
  const tickAlive = finished > 0 && now.getTime() - finished < TICK_LATE_MS;
  const faults: Record<string, string> = {};

  for (const project of projects) {
    const code = String(project.project_code ?? "").trim();
    if (!code || !enabled.has(code)) continue;

    const [error] = logLines(project.last_error);
    if (error) { faults[code] = error; continue; }
    if (!tickAlive) continue;

    const until = Number(project.active_stop_until_at) || 0;
    if (project.last_notified_state === "STOP" && until > 0 && now.getTime() - until >= STOP_GRACE_MS) {
      faults[code] = `Stuck in STOP: the 20-minute clearance passed at ${sgt(until)} but no ALL_CLEAR was sent`;
      continue;
    }

    const evaluated = Number(project.last_evaluated_at) || 0;
    if (evaluated > 0 && now.getTime() - evaluated >= EVALUATION_STALE_MS) {
      faults[code] = `Not evaluated since ${sgt(evaluated)} (${minutes(now.getTime() - evaluated)} min ago), although the tick last finished at ${sgt(finished)}`;
    }
  }
  return faults;
}

export type LightningHealth = { notices: LightningNotice[]; faults: Record<string, string> };

type Request = (path: string, init: { schema: string }) => Promise<{ ok: boolean; body: unknown }>;

/**
 * Three small reads: one heartbeat row, the per-project runtime rows, and which projects are enabled.
 *
 * A table that cannot be read contributes nothing, which is the weaker answer and said plainly: this
 * cannot tell "healthy" from "could not look", so a finding is shown when found and its absence proves
 * nothing. That matches the faults reader beside it.
 */
export async function readLightningHealth(request: Request, now: Date = new Date()): Promise<LightningHealth> {
  const schema = "lightning";
  const [service, projects, configs] = await Promise.all([
    request(
      "lightning_service_runtime?select=last_tick_started_at,last_tick_finished_at,last_tick_status,last_tick_projects_total,last_tick_projects_failed,last_fetch_success_at,consecutive_fetch_failures,last_fetch_error&service_key=eq.nea",
      { schema },
    ).catch(() => null),
    request(
      "lightning_project_runtime?select=project_code,last_evaluated_at,last_error,last_notified_state,last_notified_degraded,active_stop_until_at",
      { schema },
    ).catch(() => null),
    request("lightning_project_configs?select=project_code,enabled", { schema }).catch(() => null),
  ]);

  const runtime = service?.ok && Array.isArray(service.body) ? ((service.body[0] as ServiceRuntime | undefined) ?? null) : null;
  const projectRows = projects?.ok && Array.isArray(projects.body) ? (projects.body as ProjectRuntime[]) : [];
  const enabled = new Set(
    configs?.ok && Array.isArray(configs.body)
      ? (configs.body as { project_code?: unknown; enabled?: unknown }[])
          .filter((row) => row.enabled === true)
          .map((row) => String(row.project_code ?? "").trim())
          .filter(Boolean)
      : [],
  );

  const degraded = projectRows
    .filter((row) => row.last_notified_degraded === true && enabled.has(String(row.project_code)))
    .map((row) => String(row.project_code))
    .sort();

  const notices = [assessTick(runtime, now), assessFeed(runtime, degraded, now)].filter((notice): notice is LightningNotice => notice !== null);
  return { notices, faults: lightningProjectFaults(projectRows, enabled, runtime, now) };
}
