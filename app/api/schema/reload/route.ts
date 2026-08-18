import { NextResponse } from "next/server";

import { clearFieldSpecCache, getFieldSpec } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import { SERVICE_KEYS } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Picks up columns added to Supabase without a redeploy. */
export async function POST() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  clearFieldSpecCache();
  const specs = await Promise.all(SERVICE_KEYS.map((key) => getFieldSpec(key)));
  return NextResponse.json({
    ok: true,
    fields: Object.fromEntries(SERVICE_KEYS.map((key, i) => [key, Object.keys(specs[i].fields).length])),
  });
}
