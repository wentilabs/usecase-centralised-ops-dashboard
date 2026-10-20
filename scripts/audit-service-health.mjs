import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What each service actually writes, read through HALO's own classifier.
 *
 * The data-health documentation says what a service SHOULD record; this says what
 * each one DOES, from the live run logs, so the two can be compared and the gap is
 * a number instead of an opinion. It reads only — one SELECT per run log — and
 * prints nothing from the data but statuses and error sentences.
 *
 *     node scripts/audit-service-health.mjs [days]        (default 14)
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY, from the environment or `.env`.
 *
 * Per service and status it reports how often it was written, the colour HALO gives
 * it and WHY (declared by the service, a naming rule, a late-reading line, or not
 * recognised), and flags the three things that make a colour untrustworthy:
 *
 *   COLOUR-WITHOUT-EVIDENCE  amber or red with no error written. A reader is told
 *                            something is wrong and given nothing to search for.
 *   GREEN-BUT-HAS-ERRORS     a status HALO reads as fine that wrote errors anyway:
 *                            a problem hiding under a reassuring name.
 *   UNRECOGNISED             a status no rule covers, shown amber so it is not hidden.
 *
 * Then, for Noise and WBGT, how many `completed_with_…` runs were nothing but late
 * readings — the share HALO shows as `stale` (dark green) instead of amber.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const days = Number(process.argv[2]) || 14;

function loadEnv() {
  const env = { ...process.env };
  const file = path.join(root, ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !env[match[1]]) env[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return env;
}
const env = loadEnv();
const URL_ = (env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = env.SUPABASE_SECRET_KEY || "";
if (!URL_ || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required (environment or .env).");
  process.exit(1);
}

// HALO's classifier is TypeScript; the test build is how it is run outside Next.
const dist = path.join(root, ".test-dist/lib/health-status.js");
if (!existsSync(dist)) {
  execFileSync("npx", ["tsc", "-p", "tsconfig.test.json"], { cwd: root, stdio: "ignore" });
}
const require = createRequire(import.meta.url);
const { colourForStatus, colourForRun } = require(dist);
const { logLines } = require(path.join(root, ".test-dist/lib/log-lines.js"));

// [service, schema, table, status column, error column, time column]
const SOURCES = [
  ["haze", "haze", "haze_job_runs", "status", "errors", "started_at"],
  ["issueChaser", "issue_chaser", "job_runs", "status", "errors", "started_at"],
  ["ailytics", "ailytics", "job_runs", "status", "errors", "started_at"],
  ["noise", "noise-meters", "noise_job_runs", "status", "errors", "started_at"],
  ["wbgt", "wbgts", "wbgt_job_runs", "status", "errors", "started_at"],
  ["subcon", "manpower_activity", "job_runs", "status", "errors", "started_at"],
  ["lightning", "lightning", "lightning_events", "delivery_status", "last_delivery_error", "created_at"],
];
const since = new Date(Date.now() - days * 864e5).toISOString();

async function readAll(schema, table, select, timeColumn, extra = "") {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const response = await fetch(
      `${URL_}/rest/v1/${table}?select=${select}&${timeColumn}=gte.${since}${extra}&order=${timeColumn}.desc`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Accept-Profile": schema, Range: `${from}-${from + 999}` } },
    );
    if (!response.ok) return { status: response.status };
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000 || rows.length >= 60000) return { rows };
  }
}

const shape = (line) => line.replace(/\d+/g, "N").slice(0, 110);

for (const [service, schema, table, statusColumn, errorColumn, timeColumn] of SOURCES) {
  const read = await readAll(schema, table, `${statusColumn},${errorColumn},project_code`, timeColumn);
  if (!read.rows) {
    console.log(`\n## ${service}: unreadable (HTTP ${read.status})`);
    continue;
  }
  const byStatus = new Map();
  for (const row of read.rows) {
    const status = String(row[statusColumn] ?? "").trim();
    const entry = byStatus.get(status) ?? { count: 0, withErrors: 0, messages: new Map(), noProject: 0 };
    entry.count += 1;
    const lines = logLines(row[errorColumn]);
    if (lines.length) entry.withErrors += 1;
    for (const line of new Set(lines)) entry.messages.set(shape(line), (entry.messages.get(shape(line)) ?? 0) + 1);
    if (!row.project_code) entry.noProject += 1;
    byStatus.set(status, entry);
  }

  console.log(`\n## ${service}  (${table}, ${read.rows.length} rows, ${days} days)`);
  for (const [status, entry] of [...byStatus].sort((a, b) => b[1].count - a[1].count)) {
    const verdict = colourForStatus(service, status);
    const flags = [];
    if (verdict.colour !== "green" && !entry.withErrors && !/^(skipped|running)/.test(status)) flags.push("COLOUR-WITHOUT-EVIDENCE");
    if (verdict.colour === "green" && entry.withErrors) flags.push("GREEN-BUT-HAS-ERRORS");
    if (verdict.basis === "unrecognised") flags.push("UNRECOGNISED");
    if (entry.noProject) flags.push(`NO-PROJECT×${entry.noProject}`);
    console.log(
      `  ${(status || "(blank)").padEnd(46)} ${String(entry.count).padStart(6)}  ${verdict.colour.padEnd(5)} ${verdict.basis.padEnd(12)} errors ${String(entry.withErrors).padStart(5)}  ${flags.join(" ")}`,
    );
    if ((entry.withErrors && verdict.colour !== "green") || flags.includes("GREEN-BUT-HAS-ERRORS")) {
      for (const [message, count] of [...entry.messages].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
        console.log(`        ×${String(count).padStart(5)}  ${message.split("\n")[0]}`);
      }
    }
  }
}

console.log(`\n## Late readings: how much of each service's amber is the sensor being behind`);
for (const [service, schema, table, statusColumn, errorColumn, timeColumn] of SOURCES.filter(([name]) => name === "noise" || name === "wbgt")) {
  const read = await readAll(schema, table, `${statusColumn},${errorColumn}`, timeColumn, `&${statusColumn}=like.completed_with*`);
  if (!read.rows) continue;
  const counts = { stale: 0, amber: 0 };
  const stillAmber = new Map();
  for (const row of read.rows) {
    const lines = logLines(row[errorColumn]);
    const colour = colourForRun(service, row[statusColumn], lines).colour;
    counts[colour] = (counts[colour] ?? 0) + 1;
    if (colour === "amber") for (const line of new Set(lines)) stillAmber.set(shape(line), (stillAmber.get(shape(line)) ?? 0) + 1);
  }
  const total = read.rows.length;
  console.log(`  ${service}: ${total} completed_with_… runs → ${counts.stale} stale (${total ? Math.round((counts.stale / total) * 100) : 0}%), ${counts.amber} amber`);
  for (const [message, count] of [...stillAmber].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    console.log(`        still amber ×${String(count).padStart(5)}  ${message.split("\n")[0]}`);
  }
}
