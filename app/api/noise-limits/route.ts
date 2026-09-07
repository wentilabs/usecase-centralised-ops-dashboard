import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listNoiseLimits, listProtectedNoiseMeters } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/noise-limits` — `listNoiseLimits` in the OpenAPI contract.
 *
 * The permissible noise levels one project's meters are assessed against, read
 * from `noise-meters.noise_limits`. Reads only: these rows are written by the
 * limits refresh, or by hand for a meter whose numbers come from a source
 * outside NoiseLynx.
 *
 * With no `project`, returns just the protected set for every project — which is
 * what the card list needs to draw its badge, and is one query rather than one
 * per card.
 */
export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectCode = request.nextUrl.searchParams.get("project")?.trim();
  try {
    if (!projectCode) {
      const protectedMeters = await listProtectedNoiseMeters();
      return NextResponse.json({ protectedMeters }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const meters = await listNoiseLimits(projectCode);
    return NextResponse.json({ projectCode, meters }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
