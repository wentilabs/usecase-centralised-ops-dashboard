import { NextResponse } from "next/server";
import { getDashboardSession } from "@/lib/supabase/server";
import { readSmsGatewayHealth } from "@/lib/sms-gateway-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/data-health/sms-gateways — listSmsGatewayHealth in lib/openapi.ts.
 * Current gateway health, calculated by the database at read time; never cached.
 */
export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const gateways = await readSmsGatewayHealth();
    return NextResponse.json({ gateways }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ gateways: null, error: "SMS gateway health unavailable" }, { status: 503 });
  }
}
