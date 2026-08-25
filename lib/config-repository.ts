import "server-only";

import {
  hashToken,
  hashesMatch,
  isRevoked,
  scopesOf,
  type TokenIdentity,
  type TokenRecord,
} from "./api-tokens";
import { buildFieldSpec, type IntrospectedColumn, type ServiceFieldSpec } from "./field-spec";
import { SERVICES, type ProjectConfigRow, type ServiceKey } from "./services";

/**
 * Typed data access for the six config tables, plus the shared audit trail.
 * Server-only: it holds the Supabase secret key, which never reaches a browser.
 */

const REQUEST_TIMEOUT_MS = 8000;

function config() {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  return { url, key };
}

async function request(path: string, init: RequestInit & { schema: string }) {
  const { url, key } = config();
  const { schema, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      ...rest,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": schema,
        "Content-Profile": schema,
        "Content-Type": "application/json",
        ...(rest.headers ?? {}),
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function listConfigs(service: ServiceKey): Promise<ProjectConfigRow[]> {
  const { table, schema } = SERVICES[service];
  const res = await request(`${table}?select=*&order=project_code.asc`, { schema });
  if (!res.ok) throw new Error(`${service}: ${res.status} ${res.text.slice(0, 200)}`);
  return res.body as ProjectConfigRow[];
}

/**
 * The active noise meters for one project, as {recId, name}.
 *
 * Reads `noise-meters.noise_limits`, which holds one row per meter per day-type
 * per hour window — so it de-duplicates on `full_identifier`, the key the noise
 * service itself treats as a meter's identity. `active = true` and the ordering
 * mirror loadAllProjectLimitRows() in the noise repo, so the list matches the
 * meters the outbound filter is comparing against.
 *
 * `noise_meter_loc` is the official name deliberately: the noise service also
 * has a per-project display-alias layer for outbound messages only, and the
 * configuration should name what the database stores.
 */
export async function listNoiseMeters(projectCode: string): Promise<{ recId: string; name: string }[]> {
  const res = await request(
    `noise_limits?select=full_identifier,noise_meter_loc,rec_id&active=is.true` +
      `&project_code=eq.${encodeURIComponent(projectCode)}&order=full_identifier.asc`,
    { schema: "noise-meters" },
  );
  if (!res.ok) throw new Error(`noise meters for ${projectCode}: ${res.status} ${res.text.slice(0, 200)}`);

  const seen = new Map<string, { recId: string; name: string }>();
  for (const row of (res.body ?? []) as Record<string, unknown>[]) {
    const identifier = String(row.full_identifier ?? "");
    if (!identifier || seen.has(identifier)) continue;
    seen.set(identifier, {
      recId: String(row.rec_id ?? "").trim(),
      name: String(row.noise_meter_loc ?? "").trim() || identifier,
    });
  }
  return [...seen.values()];
}

export async function getConfig(service: ServiceKey, rowId: string): Promise<ProjectConfigRow | null> {
  const { table, schema, idColumn } = SERVICES[service];
  const res = await request(`${table}?select=*&${idColumn}=eq.${encodeURIComponent(rowId)}`, { schema });
  if (!res.ok) throw new Error(`${service}: ${res.status} ${res.text.slice(0, 200)}`);
  return (res.body as ProjectConfigRow[])[0] ?? null;
}

/**
 * Optimistic concurrency: the write only lands if the row still carries the
 * updated_at the editor loaded. Zero rows back means somebody changed it in
 * between — reported rather than silently overwritten.
 */
export async function updateConfig(
  service: ServiceKey,
  rowId: string,
  patch: Record<string, unknown>,
  baseUpdatedAt: string | null,
): Promise<ProjectConfigRow[]> {
  const { table, schema, idColumn } = SERVICES[service];
  const params = [`${idColumn}=eq.${encodeURIComponent(rowId)}`];
  if (baseUpdatedAt) params.push(`updated_at=eq.${encodeURIComponent(baseUpdatedAt)}`);

  const res = await request(`${table}?${params.join("&")}`, {
    schema,
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.text.slice(0, 300)}`);
  return res.body as ProjectConfigRow[];
}

/**
 * Create a project row.
 *
 * The only insert in the app — everything else patches. `Prefer: return=representation`
 * so the caller gets the row Postgres actually stored, defaults and all, rather
 * than echoing back what was sent.
 */
export async function insertConfig(
  service: ServiceKey,
  row: Record<string, unknown>,
): Promise<ProjectConfigRow[]> {
  const { table, schema } = SERVICES[service];
  const res = await request(table, {
    schema,
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.text.slice(0, 300)}`);
  return res.body as ProjectConfigRow[];
}

/**
 * Resolve a bearer token to an identity, or null.
 *
 * Looked up by hash — the plaintext is never stored, so this is the only way a
 * token can be recognised at all. A revoked token resolves to null.
 *
 * `last_used_at` is updated opportunistically and its failure is ignored: an
 * agent request must not fail because a bookkeeping write did.
 */
export async function resolveApiToken(token: string): Promise<TokenIdentity | null> {
  const hash = hashToken(token);
  const res = await request(
    `api_tokens?select=id,name,scopes,revoked_at,token_hash&token_hash=eq.${encodeURIComponent(hash)}&limit=1`,
    { schema: "ops" },
  );
  if (!res.ok) return null;
  const record = (res.body as (TokenRecord & { token_hash: string })[])[0];
  if (!record || !hashesMatch(record.token_hash, hash) || isRevoked(record)) return null;

  const scopes = scopesOf(record);
  if (!scopes.length) return null;

  void request(`api_tokens?id=eq.${encodeURIComponent(record.id)}`, {
    schema: "ops",
    method: "PATCH",
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {});

  return { actor: `agent:${record.name}`, scopes, tokenId: record.id };
}

/**
 * Call a Postgres function through PostgREST.
 *
 * Onboarding a WBGT project needs a table created, which is DDL and therefore
 * out of reach for an ordinary insert. The wbgt repo installs a narrow
 * `security definer` function for exactly this; a 404 here means the migration
 * has not been run yet, which the dialog reports rather than failing opaquely.
 */
export async function callRpc(
  schema: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  return request(`rpc/${fn}`, {
    schema,
    method: "POST",
    body: JSON.stringify(args),
  });
}

/** Insert rows into a companion table in the same schema, e.g. `wbgt_sensors`. */
export async function insertRows(
  schema: string,
  table: string,
  rows: Record<string, unknown>[],
  { onConflict }: { onConflict?: string } = {},
): Promise<ProjectConfigRow[]> {
  const path = onConflict ? `${table}?on_conflict=${encodeURIComponent(onConflict)}` : table;
  const res = await request(path, {
    schema,
    method: "POST",
    headers: {
      Prefer: onConflict ? "return=representation,resolution=merge-duplicates" : "return=representation",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.text.slice(0, 300)}`);
  return res.body as ProjectConfigRow[];
}

/**
 * Whether a table exists and is readable, without caring what is in it.
 *
 * PostgREST answers a missing table with 404 / PGRST205, which is how HALO can
 * tell that a project's readings table has not been created even though it
 * cannot create one itself.
 */
export async function tableExists(schema: string, table: string): Promise<boolean> {
  const res = await request(`${table}?select=*&limit=0`, { schema });
  return res.ok;
}

/**
 * PostgREST publishes an OpenAPI doc describing every column: type, default and
 * pg-enum values. Cached per process; POST /api/schema/reload clears it so a
 * column added to Supabase shows up without a redeploy.
 *
 * The cache hangs off globalThis rather than the module scope on purpose. Next
 * bundles route handlers separately from server components, so a module-scoped
 * Map gives the /api/schema/reload handler a DIFFERENT instance from the one
 * app/page.tsx reads — clearing it would appear to work (the API returns fresh
 * columns) while the dashboard kept serving the stale spec until a restart.
 * That is exactly what happened when haze and lightning gained their POC
 * columns.
 */
const globalSpecCache = globalThis as typeof globalThis & {
  __haloSpecCache?: Map<ServiceKey, ServiceFieldSpec>;
};
const specCache: Map<ServiceKey, ServiceFieldSpec> = (globalSpecCache.__haloSpecCache ??= new Map());

export function clearFieldSpecCache() {
  specCache.clear();
}

/**
 * How many service specs are currently cached, reported by /api/session.
 *
 * This is the diagnostic that distinguishes "the reload button worked" from
 * "the reload button cleared a different copy of the cache": render the
 * dashboard, and this must be non-zero when read from an API route.
 */
export function cachedFieldSpecCount() {
  return specCache.size;
}

export async function getFieldSpec(service: ServiceKey): Promise<ServiceFieldSpec> {
  const cached = specCache.get(service);
  if (cached) return cached;

  const { schema, table } = SERVICES[service];
  const res = await request("", { schema });
  if (!res.ok) throw new Error(`${service} schema: ${res.status}`);

  const definitions = (res.body as { definitions?: Record<string, { properties?: Record<string, IntrospectedColumn> }> })
    ?.definitions;
  const properties = definitions?.[table]?.properties ?? {};
  const introspected: Record<string, IntrospectedColumn> = {};
  for (const [name, p] of Object.entries(properties)) {
    introspected[name] = { type: p.type, format: p.format, enum: p.enum ?? null, default: p.default };
  }

  const spec = buildFieldSpec(service, introspected);
  specCache.set(service, spec);
  return spec;
}

// ---------------------------------------------------------------------------
// ops.config_audit — the Postgres trigger writes every row (including changes
// made directly in Supabase); the dashboard annotates the one its write caused.
// ---------------------------------------------------------------------------
export type AuditEntry = {
  id: string;
  at: string;
  table_name: string;
  row_id: string;
  project_code: string | null;
  changes: Record<string, { from: unknown; to: unknown }>;
  actor_email: string | null;
  note: string | null;
  source: string;
  external: boolean;
};

function auditSetupHint(status: number) {
  return status === 404 || status === 406
    ? "ops.config_audit not reachable — run supabase/config_audit_setup.sql, then add `ops` to Supabase → Settings → API → Exposed schemas."
    : `status ${status}`;
}

export async function listAudit(options: { table?: string; rowId?: string; limit?: number } = {}) {
  const params = ["select=*", "order=at.desc", `limit=${Math.min(options.limit ?? 200, 1000)}`];
  if (options.table) params.push(`table_name=eq.${encodeURIComponent(options.table)}`);
  if (options.rowId) params.push(`row_id=eq.${encodeURIComponent(options.rowId)}`);

  const res = await request(`config_audit?${params.join("&")}`, { schema: "ops" });
  if (!res.ok) throw new Error(auditSetupHint(res.status));

  return (res.body as Omit<AuditEntry, "external">[]).map((row) => ({
    ...row,
    external: !row.actor_email,
  }));
}

export async function annotateAudit(input: {
  table: string;
  rowId: string;
  newUpdatedAt?: string;
  actorEmail: string;
  note: string;
}): Promise<{ annotated: boolean; reason?: string }> {
  if (!input.newUpdatedAt) return { annotated: false, reason: "no_updated_at" };

  const query =
    `config_audit?table_name=eq.${encodeURIComponent(input.table)}` +
    `&row_id=eq.${encodeURIComponent(input.rowId)}` +
    `&new_updated_at=eq.${encodeURIComponent(input.newUpdatedAt)}`;

  try {
    const res = await request(query, {
      schema: "ops",
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        actor_email: input.actorEmail,
        note: input.note || null,
        source: "dashboard",
      }),
    });
    if (!res.ok) return { annotated: false, reason: auditSetupHint(res.status) };
    return { annotated: Array.isArray(res.body) && res.body.length > 0 };
  } catch (error) {
    return { annotated: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
