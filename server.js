"use strict";

/**
 * Ops dashboard server — zero dependencies.
 *
 * The dashboard is the control surface for both alert systems' project
 * configs: it reads them from Supabase (both schemas) via PostgREST and
 * writes edits back, validated against the live schema, guarded against
 * concurrent external edits, and recorded in an append-only audit log.
 *
 * Files written locally: links.store.json (UI links) and audit.log.jsonl
 * (every config change, with before/after values).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { buildFieldSpec } = require("./lib/field-spec");

// ---------- env ----------
loadDotEnv(path.join(__dirname, ".env"));

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const PORT = Number(process.env.PORT || 5178);
// Every centralised alert service, one entry each. idColumn is the row
// identity used for reads and PATCHes — ailytics keys on a uuid `id` while the
// rest key on project_code.
const SCHEMAS = {
  wbgt: { schema: process.env.WBGT_SCHEMA || "wbgts", table: "wbgt_project_configs", idColumn: "project_code", label: "WBGT" },
  noise: { schema: process.env.NOISE_SCHEMA || "noise-meters", table: "noise_project_configs", idColumn: "project_code", label: "Noise" },
  haze: { schema: process.env.HAZE_SCHEMA || "haze", table: "haze_project_configs", idColumn: "project_code", label: "Haze" },
  lightning: { schema: process.env.LIGHTNING_SCHEMA || "lightning", table: "lightning_project_configs", idColumn: "project_code", label: "Lightning" },
  ailytics: { schema: process.env.AILYTICS_SCHEMA || "ailytics", table: "project_configs", idColumn: "id", label: "Ailytics" },
};
const USECASES = Object.keys(SCHEMAS);
const USECASE_RE = USECASES.join("|");
const LINKS_STORE = path.join(__dirname, "links.store.json");
const AUDIT_LOG = path.join(__dirname, "audit.log.jsonl");

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

// ---------- supabase (PostgREST, read-only) ----------
async function fetchConfigs(usecase) {
  const { schema, table } = SCHEMAS[usecase];
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&order=project_code.asc`;
  // (project_code exists on every config table, including ailytics, so it is
  // always a valid sort key even where it isn't the identity.)
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Accept-Profile": schema,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${usecase} fetch failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ---------- schema introspection ----------
// PostgREST publishes an OpenAPI doc describing every column: type, format,
// default, and pg-enum values. Cached per process; the curated overlay in
// lib/field-spec.js adds labels/grouping and CHECK-constraint value lists.
const schemaCache = {};

async function fetchFieldSpec(usecase) {
  if (schemaCache[usecase]) return schemaCache[usecase];
  const { schema, table } = SCHEMAS[usecase];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Accept-Profile": schema,
    },
  });
  if (!res.ok) throw new Error(`${usecase} schema fetch failed: ${res.status}`);
  const doc = await res.json();
  const props = (doc.definitions?.[table]?.properties) || {};
  const introspected = {};
  for (const [name, p] of Object.entries(props)) {
    introspected[name] = { type: p.type, format: p.format, enum: p.enum || null, default: p.default };
  }
  schemaCache[usecase] = buildFieldSpec(usecase, introspected);
  return schemaCache[usecase];
}

// ---------- config writes ----------
// Coerce a value coming from the browser into what Postgres expects, and
// reject anything the schema cannot accept. Empty string → null so clearing
// a text field blanks the column rather than storing "".
function coerceValue(field, raw) {
  // Postgres array columns (e.g. lightning detection types) arrive as an array
  // of option codes. Empty stays an empty array so a NOT NULL / cardinality
  // CHECK reports the real reason rather than a null error.
  if (field.type === "array" || field.widget === "multi") {
    const arr = Array.isArray(raw)
      ? raw
      : String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (field.options) {
      for (const v of arr) {
        if (!field.options.includes(v)) {
          throw new Error(`${field.name}: "${v}" is not one of ${field.options.join(", ")}`);
        }
      }
    }
    return arr;
  }
  if (raw === null || raw === undefined || raw === "") return null;
  if (field.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    throw new Error(`${field.name}: expected true/false`);
  }
  if (field.type === "integer" || field.type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${field.name}: expected a number`);
    if (field.type === "integer" && !Number.isInteger(n)) throw new Error(`${field.name}: expected a whole number`);
    return n;
  }
  const s = String(raw).trim();
  if (field.options && !field.options.includes(s)) {
    throw new Error(`${field.name}: "${s}" is not one of ${field.options.join(", ")}`);
  }
  if (field.widget === "hhmm" && !/^\d{4}$/.test(s)) throw new Error(`${field.name}: expected HHMM, e.g. 0730`);
  return s;
}

async function fetchOneConfig(usecase, rowId) {
  const { schema, table, idColumn } = SCHEMAS[usecase];
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&${idColumn}=eq.${encodeURIComponent(rowId)}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, "Accept-Profile": schema },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function patchConfig(usecase, rowId, patch, baseUpdatedAt) {
  const { schema, table, idColumn } = SCHEMAS[usecase];
  const params = [`${idColumn}=eq.${encodeURIComponent(rowId)}`];
  // Optimistic concurrency: only write if the row still looks like what the
  // editor loaded. A 0-row result means somebody (or something) changed it
  // in between — surfaced to the user rather than silently overwritten.
  if (baseUpdatedAt) params.push(`updated_at=eq.${encodeURIComponent(baseUpdatedAt)}`);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params.join("&")}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Profile": schema,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ---------- audit log (append-only, local) ----------
function appendAudit(entry) {
  fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + "\n");
}

function readAudit({ usecase = null, projectCode = null, limit = 200 } = {}) {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  const lines = fs.readFileSync(AUDIT_LOG, "utf8").split("\n").filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
    try {
      const e = JSON.parse(lines[i]);
      if (usecase && e.usecase !== usecase) continue;
      if (projectCode && e.project_code !== projectCode) continue;
      out.push(e);
    } catch (_) {
      /* skip malformed line */
    }
  }
  return out;
}

// Default header links (user-overridable via UI). Supabase table editor URL
// is derived from the project ref in SUPABASE_URL.
function defaultHeaderLinks(usecase) {
  const ref = (SUPABASE_URL.match(/^https?:\/\/([^.]+)\.supabase\.co/) || [])[1];
  const { schema, table } = SCHEMAS[usecase];
  return {
    supabase: ref
      ? `https://supabase.com/dashboard/project/${ref}/editor?schema=${encodeURIComponent(schema)}#${table}`
      : "",
  };
}

// ---------- links store (the only thing this app writes) ----------
function readStore() {
  try {
    return JSON.parse(fs.readFileSync(LINKS_STORE, "utf8"));
  } catch {
    return {}; // { "<usecase>:<project_code>": [{id,label,url,note}] }
  }
}
function writeStore(store) {
  const tmp = LINKS_STORE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, LINKS_STORE);
}

// ---------- http helpers ----------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 64 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  try {
    // GET /api/projects — live read of both schemas + merged manual links
    if (req.method === "GET" && u.pathname === "/api/projects") {
      const settled = await Promise.allSettled(USECASES.map((u) => fetchConfigs(u)));
      const store = readStore();
      const payload = { fetchedAt: new Date().toISOString(), meta: {}, headerLinks: {} };
      USECASES.forEach((usecase, i) => {
        const { idColumn, label } = SCHEMAS[usecase];
        payload.meta[usecase] = { label, idColumn };
        payload.headerLinks[usecase] = { ...defaultHeaderLinks(usecase), ...(store[`header:${usecase}`] || {}) };
        const r = settled[i];
        payload[usecase] = r.status === "fulfilled"
          ? r.value.map((row) => ({ ...row, _links: store[`${usecase}:${row[idColumn]}`] || [] }))
          : { error: String(r.reason) };
      });
      return json(res, 200, payload);
    }

    // GET /api/schema — field spec for both use-cases (types, enums, groups)
    if (req.method === "GET" && u.pathname === "/api/schema") {
      const specs = await Promise.all(USECASES.map((u) => fetchFieldSpec(u)));
      return json(res, 200, Object.fromEntries(USECASES.map((u, i) => [u, specs[i]])));
    }

    // GET /api/audit?usecase=&project=&limit= — recent config changes
    if (req.method === "GET" && u.pathname === "/api/audit") {
      return json(res, 200, {
        entries: readAudit({
          usecase: u.searchParams.get("usecase"),
          projectCode: u.searchParams.get("project"),
          limit: Math.min(Number(u.searchParams.get("limit") || 200), 1000),
        }),
      });
    }

    // PATCH /api/config/:usecase/:project — apply validated config changes
    const cfgPatch = u.pathname.match(new RegExp(`^/api/config/(${USECASE_RE})/(.+)$`));
    if (req.method === "PATCH" && cfgPatch) {
      const usecase = cfgPatch[1];
      const projectCode = decodeURIComponent(cfgPatch[2]);
      const { changes = {}, baseUpdatedAt = null, note = "" } = JSON.parse((await readBody(req)) || "{}");

      const spec = await fetchFieldSpec(usecase);
      const before = await fetchOneConfig(usecase, projectCode);
      if (!before) return json(res, 404, { error: `${projectCode} not found` });

      // Validate + coerce every field before touching the database.
      const patch = {};
      const rejected = [];
      for (const [name, raw] of Object.entries(changes)) {
        const field = spec.fields[name];
        if (!field) { rejected.push(`${name}: unknown column`); continue; }
        if (field.readonly) { rejected.push(`${name}: read-only`); continue; }
        try {
          patch[name] = coerceValue(field, raw);
        } catch (err) {
          rejected.push(err.message);
        }
      }
      if (rejected.length) return json(res, 400, { error: "Invalid changes", rejected });
      if (!Object.keys(patch).length) return json(res, 400, { error: "No changes supplied" });

      // Drop no-ops so the audit log only records real transitions.
      const effective = {};
      for (const [name, value] of Object.entries(patch)) {
        if (JSON.stringify(before[name] ?? null) !== JSON.stringify(value)) effective[name] = value;
      }
      if (!Object.keys(effective).length) {
        return json(res, 200, { ok: true, unchanged: true, row: before });
      }

      let rows;
      try {
        rows = await patchConfig(usecase, projectCode, effective, baseUpdatedAt);
      } catch (err) {
        return json(res, 502, { error: `Supabase rejected the change: ${err.message}` });
      }
      if (!rows.length) {
        const current = await fetchOneConfig(usecase, projectCode);
        return json(res, 409, {
          error: "This project changed in Supabase since you opened the editor — reload and re-apply.",
          current,
        });
      }

      const after = rows[0];
      const entry = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        usecase,
        project_code: projectCode,
        note: String(note || "").slice(0, 500),
        changes: Object.fromEntries(
          Object.keys(effective).map((k) => [k, { from: before[k] ?? null, to: after[k] ?? null }]),
        ),
      };
      appendAudit(entry);
      console.log(
        `[config] ${usecase}/${projectCode} ${Object.keys(effective).map((k) => `${k}=${JSON.stringify(after[k])}`).join(" ")}`,
      );
      return json(res, 200, { ok: true, row: after, entry });
    }

    // PUT /api/header/:usecase — set/clear one header quick-link URL
    const headerSet = u.pathname.match(new RegExp(`^/api/header/(${USECASE_RE})$`));
    if (req.method === "PUT" && headerSet) {
      const { key, url: href } = JSON.parse((await readBody(req)) || "{}");
      if (!key || !/^[a-z_]+$/.test(key)) return json(res, 400, { error: "bad key" });
      const storeKey = `header:${headerSet[1]}`;
      const store2 = readStore();
      const links = { ...(store2[storeKey] || {}) };
      if (href) links[key] = String(href).slice(0, 2000);
      else delete links[key];
      if (Object.keys(links).length) store2[storeKey] = links;
      else delete store2[storeKey];
      writeStore(store2);
      return json(res, 200, { ok: true });
    }

    // POST /api/links/:usecase/:project — add a manual link or note
    const linkAdd = u.pathname.match(new RegExp(`^/api/links/(${USECASE_RE})/([^/]+)$`));
    if (req.method === "POST" && linkAdd) {
      const { label, url: href, note } = JSON.parse((await readBody(req)) || "{}");
      if (!label || (!href && !note)) return json(res, 400, { error: "need label plus url or note" });
      const key = `${linkAdd[1]}:${decodeURIComponent(linkAdd[2])}`;
      const store = readStore();
      const entry = { id: crypto.randomUUID(), label: String(label).slice(0, 120) };
      if (href) entry.url = String(href).slice(0, 2000);
      if (note) entry.note = String(note).slice(0, 2000);
      store[key] = [...(store[key] || []), entry];
      writeStore(store);
      return json(res, 200, { ok: true, entry });
    }

    // DELETE /api/links/:usecase/:project/:id — remove a manual link
    const linkDel = u.pathname.match(new RegExp(`^/api/links/(${USECASE_RE})/([^/]+)/([^/]+)$`));
    if (req.method === "DELETE" && linkDel) {
      const key = `${linkDel[1]}:${decodeURIComponent(linkDel[2])}`;
      const store = readStore();
      const before = (store[key] || []).length;
      store[key] = (store[key] || []).filter((l) => l.id !== linkDel[3]);
      if (store[key].length === 0) delete store[key];
      writeStore(store);
      return json(res, 200, { ok: true, removed: before - (store[key] || []).length });
    }

    // static files
    if (req.method === "GET") {
      let p = u.pathname === "/" ? "/index.html" : u.pathname;
      const file = path.join(__dirname, "public", path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
      if (file.startsWith(path.join(__dirname, "public")) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        return fs.createReadStream(file).pipe(res);
      }
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Ops dashboard → http://localhost:${PORT}`);
  console.log(`Schemas: wbgt=${SCHEMAS.wbgt.schema}, noise=${SCHEMAS.noise.schema} (read-only)`);
});
