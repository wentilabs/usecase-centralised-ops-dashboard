/**
 * Have we already got enough rows for every project we have seen?
 *
 * The strips want the newest N processes PER PROJECT. A time window cannot
 * express that, and paging the whole window to find out costs up to ten round
 * trips per service — which is what made the dashboard slow to first paint.
 *
 * Rows arrive newest first, so once every project in hand has N of them, any
 * further page can only add older rows that would be sliced off anyway. The one
 * thing it can also add is a project that has not appeared yet; that is
 * accepted deliberately, because a project whose newest process is older than
 * everything on the first pages is one that has effectively stopped, and its
 * absence from the board is then the honest reading rather than a gap in it.
 */
export function everyProjectHasEnough(
  rows: Record<string, unknown>[],
  projectKey: (row: Record<string, unknown>) => string,
  perProject: number,
): boolean {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = projectKey(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.size) return false;
  return [...counts.values()].every((count) => count >= perProject);
}
