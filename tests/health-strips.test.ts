import assert from "node:assert/strict";
import test from "node:test";

import {
  BAR_COUNT,
  healthyShare,
  shareText,
  stripFrom,
  stripsFrom,
  troubleCount,
  troubleIn,
} from "../lib/health-timeline";
import { everyProjectHasEnough } from "../lib/enough-per-project";
import { readDeliveryWindow } from "../lib/delivery-reader";
import { readRunWindow, servicesWithRunLog } from "../lib/run-reader";

const sample = (at: string, colour: "green" | "amber" | "red", status: string = colour) => ({ at, colour, status });

test("a bar is a process, so a slow cadence is fifty bars and not forty-eight blanks", () => {
  // The reason this is ordinal. Subcon reports twice a day: on an hourly axis
  // its card was forty-eight grey gaps and two coloured bars, which reads as a
  // broken service rather than a quiet one.
  const twiceDaily = Array.from({ length: 60 }, (_, index) =>
    sample(`2026-09-${String(10 + Math.floor(index / 2)).padStart(2, "0")}T${index % 2 ? "18" : "06"}:00:00Z`, "green"),
  );

  const bars = stripFrom(twiceDaily);
  assert.equal(bars.length, BAR_COUNT, "fifty processes, however long they took");
  assert.ok(bars.every((bar) => bar.colour === "green"), "and no blanks among them");
});

test("the newest processes are kept, oldest-first, however the pages arrived", () => {
  // Ordering is this function's job: samples arrive newest-first, concatenated
  // across several pages and two different readers.
  const bars = stripFrom(
    [
      sample("2026-10-16T09:00:00Z", "green"),
      sample("2026-10-16T11:00:00Z", "red"),
      sample("2026-10-16T07:00:00Z", "amber"),
      sample("2026-10-16T10:00:00Z", "green"),
    ],
    3,
  );

  assert.deepEqual(bars.map((bar) => bar.at.slice(11, 13)), ["09", "10", "11"], "oldest first, newest on the right");
  assert.equal(bars.at(-1)?.colour, "red", "the newest process is the rightmost bar");
});

test("each project gets its own strip, and a project with no processes gets none", () => {
  const strips = stripsFrom([
    { key: "A", ...sample("2026-10-16T11:00:00Z", "green") },
    { key: "A", ...sample("2026-10-16T10:00:00Z", "amber") },
    { key: "B", ...sample("2026-10-16T11:00:00Z", "red") },
  ]);

  assert.deepEqual([...strips.keys()].sort(), ["A", "B"]);
  // Fifty blank bars on a card read as a broken system rather than a quiet one.
  assert.equal(strips.get("C"), undefined);
  assert.deepEqual(strips.get("A")?.map((bar) => bar.colour), ["amber", "green"]);
});

test("the clean share divides by what is on screen, so it cannot disagree with the bars", () => {
  assert.equal(healthyShare([sample("a", "green"), sample("b", "amber")]), 0.5);
  assert.equal(healthyShare([]), null);
  // Rounded before deciding whether it is whole: 0.56 * 100 is
  // 56.00000000000001 in binary floating point, which printed "56.0 %".
  assert.equal(shareText(0.56), "56 %", "a whole number stays whole through the float");
  assert.equal(shareText(0.5), "50 %");
  assert.equal(shareText(0.908), "90.8 %");
  assert.equal(shareText(1), "100 %");
  // Never rounded up to a clean hundred while a failure is still on the strip:
  // that reads as a contradiction and costs the strip its credibility.
  assert.equal(shareText(0.999999), "99.99 %");
  assert.equal(shareText(null), "—");
});

test("the expanded view lists only the trouble, newest first, in the service's own words", () => {
  const bars = stripFrom([
    sample("2026-10-16T08:00:00Z", "green", "completed"),
    sample("2026-10-16T09:00:00Z", "amber", "completed_with_issues"),
    sample("2026-10-16T10:00:00Z", "green", "completed"),
    sample("2026-10-16T11:00:00Z", "red", "failed_config_validation"),
  ]);

  const trouble = troubleIn(bars);
  assert.deepEqual(trouble.map((group) => group.status), ["failed_config_validation", "completed_with_issues"]);
  assert.ok(!trouble.some((group) => group.colour === "green"), "a clean process is not an exception");
  assert.equal(troubleCount(bars), 2, "the strip counts processes, the list groups them");
});

test("the same fault repeated is one grouped line, with a span", () => {
  // Twenty-six identical `completed_with_issues` lines is one chronic fault
  // rendered as twenty-six events — the alarm fatigue the colours exist to fix,
  // reappearing one layer down.
  const bars = stripFrom([
    sample("2026-10-16T15:58:00Z", "amber", "completed_with_issues"),
    sample("2026-10-16T16:58:00Z", "amber", "completed_with_issues"),
    sample("2026-10-16T19:58:00Z", "amber", "completed_with_issues"),
    sample("2026-10-16T18:00:00Z", "red", "failed_config_validation"),
    sample("2026-10-16T17:00:00Z", "green", "completed"),
  ]);

  const [worst, chronic] = troubleIn(bars);
  assert.equal(worst.status, "failed_config_validation", "red leads whatever the counts are");
  assert.equal(worst.count, 1);
  assert.equal(chronic.count, 3, "three occurrences, one line");
  assert.equal(chronic.from, "2026-10-16T15:58:00Z", "and the span says how long it has been going on");
  assert.equal(chronic.to, "2026-10-16T19:58:00Z");
  assert.equal(troubleCount(bars), 4, "while the count on the strip is still every process");
});

test("paging stops once every project in hand has its quota", () => {
  // This is what made the page slow: the strips need the newest fifty per
  // project, and paging a whole time window to find that out cost up to ten
  // round trips per service.
  const rows = (counts: Record<string, number>) =>
    Object.entries(counts).flatMap(([code, n]) => Array.from({ length: n }, () => ({ project_code: code })));
  const key = (row: Record<string, unknown>) => String(row.project_code ?? "");

  assert.equal(everyProjectHasEnough(rows({ A: 50, B: 50 }), key, 50), true);
  assert.equal(everyProjectHasEnough(rows({ A: 50, B: 49 }), key, 50), false, "one short project keeps it paging");
  // Nothing in hand is not "enough" — that would stop before the first page
  // could have told us anything.
  assert.equal(everyProjectHasEnough([], key, 50), false);
  assert.equal(everyProjectHasEnough([{ project_code: "" }], key, 1), false, "a blank code is not a project");
});

test("both readers are bounded per project rather than by time, and carry the service's own status", async () => {
  let path = "";
  const delivered = await readDeliveryWindow(
    "haze",
    async (requested) => {
      path = requested;
      return {
        ok: true,
        body: [{ project_code: "JCU", delivery_status: "UNCONFIRMED", created_at: "2026-10-16T11:00:39+00:00" }],
      };
    },
    50,
  );

  assert.doesNotMatch(path, /gte\./, "no time filter: the window is a count per project now");
  assert.match(path, /order=created_at\.desc/, "newest first, so the quota is the newest fifty");
  assert.equal(delivered[0].status, "UNCONFIRMED", "kept verbatim, for the expanded view and for grepping");
  assert.equal(delivered[0].colour, "amber", "coloured by haze's own contract");

  assert.deepEqual(servicesWithRunLog().sort(), ["noise", "wbgt"]);
  const ran = await readRunWindow(
    "wbgt",
    async () => ({
      ok: true,
      body: [
        { project_code: "C991", status: "completed_with_issues", started_at: "2026-10-16T09:00:00+00:00" },
        { project_code: "", status: "completed", started_at: "2026-10-16T09:00:00+00:00" },
      ],
    }),
    50,
  );

  assert.equal(ran.length, 1, "a row with no project code belongs to no strip");
  assert.equal(ran[0].status, "completed_with_issues");
  assert.equal(ran[0].colour, "amber", "completed_with_ is the in-between state, not a pass");
});
