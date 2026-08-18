import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listAudit } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import { SERVICES, isServiceKey } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const service = params.get("service");
  try {
    const entries = await listAudit({
      table: service && isServiceKey(service) ? SERVICES[service].table : undefined,
      rowId: params.get("project") ?? undefined,
      limit: Number(params.get("limit") ?? 200),
    });
    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
