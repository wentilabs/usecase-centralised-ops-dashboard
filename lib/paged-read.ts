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
  }: { schema: string; pageSize?: number; maxPages?: number },
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const res = await request(pathFor(page * pageSize, pageSize), { schema });
    // A failed page discards everything rather than returning a partial window:
    // half a window is indistinguishable on the strip from a half-idle service,
    // and that is the reading this whole module exists to prevent.
    if (!res.ok || !Array.isArray(res.body)) return [];

    const batch = res.body as Record<string, unknown>[];
    rows.push(...batch);
    // A short page is the only honest end-of-data signal PostgREST gives.
    if (batch.length < pageSize) return rows;
  }

  return rows;
}
