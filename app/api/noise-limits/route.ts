import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listNoiseLimits, listProtectedNoiseMeters, writeNoiseLimits } from "@/lib/config-repository";
import { expandBandToHours, protectedSourceFile, type BandEdit } from "@/lib/noise-limits";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/noise-limits` — `listNoiseLimits` in the OpenAPI contract.
 *
 * The permissible noise levels one project's meters are assessed against, read
 * from `noise-meters.noise_limits`. Reads only: these rows are written by the
 * limits refresh, or by hand for a meter whose numbers come from a source
 * outside NoiseLynx.
 *
 * With no `project`, returns just the protected set for every project — which is
 * what the card list needs to draw its badge, and is one query rather than one
 * per card.
 */
export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectCode = request.nextUrl.searchParams.get("project")?.trim();
  try {
    if (!projectCode) {
      const protectedMeters = await listProtectedNoiseMeters();
      return NextResponse.json({ protectedMeters }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const meters = await listNoiseLimits(projectCode);
    return NextResponse.json({ projectCode, meters }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}

/**
 * `PATCH /api/noise-limits` — `writeNoiseLimits` in the contract.
 *
 * The only route that writes `noise_limits`. See docs/WRITE_NOISE_LIMITS.md.
 *
 * Gates, in order and here rather than in a caller, because a caller can be
 * bypassed:
 *   1. signed in, and `canEdit`;
 *   2. bands are named by their minute range and must be real bands of that
 *      meter — the request cannot invent a row, only change one that exists;
 *   3. `baseImportedAt` refuses a save built on values that have since moved;
 *   4. protection is applied in the SAME write as the values, so a refresh
 *      cannot land between the two and revert them.
 *
 * `protect` is a choice, deliberately not a consequence of editing. A correction
 * NoiseLynx should also carry is better left following NoiseLynx, so its page
 * stays the source of truth; sending `protect: false` leaves each row's existing
 * `source_file` untouched rather than clearing a marker somebody else set.
 */
export async function PATCH(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.canEdit) {
    return NextResponse.json({ error: "Your account has read-only access to the dashboard." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    projectCode?: string;
    fullIdentifier?: string;
    bands?: { dayType?: string; startMinutes?: number; endMinutes?: number; leq5min?: number | null; leq1hr?: number | null; leq12hr?: number | null }[];
    protect?: boolean;
    provenance?: string;
    baseImportedAt?: string | null;
  };

  const projectCode = String(body.projectCode ?? "").trim();
  const fullIdentifier = String(body.fullIdentifier ?? "").trim();
  if (!projectCode || !fullIdentifier) {
    return NextResponse.json({ error: "projectCode and fullIdentifier are required" }, { status: 400 });
  }
  if (!Array.isArray(body.bands) || !body.bands.length) {
    return NextResponse.json({ error: "No bands to write" }, { status: 400 });
  }

  const rows: Parameters<typeof writeNoiseLimits>[0]["rows"] = [];
  for (const band of body.bands) {
    const dayType = String(band.dayType ?? "");
    if (dayType !== "mon_sat" && dayType !== "sun_ph") {
      return NextResponse.json({ error: `Unknown day type “${dayType}”` }, { status: 400 });
    }
    const start = Number(band.startMinutes);
    const end = Number(band.endMinutes);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 1439 || end < 0 || end > 1440) {
      return NextResponse.json({ error: "A band needs whole-minute bounds inside one day" }, { status: 400 });
    }
    const limit = (value: unknown, name: string) => {
      if (value === null || value === undefined) return null;
      const parsed = Number(value);
      // Range is NOT enforced: the columns carry no CHECK and that is intended.
      // Non-numeric and negative are refused because neither can be meant.
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a number of 0 or more, or blank`);
      return parsed > 0 ? parsed : null;
    };
    try {
      const edit: BandEdit = {
        startMinutes: start,
        endMinutes: end,
        leq5min: limit(band.leq5min, "Leq5min"),
        leq1hr: limit(band.leq1hr, "Leq1hr"),
        leq12hr: limit(band.leq12hr, "Leq12hr"),
      };
      for (const hour of expandBandToHours(edit)) {
        rows.push({
          dayTypeNormalized: dayType,
          hourStartMinutes: hour.hourStartMinutes,
          hourEndMinutes: hour.hourEndMinutes,
          leq5min: edit.leq5min,
          leq1hr: edit.leq1hr,
          leq12hr: edit.leq12hr,
        });
      }
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const { written } = await writeNoiseLimits({
      projectCode,
      fullIdentifier,
      rows,
      sourceFile: body.protect ? protectedSourceFile(String(body.provenance ?? ""), today) : null,
      baseImportedAt: body.baseImportedAt ?? null,
    });
    const meters = await listNoiseLimits(projectCode);
    return NextResponse.json(
      { projectCode, written, meters },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const flagged = error as { conflict?: boolean; badRequest?: boolean };
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: flagged?.conflict ? 409 : flagged?.badRequest ? 400 : 502 },
    );
  }
}
