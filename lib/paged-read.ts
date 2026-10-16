/**
 * Read past PostgREST's row ceiling.
 *
 * The server is configured with `max-rows`, which silently caps every response
 * at 1000 rows no matter what `limit` asks for. That is not an error and
 * nothing in the response says it happened — the array simply stops.
 *
 * For the health strips that truncation is worse than an error, because it
 * looks like data. Haze records sixty-four deliveries an hour, so one page
 * covers about fifteen hours of a fifty-hour window, and the other thirty-five
 * hours render as "no cycle" — a grey gap that reads as thirty-five missed
 * runs. The strip would be at its most wrong exactly where it matters most, on
 * the busiest service.
 *
 * So the window is paged until a short page proves the end was reached.
 */
export async function readPaged(
  request: (path: string, init: { schema: string }) => Promise<{ ok: boolean; body: unknown }>,
  pathFor: (offset: number, limit: number) => string,
  {
    schema,
    pageSize = 1000,
    /**
     * A ceiling, not an expectation. Ten pages is 10,000 rows — more than twice
     * the busiest service's fifty-hour window — and it stops a mis-specified
     * filter from walking a whole table on page load.
     */
    maxPages = 10,
    /**
     * Stop early once the rows in hand already answer the question.
     *
     * The strips need the newest fifty processes PER PROJECT, not a whole time
     * window, so for most services two pages are enough and the remaining eight
     * are pure latency on first paint. Checked after each page, never before
     * the first.
     */
    enough,
  }: {
    schema: string;
    pageSize?: number;
    maxPages?: number;
    enough?: (rows: Record<string, unknown>[]) => boolean;
  },
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];

  // The first two pages are fetched together. Thirty-odd projects wanting fifty
  // processes each is about 1600 rows, so a second page is all but certain, and
  // asking for it only after the first returns spends a whole round trip
  // learning what the arithmetic already said. On the slowest table that is 1.4s
  // of avoidable latency on a cold load. A speculative page costs one request
  // the service can serve in parallel; `enough` still decides everything after.
  const firstPages = Math.min(2, maxPages);
  const opened = await Promise.all(
    Array.from({ length: firstPages }, (_, page) => request(pathFor(page * pageSize, pageSize), { schema })),
  );

  for (const res of opened) {
    // A failed page discards everything rather than returning a partial window:
    // half a window is indistinguishable on the strip from a half-idle service,
    // and that is the reading this whole module exists to prevent.
    if (!res.ok || !Array.isArray(res.body)) return [];
    const batch = res.body as Record<string, unknown>[];
    rows.push(...batch);
    // A short page is the only honest end-of-data signal PostgREST gives. Stop
    // here even if a later speculative page came back full — it cannot have,
    // unless the table changed underneath us, and trusting it over the short
    // page would leave a hole in the middle of the window.
    if (batch.length < pageSize) return rows;
  }
  if (enough?.(rows)) return rows;

  for (let page = firstPages; page < maxPages; page += 1) {
    const res = await request(pathFor(page * pageSize, pageSize), { schema });
    if (!res.ok || !Array.isArray(res.body)) return [];

    const batch = res.body as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
    if (enough?.(rows)) return rows;
  }

  return rows;
}
