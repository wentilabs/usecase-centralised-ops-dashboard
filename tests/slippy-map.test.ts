import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  SG_CENTRE,
  TILE_SIZE,
  clampZoom,
  formatCoordinate,
  latToTileY,
  lonToTileX,
  panCentre,
  tileSrc,
  tileXToLon,
  tileYToLat,
  tilesForViewport,
} from "../lib/slippy-map";

/**
 * A projection bug puts a project's pin in the wrong place, and the map looks
 * plausible either way — which is exactly the class of mistake a unit test is
 * for. These check against tile numbers verified by hand against OneMap.
 */
test("Singapore lands on the tiles OneMap actually serves", () => {
  // Verified by fetching them: z15 x25836 y16266 returns a real PNG.
  assert.equal(Math.floor(lonToTileX(103.8501, 15)), 25836);
  assert.equal(Math.floor(latToTileY(1.2897, 15)), 16266);
  assert.equal(Math.floor(lonToTileX(103.8501, 12)), 3229);
  assert.equal(Math.floor(latToTileY(1.2897, 12)), 2033);
});

test("the projection round-trips", () => {
  for (const point of [SG_CENTRE, { latitude: 1.1, longitude: 103.55 }, { latitude: 1.5, longitude: 104.15 }]) {
    for (const zoom of [11, 15, 19]) {
      const lon = tileXToLon(lonToTileX(point.longitude, zoom), zoom);
      const lat = tileYToLat(latToTileY(point.latitude, zoom), zoom);
      assert.ok(Math.abs(lon - point.longitude) < 1e-9, `lon ${lon} vs ${point.longitude}`);
      assert.ok(Math.abs(lat - point.latitude) < 1e-9, `lat ${lat} vs ${point.latitude}`);
    }
  }
});

test("panning moves the centre the way a drag reads", () => {
  // Dragging the map LEFT (negative dx) shows what is to the east, so the centre
  // longitude increases. Getting this backwards is the classic inverted-map bug.
  const east = panCentre(SG_CENTRE, { dx: TILE_SIZE, dy: 0 }, 15);
  assert.ok(east.longitude > SG_CENTRE.longitude, "positive dx moves east");
  const south = panCentre(SG_CENTRE, { dx: 0, dy: TILE_SIZE }, 15);
  assert.ok(south.latitude < SG_CENTRE.latitude, "positive dy moves south");

  // One tile at zoom z is 360/2^z degrees of longitude, exactly.
  assert.ok(Math.abs(east.longitude - SG_CENTRE.longitude - 360 / 2 ** 15) < 1e-9);

  // And a pan of zero is a no-op rather than a slow drift.
  const still = panCentre(SG_CENTRE, { dx: 0, dy: 0 }, 15);
  assert.equal(still.latitude, SG_CENTRE.latitude);
  assert.equal(still.longitude, SG_CENTRE.longitude);
});

test("a viewport is covered edge to edge, with no gaps", () => {
  const width = 600;
  const height = 260;
  const tiles = tilesForViewport(SG_CENTRE, 15, width, height);
  assert.ok(tiles.length > 0);

  // Every pixel of the viewport must be inside some tile. Sample a grid rather
  // than trust the arithmetic — a one-tile gap on the right edge is the bug this
  // catches, and it only appears at certain fractional centres.
  for (let px = 0; px < width; px += 25) {
    for (let py = 0; py < height; py += 25) {
      const covered = tiles.some(
        (t) => px >= t.left && px < t.left + TILE_SIZE && py >= t.top && py < t.top + TILE_SIZE,
      );
      assert.ok(covered, `no tile covers ${px},${py}`);
    }
  }

  // No tile is wildly outside the viewport either — that would be wasted fetches.
  for (const tile of tiles) {
    assert.ok(tile.left > -TILE_SIZE * 2 && tile.left < width + TILE_SIZE * 2, `left ${tile.left}`);
    assert.ok(tile.top > -TILE_SIZE * 2 && tile.top < height + TILE_SIZE * 2, `top ${tile.top}`);
  }
});

test("tiles are requested from OneMap, never off the edge of the world", () => {
  const tiles = tilesForViewport({ latitude: 1.29, longitude: 103.85 }, 12, 600, 260);
  for (const tile of tiles) {
    assert.ok(tile.y >= 0 && tile.y < 2 ** 12, `y ${tile.y} is outside the world`);
    assert.match(tileSrc(tile), /^https:\/\/www\.onemap\.gov\.sg\/maps\/tiles\/Default\/12\/\d+\/\d+\.png$/);
  }
});

test("zoom stays where OneMap serves tiles", () => {
  assert.equal(clampZoom(MIN_ZOOM - 5), MIN_ZOOM, "wider than the island is not useful");
  assert.equal(clampZoom(MAX_ZOOM + 5), MAX_ZOOM, "past this OneMap returns blank tiles, not an error");
  assert.equal(clampZoom(15.4), 15);
});

test("coordinates are written the way the column stores them", () => {
  // toFixed(6) gives "1.289700", and the trailing zeros come off.
  assert.equal(formatCoordinate(1.28970049), "1.2897");
  assert.equal(formatCoordinate(103.85), "103.85");
  // Six decimals is about 11cm, past what a dragged pin can mean.
  assert.ok(formatCoordinate(1.234567891).length <= 8);
});
