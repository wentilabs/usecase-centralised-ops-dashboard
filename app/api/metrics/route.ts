import { NextResponse } from "next/server";

import { metrics } from "@/lib/server-metrics";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/metrics` — where this process spent its time.
 *
 * One row per instrumented operation, costliest first by total time, each with
 * a call count, mean, p50, p95, max and its tags — cache hit and miss, ok and
 * error, timeout. Intended to be read before a refactor, so the work goes at
 * whatever is actually expensive rather than whatever was slow the one time
 * someone timed it with curl.
 *
 * Read-only and in-process. The numbers describe the instance that answers the
 * request and reset when it restarts, which on Amplify means they describe a
 * warm container rather than the estate — good enough to rank the operations
 * against each other, which is the question being asked.
 *
 * Behind the allow-list like every other route: the operation names say which
 * services exist and how the app is put together, and there is no reason for
 * that to be public.
 */
export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const stats = metrics.snapshot();
  return NextResponse.json({
    // Uptime is the denominator for every count below: 400 reads means one
    // thing after a minute and another after a day.
    uptimeSeconds: Math.round(process.uptime()),
    operations: stats,
    totalMs: stats.reduce((sum, stat) => sum + stat.total, 0),
  });
}
