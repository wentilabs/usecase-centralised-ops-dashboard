import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** GET getVibrationMeterLimits reads one site's per-meter policy. PATCH
 * updateVibrationMeterLimit saves an editor's change with the row's updated_at guard. */

import { listVibrationMeterLimits, updateVibrationMeterLimit, type VibrationMeterLimitRow } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const validCode = (value: string) => /^[A-Z][A-Z0-9-]{0,31}$/.test(value);

export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const code = (request.nextUrl.searchParams.get("code") ?? "").trim();
  if (!validCode(code)) return NextResponse.json({ error: "A valid Vibration project code is required" }, { status: 400 });
  try {
    return NextResponse.json({ limits: await listVibrationMeterLimits(code) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.canEdit) return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Partial<VibrationMeterLimitRow>;
  const project = String(body.project_code ?? "");
  const meter = String(body.meter_code ?? "");
  const updatedAt = String(body.updated_at ?? "");
  const approved = Number(body.approved_ppv_mm_s);
  const warning = Number(body.warning_percent);
  const critical = Number(body.critical_percent);
  const limit = Number(body.limit_percent);
  if (!validCode(project) || !/^[A-Z0-9][A-Z0-9-]{0,47}$/.test(meter) || !updatedAt ||
      ![approved, warning, critical, limit].every(Number.isFinite) ||
      approved <= 0 || warning <= 0 || !(warning < critical && critical < limit)) {
    return NextResponse.json({ error: "Provide a positive PPV limit and ascending warning, critical and reached percentages" }, { status: 400 });
  }
  try {
    const saved = await updateVibrationMeterLimit({
      project_code: project, meter_code: meter, updated_at: updatedAt,
      approved_ppv_mm_s: approved, warning_percent: warning,
      critical_percent: critical, limit_percent: limit,
    });
    if (!saved) return NextResponse.json({ error: "Meter limit changed since it was opened; reload before saving" }, { status: 409 });
    return NextResponse.json({ limit: saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
