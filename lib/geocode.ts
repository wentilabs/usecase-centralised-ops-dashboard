import { withinServiceArea } from "./derive";

/**
 * Address → coordinates, via OneMap.
 *
 * Lives here rather than in the route because two callers need it: the dialog,
 * through `GET /api/onboard/geocode`, where a person picks from the candidates;
 * and the chat onboarding path, which resolves an address named in a sentence
 * without anyone to ask. Mirrors `geocodeSingapore` in the lightning repo,
 * including the service-area check on every candidate — the caller picks one,
 * and picking an out-of-area result must be visibly wrong rather than silently
 * rejected later by a CHECK constraint.
 *
 * The optional `ONEMAP_TOKEN` stays server-side, which is the other reason the
 * browser goes through the route rather than calling OneMap directly.
 */
export type GeocodeCandidate = {
  index: number;
  address: string;
  postal_code: string | null;
  latitude: number;
  longitude: number;
  /** Inside the bounds haze and lightning both CHECK. */
  valid: boolean;
};

export type GeocodeResult =
  | { ok: true; query: string; results: GeocodeCandidate[] }
  | { ok: false; status: number; error: string };

const ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search";
const TIMEOUT_MS = 20_000;

export async function geocodeSingapore(
  query: string,
  env: Record<string, string | undefined> = {},
): Promise<GeocodeResult> {
  const searchVal = query.trim();
  if (!searchVal) return { ok: false, status: 400, error: "A postal code or address is required." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL(ONEMAP_SEARCH_URL);
    url.searchParams.set("searchVal", searchVal);
    url.searchParams.set("returnGeom", "Y");
    url.searchParams.set("getAddrDetails", "Y");

    const token = env.ONEMAP_TOKEN;
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json", ...(token ? { Authorization: token } : {}) },
    });
    if (!res.ok) return { ok: false, status: 502, error: `OneMap returned ${res.status}.` };

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
    return { ok: true, query: searchVal, results: results.slice(0, 8) };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: 504,
      error: aborted ? "OneMap did not respond in time." : `Address lookup failed: ${error}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The forms of an address worth trying, in order.
 *
 * OneMap's search is an exact-ish elastic match and is brittle about the way
 * people actually write a Singapore address. Measured against the live API:
 *
 *   "8 Seletar West Rd 1, Singapore 798990"  → 0 results
 *   "8 Seletar West Rd 1, Singapore"         → 0 results
 *   "798990"                                 → 1, the right one
 *   "8 Seletar West Rd 1"                    → 1, the right one
 *
 * The trailing ", Singapore <postal>" — the form every map app and every
 * signature block produces — is the thing that breaks it. In the dialog a
 * person sees nothing found and retypes; a plan has nobody to retype, so a
 * perfectly good address came back as "matched nothing in OneMap" and the row
 * stayed short of a location.
 *
 * So: as written first, because a building name or an unusual format may be
 * exactly what OneMap holds; then the postal code, which is unique in
 * Singapore and the most precise key there is; then the address with the
 * country-and-postal tail removed.
 */
export function addressVariants(query: string): string[] {
  const original = query.trim().replace(/\s+/g, " ");
  const tried: string[] = [];
  const add = (value: string) => {
    const trimmed = value.trim().replace(/[\s,]+$/, "");
    if (trimmed && !tried.some((seen) => seen.toLowerCase() === trimmed.toLowerCase())) tried.push(trimmed);
  };

  add(original);
  // Six digits standing alone. Not a bare six-digit substring of a longer
  // number, which would turn a phone number into a postal code.
  const postal = original.match(/(?:^|[^\d])(\d{6})(?:[^\d]|$)/)?.[1];
  if (postal) add(postal);
  // Both tails, in both orders, as ONE variant — ", Singapore" on its own
  // also returns nothing, so stripping the digits and stopping there would
  // spend a request on a form already known to fail.
  add(
    original
      .replace(/[,\s]+\d{6}\s*$/, "")
      .replace(/[,\s]+(?:singapore|s'pore|sgp?)\b[\s,]*\d*\s*$/i, "")
      .replace(/[,\s]+\d{6}\s*$/, ""),
  );
  return tried;
}

/**
 * Geocode an address, trying the forms OneMap will actually accept.
 *
 * Reports which form matched, because "we found it, but only after dropping
 * the postal code" is something the operator should be able to see next to
 * the coordinates.
 */
export async function resolveAddress(
  query: string,
  env: Record<string, string | undefined> = {},
): Promise<GeocodeResult & { triedAs?: string }> {
  let last: GeocodeResult & { triedAs?: string } = {
    ok: false,
    status: 400,
    error: "A postal code or address is required.",
  };
  for (const variant of addressVariants(query)) {
    const result = await geocodeSingapore(variant, env);
    // A transport failure is not a reason to try a different spelling — the
    // next attempt fails the same way, and hammering OneMap on a timeout is
    // the opposite of what to do.
    if (!result.ok) return { ...result, triedAs: variant };
    if (result.results.length) return { ...result, query, triedAs: variant };
    last = { ...result, query, triedAs: variant };
  }
  return last;
}

/**
 * The one candidate a plan should use, with no human to choose.
 *
 * The first result inside the service area. OneMap orders by relevance, and an
 * out-of-area match for a Singapore address is a wrong match rather than a
 * distant site — taking it would hand a CHECK constraint a value the operator
 * never saw. Nothing is picked when nothing is in area, and the caller says so
 * rather than guessing.
 */
export function bestCandidate(results: GeocodeCandidate[]): GeocodeCandidate | null {
  return results.find((candidate) => candidate.valid) ?? null;
}
