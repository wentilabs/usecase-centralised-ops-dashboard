/**
 * When each thing the dashboard loads finished, and how long it took.
 *
 * The page is no longer one wait: the configuration arrives with the document and the health and the
 * history arrive after it, so "is it loaded?" has three answers, and "how stale is what I am looking
 * at?" has three more. A single "fetched" time said when the first one landed and nothing about the
 * others — so a card with no strip yet looked the same as a card with no history, and nobody could
 * tell a slow load from a stuck one. Each now says what it is doing, and when it finished, and how long
 * it took, to the second.
 */
export type Load = {
  state: "loading" | "done" | "failed";
  /** When it finished, as an ISO time. */
  at?: string;
  /** How long it took, in milliseconds. */
  ms?: number;
};

export const LOADING: Load = { state: "loading" };

/** "15:24:05" — Singapore, to the second, because loads are seconds apart and a minute hides the order. */
export function clockSgt(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Date(at.getTime() + 8 * 3_600_000).toISOString().slice(11, 19);
}

/** "180 ms", "3.6 s". Milliseconds below a second, because "0.2 s" hides the difference between 40 and 240. */
export function durationText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  // Rounded in tenths by hand: (0.95).toFixed(1) is "0.9" in binary floating point, so 950 ms would read "0.9 s"
  // directly beside "949 ms", which is the wrong way round.
  return ms < 950 ? `${Math.round(ms)} ms` : `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
}

/** The one line for a load: `health 15:24:05 · 3.6 s`, `health loading…`, `health failed`. */
export function describeLoad(label: string, load: Load): string {
  if (load.state === "loading") return `${label} loading…`;
  if (load.state === "failed") return `${label} failed${load.at ? ` ${clockSgt(load.at)}` : ""}`;
  const clock = load.at ? clockSgt(load.at) : "";
  const took = load.ms !== undefined ? durationText(load.ms) : "";
  return [label, clock, took ? `· ${took}` : ""].filter(Boolean).join(" ");
}

/** A finished load, timed from `startedAt` (a `performance.now()` reading) to now. */
export function finished(startedAt: number, now: () => number = () => performance.now(), at: () => string = () => new Date().toISOString()): Load {
  return { state: "done", at: at(), ms: Math.round(now() - startedAt) };
}

export function failed(at: () => string = () => new Date().toISOString()): Load {
  return { state: "failed", at: at() };
}
