import { NextResponse } from "next/server";

import { listProjectFaults, listProjectStrips, listServiceNotices } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/project-strips` — the health history behind each card's bar strip.
 *
 * Fetched after first paint rather than rendered with the page, because the cost
 * is irreducible and the dashboard should not wait on it. Noise alone writes
 * 10,227 run rows in 48 hours and PostgREST serves 1000 at a time, so a hundred
 * processes for each of its 32 projects is four keyset pages; measured, touching
 * that window costs about a second however it is asked for — a single project's
 * own hundred rows takes as long as a full page, because the window itself is
 * the scan.
 *
 * None of that belongs in front of the project cards, which are the reason
 * somebody opened the page. The strips arrive a moment later and the cards
 * render without them, which is why `HealthBars` returns null on an empty list
 * rather than drawing an empty frame.
 */
export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // In parallel, and a failure of one must not take the other down: the faults
  // are a handful of rows and the strips are the slow read.
  const [strips, faults, notices] = await Promise.all([
    listProjectStrips(),
    listProjectFaults().catch(() => ({})),
    // Whole-service findings (the Lightning tick, the NEA feed): three small reads, cached for a
    // minute, and a failure here must not take the strips down.
    listServiceNotices().catch(() => []),
  ]);
  return NextResponse.json({ strips, faults, notices });
}
