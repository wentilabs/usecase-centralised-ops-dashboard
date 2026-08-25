/**
 * Values HALO computes the way the services compute them.
 *
 * Each function here is a port of one in a service repo. That is a drift risk
 * and is accepted deliberately: the alternative is asking someone to paste a
 * value they cannot check, or making the browser call a Lambda for arithmetic.
 * Every port names its origin, and `tests/derive.test.ts` pins the cases the
 * source repo's own tests pin — including the ones that exist because the
 * obvious answer is wrong.
 */

/** Singapore service area, from the CHECK constraints haze and lightning share. */
export const SITE_BOUNDS = {
  minLat: 1.1,
  maxLat: 1.5,
  minLon: 103.55,
  maxLon: 104.15,
} as const;

export function withinServiceArea(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= SITE_BOUNDS.minLat &&
    latitude <= SITE_BOUNDS.maxLat &&
    longitude >= SITE_BOUNDS.minLon &&
    longitude <= SITE_BOUNDS.maxLon
  );
}

/** Reference points for the five NEA regions — haze `lib/nea-region.js`. */
const REGION_LABELS: Record<string, [number, number]> = {
  north: [1.41803, 103.82],
  south: [1.29587, 103.82],
  east: [1.35735, 103.94],
  west: [1.35735, 103.7],
  central: [1.35735, 103.82],
};

/** Equirectangular approximation, as in the source. Distances are tiny here. */
function planarDistance([aLat, aLon]: [number, number], [bLat, bLon]: [number, number]): number {
  const rad = Math.PI / 180;
  const x = (bLon - aLon) * rad * Math.cos(((aLat + bLat) / 2) * rad);
  const y = (bLat - aLat) * rad;
  return Math.sqrt(x * x + y * y);
}

export type RegionDerivation = {
  region: string;
  method: "override" | "north_east_rule" | "nearest_label";
  /** True whenever the value was inferred rather than stated. */
  requiresManualReview: boolean;
  note: string;
};

/**
 * Which NEA region a site follows.
 *
 * Port of `deriveNeaRegion` in the haze repo's `lib/nea-region.js`. Two things
 * carry over and must not be "simplified":
 *
 *  - **The Punggol/Sengkang rule runs BEFORE the centroid lookup.** NEA lists
 *    those areas as North even though the nearest reference point is East. The
 *    geometry is not wrong; the authority disagrees with it, and the authority
 *    wins.
 *  - **Every inferred answer is flagged for review.** The source returns
 *    `requires_manual_review: true` for both inference branches, and only an
 *    explicit override is trusted outright.
 *
 * This is an onboarding aid only. The service reads the stored `nea_region` and
 * never re-derives it, so correcting coordinates later does NOT move a project
 * to another region — see INV-HAZE-05.
 */
export function deriveNeaRegion(
  latitude: number,
  longitude: number,
  override?: string | null,
): RegionDerivation | null {
  const chosen = String(override ?? "").trim().toLowerCase();
  if (chosen) {
    if (!REGION_LABELS[chosen]) return null;
    return {
      region: chosen,
      method: "override",
      requiresManualReview: false,
      note: "Set explicitly — not derived.",
    };
  }

  if (!withinServiceArea(latitude, longitude)) return null;

  if (latitude >= 1.375 && longitude >= 103.84) {
    return {
      region: "north",
      method: "north_east_rule",
      requiresManualReview: true,
      note: "NEA lists Punggol and Sengkang as North even though the nearest reference point is East. Confirm against NEA before enabling.",
    };
  }

  const nearest = Object.entries(REGION_LABELS)
    .map(([region, point]) => ({ region, distance: planarDistance([latitude, longitude], point) }))
    .sort((a, b) => a.distance - b.distance)[0];

  return {
    region: nearest.region,
    method: "nearest_label",
    requiresManualReview: true,
    note: "Nearest NEA reference point. Confirm against NEA's own regional map before enabling.",
  };
}
