import { NextResponse } from "next/server";

import { listProjectStrips } from "@/lib/config-repository";
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

  const strips = await listProjectStrips();
  return NextResponse.json({ strips });
}
