import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listVibrationSources } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/vibration/sources?code=` — `getVibrationSources` in the OpenAPI contract.
 *
 * The source targets (one per meter) that the scraper will read for a Vibration site.
 * Read-only. `sources` is null when HALO could not read them, which the editor must show
 * as "could not read" and never as "no source".
 */
export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const code = (request.nextUrl.searchParams.get("code") ?? "").trim();
  if (!/^[A-Z][A-Z0-9-]{0,31}$/.test(code)) return NextResponse.json({ error: "A Vibration project code is required." }, { status: 400 });
  return NextResponse.json({ ok: true, code, sources: await listVibrationSources(code) });
}
