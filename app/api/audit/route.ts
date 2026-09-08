import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listAudit } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import { SERVICES, isServiceKey } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * `GET /api/audit` — `listAuditEntries` in the OpenAPI contract.
 *
 * The shared config audit trail from `ops.config_audit`, newest first, optionally
 * narrowed to one service and one row. Reads only.
 *
 * Parameters and their bounds are declared once, in `lib/openapi.ts`, and served
 * at `/openapi.json` — the same document the MCP tools are derived from. They are
 * not repeated here, because two copies of a parameter list is one copy that goes
 * stale, and a contract test asserts every route has an operation.
 */

export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const service = params.get("service");
  // `table` reaches the audited tables that are not a service's config row —
  // today just `noise_limits`, whose history is per METER and so is keyed on
  // `full_identifier` rather than a project code. Allow-listed rather than
  // passed through: `table_name` is a filter value, and the set of things worth
  // asking for is small and known.
  const table = params.get("table");
  const AUDITED_TABLES = new Set(["noise_limits"]);
  if (table && !AUDITED_TABLES.has(table)) {
    return NextResponse.json({ error: `No audit history is kept for “${table}”.` }, { status: 400 });
  }
  try {
    const entries = await listAudit({
      table: table ?? (service && isServiceKey(service) ? SERVICES[service].table : undefined),
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
