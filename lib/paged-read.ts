/**
 * Read past PostgREST's row ceiling, without deep OFFSET.
 *
 * Two server limits shape this, and neither announces itself:
 *
 * **`max-rows` caps every response at 1000.** Not an error, nothing in the
 * response says it happened — the array simply stops. Haze records sixty-four
 * deliveries an hour, so a single request covers a fraction of what a strip
 * needs and the rest would render as missing processes.
 *
 * **Deep `OFFSET` times out.** Postgres scans and discards every skipped row, so
 * `offset=3000` on `wbgt_job_runs` took 8.3 seconds and came back
 * `57014 canceling statement due to statement timeout`. Since a failed page
 * discards the whole window, raising the strips to a hundred processes per
 * project — four pages — made every strip on the dashboard vanish at once.
 *
 * So pages are cut with a KEYSET: each one asks for rows strictly older than the
 * oldest row already seen. That is an index seek whatever the depth, so page
 * four costs what page one costs.
 *
 * The cost of keyset is that pages can no longer be fetched in parallel, since
 * each needs the previous page's last value. Measured, that is the better trade
 * by a wide margin: four serial seeks at ~0.6s beat four parallel scans where
 * the deepest one times out and takes the result with it.
 */
export async function readPaged(
  request: (path: string, init: { schema: string }) => Promise<{ ok: boolean; body: unknown }>,
  /** `before` is null on the first page, then the oldest value already seen. */
  pathFor: (before: string | null, limit: number) => string,
  {
    schema,
    pageSize = 1000,
    /**
     * A ceiling, not an expectation. Ten pages is 10,000 rows — more than the
     * busiest service's quota — and it stops a mis-specified filter from walking
     * a whole table on page load.
     */
    maxPages = 10,
    /**
     * Stop early once the rows in hand already answer the question.
     *
     * The strips need the newest N processes PER PROJECT, so once every project
     * in hand has its quota a further page can only add rows that would be
     * sliced off. Checked after each page, never before the first.
     */
    enough,
    /** Reads the keyset value from a row — the column `pathFor` orders by. */
    cursorOf,
  }: {
    schema: string;
    pageSize?: number;
    maxPages?: number;
    enough?: (rows: Record<string, unknown>[]) => boolean;
    cursorOf: (row: Record<string, unknown>) => string;
  },
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let before: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const res = await request(pathFor(before, pageSize), { schema });
    // A failed page discards everything rather than returning a partial window:
    // half a window is indistinguishable on a strip from a half-idle service,
    // and that is the reading this module exists to prevent.
    if (!res.ok || !Array.isArray(res.body)) return [];

    const batch = res.body as Record<string, unknown>[];
    rows.push(...batch);
    // A short page is the only honest end-of-data signal PostgREST gives.
    if (batch.length < pageSize) return rows;
    if (enough?.(rows)) return rows;

    const last = cursorOf(batch[batch.length - 1]);
    // No cursor means no safe way to ask for the next page: asking again
    // without one would re-read the same rows forever.
    if (!last || last === before) return rows;
    before = last;
  }

  return rows;
}
