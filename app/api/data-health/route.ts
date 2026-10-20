import { NextResponse } from "next/server";

import { listEstateHealth } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/data-health` — each project's readings-age verdict, loaded after first paint.
 *
 * This used to be awaited by the page itself, and it was the whole of the wait: of a 3.7 s render,
 * 3.6 s was this — one newest-row query per active project, 63 of them — while configuration, field
 * specs, group names and the session together took about 120 ms. The cards do not need it to be
 * useful (they render without a pill, as they already do without strips), so it arrives a moment
 * later and the page no longer waits for it.
 *
 * It answers `tookMs` as well, because "how long did the thing I am waiting on take" is the number
 * the dashboard now shows beside each load.
 */
export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const health = await listEstateHealth().catch(() => null);
  return NextResponse.json({ health, fetchedAt: new Date().toISOString(), tookMs: Date.now() - started });
}
