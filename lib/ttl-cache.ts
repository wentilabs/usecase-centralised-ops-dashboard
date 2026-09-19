/**
 * A tiny keyed cache that forgets on its own.
 *
 * Extracted so it can be tested: `lib/config-repository` imports `server-only`
 * and therefore cannot be loaded by a node test, which is why nothing in there
 * had coverage. The rules worth pinning — when an entry is stale, what a
 * targeted forget removes, what an untargeted one does — live here, and the
 * repository keeps only the fetching.
 *
 * Deliberately not an LRU or a size-bounded store. There are seven services and
 * one entry each; the only thing that needs to be right is the expiry.
 */
export type TtlCache<K, V> = {
  get: (key: K) => V | undefined;
  set: (key: K, value: V) => void;
  forget: (key?: K) => void;
  /** Keys still within the window, for diagnostics. */
  fresh: () => K[];
};

export function createTtlCache<K, V>(
  ttlMs: number,
  /** Injectable so a test can age an entry without sleeping. */
  now: () => number = Date.now,
  store: Map<K, { at: number; value: V }> = new Map(),
): TtlCache<K, V> {
  const live = (entry: { at: number } | undefined) => Boolean(entry && now() - entry.at < ttlMs);
  return {
    get(key) {
      const entry = store.get(key);
      if (!live(entry)) {
        // Drop it on read rather than leaving it to be re-checked forever: an
        // expired entry is indistinguishable from an absent one everywhere
        // else, and keeping it makes `fresh()` lie about what is held.
        if (entry) store.delete(key);
        return undefined;
      }
      return entry!.value;
    },
    set(key, value) {
      store.set(key, { at: now(), value });
    },
    forget(key) {
      if (key === undefined) store.clear();
      else store.delete(key);
    },
    fresh() {
      return [...store.entries()].filter(([, entry]) => live(entry)).map(([key]) => key);
    },
  };
}
