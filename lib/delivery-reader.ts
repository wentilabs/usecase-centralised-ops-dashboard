import { colourForStatus, type HealthColour } from "./health-status";
import { everyProjectHasEnough } from "./enough-per-project";
import { readPaged } from "./paged-read";
import type { ServiceKey } from "./services";

/**
 * Did this project's last message reach the listener?
 *
 * The question the dashboard could not ask. Health was the age of a readings
 * table, which only two services keep — so five services showed nothing, while
 * their delivery ledgers were recording real failures the whole time. At the
 * time of writing those ledgers held 75 UNCONFIRMED rows on Haze and 43 FAILED
 * on Lightning, in the last few hours, none of it visible anywhere in HALO.
 *
 * **What "delivered" means here.** Since the listener queue landed, a service
 * can confirm that the listener ACCEPTED a message — `queued` — and no more
 * than that. Whether WhatsApp ultimately sent it is resolved later, in the
 * listener's own `internal.whatsapp_outbound_queue`, which nothing reconciles
 * against yet. So `queued` is green here because acceptance is the furthest
 * this side can honestly see, and the open gap is recorded in
 * docs/DATA_HEALTH.md rather than hidden behind a colour.
 *
 * **Not `server-only`, deliberately.** The transport arrives as an argument, so
 * this module holds no credentials and reaches no network — it is a pure mapper
 * from ledger rows to verdicts, in the same family as `lib/load-model`. That is
 * what makes it testable against real row shapes. The credential boundary is
 * `lib/config-repository.ts`, which supplies the service-role request and stays
 * server-only; moving the marker here would buy nothing and cost the tests.
 */

type Ledger = {
  schema: string;
  table: string;
  statusColumn: string;
  projectColumn: string;
  /** Newest-first ordering key. */
  timeColumn: string;
};

/**
 * Where each service records its outbound attempts.
 *
 * Only the services whose ledger is both per-project and actually written to.
 * The others are deliberately absent rather than guessed at, so the board says
 * "nothing reads this service" instead of showing a green it has not earned:
 *
 *   wbgt    `wbgt_notification_outbox` exists but is empty
 *   subcon  `outbound_message_submissions` exists but is empty
 *   ailytics keys deliveries by `project_config_id`, a uuid, not `project_code`
 *   noise   records no general delivery ledger at all — only its monthly report
 *
 * This lives in HALO rather than in the contracts because it is an integration
 * detail — which table, which column — not a semantic one. What the statuses
 * MEAN stays with each service, in its contract, and is read through
 * `colourForStatus`.
 */
const LEDGERS: Partial<Record<ServiceKey, Ledger>> = {
  haze: {
    schema: "haze",
    table: "haze_notification_events",
    statusColumn: "delivery_status",
    projectColumn: "project_code",
    timeColumn: "created_at",
  },
  lightning: {
    schema: "lightning",
    table: "lightning_events",
    statusColumn: "delivery_status",
    projectColumn: "project_code",
    timeColumn: "created_at",
  },
  issueChaser: {
    schema: "issue_chaser",
    table: "outbound_submissions",
    statusColumn: "status",
    projectColumn: "project_code",
    timeColumn: "submitted_at",
  },
};

export type DeliveryVerdict = {
  service: ServiceKey;
  projectCode: string;
  colour: HealthColour;
  /** The service's own word, never rewritten — this is what a reader greps. */
  status: string;
  at: string;
};

export function servicesWithLedger(): ServiceKey[] {
  return Object.keys(LEDGERS) as ServiceKey[];
}

/**
 * The newest attempt per project, for one service.
 *
 * One query, not one per project: PostgREST cannot do `DISTINCT ON`, so the
 * recent window is pulled once and reduced here. `limit` is generous because a
 * service that sends hourly to thirty projects fills a few hundred rows a day,
 * and a project missing from the window simply has no verdict rather than a
 * wrong one.
 */
export async function readDelivery(
  service: ServiceKey,
  request: (path: string, init: { schema: string }) => Promise<{ ok: boolean; body: unknown }>,
  limit = 600,
): Promise<DeliveryVerdict[]> {
  const ledger = LEDGERS[service];
  if (!ledger) return [];

  const { schema, table, statusColumn, projectColumn, timeColumn } = ledger;
  const select = `${projectColumn},${statusColumn},${timeColumn}`;
  const res = await request(`${table}?select=${select}&order=${timeColumn}.desc&limit=${limit}`, { schema });
  if (!res.ok || !Array.isArray(res.body)) return [];

  const newest = new Map<string, DeliveryVerdict>();
  for (const row of res.body as Record<string, unknown>[]) {
    const projectCode = String(row[projectColumn] ?? "").trim();
    if (!projectCode || newest.has(projectCode)) continue; // rows arrive newest-first
    const status = String(row[statusColumn] ?? "").trim();
    newest.set(projectCode, {
      service,
      projectCode,
      colour: colourForStatus(service, status).colour,
      status,
      at: String(row[timeColumn] ?? ""),
    });
  }
  return [...newest.values()];
}

/**
 * Every attempt in a recent window, for the history strip.
 *
 * Separate from `readDelivery` because it answers a different question and has
 * a different cost: that one wants the newest row per project, this one wants
 * all of them, and only their time and status. Two columns rather than the
 * whole row keeps a two-day window for a service sending to sixty-four groups
 * an hour down to a few hundred kilobytes, and the repository caches it.
 *
 * Bounded by COUNT per project, not by time, because the strips are ordinal: a
 * bar is one delivery attempt, whatever cadence the service runs at. Paged,
 * because PostgREST caps every response at 1000 rows without saying so, and
 * stopped as soon as every project in hand has its quota — see
 * `lib/paged-read.ts` and `lib/enough-per-project.ts`.
 */
export async function readDeliveryWindow(
  service: ServiceKey,
  request: (path: string, init: { schema: string }) => Promise<{ ok: boolean; body: unknown }>,
  perProject: number,
  maxPages = 4,
): Promise<{ projectCode: string; at: string; colour: HealthColour; status: string }[]> {
  const ledger = LEDGERS[service];
  if (!ledger) return [];

  const { schema, table, statusColumn, projectColumn, timeColumn } = ledger;
  const rows = await readPaged(
    request,
    (offset, limit) =>
      `${table}?select=${projectColumn},${statusColumn},${timeColumn}` +
      `&order=${timeColumn}.desc&limit=${limit}&offset=${offset}`,
    {
      schema,
      maxPages,
      enough: (seen) =>
        everyProjectHasEnough(seen, (row) => String(row[projectColumn] ?? "").trim(), perProject),
    },
  );

  return rows.flatMap((row) => {
    const projectCode = String(row[projectColumn] ?? "").trim();
    const at = String(row[timeColumn] ?? "");
    if (!projectCode || !at) return [];
    const status = String(row[statusColumn] ?? "").trim();
    return [{ projectCode, at, colour: colourForStatus(service, status).colour, status }];
  });
}
