import { NextResponse } from "next/server";

import { listHandlerFailures } from "@/lib/handler-failure-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** `GET /api/handler-failures` — recent service-written Supabase error evidence. */
export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await listHandlerFailures(), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ checkedAt: new Date().toISOString(), failures: [], sources: [], unavailable: true });
  }
}
