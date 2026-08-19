import "server-only";

/**
 * WhatsApp group id → human group name.
 *
 * Source of truth is ops.whatsapp_group_names in the config project: one small
 * shared table every instance reads. It is populated on demand from the
 * listener project's whatsapp_listener log.
 *
 * Why not cache in memory: this deploys as serverless SSR, so an in-process
 * cache is per instance — several instances each re-query the log, and a
 * refresh only ever applies to the instance that served the click. A shared
 * table makes refresh global and staleness visible via refreshed_at.
 *
 * Why the log is not queried per request: it holds ~1.9M rows and serves live
 * WhatsApp traffic, and "latest row per group" is the expensive group-wise-max
 * shape. Measured: ~60ms per group ordered by `timestamp` (indexed) versus
 * ~1.5s by `created_at` (not), so we always order by `timestamp`.
 */

const CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 8000;
// Absorbs bursts within a single render without hiding a refresh from anyone.
const MEMO_TTL_MS = 60_000;

export type GroupNameRow = { chat_id: string; chat_name: string | null; refreshed_at: string };
export type GroupNameMap = Record<string, string>;

export type GroupNamesResult = {
  /** Whether the listener project is configured (refresh is possible at all). */
  configured: boolean;
  /** Whether ops.whatsapp_group_names is reachable (setup SQL has been run). */
  storeReady: boolean;
  map: GroupNameMap;
  refreshedAt: string | null;
  /** Ids with no listener rows — the UI falls back to showing the raw id. */
  unresolved: string[];
  setupHint?: string;
};

let memo: { result: GroupNamesResult; at: number } | null = null;

function configStore() {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  return { url, key };
}

function listenerConfig() {
  const url = (process.env.LISTENER_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.LISTENER_SUPABASE_ANON_KEY ?? "";
  return { url, key, configured: Boolean(url && key) };
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, fallback: T): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

const SETUP_HINT =
  "ops.whatsapp_group_names not reachable — run supabase/config_audit_setup.sql, then add `ops` to Supabase → Settings → API → Exposed schemas.";

/** Read the shared table. Returns null when the table/schema is not set up. */
async function readStore(): Promise<GroupNameRow[] | null> {
  const { url, key } = configStore();
  return withTimeout(async (signal) => {
    const res = await fetch(`${url}/rest/v1/whatsapp_group_names?select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": "ops",
      },
      cache: "no-store",
      signal,
    });
    if (res.status === 404 || res.status === 406) return null;
    if (!res.ok) return null;
    return (await res.json()) as GroupNameRow[];
  }, null);
}

async function writeStore(rows: { chat_id: string; chat_name: string | null }[]): Promise<boolean> {
  if (!rows.length) return true;
  const { url, key } = configStore();
  const refreshed_at = new Date().toISOString();
  return withTimeout(async (signal) => {
    const res = await fetch(`${url}/rest/v1/whatsapp_group_names`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Profile": "ops",
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(rows.map((row) => ({ ...row, refreshed_at }))),
      signal,
    });
    return res.ok;
  }, false);
}

async function fetchNameFromListener(chatId: string): Promise<string | null> {
  const { url, key } = listenerConfig();
  return withTimeout(async (signal) => {
    const query =
      `whatsapp_listener?select=chatName&from=eq.${encodeURIComponent(chatId)}` +
      `&order=timestamp.desc&limit=1`;
    const res = await fetch(`${url}/rest/v1/${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal,
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { chatName?: string | null }[];
    const name = rows[0]?.chatName;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  }, null);
}

function toResult(rows: GroupNameRow[], chatIds: string[], configured: boolean): GroupNamesResult {
  const map: GroupNameMap = {};
  let refreshedAt: string | null = null;
  for (const row of rows) {
    if (row.chat_name) map[row.chat_id] = row.chat_name;
    if (!refreshedAt || row.refreshed_at > refreshedAt) refreshedAt = row.refreshed_at;
  }
  return {
    configured,
    storeReady: true,
    map,
    refreshedAt,
    unresolved: chatIds.filter((id) => !(id in map)),
  };
}

/**
 * Read names for the given ids. Only touches the listener log when explicitly
 * refreshed, or when the store has no row at all for an id yet.
 */
export async function getGroupNames(
  chatIds: string[],
  { refresh = false }: { refresh?: boolean } = {},
): Promise<GroupNamesResult> {
  const { configured } = listenerConfig();

  if (!refresh && memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.result;

  const stored = await readStore();
  if (stored === null) {
    return {
      configured,
      storeReady: false,
      map: {},
      refreshedAt: null,
      unresolved: chatIds,
      setupHint: SETUP_HINT,
    };
  }

  const known = new Set(stored.map((row) => row.chat_id));
  const missing = chatIds.filter((id) => !known.has(id));
  const toLookup = refresh ? chatIds : missing;

  if (configured && toLookup.length) {
    const queue = [...new Set(toLookup)];
    const resolved: { chat_id: string; chat_name: string | null }[] = [];

    // Bounded fan-out: quick enough for a button, polite to a database that is
    // serving live message traffic.
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const chatId = queue.shift();
        if (!chatId) return;
        resolved.push({ chat_id: chatId, chat_name: await fetchNameFromListener(chatId) });
      }
    });
    await Promise.all(workers);

    await writeStore(resolved);
    const fresh = await readStore();
    if (fresh) {
      const result = toResult(fresh, chatIds, configured);
      memo = { result, at: Date.now() };
      return result;
    }
  }

  const result = toResult(stored, chatIds, configured);
  memo = { result, at: Date.now() };
  return result;
}
