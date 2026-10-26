import { NextResponse } from "next/server";

import { listHazeHourlyEvidence } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** `GET /api/scheduled-run-health` — read the last two completed Haze hourly slots. */
export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ hazeHourlyEvidence: await listHazeHourlyEvidence() });
}
