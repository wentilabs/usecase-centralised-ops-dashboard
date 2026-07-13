"use strict";

/**
 * Ops dashboard server — zero dependencies.
 * Reads project configs from Supabase (both schemas) via PostgREST,
 * serves the static UI, and persists UI-managed links to links.store.json.
 * Supabase config is READ-ONLY; only the local links store is ever written.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------- env ----------
loadDotEnv(path.join(__dirname, ".env"));

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const PORT = Number(process.env.PORT || 5178);
const SCHEMAS = {
  wbgt: { schema: process.env.WBGT_SCHEMA || "wbgts", table: "wbgt_project_configs" },
  noise: { schema: process.env.NOISE_SCHEMA || "noise-meters", table: "noise_project_configs" },
};
const LINKS_STORE = path.join(__dirname, "links.store.json");

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
      const [wbgtRes, noiseRes] = await Promise.allSettled([fetchConfigs("wbgt"), fetchConfigs("noise")]);
      const store = readStore();
      const attach = (usecase, rows) =>
        rows.map((row) => ({ ...row, _links: store[`${usecase}:${row.project_code}`] || [] }));
      return json(res, 200, {
        fetchedAt: new Date().toISOString(),
        wbgt: wbgtRes.status === "fulfilled" ? attach("wbgt", wbgtRes.value) : { error: String(wbgtRes.reason) },
        noise: noiseRes.status === "fulfilled" ? attach("noise", noiseRes.value) : { error: String(noiseRes.reason) },
        headerLinks: {
          wbgt: { ...defaultHeaderLinks("wbgt"), ...(store["header:wbgt"] || {}) },
          noise: { ...defaultHeaderLinks("noise"), ...(store["header:noise"] || {}) },
        },
      });
    }

    // PUT /api/header/:usecase — set/clear one header quick-link URL
    const headerSet = u.pathname.match(/^\/api\/header\/(wbgt|noise)$/);
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
    const linkAdd = u.pathname.match(/^\/api\/links\/(wbgt|noise)\/([^/]+)$/);
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
    const linkDel = u.pathname.match(/^\/api\/links\/(wbgt|noise)\/([^/]+)\/([^/]+)$/);
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
