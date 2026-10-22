import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { rowExists } from "@/lib/config-repository";
import { onboardingFor } from "@/lib/onboarding";
import { getDashboardSession } from "@/lib/supabase/server";
import { isServiceKey } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * `GET /api/onboard/{service}/prerequisites?code=` — `checkOnboardingPrerequisites` in the
 * OpenAPI contract.
 *
 * Which things a new project of this service needs are already there, for one code.
 *
 * Read-only. `met` is null when HALO could not ask, which the dialog must show as "could
 * not check" and never as missing.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ service: string }> }) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { service } = await context.params;
  if (!isServiceKey(service)) return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  const definition = onboardingFor(service);
  if (!definition) return NextResponse.json({ error: `${service} has no onboarding flow.` }, { status: 404 });

  const code = (request.nextUrl.searchParams.get("code") ?? "").trim();
  if (!code || !definition.codePattern.test(code)) return NextResponse.json({ ok: true, code, prerequisites: [] });

  const prerequisites = await Promise.all(
    (definition.prerequisites ?? []).map(async (item) => ({
      id: item.id,
      met: await rowExists(item.schema, item.table, item.filter(code)),
      metText: item.met,
      missingText: item.missing,
    })),
  );
  return NextResponse.json({ ok: true, code, prerequisites });
}
