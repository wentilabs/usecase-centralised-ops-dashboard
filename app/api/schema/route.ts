import { NextResponse } from "next/server";

import { getFieldSpec } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import { SERVICE_KEYS } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const specs = await Promise.all(SERVICE_KEYS.map((key) => getFieldSpec(key)));
  return NextResponse.json(Object.fromEntries(SERVICE_KEYS.map((key, i) => [key, specs[i]])));
}
