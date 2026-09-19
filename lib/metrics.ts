/**
 * Where the time goes, recorded in process.
 *
 * Every performance question asked here so far has been answered by timing a
 * URL with curl and guessing at the attribution — which is how a filtered query
 * that made a page SLOWER looked like an optimisation until it was measured
 * end to end. A page is a dozen operations; the number that matters is which
 * one of them is expensive, and how often.
 *
 * Deliberately small and in-memory. This is a diagnostic to point refactoring
 * at the right function, not a monitoring system: no persistence, no export
 * format, no per-request tracing. It answers "what is slow, how often is it
 * called, and is the cache working" and stops there.
 *
 * Cost per call is one Date.now() pair, an object lookup and a push into a
 * bounded array, so it is safe to leave on in production. The sample cap is
 * what keeps it bounded — a process serving for a week must not accumulate a
 * million durations.
 */
export type Stat = {
  name: string;
  count: number;
  /** Milliseconds, total across every call. */
  total: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
  /** Named tallies, e.g. hit/miss, ok/error. Counts only, never timed. */
  tags: Record<string, number>;
};

/** How many durations to keep per operation before dropping the oldest. */
export const SAMPLE_CAP = 256;

type Entry = { count: number; total: number; max: number; samples: number[]; tags: Record<string, number> };

export type Metrics = {
  record: (name: string, ms: number) => void;
  tag: (name: string, tag: string) => void;
  /** Time an async call, tagging it ok or error, and rethrow unchanged. */
  time: <T>(name: string, run: () => Promise<T>) => Promise<T>;
  snapshot: () => Stat[];
  reset: () => void;
};

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  // Nearest-rank: with 20 samples p95 is the 19th, not an interpolation
  // between two. Interpolating would invent a duration nothing took.
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

export function createMetrics(now: () => number = Date.now, store: Map<string, Entry> = new Map()): Metrics {
  function entry(name: string): Entry {
    let found = store.get(name);
    if (!found) {
      found = { count: 0, total: 0, max: 0, samples: [], tags: {} };
      store.set(name, found);
    }
    return found;
  }

  return {
    record(name, ms) {
      const item = entry(name);
      item.count += 1;
      item.total += ms;
      if (ms > item.max) item.max = ms;
      item.samples.push(ms);
      // Oldest out. A long-lived process should describe its recent behaviour,
      // not average it with how it behaved on Tuesday.
      if (item.samples.length > SAMPLE_CAP) item.samples.shift();
    },
    tag(name, label) {
      const item = entry(name);
      item.tags[label] = (item.tags[label] ?? 0) + 1;
    },
    async time(name, run) {
      const started = now();
      try {
        const result = await run();
        this.record(name, now() - started);
        this.tag(name, "ok");
        return result;
      } catch (cause) {
        // A failure that takes two seconds is part of the picture, so it is
        // recorded rather than dropped — tagged, so a fast path is not
        // flattered by errors returning early.
        this.record(name, now() - started);
        this.tag(name, "error");
        throw cause;
      }
    },
    snapshot() {
      return [...store.entries()]
        .map(([name, item]) => {
          const sorted = [...item.samples].sort((a, b) => a - b);
          return {
            name,
            count: item.count,
            total: Math.round(item.total),
            mean: item.count ? Math.round(item.total / item.count) : 0,
            p50: percentile(sorted, 0.5),
            p95: percentile(sorted, 0.95),
            max: item.max,
            tags: { ...item.tags },
          };
        })
        // Costliest first: the list is read to decide what to work on, and
        // total time spent is what that decision turns on — not the slowest
        // single call, which may happen once a day.
        .sort((a, b) => b.total - a.total);
    },
    reset() {
      store.clear();
    },
  };
}
