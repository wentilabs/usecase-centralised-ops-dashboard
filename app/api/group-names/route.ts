import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { chatIdsIn } from "@/lib/card-summary";
import { getGroupNames, refreshRecentGroupNames } from "@/lib/group-names";
import { listConfigs } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import { SERVICE_KEYS } from "@/lib/services";
import type { ProjectConfigRow } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Chat id → group name for the whole dashboard.
 *
 * `?refresh=1` walks back through the recent listener log and re-reads every
 * active group's current name, which also discovers groups no project
 * references yet — that is what fills the group picker's dropdown. The complete
 * 641-group history comes from the one-time `npm run groups:backfill`; this
 * endpoint deliberately does not attempt it, because enumerating every distinct
 * id takes ~50s and would exceed the serverless request budget.
 */
export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  let scan: Awaited<ReturnType<typeof refreshRecentGroupNames>> | null = null;
  if (refresh) scan = await refreshRecentGroupNames();

  const settled = await Promise.allSettled(SERVICE_KEYS.map((key) => listConfigs(key)));
  const rows = settled.flatMap((result) => (result.status === "fulfilled" ? (result.value as ProjectConfigRow[]) : []));

  // The recent scan has already refreshed what it could see, so only ids it
  // never encountered need an individual lookup.
  const names = await getGroupNames(chatIdsIn(rows), { refresh: false });

  return NextResponse.json(
    { ...names, scan },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
