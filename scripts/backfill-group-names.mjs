#!/usr/bin/env node
/**
 * One-time load of EVERY WhatsApp group id → name into ops.whatsapp_group_names.
 *
 *   npm run groups:backfill            # fill in the gaps
 *   npm run groups:backfill -- --force # re-read every name, even known ones
 *
 * Why a script and not an endpoint: the listener log holds ~1.9M rows across
 * ~641 distinct group chats, and PostgREST offers no DISTINCT. Enumerating the
 * ids means one round trip per group (~80ms each, so ~50s), which comfortably
 * exceeds a serverless request budget. The app therefore only ever does the
 * cheap incremental scan (refreshRecentGroupNames), and this runs once by hand.
 *
 * How the enumeration works: ordering by `from` and asking for a single row
 * greater than the last id seen returns the next distinct id, so the number of
 * requests is the number of groups rather than the number of messages.
 */

const CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 20_000;
const UPSERT_BATCH = 200;
const GROUP_SUFFIX = "@g.us";
/** Guard against an unbounded loop if the log ever grows a pathological shape. */
const MAX_GROUPS = 20_000;

const force = process.argv.includes("--force");

const listener = {
  url: (process.env.LISTENER_SUPABASE_URL ?? "").replace(/\/+$/, ""),
  key: process.env.LISTENER_SUPABASE_ANON_KEY ?? "",
};
const store = {
  url: (process.env.SUPABASE_URL ?? "").replace(/\/+$/, ""),
  key: process.env.SUPABASE_SECRET_KEY ?? "",
};

for (const [label, cfg, vars] of [
  ["listener", listener, "LISTENER_SUPABASE_URL / LISTENER_SUPABASE_ANON_KEY"],
  ["config", store, "SUPABASE_URL / SUPABASE_SECRET_KEY"],
]) {
  if (!cfg.url || !cfg.key) {
    console.error(`Missing ${vars} — the ${label} project is not configured.`);
    process.exit(1);
  }
}

async function getJson(base, key, query, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/rest/v1/${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...extraHeaders },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** The next distinct `from` after `cursor`, restricted to group chats. */
async function nextGroupId(cursor) {
  let query =
    `whatsapp_listener?select=from&order=from.asc&limit=1` +
    `&from=like.${encodeURIComponent(`*${GROUP_SUFFIX}`)}`;
  if (cursor) query += `&from=gt.${encodeURIComponent(cursor)}`;
  const rows = await getJson(listener.url, listener.key, query);
  return rows[0]?.from ?? null;
}

/**
 * The group's current name.
 *
 * Filtered to rows that actually carry a chatName: plenty of messages store it
 * as null, so taking the single latest row blindly reports "unnamed" for a group
 * whose name is sitting one row further back. Asking for a few rows also covers
 * a latest row whose chatName is present but blank.
 */
async function latestName(chatId) {
  const query =
    `whatsapp_listener?select=chatName&from=eq.${encodeURIComponent(chatId)}` +
    `&chatName=not.is.null&order=timestamp.desc&limit=5`;
  try {
    const rows = await getJson(listener.url, listener.key, query);
    for (const row of rows) {
      const name = typeof row.chatName === "string" ? row.chatName.trim() : "";
      if (name) return name;
    }
    return null;
  } catch {
    return null;
  }
}

async function readKnown() {
  const rows = await getJson(store.url, store.key, "whatsapp_group_names?select=chat_id,chat_name", {
    "Accept-Profile": "ops",
  });
  return new Map(rows.map((row) => [row.chat_id, row.chat_name]));
}

async function upsert(rows) {
  if (!rows.length) return;
  const refreshed_at = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${store.url}/rest/v1/whatsapp_group_names`, {
      method: "POST",
      headers: {
        apikey: store.key,
        Authorization: `Bearer ${store.key}`,
        "Content-Profile": "ops",
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(rows.map((row) => ({ ...row, refreshed_at }))),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`upsert failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

console.log(`Reading ops.whatsapp_group_names…`);
const known = await readKnown();
console.log(`  ${known.size} rows already stored (${[...known.values()].filter(Boolean).length} named)`);

console.log(`Enumerating distinct ${GROUP_SUFFIX} ids in the listener log…`);
const ids = [];
let cursor = null;
for (;;) {
  const id = await nextGroupId(cursor);
  if (!id) break;
  ids.push(id);
  cursor = id;
  if (ids.length % 100 === 0) console.log(`  ${ids.length} groups… (${elapsed()})`);
  if (ids.length >= MAX_GROUPS) {
    console.warn(`  stopping at ${MAX_GROUPS} — more groups remain, re-run to continue past ${cursor}`);
    break;
  }
}
console.log(`  ${ids.length} distinct groups found (${elapsed()})`);

const pending = force ? ids : ids.filter((id) => !known.get(id));
console.log(
  force
    ? `Re-reading all ${pending.length} names…`
    : `Resolving ${pending.length} names (${ids.length - pending.length} already named)…`,
);

const queue = [...pending];
const resolved = [];
let done = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const chatId = queue.shift();
      if (!chatId) return;
      resolved.push({ chat_id: chatId, chat_name: await latestName(chatId) });
      done += 1;
      if (done % 100 === 0) console.log(`  ${done}/${pending.length} resolved (${elapsed()})`);
    }
  }),
);

console.log(`Writing ${resolved.length} rows in batches of ${UPSERT_BATCH}…`);
for (let i = 0; i < resolved.length; i += UPSERT_BATCH) {
  await upsert(resolved.slice(i, i + UPSERT_BATCH));
}

const named = resolved.filter((row) => row.chat_name).length;
console.log(
  `\nDone in ${elapsed()}: ${ids.length} groups seen, ${resolved.length} looked up, ${named} named, ` +
    `${resolved.length - named} had no usable chatName.`,
);
console.log(`The dashboard picks these up on its next render; ⟳ Chat aliases keeps them current.`);
