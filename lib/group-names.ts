import "server-only";

/**
 * WhatsApp group id → human group name, read from the listener project's
 * whatsapp_listener table.
 *
 * Why cached rather than looked up per request: that table is a live message
 * log (~1.9M rows and growing) shared with production WhatsApp traffic, and
 * "latest row per group" is the expensive group-wise-max shape. Measured
 * against it, one group's lookup is ~60ms when ordered by `timestamp` (indexed)
 * versus ~1.5s ordered by `created_at` (not) — so we always order by
 * `timestamp`, fan out with a small concurrency limit, and hold the result in
 * memory. Group names change when somebody renames a chat, i.e. rarely, so a
 * long TTL plus an explicit refresh is the right trade.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 8000;

export type GroupNameMap = Record<string, string>;

type Cache = { map: GroupNameMap; fetchedAt: number; missing: string[] };

let cache: Cache | null = null;
let inFlight: Promise<Cache> | null = null;

function listenerConfig() {
  const url = (process.env.LISTENER_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.LISTENER_SUPABASE_ANON_KEY ?? "";
  return { url, key, configured: Boolean(url && key) };
}

async function fetchOneName(chatId: string): Promise<string | null> {
  const { url, key } = listenerConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const query =
      `whatsapp_listener?select=chatName&from=eq.${encodeURIComponent(chatId)}` +
      `&order=timestamp.desc&limit=1`;
    const res = await fetch(`${url}/rest/v1/${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { chatName?: string | null }[];
    const name = rows[0]?.chatName;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAll(chatIds: string[]): Promise<Cache> {
  const map: GroupNameMap = {};
  const missing: string[] = [];
  const queue = [...new Set(chatIds)];

  // Bounded fan-out: enough to stay quick, small enough to be a polite
  // neighbour on a database serving live message traffic.
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const chatId = queue.shift();
      if (!chatId) return;
      const name = await fetchOneName(chatId);
      if (name) map[chatId] = name;
      else missing.push(chatId);
    }
  });
  await Promise.all(workers);

  return { map, fetchedAt: Date.now(), missing };
}

export type GroupNamesResult = {
  configured: boolean;
  map: GroupNameMap;
  fetchedAt: string | null;
  /** Ids with no listener rows — the UI falls back to showing the raw id. */
  unresolved: string[];
};

export async function getGroupNames(
  chatIds: string[],
  { refresh = false }: { refresh?: boolean } = {},
): Promise<GroupNamesResult> {
  const { configured } = listenerConfig();
  if (!configured) return { configured: false, map: {}, fetchedAt: null, unresolved: chatIds };

  const fresh = cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  const covered = cache && chatIds.every((id) => id in cache!.map || cache!.missing.includes(id));

  if (!refresh && fresh && covered) {
    return {
      configured: true,
      map: cache!.map,
      fetchedAt: new Date(cache!.fetchedAt).toISOString(),
      unresolved: cache!.missing,
    };
  }

  // Collapse concurrent refreshes into one fan-out.
  inFlight ??= fetchAll(chatIds).finally(() => {
    inFlight = null;
  });
  cache = await inFlight;

  return {
    configured: true,
    map: cache.map,
    fetchedAt: new Date(cache.fetchedAt).toISOString(),
    unresolved: cache.missing,
  };
}
