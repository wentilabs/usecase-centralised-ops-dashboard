import assert from "node:assert/strict";
import test from "node:test";

import { readPaged } from "../lib/paged-read";
import { readRunWindow, servicesWithRunLog } from "../lib/run-reader";
import { timelinesFrom } from "../lib/health-timeline";

/** A server that serves `total` rows 1000 at a time, as PostgREST's max-rows does. */
function pagedServer(total: number, pageSize = 1000) {
  const paths: string[] = [];
  const request = async (path: string) => {
    paths.push(path);
    const offset = Number(new URLSearchParams(path.split("?")[1]).get("offset") ?? 0);
    const count = Math.max(0, Math.min(pageSize, total - offset));
    return { ok: true, body: Array.from({ length: count }, (_, i) => ({ n: offset + i })) };
  };
  return { request, paths };
}

const pathFor = (offset: number, limit: number) => `t?select=n&limit=${limit}&offset=${offset}`;

test("a full page is followed, because PostgREST caps responses without saying so", async () => {
  // The bug this exists for: `limit=6000` is silently served as 1000 rows, and
  // the missing 5000 render as idle hours rather than as an error.
  const { request, paths } = pagedServer(2400);
  const rows = await readPaged(request, pathFor, { schema: "s" });

  assert.equal(rows.length, 2400, "the whole window, not the first page of it");
  assert.equal(paths.length, 3, "three requests for 2400 rows");
  assert.match(paths[1], /offset=1000/);
  assert.match(paths[2], /offset=2000/);
});

test("a short page ends the read, because it is the only end-of-data signal there is", async () => {
  const { request, paths } = pagedServer(640);
  const rows = await readPaged(request, pathFor, { schema: "s" });

  assert.equal(rows.length, 640);
  assert.equal(paths.length, 1, "no speculative extra request after a short page");
});

test("an exactly-full window still stops, rather than paging to the ceiling", async () => {
  // The boundary case: 1000 rows is both a full page and the whole answer, so
  // one extra request is unavoidable — but only one.
  const { request, paths } = pagedServer(1000);
  const rows = await readPaged(request, pathFor, { schema: "s" });

  assert.equal(rows.length, 1000);
  assert.equal(paths.length, 2, "one more request, which comes back empty, and then it stops");
});

test("a failed page discards the window instead of returning half of it", async () => {
  // Half a window is indistinguishable on the strip from a half-idle service.
  let calls = 0;
  const rows = await readPaged(
    async () => {
      calls += 1;
      // The failing page must still carry ROWS, or `!Array.isArray` rejects it
      // and the status check is never exercised. A gateway serving a stale or
      // partial body behind a 5xx is the case that would otherwise be appended
      // to the window and painted as real cycles.
      return calls === 1
        ? { ok: true, body: Array.from({ length: 1000 }, (_, i) => ({ n: i })) }
        : { ok: false, body: [{ n: 9999 }] };
    },
    pathFor,
    { schema: "s" },
  );

  assert.deepEqual(rows, [], "a partial window is worse than no window");
  assert.equal(calls, 2, "and it stopped at the failure rather than paging on");
});

test("the page ceiling bounds a runaway filter", async () => {
  const { request, paths } = pagedServer(1_000_000);
  const rows = await readPaged(request, pathFor, { schema: "s", maxPages: 3 });

  assert.equal(paths.length, 3, "it stops at the ceiling rather than walking the table");
  assert.equal(rows.length, 3000);
});

test("the run log answers for the two services with no delivery ledger", async () => {
  // Between this and the delivery reader, every covered project has a history.
  assert.deepEqual(servicesWithRunLog().sort(), ["noise", "wbgt"]);

  let path = "";
  const rows = await readRunWindow(
    "wbgt",
    async (requested) => {
      path = requested;
      return {
        ok: true,
        body: [
          { project_code: "C991", status: "completed_with_issues", started_at: "2026-10-16T09:00:00+00:00" },
          { project_code: "C991", status: "skipped_outside_site_hours", started_at: "2026-10-16T20:00:00+00:00" },
          { project_code: "", status: "completed", started_at: "2026-10-16T09:00:00+00:00" },
        ],
      };
    },
    "2026-10-14T10:00:00.000Z",
  );

  assert.match(path, /started_at=gte\.2026-10-14T10:00:00\.000Z/, "bounded by time");
  assert.equal(rows.length, 2, "a row with no project code belongs to no strip");
  // Read from the contract's convention, not decided here: a run that completed
  // with issues is the in-between state, and a correct skip is not a failure.
  assert.equal(rows[0].colour, "amber", "completed_with_ is degraded, not clean");
  assert.equal(rows[1].colour, "green", "a skip the service chose is not a fault");

  assert.deepEqual(await readRunWindow("haze", async () => ({ ok: true, body: [] }), "x"), [], "no run log, no rows");
});

test("each project gets its own strip, and a project with no attempts gets none", () => {
  const timelines = timelinesFrom(
    [
      { key: "A", at: "2026-10-16T11:00:00+00:00", colour: "green" },
      { key: "A", at: "2026-10-16T10:00:00+00:00", colour: "amber" },
      { key: "B", at: "2026-10-16T11:00:00+00:00", colour: "red" },
    ],
    { now: new Date("2026-10-16T11:30:00Z"), bars: 3 },
  );

  assert.deepEqual([...timelines.keys()].sort(), ["A", "B"]);
  // Fifty grey bars on a card read as a broken system rather than a quiet one,
  // so a project nobody recorded anything for has no strip at all.
  assert.equal(timelines.get("C"), undefined);
  assert.deepEqual(timelines.get("A")?.map((bar) => bar.colour), [null, "amber", "green"]);
  assert.deepEqual(timelines.get("B")?.map((bar) => bar.colour), [null, null, "red"]);
});
