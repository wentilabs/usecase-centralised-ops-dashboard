import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the dashboard's loading time goes, measured rather than guessed.
 *
 *     node scripts/measure-load.mjs [baseUrl]        (default http://localhost:5178)
 *
 * Needs the app running (for the first three) and SUPABASE_URL / SUPABASE_SECRET_KEY (for the last).
 * Read-only: it requests pages and runs SELECTs. `POST /api/data-health/refresh` is called once, to
 * measure a COLD read, and that only discards HALO's own caches.
 *
 *   1. the page itself            time to first byte, which is what "upfront loading" means
 *   2. the deferred loads         /api/data-health and /api/project-strips, cold and from cache
 *   3. the strips, per service    the dominant cost, split by service, with request counts
 *   4. the sort that costs a second   a query ordered by started_at against one that is not
 *
 * Number 4 is the one that found the problem: ordering a run log by `started_at` costs 0.7–1.5 s however
 * few rows it returns, because there is no index on it, while the same query unordered takes 0.18 s.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.argv[2] || "http://localhost:5178").replace(/\/+$/, "");

function env() {
  const out = { ...process.env };
  const file = path.join(root, ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !out[match[1]]) out[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return out;
}
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = env();

const ms = (n) => `${String(Math.round(n)).padStart(6)} ms`;
async function timed(url, init) {
  const started = performance.now();
  const response = await fetch(url, init);
  const firstByte = performance.now() - started;
  const body = await response.arrayBuffer();
  return { status: response.status, firstByte, total: performance.now() - started, bytes: body.byteLength };
}

console.log(`\n1. the page — ${base}/`);
for (let run = 1; run <= 4; run += 1) {
  const result = await timed(`${base}/`, { headers: { "Accept-Encoding": "gzip" } });
  console.log(`   run ${run}: first byte ${ms(result.firstByte)}  total ${ms(result.total)}  ${(result.bytes / 1024).toFixed(0)} KB over the wire  HTTP ${result.status}${run === 1 ? "   (the first run may include compiling)" : ""}`);
}

console.log(`\n2. the deferred loads`);
const refresh = await timed(`${base}/api/data-health/refresh`, { method: "POST" });
console.log(`   everything, cold (POST /api/data-health/refresh): ${ms(refresh.total)}  HTTP ${refresh.status}`);
for (const route of ["/api/data-health", "/api/project-strips"]) {
  const warm = await timed(`${base}${route}`);
  console.log(`   ${route.padEnd(22)} from cache: ${ms(warm.total)}  ${(warm.bytes / 1024).toFixed(0)} KB`);
}

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.log("\n3–4 skipped: SUPABASE_URL and SUPABASE_SECRET_KEY are not set.");
  process.exit(0);
}

const dist = path.join(root, ".test-dist/lib/process-log.js");
if (!existsSync(dist)) execFileSync("npx", ["tsc", "-p", "tsconfig.test.json"], { cwd: root, stdio: "ignore" });
const { readProcessWindow, PROCESS_SERVICES } = createRequire(import.meta.url)(dist);

let requests = 0;
let bytes = 0;
const request = async (route, init) => {
  requests += 1;
  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${route}`, {
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, "Accept-Profile": init.schema },
  });
  const text = await response.text();
  bytes += text.length;
  return { ok: response.ok, body: response.ok ? JSON.parse(text) : text };
};

console.log(`\n3. the strips, service by service (100 bars each, 48 hours)`);
const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
let sum = 0;
for (const service of PROCESS_SERVICES) {
  const before = { requests, bytes };
  const started = performance.now();
  const bars = await readProcessWindow(service, request, 100, since);
  const took = performance.now() - started;
  sum += took;
  console.log(`   ${service.padEnd(12)} ${ms(took)}  ${String(requests - before.requests).padStart(2)} requests  ${String(Math.round((bytes - before.bytes) / 1024)).padStart(5)} KB  ${bars.length} bars`);
}
console.log(`   ${"sum".padEnd(12)} ${ms(sum)}`);

console.log(`\n4. the sort — the same table, ordered and not (Noise's run log)`);
const probe = async (label, query) => {
  const started = performance.now();
  await request(`noise_job_runs?${query}`, { schema: "noise-meters" });
  console.log(`   ${label.padEnd(44)} ${ms(performance.now() - started)}`);
};
for (let run = 0; run < 2; run += 1) {
  await probe("newest 1 row, ordered by started_at", "select=started_at&order=started_at.desc&limit=1");
  await probe("1000 rows, NOT ordered", `select=started_at&started_at=gte.${since}&limit=1000`);
  await probe("1000 rows, ordered by started_at", `select=started_at&started_at=gte.${since}&order=started_at.desc&limit=1000`);
}
console.log("\nIf the ordered queries are several times slower than the unordered one, the table has no index on started_at:");
console.log("see docs/PERFORMANCE.md for the two statements that fix it.\n");
