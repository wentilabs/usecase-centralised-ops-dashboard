import { NextResponse } from "next/server";

import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getDashboardSession();
  return NextResponse.json(session, { headers: { "Cache-Control": "private, no-store" } });
}
