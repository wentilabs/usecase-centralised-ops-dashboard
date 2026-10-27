import { NextResponse } from "next/server";

import { listFrequentRunEvidence, listHazeHourlyEvidence, listNoiseScheduleEvidence, listSubconScheduleEvidence } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** `GET /api/scheduled-run-health` — independently read recurring service run evidence. */
export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [hazeHourlyEvidence, frequentRunEvidence, noiseScheduleEvidence, subconScheduleEvidence] = await Promise.all([listHazeHourlyEvidence(), listFrequentRunEvidence(), listNoiseScheduleEvidence(), listSubconScheduleEvidence()]);
  return NextResponse.json({ hazeHourlyEvidence, frequentRunEvidence, noiseScheduleEvidence, subconScheduleEvidence });
}
