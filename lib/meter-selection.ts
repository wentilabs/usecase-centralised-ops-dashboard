/**
 * `noise-meters.noise_project_configs.noise_meters_included` — which meters
 * reach the CLIENT-facing messages.
 *
 * Semantics come from `usecases/noise/outbound-meter-filter.js` in the noise
 * repo: a comma-separated list of NoiseLynx RecIDs, and **blank or NULL means
 * every meter**. The filter applies to client messages only — scraping,
 * calculations, Google Sheets and the internal fail-safes always keep every
 * meter — so this is "who is told", not "which meters run".
 *
 * The important asymmetry: an empty value is not the same as a value listing
 * every current RecID. Empty keeps following the project's meters as they
 * change; an exhaustive list freezes today's set, so a meter added next month
 * would silently stop reaching the client. `serializeSelection` therefore
 * collapses "everything enabled" back to empty rather than writing them all out.
 */

export type Meter = { recId: string; name: string };

export type MeterToggle = {
  /** The RecID the filter matches on. Empty when the meter has none. */
  recId: string;
  name: string;
  enabled: boolean;
  /**
   * Set when the pill cannot be toggled or needs explaining:
   * - `no-rec-id`: the meter has no RecID, so no allowlist can name it. Once
   *   filtering is on at all, it cannot reach the client.
   * - `unknown`: the stored value names a RecID that is not an active meter on
   *   this project. The service logs `[ERROR]` and omits it.
   */
  issue?: "no-rec-id" | "unknown";
};

/** Same parse as parseIncludedNoiseMeterRecIds(): trim, drop blanks, de-dupe. */
export function parseIncludedRecIds(value: unknown): string[] {
  return [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

/** Blank or NULL means every meter is included. */
export function includesEveryMeter(value: unknown): boolean {
  return parseIncludedRecIds(value).length === 0;
}

/**
 * One toggle per meter, in the project's own meter order, plus a trailing pill
 * for any stored RecID that no longer matches a meter — surfaced rather than
 * dropped, so a stale id is visible instead of being silently rewritten away.
 */
export function buildToggles(value: unknown, meters: Meter[]): MeterToggle[] {
  const requested = parseIncludedRecIds(value);
  const all = requested.length === 0;
  const known = new Set(meters.map((meter) => meter.recId).filter(Boolean));

  const toggles: MeterToggle[] = meters.map((meter) => ({
    recId: meter.recId,
    name: meter.name,
    // With no allowlist everything is on. A meter without a RecID can never be
    // named by one, so it reads as off the moment filtering starts.
    enabled: all ? true : Boolean(meter.recId) && requested.includes(meter.recId),
    ...(meter.recId ? {} : { issue: "no-rec-id" as const }),
  }));

  for (const recId of requested) {
    if (!known.has(recId)) {
      toggles.push({ recId, name: recId, enabled: true, issue: "unknown" });
    }
  }
  return toggles;
}

/**
 * The column value for a set of toggles.
 *
 * Empty when every nameable meter is enabled and nothing stale is left on, so
 * the project keeps defaulting to "all meters" — see the note at the top.
 */
export function serializeSelection(toggles: MeterToggle[]): string {
  // "Everything enabled" is measured over the project's REAL meters only. A
  // stale id is not a meter, so counting it here would block the collapse to
  // blank and quietly freeze the set instead.
  const real = toggles.filter((toggle) => toggle.recId && toggle.issue !== "unknown");
  const enabledReal = real.filter((toggle) => toggle.enabled);
  const staleStillOn = toggles.filter((toggle) => toggle.issue === "unknown" && toggle.enabled);

  if (enabledReal.length === real.length && !staleStillOn.length) return "";
  return [...enabledReal, ...staleStillOn].map((toggle) => toggle.recId).join(",");
}

/** Flip one meter and return the new column value. */
export function toggleMeter(toggles: MeterToggle[], recId: string): string {
  return serializeSelection(
    toggles.map((toggle) => (toggle.recId === recId ? { ...toggle, enabled: !toggle.enabled } : toggle)),
  );
}

/** Short summary for a card or a label, e.g. "3 of 7 meters". */
export function describeSelection(value: unknown, meterCount: number | null): string {
  const requested = parseIncludedRecIds(value);
  if (!requested.length) return meterCount === null ? "all meters" : `all ${meterCount} meters`;
  return meterCount === null ? `${requested.length} meters only` : `${requested.length} of ${meterCount} meters`;
}
