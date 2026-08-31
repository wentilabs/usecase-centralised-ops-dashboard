import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listLightningDetections } from "@/lib/config-repository";
import { DETECTION_CAP, WINDOWS, windowMs, type WindowKey } from "@/lib/lightning-map";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/lightning/detections` — `listLightningDetections` in the contract.
 *
 * Lightning detections for the evidence map.
 *
 * Read-only, and available to any signed-in reader rather than editors only: the
 * map exists to answer a client's "why did we get no alert at 23:50", and the
 * person fielding that question is not necessarily someone who may change
 * configuration.
 */
export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;

  const at = Number(params.get("at") ?? Date.now());
  if (!Number.isFinite(at)) {
    return NextResponse.json({ error: "`at` must be epoch milliseconds." }, { status: 400 });
  }
  const key = (params.get("window") ?? "1h") as WindowKey;
  if (!WINDOWS.some((entry) => entry.key === key)) {
    return NextResponse.json(
      { error: `\`window\` must be one of ${WINDOWS.map((entry) => entry.key).join(", ")}.` },
      { status: 400 },
    );
  }

  // south,west,north,east — the viewport, so zooming in shows more of a busy
  // hour instead of the same island-wide sample.
  let bbox: { south: number; west: number; north: number; east: number } | undefined;
  const raw = params.get("bbox");
  if (raw) {
    const parts = raw.split(",").map(Number);
    if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
      return NextResponse.json({ error: "`bbox` must be south,west,north,east." }, { status: 400 });
    }
    const [south, west, north, east] = parts;
    bbox = { south, west, north, east };
  }

  // Bounded so a hand-written URL cannot ask for the whole table. PostgREST
  // would cap it at 1000 regardless; this makes the ceiling explicit.
  const limit = Math.min(1000, Math.max(1, Number(params.get("limit") ?? DETECTION_CAP) || DETECTION_CAP));

  // Only G and C exist; anything else is a typo that would silently match
  // nothing and look like a quiet sky.
  const rawTypes = params.get("types");
  const types = rawTypes ? rawTypes.split(",").map((entry) => entry.trim().toUpperCase()).filter(Boolean) : undefined;
  if (types && types.some((type) => type !== "G" && type !== "C")) {
    return NextResponse.json({ error: "`types` may only contain G and C." }, { status: 400 });
  }
  if (types && types.length === 0) {
    return NextResponse.json({ error: "`types` must name at least one type." }, { status: 400 });
  }

  const from = at - windowMs(key);
  try {
    const { rows, total } = await listLightningDetections({
      fromMs: from,
      toMs: at,
      bbox,
      types,
      limit,
    });
    return NextResponse.json(
      {
        // Echoed so a screenshot of the map carries the window it was taken for.
        from,
        to: at,
        window: key,
        cap: limit,
        total,
        truncated: total > rows.length,
        detections: rows,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
