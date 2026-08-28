import assert from "node:assert/strict";
import test from "node:test";

import {
  DETECTION_CAP,
  WINDOWS,
  boundsAround,
  boxContains,
  countedTypes,
  evidenceFor,
  formatDistance,
  formatSgtClock,
  haversineMetres,
  hitTest,
  metresPerPixel,
  publishLagSeconds,
  qualifies,
  radiusPixels,
  ringsFor,
  screenPoint,
  sgtInputToMs,
  sgtInputValue,
  viewportBounds,
  widestRingM,
  windowMs,
} from "../lib/lightning-map";
import { MIN_ZOOM, SG_BOUNDS, clampCentre } from "../lib/slippy-map";
import type { ProjectConfigRow } from "../lib/services";

const project = (over: Record<string, unknown> = {}) =>
  ({
    project_code: "TJR",
    latitude: 1.29,
    longitude: 103.85,
    red_radius_m: 3000,
    amber_radius_m: 6000,
    site_extent_radius_m: 0,
    ground_uncertainty_m: 0,
    cloud_uncertainty_m: 0,
    red_detection_types: ["G"],
    amber_detection_types: ["G"],
    amber_enabled: true,
    ...over,
  }) as unknown as ProjectConfigRow;

test("the drawn ring is the qualifying distance, not the radius column", () => {
  // Today every project runs extent 0 and both margins 0, so the two coincide.
  assert.deepEqual(ringsFor(project()), [
    { tier: "red", types: "G", radiusM: 3000 },
    { tier: "amber", types: "G", radiusM: 6000 },
  ]);

  // The moment a margin or an extent is set they diverge, and the engine's rule
  // is `haversine − extent − margin ≤ radius`, so the circle GROWS. A map drawing
  // the raw column would understate the trigger area while claiming to be proof.
  const widened = ringsFor(project({ site_extent_radius_m: 500, ground_uncertainty_m: 2000 }));
  assert.deepEqual(widened, [
    { tier: "red", types: "G", radiusM: 5500 },
    { tier: "amber", types: "G", radiusM: 8500 },
  ]);
});

test("a tier with two types splits only when their margins differ", () => {
  // Same margin: one circle, labelled for both — FJX's red tier today.
  assert.deepEqual(
    ringsFor(project({ red_detection_types: ["G", "C"], amber_enabled: false })),
    [{ tier: "red", types: "G/C", radiusM: 3000 }],
  );

  // Different margins: genuinely two circles, because a cloud strike qualifies at
  // a different distance from a ground one.
  const split = ringsFor(
    project({
      red_detection_types: ["G", "C"],
      ground_uncertainty_m: 1000,
      cloud_uncertainty_m: 3000,
      amber_enabled: false,
    }),
  );
  assert.deepEqual(split, [
    { tier: "red", types: "G", radiusM: 4000 },
    { tier: "red", types: "C", radiusM: 6000 },
  ]);
});

test("amber is absent, not greyed, when it is switched off", () => {
  // INV-LTG-13: amber detections are not evaluated at all. A faint ring would
  // imply a threshold that is not being tested.
  const rings = ringsFor(project({ amber_enabled: false }));
  assert.equal(rings.some((ring) => ring.tier === "amber"), false);
  assert.equal(rings.length, 1);

  // A tier with no types, or a zero radius, draws nothing rather than a dot.
  assert.deepEqual(ringsFor(project({ red_detection_types: [], amber_enabled: false })), []);
  assert.deepEqual(ringsFor(project({ red_radius_m: 0, amber_enabled: false })), []);
});

test("types arrive from Postgres as an array or as text, and both are read", () => {
  assert.equal(ringsFor(project({ red_detection_types: "G,C", amber_enabled: false }))[0].types, "G/C");
  assert.equal(ringsFor(project({ red_detection_types: "{G,C}", amber_enabled: false }))[0].types, "G/C");
  assert.equal(ringsFor(project({ red_detection_types: '{"G","C"}', amber_enabled: false }))[0].types, "G/C");
  // Order follows G then C regardless of how it was stored, so two projects with
  // the same setting never render differently.
  assert.equal(ringsFor(project({ red_detection_types: ["C", "G"], amber_enabled: false }))[0].types, "G/C");
});

test("metres map to pixels the way Web Mercator says", () => {
  // At the equator, zoom 0, one 256px tile spans the world: 40075016 / 256.
  assert.ok(Math.abs(metresPerPixel(0, 0) - 156543.03392) < 0.001);
  // Each zoom level halves it.
  assert.ok(Math.abs(metresPerPixel(0, 10) - 156543.03392 / 1024) < 1e-6);
  // Singapore is near enough the equator that the cosine barely bites — which is
  // exactly why the latitude term must be here: the error would stay invisible.
  const sg = metresPerPixel(1.29, 14);
  assert.ok(sg > 9.5 && sg < 9.6, `${sg} m/px at z14`);

  // A 3 km ring at z14 in Singapore is a few hundred pixels across.
  const r = radiusPixels(3000, 1.29, 14);
  assert.ok(r > 300 && r < 320, `${r}px`);
});

test("distance and qualification match the engine's rule", () => {
  // ~1.11 km per 0.01° of latitude.
  const d = haversineMetres({ lat: 1.29, lon: 103.85 }, { lat: 1.3, lon: 103.85 });
  assert.ok(Math.abs(d - 1113) < 15, `${d} m`);

  const near = { occurred_at: 0, published_at: null, latitude: 1.3, longitude: 103.85, detection_type: "G" as const };
  const far = { occurred_at: 0, published_at: null, latitude: 1.35, longitude: 103.85, detection_type: "G" as const };
  assert.equal(qualifies(project(), near, "red"), true, "1.1 km is inside a 3 km ring");
  assert.equal(qualifies(project(), far, "red"), false, "6.7 km is not");
  assert.equal(qualifies(project(), far, "amber"), false, "nor inside 6 km");

  // A type the tier does not count never qualifies, however close it lands.
  const cloudStrike = { ...near, detection_type: "C" as const };
  assert.equal(qualifies(project(), cloudStrike, "red"), false, "red counts G only here");
  assert.equal(qualifies(project({ red_detection_types: ["G", "C"] }), cloudStrike, "red"), true);
});

test("the publish lag is shown because the window filters on it", () => {
  // A strike at 23:50 that reached us at 23:58 could not have fired a 23:52
  // alert, and the map has to make that legible rather than imply we ignored it.
  assert.equal(publishLagSeconds({ occurred_at: 1000, published_at: 481000 } as never), 480);
  assert.equal(publishLagSeconds({ occurred_at: 1000, published_at: null } as never), null);
});

test("windows and the cap are what the map promises", () => {
  assert.deepEqual(WINDOWS.map((w) => w.key), ["15m", "1h", "3h"]);
  assert.equal(windowMs("15m"), 900_000);
  assert.equal(windowMs("3h"), 10_800_000);
  assert.equal(windowMs("nonsense" as never), 3_600_000, "an unknown window falls back to an hour");
  assert.equal(DETECTION_CAP, 500);
});

test("screenPoint puts the centre in the middle and orients north-up, east-right", () => {
  const centre = { latitude: 1.3521, longitude: 103.8198 };
  const middle = screenPoint(centre, centre, 13, 800, 600);
  assert.ok(Math.abs(middle.x - 400) < 1e-6 && Math.abs(middle.y - 300) < 1e-6, "centre is the middle");

  // A point further east must draw to the RIGHT, and further north UPWARDS
  // (smaller y). Mercator's y axis is inverted relative to latitude, which is
  // exactly the sign that gets flipped.
  const east = screenPoint({ latitude: 1.3521, longitude: 103.9 }, centre, 13, 800, 600);
  const north = screenPoint({ latitude: 1.42, longitude: 103.8198 }, centre, 13, 800, 600);
  assert.ok(east.x > 400, `east should be right of centre, got x=${east.x}`);
  assert.ok(Math.abs(east.y - 300) < 1e-6, "same latitude means same y");
  assert.ok(north.y < 300, `north should be above centre, got y=${north.y}`);

  // And the pixel distance must agree with metresPerPixel, or rings and strikes
  // would be drawn at two different scales on the same canvas.
  const metres = haversineMetres(
    { lat: centre.latitude, lon: centre.longitude },
    { lat: centre.latitude, lon: 103.9 },
  );
  assert.ok(
    Math.abs(east.x - 400 - radiusPixels(metres, centre.latitude, 13)) < 1,
    "projection and radiusPixels must use the same scale",
  );
});

test("viewportBounds brackets the viewport, north above south, and grows with padding", () => {
  const centre = { latitude: 1.3521, longitude: 103.8198 };
  const box = viewportBounds(centre, 13, 800, 600, 0);
  assert.ok(box.north > centre.latitude && box.south < centre.latitude, "brackets in latitude");
  assert.ok(box.east > centre.longitude && box.west < centre.longitude, "brackets in longitude");

  // The corners must be the corners: projecting the box's NW corner should land
  // on (0, 0) of the viewport.
  const corner = screenPoint({ latitude: box.north, longitude: box.west }, centre, 13, 800, 600);
  assert.ok(Math.abs(corner.x) < 1e-6 && Math.abs(corner.y) < 1e-6, `NW corner should be (0,0), got ${corner.x},${corner.y}`);

  // Wider viewport, wider box — and padding widens it further, which is what
  // stops strikes popping in at the edge during a pan.
  const wide = viewportBounds(centre, 13, 1600, 600, 0);
  assert.ok(wide.east > box.east, "a wider viewport covers more longitude");
  const padded = viewportBounds(centre, 13, 800, 600, 64);
  assert.ok(padded.north > box.north && padded.west < box.west, "padding grows the box");

  // Zooming in narrows it — the reason zooming shows more of a busy window.
  const closer = viewportBounds(centre, 16, 800, 600, 0);
  assert.ok(closer.north < box.north && closer.east < box.east, "a deeper zoom covers less ground");
});

test("hitTest returns the nearest point within the radius, not the first", () => {
  const points = [
    { x: 100, y: 100 },
    { x: 104, y: 100 },
    { x: 500, y: 500 },
  ];
  // Both of the first two are within 9px of (105,100); the nearer is index 1.
  assert.equal(hitTest(points, 105, 100), 1, "nearest wins over first-found");
  assert.equal(hitTest(points, 99, 100), 0);
  assert.equal(hitTest(points, 300, 300), -1, "empty map is a miss");
  // The radius is a radius, not a bounding box: (106.5, 106.5) is 9.19px away.
  assert.equal(hitTest([{ x: 100, y: 100 }], 106.5, 106.5, 9), -1, "corner of the box is outside the circle");
  assert.equal(hitTest([{ x: 100, y: 100 }], 109, 100, 9), 0, "exactly on the radius is a hit");
});

test("evidenceFor counts what fired and how close the closest came", () => {
  // 2km red on G only, 4km amber. A C strike 1km away must NOT count as red.
  const config = {
    latitude: 1.3,
    longitude: 103.8,
    red_radius_m: 2000,
    red_detection_types: ["G"],
    amber_radius_m: 4000,
    amber_detection_types: ["G", "C"],
    amber_enabled: true,
  };
  const at = (latitude: number, type: "G" | "C") => ({
    occurred_at: 0,
    published_at: 0,
    latitude,
    longitude: 103.8,
    detection_type: type,
  });

  // ~1.1km, ~3.3km, ~11km north of the site.
  const near = at(1.31, "G");
  const mid = at(1.33, "G");
  const far = at(1.4, "G");
  const nearCloud = at(1.31, "C");

  const evidence = evidenceFor(config, [near, mid, far, nearCloud]);
  assert.equal(evidence.total, 4, "total is everything evaluated, not just hits");
  assert.equal(evidence.red, 1, "only the G strike inside 2km is red — the C one at the same spot is not");
  assert.equal(evidence.amber, 3, "amber takes both types inside 4km, including the ones red already counted");
  assert.ok(
    evidence.nearestM !== null && Math.abs(evidence.nearestM - 1112) < 40,
    `nearest should be ~1.1km, got ${evidence.nearestM}`,
  );

  // The all-clear case, which is the one the map exists to produce.
  const clear = evidenceFor(config, [far]);
  assert.deepEqual({ red: clear.red, amber: clear.amber, total: clear.total }, { red: 0, amber: 0, total: 1 });
  assert.ok(clear.nearestM !== null && clear.nearestM > 10000, "still reports how close it came");

  // Nothing in the window at all: no strike is not the same as no answer.
  assert.deepEqual(evidenceFor(config, []), { total: 0, red: 0, amber: 0, nearestM: null });
});

test("the time anchor round-trips through Singapore time, not the browser's", () => {
  // 28 Aug 2026, 13:45 SGT is 05:45Z.
  const ms = Date.parse("2026-08-28T05:45:00Z");
  assert.equal(sgtInputValue(ms), "2026-08-28T13:45", "shown to the operator as SGT");
  assert.equal(sgtInputToMs("2026-08-28T13:45"), ms, "and read back as SGT");

  // The round trip must hold across midnight, where an offset bug shows up as
  // being a whole day out rather than eight hours.
  const midnight = Date.parse("2026-08-27T16:30:00Z"); // 00:30 SGT on the 28th
  assert.equal(sgtInputValue(midnight), "2026-08-28T00:30");
  assert.equal(sgtInputToMs(sgtInputValue(midnight)), midnight);

  // And it must NOT be the machine's local time: this test runs on a host in an
  // unknown timezone, so pin the expectation to the fixed +08:00 arithmetic.
  assert.equal(sgtInputToMs("2026-01-01T00:00"), Date.parse("2025-12-31T16:00:00Z"));

  assert.equal(sgtInputToMs("not a time"), null);
  assert.equal(sgtInputToMs(""), null);
});

test("clock and distance format for a reader", () => {
  assert.match(formatSgtClock(Date.parse("2026-08-28T05:45:07Z")), /28 Aug.*13:45:07/);
  assert.equal(formatSgtClock(null), "—");
  assert.equal(formatDistance(820), "820 m");
  assert.equal(formatDistance(3400), "3.40 km");
  assert.equal(formatDistance(24000), "24.0 km");
  assert.equal(formatDistance(null), "—");
});

test("boundsAround contains the circle it claims to, and widestRingM sizes it", () => {
  const point = { latitude: 1.3, longitude: 103.8 };
  const box = boundsAround(point, 5000);
  const from = { lat: point.latitude, lon: point.longitude };

  // Every edge must be at least 5km out, or the box would clip the ring it
  // exists to cover and the evidence count would be short.
  for (const [name, edge] of [
    ["north", { lat: box.north, lon: point.longitude }],
    ["south", { lat: box.south, lon: point.longitude }],
    ["east", { lat: point.latitude, lon: box.east }],
    ["west", { lat: point.latitude, lon: box.west }],
  ] as const) {
    const distance = haversineMetres(from, edge);
    // A tolerance of 1m, not 0: the round trip through haversine leaves sub-metre
    // float error on the east/west edges. The 6m shortfall this test caught when
    // the box used a different earth radius is well outside it.
    assert.ok(distance >= 4999, `${name} edge is only ${distance.toFixed(2)}m out`);
    assert.ok(distance < 5200, `${name} edge is wastefully far at ${Math.round(distance)}m`);
  }

  // Amber is the wider tier, so it sets the box — sizing off red would clip it.
  const config = {
    latitude: 1.3,
    longitude: 103.8,
    red_radius_m: 2000,
    red_detection_types: ["G"],
    amber_radius_m: 6000,
    amber_detection_types: ["G"],
    amber_enabled: true,
    site_extent_radius_m: 300,
  };
  assert.equal(widestRingM(config), 6300, "the widest ring includes the site extent");
  assert.equal(widestRingM({ ...config, amber_enabled: false }), 2300, "amber off leaves red as the widest");
});

test("countedTypes is the union of what the enabled tiers actually count", () => {
  const base = {
    latitude: 1.3,
    longitude: 103.8,
    red_radius_m: 2000,
    amber_radius_m: 4000,
    amber_enabled: true,
  };
  // The common shape: both tiers on ground strikes only. Fetching C as well
  // would be pure noise, and noise is what pushed a real strike out of a capped
  // result.
  assert.deepEqual(countedTypes({ ...base, red_detection_types: ["G"], amber_detection_types: ["G"] }), ["G"]);

  // A tier that counts both widens the union, and the order is normalised.
  assert.deepEqual(
    countedTypes({ ...base, red_detection_types: ["C"], amber_detection_types: ["G"] }),
    ["G", "C"],
  );

  // Amber off means amber's types are not evaluated, so they must not be
  // fetched — otherwise a C-only amber tier would drag in the whole storm.
  assert.deepEqual(
    countedTypes({
      ...base,
      amber_enabled: false,
      red_detection_types: ["G"],
      amber_detection_types: ["G", "C"],
    }),
    ["G"],
  );

  // Nothing configured means nothing qualifies — and an empty list must stay
  // empty rather than becoming "every type" downstream.
  assert.deepEqual(countedTypes({ ...base, red_radius_m: 0, amber_enabled: false }), []);
});

test("boxContains only skips a refetch when the held box really covers the new one", () => {
  const outer = { south: 1.2, west: 103.6, north: 1.5, east: 104.0 };

  assert.equal(boxContains(outer, outer), true, "the same box is covered");
  assert.equal(
    boxContains(outer, { south: 1.25, west: 103.7, north: 1.45, east: 103.9 }),
    true,
    "zooming in stays inside what is already held",
  );

  // Each edge, one at a time — a single-sided overhang is exactly the case a
  // sloppy check would wave through, and it would silently drop the strikes in
  // the newly exposed strip.
  assert.equal(boxContains(outer, { ...outer, north: 1.6 }), false, "panning north exposes new ground");
  assert.equal(boxContains(outer, { ...outer, south: 1.1 }), false, "panning south does too");
  assert.equal(boxContains(outer, { ...outer, west: 103.5 }), false, "and west");
  assert.equal(boxContains(outer, { ...outer, east: 104.1 }), false, "and east");

  // Touching edges count as covered: the viewport padding means an exact match
  // is common, and refetching an identical box is pure latency.
  assert.equal(boxContains(outer, { south: 1.2, west: 103.6, north: 1.5, east: 104.0 }), true);
});

test("the map is held inside the area OneMap actually serves", () => {
  const W = 1280;
  const H = 620;

  // At the default zoom the viewport is wider than Singapore, so both axes lock
  // to the middle: there is nothing to drag, and dragging anywhere lands in the
  // same place. This is what "fixed to the Singapore map" means at that zoom.
  const wide = clampCentre({ latitude: 1.35, longitude: 103.8 }, MIN_ZOOM, W, H);
  const wideFromElsewhere = clampCentre({ latitude: 5, longitude: 99 }, MIN_ZOOM, W, H);
  assert.ok(
    Math.abs(wide.latitude - wideFromElsewhere.latitude) < 1e-9 &&
      Math.abs(wide.longitude - wideFromElsewhere.longitude) < 1e-9,
    "a locked axis ignores where the drag went",
  );
  assert.ok(
    wide.longitude > SG_BOUNDS.west && wide.longitude < SG_BOUNDS.east,
    "and it sits inside the coverage",
  );

  // Zoomed in, panning works — but the viewport edge stops at the coverage
  // rather than the centre doing so, which is what left three quarters of the
  // screen empty and tiled with broken-image icons.
  const zoom = 15;
  const pushed = clampCentre({ latitude: 3, longitude: 106 }, zoom, W, H);
  const view = viewportBounds(pushed, zoom, W, H, 0);
  assert.ok(view.north <= SG_BOUNDS.north + 1e-9, `north edge escaped to ${view.north}`);
  assert.ok(view.east <= SG_BOUNDS.east + 1e-9, `east edge escaped to ${view.east}`);

  const pulled = clampCentre({ latitude: 0, longitude: 100 }, zoom, W, H);
  const view2 = viewportBounds(pulled, zoom, W, H, 0);
  assert.ok(view2.south >= SG_BOUNDS.south - 1e-9, `south edge escaped to ${view2.south}`);
  assert.ok(view2.west >= SG_BOUNDS.west - 1e-9, `west edge escaped to ${view2.west}`);

  // A centre well inside is left alone — the clamp must not drag a legitimate
  // view towards the middle every time the map moves.
  const inside = { latitude: 1.35, longitude: 103.85 };
  const kept = clampCentre(inside, zoom, W, H);
  assert.ok(
    Math.abs(kept.latitude - inside.latitude) < 1e-9 && Math.abs(kept.longitude - inside.longitude) < 1e-9,
    "an interior view is untouched",
  );

  // Every corner of Singapore must still be reachable at a working zoom, or the
  // clamp would fight the projects it exists to show.
  for (const [name, point] of [
    ["Tuas", { latitude: 1.32, longitude: 103.62 }],
    ["Changi", { latitude: 1.39, longitude: 104.0 }],
    ["Woodlands", { latitude: 1.44, longitude: 103.79 }],
    ["Sentosa", { latitude: 1.25, longitude: 103.82 }],
  ] as const) {
    const at = clampCentre(point, 16, 600, 400);
    assert.ok(
      Math.abs(at.latitude - point.latitude) < 0.01 && Math.abs(at.longitude - point.longitude) < 0.01,
      `${name} must be reachable, got ${at.latitude},${at.longitude}`,
    );
  }

  // An unmeasured container has no viewport to fit, and must not be clamped to
  // a nonsense centre before the first layout pass.
  assert.deepEqual(clampCentre(inside, zoom, 0, 0), inside);
});
