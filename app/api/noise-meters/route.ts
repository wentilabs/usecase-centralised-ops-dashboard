import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listNoiseMeters } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Active noise meters for one project, so the editor can label RecIDs.
 *
 * Fetched on demand rather than shipped with the dashboard: the meter list is
 * ~4,800 limit rows across all projects, and only the project being edited
 * needs it.
 */
export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectCode = request.nextUrl.searchParams.get("project")?.trim();
  if (!projectCode) return NextResponse.json({ error: "project is required" }, { status: 400 });

  try {
    const meters = await listNoiseMeters(projectCode);
    return NextResponse.json({ projectCode, meters }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
