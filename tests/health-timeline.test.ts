import assert from "node:assert/strict";
import test from "node:test";

import { BAR_COUNT, healthyShare, shareText, timelineFrom } from "../lib/health-timeline";
import { readDeliveryWindow } from "../lib/delivery-reader";

const NOW = new Date("2026-10-16T11:30:00Z");
const hoursAgo = (n: number, minute = "00") =>
  new Date(NOW.getTime() - n * 3_600_000).toISOString().slice(0, 13) + `:${minute}:00+00:00`;

test("the newest cycle is the rightmost bar, and the window is a fixed width", () => {
  const bars = timelineFrom([{ at: hoursAgo(0), colour: "green" }], { now: NOW });

  assert.equal(bars.length, BAR_COUNT, "a fixed width, so a missing cycle leaves a hole");
  assert.equal(bars.at(-1)?.hour, "2026-10-16T11", "newest on the right");
  assert.equal(bars[0].hour, "2026-10-14T10", "and 49 hours before it on the left");
  assert.equal(bars.at(-1)?.colour, "green");
});

test("an hour with no attempt is a gap, never a success", () => {
  // The distinction the strip exists for. Most of the estate is idle overnight,
  // and painting those hours green would claim fifty passing cycles from a
  // service that ran twice.
  const bars = timelineFrom([{ at: hoursAgo(0), colour: "green" }], { now: NOW });

  assert.equal(bars[0].colour, null, "no attempt is not a pass");
  assert.equal(bars[0].count, 0);
  assert.equal(bars.filter((bar) => bar.colour === "green").length, 1, "exactly the one hour that ran");
});

test("the worst outcome in an hour is the colour of its bar", () => {
  // Haze posts to sixty-four groups an hour. One failure among them is a
  // failure of that cycle, and averaging it away would hide exactly the row
  // somebody has to look at.
  const bars = timelineFrom(
    [
      { at: hoursAgo(1, "00"), colour: "green" },
      { at: hoursAgo(1, "15"), colour: "amber" },
      { at: hoursAgo(1, "45"), colour: "green" },
      { at: hoursAgo(2, "00"), colour: "amber" },
      { at: hoursAgo(2, "30"), colour: "red" },
    ],
    { now: NOW },
  );

  const at = (n: number) => bars.find((bar) => bar.hour === hoursAgo(n).slice(0, 13));
  assert.equal(at(1)?.colour, "amber", "one amber among three outranks two greens");
  assert.equal(at(1)?.count, 3, "and the attempts are still counted");
  assert.equal(at(2)?.colour, "red", "red outranks amber");
});

test("an attempt older than the window is dropped rather than folded into the oldest bar", () => {
  const bars = timelineFrom(
    [
      { at: hoursAgo(BAR_COUNT + 5), colour: "red" },
      { at: hoursAgo(2), colour: "green" },
    ],
    { now: NOW },
  );

  assert.ok(!bars.some((bar) => bar.colour === "red"), "a failure from three days ago is not this window's");
  assert.equal(bars.filter((bar) => bar.colour !== null).length, 1);
});

test("the clean share is of the cycles that ran, not of the fifty bars", () => {
  // Dividing by a fixed fifty would report a quiet night as an outage, and the
  // number beside a row of bars has to agree with the bars.
  const quietButPerfect = timelineFrom(
    [
      { at: hoursAgo(0), colour: "green" },
      { at: hoursAgo(1), colour: "green" },
    ],
    { now: NOW },
  );
  assert.equal(healthyShare(quietButPerfect), 1, "two clean cycles and forty-eight idle hours is 100%");

  const half = timelineFrom(
    [
      { at: hoursAgo(0), colour: "amber" },
      { at: hoursAgo(1), colour: "green" },
    ],
    { now: NOW },
  );
  assert.equal(healthyShare(half), 0.5);

  assert.equal(healthyShare(timelineFrom([], { now: NOW })), null, "nothing ran, so there is no share");
});

test("the share never rounds up to a clean hundred while a failure is still on screen", () => {
  // A strip showing "100.00 %" beside a visible amber bar contradicts itself,
  // and a reader who catches it once stops trusting the number.
  assert.equal(shareText(0.999999), "99.99 %");
  assert.equal(shareText(1), "100.00 %");
  assert.equal(shareText(0.9032), "90.32 %");
  assert.equal(shareText(null), "— no cycles");
});

test("the window query is bounded by time, and an unreadable ledger yields no bars", async () => {
  let path = "";
  const rows = await readDeliveryWindow(
    "haze",
    async (requested) => {
      path = requested;
      return {
        ok: true,
        body: [{ delivery_status: "UNCONFIRMED", created_at: "2026-10-16T11:00:39+00:00" }],
      };
    },
    "2026-10-14T10:00:00.000Z",
  );

  // Bounded by time, not by count: a `limit` alone truncates the busiest
  // service's older hours, and those would then render as missed cycles.
  assert.match(path, /created_at=gte\.2026-10-14T10:00:00\.000Z/, "the window is a time filter");
  assert.match(path, /select=delivery_status,created_at/, "and only the two columns it needs");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].colour, "amber", "coloured by haze's own contract");

  // The body must be a well-formed row, or `!Array.isArray` catches the case
  // and the status check is never exercised: an error response carrying rows
  // would otherwise be painted as a clean cycle.
  const broken = await readDeliveryWindow(
    "haze",
    async () => ({
      ok: false,
      body: [{ delivery_status: "SENT", created_at: "2026-10-16T11:00:00+00:00" }],
    }),
    "2026-10-14T10:00:00.000Z",
  );
  assert.deepEqual(broken, [], "an unreachable ledger is not a clean one");
});
