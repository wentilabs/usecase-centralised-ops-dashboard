import assert from "node:assert/strict";
import test from "node:test";

import { deriveNeaRegion, withinServiceArea } from "../lib/derive";

/**
 * `deriveNeaRegion` is a port of the haze repo's `lib/nea-region.js`. These pin
 * the cases that exist because the obvious answer is wrong. The port was also
 * cross-checked against the original across a 1,584-point grid covering the
 * whole service area, with zero mismatches.
 */

test("Punggol and Sengkang are North, against the nearest-centroid answer", () => {
  // NEA lists them as North; geometry says East. The authority wins, and the
  // rule runs BEFORE the centroid lookup so it cannot be overridden by distance.
  const punggol = deriveNeaRegion(1.4043, 103.9022)!;
  assert.equal(punggol.region, "north");
  assert.equal(punggol.method, "north_east_rule");
  assert.equal(punggol.requiresManualReview, true);

  // Just inside the rule's corner.
  assert.equal(deriveNeaRegion(1.375, 103.84)!.method, "north_east_rule");
  // Just outside it on each axis falls through to the centroid lookup.
  assert.equal(deriveNeaRegion(1.3749, 103.84)!.method, "nearest_label");
  assert.equal(deriveNeaRegion(1.375, 103.8399)!.method, "nearest_label");
});

test("every inferred region is flagged for review; only an override is trusted", () => {
  for (const derived of [deriveNeaRegion(1.2792, 103.848), deriveNeaRegion(1.4043, 103.9022)]) {
    assert.equal(derived!.requiresManualReview, true);
  }
  const override = deriveNeaRegion(1.2792, 103.848, "east")!;
  assert.equal(override.region, "east");
  assert.equal(override.method, "override");
  assert.equal(override.requiresManualReview, false);
});

test("an unknown override is refused rather than passed through", () => {
  assert.equal(deriveNeaRegion(1.2792, 103.848, "northeast"), null);
  // A blank override is not an override — it falls through to derivation.
  assert.deepEqual(deriveNeaRegion(1.2792, 103.848, ""), deriveNeaRegion(1.2792, 103.848));
});

test("coordinates outside Singapore derive nothing", () => {
  assert.equal(deriveNeaRegion(51.5, -0.12), null, "London");
  assert.equal(deriveNeaRegion(Number.NaN, 103.8), null);
  assert.equal(withinServiceArea(1.3, 103.8), true);
  // The CHECK bounds are inclusive at both ends.
  assert.equal(withinServiceArea(1.1, 103.55), true);
  assert.equal(withinServiceArea(1.5, 104.15), true);
  assert.equal(withinServiceArea(1.0999, 103.8), false);
  assert.equal(withinServiceArea(1.3, 104.1501), false);
});

test("the five regions are all reachable", () => {
  const seen = new Set<string>();
  for (let lat = 1.1; lat <= 1.5; lat += 0.01) {
    for (let lon = 103.55; lon <= 104.15; lon += 0.01) {
      const derived = deriveNeaRegion(Number(lat.toFixed(4)), Number(lon.toFixed(4)));
      if (derived) seen.add(derived.region);
    }
  }
  assert.deepEqual([...seen].sort(), ["central", "east", "north", "south", "west"]);
});
