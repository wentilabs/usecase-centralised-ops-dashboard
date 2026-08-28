import type { ProjectConfigRow } from "./services";
import { latToTileY, lonToTileX, TILE_SIZE, tileXToLon, tileYToLat } from "./slippy-map";

/**
 * The maths behind the Singapore lightning map.
 *
 * Pure, and tested, because this module's whole job is to be evidence. The map
 * exists to answer "why did PENTA not get an alert at 23:50" with a picture, and
 * a picture that draws the wrong circle is worse than no picture — it would prove
 * something untrue to a client.
 */

/** How far back from the chosen instant to show. */
export const WINDOWS = [
  { key: "15m", label: "15 min", ms: 15 * 60_000 },
  { key: "1h", label: "1 hour", ms: 60 * 60_000 },
  { key: "3h", label: "3 hours", ms: 3 * 60 * 60_000 },
] as const;

export type WindowKey = (typeof WINDOWS)[number]["key"];

export function windowMs(key: WindowKey): number {
  return WINDOWS.find((entry) => entry.key === key)?.ms ?? 60 * 60_000;
}

/**
 * How many detections one view may carry.
 *
 * A quiet day is a few hundred island-wide; the service's own notes put a busy
 * one near 90,000. The cap keeps the canvas honest about being a sample, and the
 * viewport query is what makes zooming in show more: the same 500 spread over a
 * 6 km ring instead of the whole island.
 */
export const DETECTION_CAP = 500;

/**
 * The cap for the evidence query.
 *
 * The same 500 as the map, and that is enough because of the type filter, not
 * in spite of the volume: a storm is overwhelmingly intra-cloud, so restricting
 * the query to the types a tier actually counts turned the worst hour on record
 * for one site from 2,130 rows into 15. Anything realistic near a site fits.
 *
 * Raising it would not help much anyway — PostgREST's own `max-rows` is 1000,
 * and it returns 1000 for a larger request without complaining. If the cap is
 * somehow reached, the UI refuses to make an all-clear claim rather than
 * shading one, because a truncated all-clear is a false statement.
 */
export const EVIDENCE_CAP = DETECTION_CAP;

/**
 * How much wider than the widest ring the evidence box is drawn.
 *
 * Just enough margin that "nearest strike" has something to report when nothing
 * came close. Nobody asks whether a strike 30 km away mattered, so there is no
 * value in reaching further — the realistic question is always within about
 * 10 km of the site, which the widest ring in use (6 km) already covers.
 */
export const EVIDENCE_BOX_FACTOR = 1.25;

/**
 * A ring to draw for one project.
 *
 * `types` is which strike types this circle governs, because a tier only counts
 * the types in its `*_detection_types` list — and the label matters on the map:
 * a ring that ignores intra-cloud strikes must not look like one that catches
 * them.
 */
export type Ring = {
  tier: "red" | "amber";
  /** "G", "C" or "G/C" — what this circle qualifies. */
  types: string;
  /** Metres from the site centre. NOT the radius column — see below. */
  radiusM: number;
};

const TYPE_ORDER = ["G", "C"] as const;

/**
 * The types a tier counts, in a fixed G-then-C order.
 *
 * PostgREST hands back a `text[]` as a JS array, but the same column read as raw
 * text arrives as the Postgres literal `{G,C}` — braces and all, sometimes with
 * quoted elements. Both are accepted, and the order is normalised so two projects
 * with the same setting can never render differently.
 */
function typeList(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value.map(String)
    : String(value ?? "")
        .replace(/^[{\[]|[}\]]$/g, "")
        .split(",")
        .map((entry) => entry.trim().replace(/^"|"$/g, ""));
  return TYPE_ORDER.filter((type) => entries.includes(type));
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The circles that actually decide an alert, for one project.
 *
 * **The drawn radius is not `red_radius_m`.** The engine tests
 * `haversine − site_extent − uncertainty(type) ≤ radius`, so the qualifying
 * circle is `radius + site_extent + uncertainty(type)` — see INV-LTG-02 in the
 * lightning repo, where the margins WIDEN the trigger ring rather than narrowing
 * it. Every project currently runs extent 0 and both margins 0, which makes the
 * two identical today; drawing the raw column would still be wrong the moment
 * someone sets a margin, and the map would then understate the trigger area
 * while claiming to be proof.
 *
 * A tier yields two circles when its types carry different margins, and one when
 * they do not. Amber is omitted entirely when `amber_enabled` is false, because
 * amber detections are then not evaluated at all (INV-LTG-13) — a greyed ring
 * would imply a threshold that is not being tested.
 */
export function ringsFor(config: ProjectConfigRow): Ring[] {
  const extent = number(config.site_extent_radius_m);
  const margin = { G: number(config.ground_uncertainty_m), C: number(config.cloud_uncertainty_m) };
  const rings: Ring[] = [];

  const tiers: { tier: "red" | "amber"; radius: number; types: string[]; enabled: boolean }[] = [
    {
      tier: "red",
      radius: number(config.red_radius_m),
      types: typeList(config.red_detection_types),
      enabled: true,
    },
    {
      tier: "amber",
      radius: number(config.amber_radius_m),
      types: typeList(config.amber_detection_types),
      enabled: config.amber_enabled !== false,
    },
  ];

  for (const { tier, radius, types, enabled } of tiers) {
    if (!enabled || radius <= 0 || !types.length) continue;
    const distinct = [...new Set(types.map((type) => margin[type as "G" | "C"]))];
    if (distinct.length === 1) {
      rings.push({ tier, types: types.join("/"), radiusM: radius + extent + distinct[0] });
      continue;
    }
    // Different margins mean the tier is genuinely two different circles.
    for (const type of types) {
      rings.push({ tier, types: type, radiusM: radius + extent + margin[type as "G" | "C"] });
    }
  }
  return rings;
}

/**
 * Metres per screen pixel, for drawing a metre-denominated circle on a tile map.
 *
 * Web Mercator stretches with latitude, so this is latitude-dependent. Singapore
 * sits near the equator where the factor is ~0.9997, which is exactly why it must
 * be written down: the error is invisible here and would stay invisible if the
 * formula were wrong.
 */
export function metresPerPixel(latitude: number, zoom: number): number {
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

/** A radius in metres, as pixels at this zoom. */
export function radiusPixels(radiusM: number, latitude: number, zoom: number): number {
  return radiusM / metresPerPixel(latitude, zoom);
}

export type Detection = {
  occurred_at: number;
  published_at: number | null;
  latitude: number;
  longitude: number;
  detection_type: "G" | "C";
};

/**
 * The lag between a strike happening and NEA telling us.
 *
 * On the map because the window filters on `published_at` — what we could have
 * acted on — and a reader comparing the map against an alert time needs to see
 * that a strike at 23:50 reached us at 23:58 and could not have fired a 23:52
 * message.
 */
export function publishLagSeconds(detection: Detection): number | null {
  if (!detection.published_at) return null;
  return Math.round((detection.published_at - detection.occurred_at) / 1000);
}

/**
 * The sphere the lightning engine measures on. Everything here must use the
 * same one: `boundsAround` sizing its box off a different radius left the box
 * 6 m short of the circle it claimed to contain.
 */
const EARTH_RADIUS_M = 6371000;

/** Metres in one degree of latitude on that sphere. */
const M_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_M) / 180;

/** Great-circle metres. Same formula the engine uses to decide. */
export function haversineMetres(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = EARTH_RADIUS_M;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a detection would have qualified for a project's tier.
 *
 * Mirrors `deriveState` in the lightning repo: the type must be one the tier
 * counts, and the effective distance must be within the radius. Used to colour
 * the handful of strikes that DID qualify, and — more often — to state that none
 * did.
 */
export function qualifies(config: ProjectConfigRow, detection: Detection, tier: "red" | "amber"): boolean {
  const ring = ringsFor(config).find(
    (entry) => entry.tier === tier && entry.types.split("/").includes(detection.detection_type),
  );
  if (!ring) return false;
  const distance = haversineMetres(
    { lat: number(config.latitude), lon: number(config.longitude) },
    { lat: detection.latitude, lon: detection.longitude },
  );
  return distance <= ring.radiusM;
}

/**
 * Where a coordinate lands inside the viewport, in pixels from its top-left.
 *
 * The tile layer positions itself the same way in `tilesForViewport`, so strikes
 * and rings drawn with this sit on the basemap rather than beside it. Points off
 * the edges come back with out-of-range values on purpose — the caller culls,
 * and a ring whose centre is off-screen may still have an arc that is not.
 */
export function screenPoint(
  point: { latitude: number; longitude: number },
  centre: { latitude: number; longitude: number },
  zoom: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: width / 2 + (lonToTileX(point.longitude, zoom) - lonToTileX(centre.longitude, zoom)) * TILE_SIZE,
    y: height / 2 + (latToTileY(point.latitude, zoom) - latToTileY(centre.latitude, zoom)) * TILE_SIZE,
  };
}

/**
 * The geographic box a viewport covers, padded by a margin in pixels.
 *
 * The padding is what stops a strike popping into existence at the edge as you
 * pan: the query fetches a little more than is visible. It is also why the box
 * is computed from corners rather than from a radius — a wide desktop viewport
 * is nothing like square.
 */
export function viewportBounds(
  centre: { latitude: number; longitude: number },
  zoom: number,
  width: number,
  height: number,
  padPx = 64,
): { south: number; west: number; north: number; east: number } {
  const centreX = lonToTileX(centre.longitude, zoom);
  const centreY = latToTileY(centre.latitude, zoom);
  const halfX = (width / 2 + padPx) / TILE_SIZE;
  const halfY = (height / 2 + padPx) / TILE_SIZE;
  return {
    // Y grows southward in Mercator, so the larger tile Y is the southern edge.
    north: tileYToLat(centreY - halfY, zoom),
    south: tileYToLat(centreY + halfY, zoom),
    west: tileXToLon(centreX - halfX, zoom),
    east: tileXToLon(centreX + halfX, zoom),
  };
}

/**
 * The index of the drawn point nearest a pointer, within `radius` pixels.
 *
 * Nearest rather than first-within, so overlapping strikes in a cluster resolve
 * to the one actually under the cursor instead of whichever the loop met first.
 * Returns -1 when the pointer is over empty map.
 */
export function hitTest(points: { x: number; y: number }[], x: number, y: number, radius = 9): number {
  let best = -1;
  let bestDistance = radius * radius;
  points.forEach((point, index) => {
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/**
 * What this window proves about one project.
 *
 * The point of the whole map. A client asking "are you sure nothing hit us?"
 * gets a count of what was evaluated and how close the closest strike came, not
 * just an empty circle — an empty circle is equally consistent with a map that
 * failed to load.
 *
 * `nearestM` is a plain centre-to-strike distance, deliberately not reduced by
 * the margins: it answers "how far away was it", while `red`/`amber` answer
 * "would it have fired", and conflating the two would make the number look
 * inconsistent with the rings.
 */
export function evidenceFor(
  config: ProjectConfigRow,
  detections: Detection[],
): { total: number; red: number; amber: number; nearestM: number | null } {
  let red = 0;
  let amber = 0;
  let nearestM: number | null = null;
  const centre = { lat: number(config.latitude), lon: number(config.longitude) };
  for (const detection of detections) {
    if (qualifies(config, detection, "red")) red += 1;
    // Counted independently: a strike inside the red ring is inside the wider
    // amber one too, and reporting "3 red, 0 amber" for that would read as amber
    // having missed something.
    if (qualifies(config, detection, "amber")) amber += 1;
    const distance = haversineMetres(centre, { lat: detection.latitude, lon: detection.longitude });
    if (nearestM === null || distance < nearestM) nearestM = distance;
  }
  return { total: detections.length, red, amber, nearestM };
}

/**
 * Singapore's UTC offset. Fixed — Singapore has had no DST since 1935 and no
 * offset change since 1982, so a constant is honest here in a way it would not
 * be for most timezones.
 */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * An epoch as the `YYYY-MM-DDTHH:mm` an `<input type="datetime-local">` wants,
 * read in Singapore time.
 *
 * The input element speaks the *browser's* local time, but every timestamp in
 * this app — alert logs, sheet rows, the client's own account of when the storm
 * was — is SGT. A laptop on another timezone would otherwise silently query a
 * window hours away from the one the operator typed, and the map would show a
 * quiet sky as proof.
 */
export function sgtInputValue(ms: number): string {
  return new Date(ms + SGT_OFFSET_MS).toISOString().slice(0, 16);
}

/** The inverse: what the operator typed, read as Singapore time. */
export function sgtInputToMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const parsed = Date.parse(`${value.slice(0, 16)}:00+08:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An epoch as a Singapore wall clock, to the second — the lag is the point. */
export function formatSgtClock(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

/** Metres as something a person reads: "820 m", "3.4 km". */
export function formatDistance(metres: number | null): string {
  if (metres === null || !Number.isFinite(metres)) return "—";
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(metres < 10000 ? 2 : 1)} km`;
}

/**
 * A box that contains a circle of `metres` around a point.
 *
 * Used to ask for a project's evidence separately from the viewport. The map
 * layer is capped and follows wherever you panned, so counting hits from what
 * happens to be drawn would report "0 strikes near TJR" when the truth is "0 of
 * the 500 I chose to draw" — a claim that could be shown to a client and be
 * wrong. A box a few kilometres wide almost never hits the cap, so the count it
 * yields is the real one.
 */
export function boundsAround(
  point: { latitude: number; longitude: number },
  metres: number,
): { south: number; west: number; north: number; east: number } {
  const dLat = metres / M_PER_DEG_LAT;
  // Longitude degrees shrink towards the poles; near the equator this is barely
  // a correction, but omitting it would quietly narrow the box further north.
  const dLon = metres / (M_PER_DEG_LAT * Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180)));
  return {
    south: point.latitude - dLat,
    north: point.latitude + dLat,
    west: point.longitude - dLon,
    east: point.longitude + dLon,
  };
}

/** The widest circle a project draws — what its evidence box must cover. */
export function widestRingM(config: ProjectConfigRow): number {
  return ringsFor(config).reduce((widest, ring) => Math.max(widest, ring.radiusM), 0);
}

/**
 * Every detection type any enabled tier of this project counts.
 *
 * The evidence query asks only for these. A type no tier counts cannot qualify
 * for anything, so fetching it can only crowd out a row that could have — which
 * is precisely how a truncated query turns into a false all-clear.
 */
export function countedTypes(config: ProjectConfigRow): string[] {
  const types = new Set<string>();
  for (const ring of ringsFor(config)) {
    for (const type of ring.types.split("/")) types.add(type);
  }
  return TYPE_ORDER.filter((type) => types.has(type));
}

export type Box = { south: number; west: number; north: number; east: number };

/**
 * Whether `outer` completely covers `inner`.
 *
 * The point is to not ask again for something already held. A complete (that
 * is, untruncated) result for a box is also a complete result for every box
 * inside it, so zooming in or panning slightly within the last fetch needs no
 * request at all — the strikes are already in memory and only the projection
 * changes. Skipping the round trip is the difference between a map that
 * redraws instantly and one that blinks.
 */
export function boxContains(outer: Box, inner: Box): boolean {
  return (
    outer.south <= inner.south &&
    outer.north >= inner.north &&
    outer.west <= inner.west &&
    outer.east >= inner.east
  );
}
