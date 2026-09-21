import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listWbgtSensors } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/wbgt-sensors — list active sensors for the MBS delivery editor. */

export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectCode = request.nextUrl.searchParams.get("project")?.trim();
  if (!projectCode) return NextResponse.json({ error: "project is required" }, { status: 400 });
  try {
    const sensors = await listWbgtSensors(projectCode);
    return NextResponse.json({ projectCode, sensors }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
