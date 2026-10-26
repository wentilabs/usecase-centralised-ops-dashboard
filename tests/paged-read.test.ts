import assert from "node:assert/strict";
import test from "node:test";

import { readPaged } from "../lib/paged-read";

/**
 * A server that serves `total` rows newest-first, 1000 at a time, cut by a
 * keyset — the shape PostgREST presents once `max-rows` is in play.
 *
 * Rows are numbered descending so `at` sorts like a timestamp: the cursor is the
 * last `at` seen, and the next page starts strictly below it.
 */
function pagedServer(total: number, pageSize = 1000) {
  const paths: string[] = [];
  const request = async (path: string) => {
    paths.push(path);
    const before = new URLSearchParams(path.split("?")[1]).get("before");
    const start = before === null ? 0 : Number(before) + 1;
    const count = Math.max(0, Math.min(pageSize, total - start));
    return {
      ok: true,
      body: Array.from({ length: count }, (_, i) => ({ n: start + i, at: String(start + i) })),
    };
  };
  return { request, paths };
}

const pathFor = (before: string | null, limit: number) =>
  `t?select=n&limit=${limit}` + (before === null ? "" : `&before=${before}`);
const cursorOf = (row: Record<string, unknown>) => String(row.at ?? "");

test("a full page is followed, because PostgREST caps responses without saying so", async () => {
  // The bug this exists for: `limit=6000` is silently served as 1000 rows, and
  // the missing 5000 render as idle hours rather than as an error.
  const { request, paths } = pagedServer(2400);
  const rows = await readPaged(request, pathFor, { schema: "s", cursorOf });

  assert.equal(rows.length, 2400, "the whole window, not the first page of it");
  assert.equal(paths.length, 3, "three requests for 2400 rows");
  // Cut by the last value seen, never by a row offset: deep OFFSET makes
  // Postgres scan and discard everything skipped, and `offset=3000` on
  // `wbgt_job_runs` took 8.3s and returned `57014 statement timeout` — which,
  // because a failed page discards the window, emptied every strip at once.
  assert.ok(!paths.some((path) => path.includes("offset=")), "no page is cut by an offset");
  assert.match(paths[1], /before=999/, "the second page starts below the first page's last row");
  assert.match(paths[2], /before=1999/);
});

test("a short page ends the read, because it is the only end-of-data signal there is", async () => {
  const { request, paths } = pagedServer(640);
  const rows = await readPaged(request, pathFor, { schema: "s", cursorOf });

  assert.equal(rows.length, 640, "the short page is the whole answer, and nothing is appended after it");
  assert.equal(paths.length, 1, "a short page is the answer; nothing further is asked for");
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
        ? { ok: true, body: Array.from({ length: 1000 }, (_, i) => ({ n: i, at: String(i) })) }
        : { ok: false, body: [{ n: 9999, at: "9999" }] };
    },
    pathFor,
    { schema: "s", cursorOf },
  );

  assert.deepEqual(rows, [], "a partial window is worse than no window");
  assert.equal(calls, 2, "and it stopped at the failure rather than paging on");
});

test("the page ceiling bounds a runaway filter", async () => {
  const { request, paths } = pagedServer(1_000_000);
  const rows = await readPaged(request, pathFor, { schema: "s", cursorOf, maxPages: 3 });

  assert.equal(paths.length, 3, "it stops at the ceiling rather than walking the table");
  assert.equal(rows.length, 3000);
});

test("a page with no usable cursor stops the read instead of asking again forever", () => {
  // Without a cursor the next request would be byte-identical to the last one,
  // and the same thousand rows would be appended until the page ceiling.
  return readPaged(
    async () => ({ ok: true, body: Array.from({ length: 1000 }, () => ({ n: 1 })) }),
    pathFor,
    { schema: "s", cursorOf: () => "" },
  ).then((rows) => {
    assert.equal(rows.length, 1000, "one page, then it stops");
  });
});

test("a notification history refuses partial pages and page-limit truncation", async () => {
  await assert.rejects(
    readPaged(async () => ({ ok: false, body: [] }), pathFor, { schema: "s", cursorOf, requireComplete: true }),
    /Incomplete paged read/,
  );
  const { request } = pagedServer(3_000);
  await assert.rejects(
    readPaged(request, pathFor, { schema: "s", cursorOf, maxPages: 1, requireComplete: true }),
    /exceeded its page limit/,
  );
});
