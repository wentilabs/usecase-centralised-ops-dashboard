import { NextResponse } from "next/server";

import {
  forgetHealthCaches,
  listConfigs,
  listProjectFaults,
  listProjectStrips,
  listServiceNotices,
} from "@/lib/config-repository";
import { listProjectHealth } from "@/lib/data-health-repository";
import { SERVICE_KEYS } from "@/lib/services";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `POST /api/data-health/refresh` — forget what Data Health remembers and read it all again.
 *
 * The dashboard's health is assembled from several reads with different lifetimes: the strips are
 * held five minutes because they cost a second of paging, the standing faults and Lightning's
 * heartbeat a minute, and the config rows a few seconds. That is right for a page left open and wrong
 * for someone who has just fixed a sheet and wants to know whether it is clear. This clears all four
 * and answers with everything the board and the cards draw from, so one click replaces the lot.
 *
 * A POST because it discards cached state, even though it changes nothing durable. Any signed-in
 * viewer may call it: it reads exactly what the page already shows, and a read-only account is the
 * one that most needs to see whether something has cleared.
 *
 * A read that fails is reported as `null`, never as an empty answer: an empty strips object would
 * blank every card's history, which would read as "nothing happened" rather than "could not look".
 */
export async function POST() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  forgetHealthCaches();

  // Rows first: the ingestion verdict is judged against each project's cadence, so it needs them.
  const rows = await Promise.allSettled(SERVICE_KEYS.map((key) => listConfigs(key)));
  const configured = Object.fromEntries(
    SERVICE_KEYS.map((key, index) => [key, rows[index].status === "fulfilled" ? rows[index].value : []]),
  );

  const [health, strips, faults, notices] = await Promise.all([
    listProjectHealth(configured).then((map) => Array.from(map.values())).catch(() => null),
    listProjectStrips().catch(() => null),
    listProjectFaults().catch(() => null),
    listServiceNotices().catch(() => null),
  ]);

  return NextResponse.json({ health, strips, faults, notices, fetchedAt: new Date().toISOString() });
}
