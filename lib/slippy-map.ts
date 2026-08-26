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
