/**
 * Web Mercator tile maths for the coordinate picker.
 *
 * Kept as its own pure module for the reason every other pure module here is:
 * a projection bug puts a project's pin in the wrong place, and that is worth a
 * unit test rather than a squint at a map. Nothing in here touches the DOM.
 *
 * Tiles come from OneMap, the Singapore Land Authority's basemap — the same
 * source as the address lookup in the onboarding dialog, and the appropriate one
 * for projects that are all inside Singapore by CHECK constraint.
 */

/** OneMap's XYZ basemap. `Default` is their standard style. */
export const TILE_URL = "https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png";

/** Required wherever the tiles are shown. */
export const TILE_ATTRIBUTION = "OneMap © Singapore Land Authority";

export const TILE_SIZE = 256;

/**
 * The colour OneMap paints open water, sampled from one of its own sea tiles.
 *
 * Used as the ground behind the tile layer. Outside its coverage OneMap answers
 * **200 with a zero-byte body** rather than 404 — the browser fails to decode
 * it, which is what the tiles' `onError` catches — so past the coastline there
 * is simply nothing drawn, and the container showed through as a dark band that
 * read as a broken panel. Painting the ground in OneMap's own water colour
 * makes the edge of the data invisible: the sea just continues, which where
 * Singapore is concerned it does.
 */
export const TILE_WATER = "#6da8e4";

/**
 * Zoom bounds.
 *
 * 11 shows the whole island, which is the widest view that is ever useful for a
 * Singapore-only service. 19 is the deepest zoom OneMap serves for this style;
 * asking for 20 returns blank tiles rather than an error, which looks like a
 * broken map.
 */
export const MIN_ZOOM = 11;
export const MAX_ZOOM = 19;

/** Roughly the middle of Singapore — where the map opens with no coordinates yet. */
export const SG_CENTRE = { latitude: 1.3521, longitude: 103.8198 };

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
}

/** Fractional tile X for a longitude. */
export function lonToTileX(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * 2 ** zoom;
}

/** Fractional tile Y for a latitude. The log term is the Mercator part. */
export function latToTileY(latitude: number, zoom: number): number {
  const radians = (latitude * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** zoom;
}

export function tileXToLon(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

export function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Move a centre point by a pixel offset at a given zoom.
 *
 * Dragging the map is expressed as "the centre moved by (-dx, -dy) pixels", so
 * this is the one conversion the drag handler needs.
 */
export function panCentre(
  centre: { latitude: number; longitude: number },
  { dx, dy }: { dx: number; dy: number },
  zoom: number,
): { latitude: number; longitude: number } {
  // A zero pan returns the point untouched. Round-tripping through the
  // projection for no movement changes the last decimal, which would let an
  // idle map slowly rewrite a coordinate someone typed.
  if (dx === 0 && dy === 0) return { latitude: centre.latitude, longitude: centre.longitude };
  const x = lonToTileX(centre.longitude, zoom) + dx / TILE_SIZE;
  const y = latToTileY(centre.latitude, zoom) + dy / TILE_SIZE;
  return { latitude: tileYToLat(y, zoom), longitude: tileXToLon(x, zoom) };
}

/** The point under a pixel, measured from the centre of a viewport. */
export function pointAtOffset(
  centre: { latitude: number; longitude: number },
  { dx, dy }: { dx: number; dy: number },
  zoom: number,
): { latitude: number; longitude: number } {
  return panCentre(centre, { dx, dy }, zoom);
}

export type Tile = { x: number; y: number; z: number; left: number; top: number };

/**
 * Which tiles cover a viewport, and where each one sits.
 *
 * `left`/`top` are pixel offsets inside the viewport, so a caller can position
 * every tile absolutely and never do arithmetic of its own. Tiles outside the
 * world are dropped rather than requested — at zoom 11 and up that only happens
 * at the poles, but a dropped tile is cheaper than a 404.
 */
export function tilesForViewport(
  centre: { latitude: number; longitude: number },
  zoom: number,
  width: number,
  height: number,
): Tile[] {
  const centreX = lonToTileX(centre.longitude, zoom);
  const centreY = latToTileY(centre.latitude, zoom);
  const span = 2 ** zoom;

  // The tile containing the centre, and where its top-left corner lands.
  const originLeft = width / 2 - (centreX % 1) * TILE_SIZE;
  const originTop = height / 2 - (centreY % 1) * TILE_SIZE;

  const before = { x: Math.ceil(originLeft / TILE_SIZE), y: Math.ceil(originTop / TILE_SIZE) };
  const after = {
    x: Math.ceil((width - originLeft - TILE_SIZE) / TILE_SIZE),
    y: Math.ceil((height - originTop - TILE_SIZE) / TILE_SIZE),
  };

  const tiles: Tile[] = [];
  for (let ix = -before.x; ix <= after.x; ix += 1) {
    for (let iy = -before.y; iy <= after.y; iy += 1) {
      const x = Math.floor(centreX) + ix;
      const y = Math.floor(centreY) + iy;
      if (y < 0 || y >= span) continue;
      tiles.push({
        // Wrap in X so a drag past the antimeridian still renders. Y does not
        // wrap — there is nothing above the north pole.
        x: ((x % span) + span) % span,
        y,
        z: zoom,
        left: originLeft + ix * TILE_SIZE,
        top: originTop + iy * TILE_SIZE,
      });
    }
  }
  return tiles;
}

export function tileSrc({ x, y, z }: Tile): string {
  return TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** Six decimals is ~11cm — past the precision of a dragged pin. */
export function formatCoordinate(value: number): string {
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * The area OneMap actually serves tiles for.
 *
 * Outside it every tile request 404s and the browser draws its own broken-image
 * placeholder, which tiled across the empty half of the screen. Singapore's
 * extent including the outlying islands, padded slightly so the coastline is
 * never flush against the edge.
 *
 * This is a real limit of the basemap, not a policy choice: the projects are all
 * inside Singapore by CHECK constraint, so there is nothing to see beyond it.
 */
export const SG_BOUNDS = { south: 1.13, west: 103.56, north: 1.51, east: 104.15 };

/**
 * Hold the *viewport* inside the tiled area, not merely its centre.
 *
 * Clamping the centre alone still let the island be dragged into a corner with
 * three quarters of the screen empty. This keeps the visible edges against the
 * coverage instead, so Singapore cannot leave the view — and when the viewport
 * is wider than the coverage (which it is at the default zoom on a desktop),
 * the axis is locked to the middle, so there is nothing to drag at all.
 *
 * Done in tile space because Mercator latitude is not linear: averaging two
 * latitudes would put "the middle" slightly north of where it renders.
 */
export function clampCentre(
  centre: { latitude: number; longitude: number },
  zoom: number,
  width: number,
  height: number,
  bounds = SG_BOUNDS,
): { latitude: number; longitude: number } {
  // Before the container is measured there is no viewport to fit.
  if (!(width > 0) || !(height > 0)) return centre;

  const halfX = width / 2 / TILE_SIZE;
  const halfY = height / 2 / TILE_SIZE;
  const west = lonToTileX(bounds.west, zoom);
  const east = lonToTileX(bounds.east, zoom);
  // Tile Y grows southward, so the northern edge is the smaller number.
  const north = latToTileY(bounds.north, zoom);
  const south = latToTileY(bounds.south, zoom);

  const fit = (value: number, low: number, high: number, half: number) =>
    high - low <= half * 2 ? (low + high) / 2 : Math.min(high - half, Math.max(low + half, value));

  return {
    latitude: tileYToLat(fit(latToTileY(centre.latitude, zoom), north, south, halfY), zoom),
    longitude: tileXToLon(fit(lonToTileX(centre.longitude, zoom), west, east, halfX), zoom),
  };
}

/**
 * How much wheel travel one zoom level costs.
 *
 * A step per wheel event made the map unusable on a trackpad, which fires a
 * stream of small deltas per gesture: one flick crossed four zoom levels and
 * overshot whatever you were aiming at. Each level is roughly a doubling, so
 * the threshold is deliberately high — a level should feel like a decision, not
 * something a stray scroll can do.
 */
export const WHEEL_PER_ZOOM = 600;

/**
 * What a wheel event means on a map: pan or zoom.
 *
 * A trackpad has two gestures and both arrive as `wheel`. Treating every wheel
 * event as zoom left a trackpad with no way to pan at all, and made zoom itself
 * feel dead once the per-level threshold went up.
 *
 * - **Pinch** sets `ctrlKey`. Browsers synthesise that for the pinch gesture,
 *   and no real Ctrl press is involved. Always a zoom.
 * - **A mouse wheel** reports whole lines or pages (`deltaMode` non-zero), or in
 *   Chrome one clean step of 100 or 120 pixels with no horizontal component.
 *   Zoom, which is what a mouse user expects from a map.
 * - **Everything else** is a two-finger scroll: many small, often fractional,
 *   frequently two-axis deltas. Pan.
 *
 * Ambiguous cases fall to pan deliberately. A wrong pan is a nudge the next
 * gesture undoes; a wrong zoom throws away the view you had lined up.
 */
export function classifyWheel(event: {
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): "zoom" | "pan" {
  if (event.ctrlKey || event.metaKey) return "zoom";
  if (event.deltaMode !== undefined && event.deltaMode !== 0) return "zoom";
  const step = Math.abs(event.deltaY);
  const clean = (step === 100 || step === 120) && event.deltaX === 0;
  return clean ? "zoom" : "pan";
}
