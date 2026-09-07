import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  MANUAL_SOURCE_MARKER,
  collapseToBands,
  groupLimitsByMeter,
  isProtectedFromRefresh,
  type LimitRow,
} from "../lib/noise-limits";

/** One hourly row, the shape `noise_limits` stores. */
function hour(
  startHour: number,
  limits: { leq5min?: number | null; leq1hr?: number | null; leq12hr?: number | null },
  extra: Partial<LimitRow> = {},
): LimitRow {
  return {
    full_identifier: "ZZT NM01 Somewhere RT",
    noise_meter_loc: "NM01 Somewhere RT",
    day_type_normalized: "mon_sat",
    hour_start_minutes: startHour * 60,
    hour_end_minutes: (startHour + 1) * 60,
    leq_5min: limits.leq5min ?? null,
    leq_1hr: limits.leq1hr ?? null,
    leq_12hr: limits.leq12hr ?? null,
    ...extra,
  };
}

test("the protection marker is spelled the way the noise service matches it", async () => {
  // The whole mechanism is a substring test in the noise repo's
  // `isManualSourceOfTruth`. HALO reports protection from the same string, so a
  // change to either spelling silently turns the badge into a lie — it would
  // claim a meter is protected while the refresh overwrites it, or the reverse.
  const source = await readFile(
    resolve(process.cwd(), "..", "usecase-wohhup-noise-meter-alerts", "scrapers", "noiselynx", "limits.js"),
    "utf8",
  ).catch(() => null);

  if (source === null) {
    // The sibling repo is not always checked out beside this one. Skipping is
    // right; failing would make HALO's suite depend on someone's directory
    // layout, and the assertions below still hold on their own.
    return;
  }
  assert.match(source, /function isManualSourceOfTruth/, "the function still exists");
  assert.ok(
    source.includes(`"${MANUAL_SOURCE_MARKER}"`),
    `the noise service no longer matches on "${MANUAL_SOURCE_MARKER}" — HALO's badge is now wrong`,
  );

  // Case-insensitive substring, matching `.toLowerCase().includes(...)` there:
  // the rest of the value carries where the numbers came from.
  assert.equal(isProtectedFromRefresh("Manual source of truth - SJC NM01 adjusted limits 2026-08-14"), true);
  assert.equal(isProtectedFromRefresh("MANUAL SOURCE OF TRUTH"), true);
  assert.equal(isProtectedFromRefresh("NoiseLynx DeviceAdmin refresh"), false);
  assert.equal(isProtectedFromRefresh("noise_meter_limits_hourly.csv"), false, "a CSV import is NOT protected");
  assert.equal(isProtectedFromRefresh(null), false);
});

test("the rendered rows are the rows on the source page", () => {
  // HMD NM04's real Mon-Sat profile. Every hour from midnight to 7am holds
  // 61/61, and 7pm-8pm and 8pm-10pm both hold 71/68 — so a collapse that only
  // looked at values would render four rows against the eight on the page, and
  // the honest reading of that is "the numbers changed". They had not.
  const night = [0, 1, 2, 3, 4, 5, 6].map((h) => hour(h, { leq5min: 61, leq1hr: 61 }));
  const day = Array.from({ length: 12 }, (_, index) => hour(7 + index, { leq5min: 90, leq12hr: 76 }));
  const evening = [19, 20, 21].map((h) => hour(h, { leq5min: 71, leq1hr: 68 }));
  const late = [22, 23].map((h) => hour(h, { leq5min: 62, leq1hr: 62 }));

  assert.deepEqual(
    collapseToBands([...day, ...night, ...evening, ...late]).map((band) => [band.label, band.hours]),
    [
      ["12am–2am", 2],
      ["2am–5am", 3],
      ["5am–6am", 1],
      ["6am–7am", 1],
      ["7am–7pm", 12],
      ["7pm–8pm", 1],
      ["8pm–10pm", 2],
      ["10pm–12am", 2],
    ],
    "the eight uneven bands of the source grid, in the day's order",
  );

  // And the other half: an hour that differs INSIDE a band still splits out,
  // rather than hiding behind whichever hour a fixed grid would have sampled.
  const edited = collapseToBands([
    hour(2, { leq5min: 61, leq1hr: 61 }),
    hour(3, { leq5min: 55, leq1hr: 55 }),
    hour(4, { leq5min: 61, leq1hr: 61 }),
  ]);
  assert.deepEqual(
    edited.map((band) => [band.label, band.hours, band.leq5min]),
    [["2am–3am", 1, 61], ["3am–4am", 1, 55], ["4am–5am", 1, 61]],
  );

  // A gap is left as a gap: a missing hour is not a covered one.
  assert.equal(
    collapseToBands([hour(2, { leq5min: 61 }), hour(4, { leq5min: 61 })]).length,
    2,
    "not bridged across the missing 3am row",
  );
});

test("the hourly limit reports both the borrow and the absence", () => {
  // The distinction the source page cannot express, because it writes 0 for
  // both. Same missing Leq1hr, opposite outcomes.
  const [borrowed] = collapseToBands([hour(7, { leq5min: 90, leq12hr: 76 })]);
  assert.deepEqual(borrowed.hourly, { limit: 76, borrowedFrom12hr: true });

  const [none] = collapseToBands([hour(19, { leq5min: 55 })]);
  assert.deepEqual(none.hourly, { limit: null, borrowedFrom12hr: false }, "nothing is compared hourly");

  // With its own Leq1hr, nothing is borrowed even when a Leq12hr exists.
  const [own] = collapseToBands([hour(19, { leq5min: 71, leq1hr: 68, leq12hr: 76 })]);
  assert.deepEqual(own.hourly, { limit: 68, borrowedFrom12hr: false });

  // A 0 stored in any of the three is "no limit", not a limit of zero — the
  // same reading as `positiveLimitOrNull` in the noise service.
  const [zeroed] = collapseToBands([hour(3, { leq5min: 0, leq1hr: 0, leq12hr: 0 })]);
  assert.deepEqual([zeroed.leq5min, zeroed.leq1hr, zeroed.leq12hr], [null, null, null]);
});

test("a meter is flagged protected when any of its rows carries the marker", () => {
  // `mergeLimitRows` decides per row, so a partly-marked meter is a real state:
  // some bands survive the refresh and some are overwritten. Reading that as
  // clean would be the dangerous direction to be wrong in.
  const meters = groupLimitsByMeter([
    hour(0, { leq5min: 61 }, { source_file: "NoiseLynx DeviceAdmin refresh" }),
    hour(1, { leq5min: 61 }, { source_file: "Manual source of truth - one band only" }),
  ]);
  assert.equal(meters.length, 1);
  assert.equal(meters[0].isProtected, true);
  assert.match(meters[0].sourceFile ?? "", /NoiseLynx DeviceAdmin refresh · Manual source of truth/);
});
