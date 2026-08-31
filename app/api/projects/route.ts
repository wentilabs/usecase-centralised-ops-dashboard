import { NextResponse } from "next/server";

import { listConfigs } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import { SERVICES, SERVICE_KEYS } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * `GET /api/projects` — `listProjects` in the OpenAPI contract.
 *
 * Every service's project rows in one response, plus a per-service `meta` saying
 * which reads failed. Takes no parameters. Reads only.
 *
 * Per-service rather than all-or-nothing on purpose: one unreachable schema must
 * degrade to a card that says so, not to an empty dashboard.
 */

export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settled = await Promise.allSettled(SERVICE_KEYS.map((key) => listConfigs(key)));
  const payload: Record<string, unknown> = { fetchedAt: new Date().toISOString(), meta: {} };
  const meta: Record<string, unknown> = {};

  SERVICE_KEYS.forEach((key, i) => {
    const result = settled[i];
    meta[key] = { label: SERVICES[key].label, idColumn: SERVICES[key].idColumn };
    payload[key] =
      result.status === "fulfilled"
        ? result.value
        : { error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
  });

  payload.meta = meta;
  return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
}
