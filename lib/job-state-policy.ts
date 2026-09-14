/**
 * Columns written by service jobs as runtime state rather than by operators as
 * configuration. They are read-only in HALO and removed from displayed audit
 * changes. The SQL audit trigger is contract-tested against this same list.
 */
export const JOB_STATE_COLUMNS = [
  "top_of_hour_band",
  "last_5min_alert_level",
  "last_5min_alert_at",
  // Noise limits refresh stamps this even when a protected row's values stay
  // unchanged; retaining it would bury operator edits in machine churn.
  "imported_at",
] as const;

export function auditChangesWithoutJobState<T>(
  changes: Record<string, T> | null | undefined,
): Record<string, T> | null {
  const entries = Object.entries(changes ?? {});
  if (!entries.some(([column]) => (JOB_STATE_COLUMNS as readonly string[]).includes(column))) {
    return changes ?? {};
  }
  const kept = entries.filter(([column]) => !(JOB_STATE_COLUMNS as readonly string[]).includes(column));
  return kept.length ? Object.fromEntries(kept) : null;
}
