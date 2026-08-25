import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { withinServiceArea } from "@/lib/derive";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search";
const TIMEOUT_MS = 20_000;

/**
 * Address → coordinates, via OneMap.
 *
 * Proxied rather than called from the browser so the optional `ONEMAP_TOKEN`
 * stays server-side, and so a CORS policy change on OneMap's side cannot break
 * the dialog. Mirrors `geocodeSingapore` in the lightning repo, including the
 * service-area check on every candidate — the caller picks one, and picking an
 * out-of-area result must be visibly wrong rather than silently rejected later
 * by a CHECK constraint.
 */
export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (!query) return NextResponse.json({ error: "A postal code or address is required." }, { status: 400 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL(ONEMAP_SEARCH_URL);
    url.searchParams.set("searchVal", query);
    url.searchParams.set("returnGeom", "Y");
    url.searchParams.set("getAddrDetails", "Y");

    const token = process.env.ONEMAP_TOKEN;
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json", ...(token ? { Authorization: token } : {}) },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `OneMap returned ${res.status}.` }, { status: 502 });
    }
    const body = (await res.json()) as { results?: Record<string, string>[] };
    const results = (body.results ?? []).map((row, index) => {
      const latitude = Number(Number(row.LATITUDE).toFixed(6));
      const longitude = Number(Number(row.LONGITUDE).toFixed(6));
      return {
        index,
        address: row.ADDRESS,
        postal_code: row.POSTAL && row.POSTAL !== "NIL" ? row.POSTAL : null,
        latitude,
        longitude,
        valid: withinServiceArea(latitude, longitude),
      };
    });
    return NextResponse.json({ ok: true, query, results: results.slice(0, 8) });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? "OneMap did not respond in time." : `Address lookup failed: ${error}` },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
