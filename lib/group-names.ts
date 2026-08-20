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

/** PostgREST caps a response at 1000 rows whatever `limit` asks for. */
const LISTENER_PAGE_SIZE = 1000;
/**
 * How far back the incremental refresh looks: ~12k messages. Measured on the
 * live log, one page already covers ~92 active groups, and the whole walk stays
 * a few seconds — short enough for a button, and it leaves the 641-group
 * long tail to the one-time backfill.
 */
const RECENT_PAGES = 12;
/** Group chats only; the log also carries @c.us and @lid direct chats. */
const GROUP_SUFFIX = "@g.us";

type ListenerRow = { from?: string | null; chatName?: string | null; timestamp?: unknown };

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

/**
 * One group's current name.
 *
 * `chatName=not.is.null` matters: many rows store it as null, so taking the
 * single latest row reported "unnamed" for 277 of 641 groups whose name was one
 * row further back. Filtering first recovered 254 of them.
 */
async function fetchNameFromListener(chatId: string): Promise<string | null> {
  const { url, key } = listenerConfig();
  return withTimeout(async (signal) => {
    const query =
      `whatsapp_listener?select=chatName&from=eq.${encodeURIComponent(chatId)}` +
      `&chatName=not.is.null&order=timestamp.desc&limit=5`;
    const res = await fetch(`${url}/rest/v1/${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal,
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { chatName?: string | null }[];
    for (const row of rows) {
      const name = typeof row.chatName === "string" ? row.chatName.trim() : "";
      if (name) return name;
    }
    return null;
  }, null);
}

/**
 * One page of the listener log, newest first. PostgREST caps a response at
 * 1000 rows regardless of `limit`, so "further into the past" means more pages,
 * walked by keyset on the indexed `timestamp` rather than by OFFSET.
 */
async function fetchListenerPage(before: unknown): Promise<ListenerRow[]> {
  const { url, key } = listenerConfig();
  return withTimeout(async (signal) => {
    let query = `whatsapp_listener?select=from,chatName,timestamp&order=timestamp.desc&limit=${LISTENER_PAGE_SIZE}`;
    if (before !== null && before !== undefined) {
      query += `&timestamp=lt.${encodeURIComponent(String(before))}`;
    }
    const res = await fetch(`${url}/rest/v1/${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal,
    });
    if (!res.ok) return [];
    return (await res.json()) as ListenerRow[];
  }, []);
}

/**
 * Incremental refresh: walk back through the most recent messages and keep the
 * first name seen for each group — rows arrive newest-first, so first seen is
 * the current name.
 *
 * This is what the ⟳ Chat aliases button runs. It costs one request per 1000
 * messages and, unlike a per-id lookup, it also *discovers* groups that no
 * project references yet — which is what makes the group picker's dropdown
 * useful. Groups that have been silent for longer than the window keep whatever
 * the one-time backfill stored (see scripts/backfill-group-names.mjs).
 */
export async function refreshRecentGroupNames(
  { pages = RECENT_PAGES }: { pages?: number } = {},
): Promise<{ scanned: number; groups: number; written: boolean }> {
  const { configured } = listenerConfig();
  if (!configured) return { scanned: 0, groups: 0, written: false };

  const latest = new Map<string, string | null>();
  let cursor: unknown = null;
  let scanned = 0;

  for (let page = 0; page < Math.max(1, pages); page += 1) {
    const rows = await fetchListenerPage(cursor);
    if (!rows.length) break;
    scanned += rows.length;
    for (const row of rows) {
      const chatId = typeof row.from === "string" ? row.from : "";
      if (!chatId.endsWith(GROUP_SUFFIX) || latest.has(chatId)) continue;
      const name = typeof row.chatName === "string" ? row.chatName.trim() : "";
      latest.set(chatId, name || null);
    }
    cursor = rows[rows.length - 1]?.timestamp ?? null;
    if (cursor === null || cursor === undefined) break;
  }

  // Only overwrite with a name we actually found: a blank chatName on a recent
  // message must not wipe a good name the backfill already stored.
  const rows = [...latest]
    .filter(([, name]) => Boolean(name))
    .map(([chat_id, chat_name]) => ({ chat_id, chat_name }));

  const written = await writeStore(rows);
  memo = null;
  return { scanned, groups: latest.size, written };
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
