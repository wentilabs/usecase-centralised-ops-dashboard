import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveAddress } from "@/lib/geocode";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/onboard/geocode` — `geocodeAddress` in the OpenAPI contract.
 *
 * A thin proxy over `resolveAddress`, so the optional `ONEMAP_TOKEN` stays
 * server-side and a CORS policy change on OneMap's side cannot break the
 * dialog. The chat onboarding path calls the same function directly.
 *
 * `resolveAddress` rather than a single `geocodeSingapore` call because the
 * form people paste — "8 Seletar West Rd 1, Singapore 798990" — is the one
 * form OneMap returns nothing for. `triedAs` says which spelling matched.
 */
export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await resolveAddress(request.nextUrl.searchParams.get("q") ?? "", process.env);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
