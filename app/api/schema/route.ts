import { NextResponse } from "next/server";

import { getFieldSpec } from "@/lib/config-repository";
import { getDashboardSession } from "@/lib/supabase/server";
import { SERVICE_KEYS } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * `GET /api/schema` — `getSchema` in the OpenAPI contract.
 *
 * The introspected field spec for every service: each column with the label, help
 * text, widget, options and default the editor renders from. Takes no parameters.
 * Reads only.
 *
 * This is the endpoint the nightly audit sweeps to catch a column that arrived in
 * Supabase without a label or a group — see AGENTS.md, "Editing the field spec".
 */

export async function GET() {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-service, not all-or-nothing. A schema that PostgREST cannot reach — a
  // newly added service whose schema is not exposed yet, most likely — must not
  // take the whole endpoint down with it. `app/page.tsx` already settles these
  // individually; this route did not, so registering Issue Chaser turned the
  // whole dashboard into a 500.
  const settled = await Promise.allSettled(SERVICE_KEYS.map((key) => getFieldSpec(key)));
  const payload = Object.fromEntries(
    SERVICE_KEYS.map((key, i) => {
      const result = settled[i];
      return [
        key,
        result.status === "fulfilled"
          ? result.value
          : { error: result.reason instanceof Error ? result.reason.message : String(result.reason) },
      ];
    }),
  );
  return NextResponse.json(payload);
}
