import assert from "node:assert/strict";
import test from "node:test";

import { readPaged } from "../lib/paged-read";
import { readRunWindow, servicesWithRunLog } from "../lib/run-reader";

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

  assert.equal(rows.length, 640, "the short page is the whole answer, and nothing is appended after it");
  // Two requests, not one: the first two pages are opened together on purpose,
  // because a second page is all but certain for the strips and discovering that
  // serially costs a whole round trip on the slowest table. The second comes
  // back empty here and is discarded — the trade is one wasted request against
  // ~1.4s of latency on every cold load.
  assert.equal(paths.length, 2, "the speculative second page is issued but adds nothing");
  assert.ok(!paths.some((path) => path.includes("offset=2000")), "and it does not page on past the short page");
});

test("a short first page wins over a full speculative one, rather than leaving a hole", async () => {
  // Only reachable if the table changes between the two concurrent requests.
  // Appending the later page's rows would put a gap in the middle of the window
  // and the bars would silently skip processes.
  let call = 0;
  const rows = await readPaged(
    async () => {
      call += 1;
      return call === 1
        ? { ok: true, body: Array.from({ length: 10 }, (_, i) => ({ n: i })) }
        : { ok: true, body: Array.from({ length: 1000 }, (_, i) => ({ n: 1000 + i })) };
    },
    pathFor,
    { schema: "s" },
  );

  assert.equal(rows.length, 10, "the short page ends it");
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
