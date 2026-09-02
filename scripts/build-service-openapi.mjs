#!/usr/bin/env node
/**
 * Generate an `openapi.yml` for each centralised service repo.
 *
 * These are read-only spec sheets: something to open and see what a service
 * exposes, what each route takes, and what it will refuse. They are generated
 * rather than hand-written so they cannot drift — rerun after a route changes.
 *
 * The source of truth is the route's own docblock, indexed by the path the
 * docblock declares rather than by parsing seven different dispatch styles.
 * Where a route also declares `allowedKeys` (noise and WBGT, which reject
 * unknown body keys), that list wins for the parameter set and the docblock
 * supplies the prose — the code is what the request will actually be judged
 * against.
 *
 * A route dispatched in index.js with no docblock is reported, not invented.
 * Two repos have no route docs at all; they get a spec listing their routes
 * with that stated plainly, which is more useful than a confident guess.
 *
 *   node scripts/build-service-openapi.mjs            # write every repo
 *   node scripts/build-service-openapi.mjs --check    # report drift, write nothing
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import YAML from "yaml";

const ROOT = resolve(process.env.ESTATE_ROOT ?? "..");
const CHECK = process.argv.includes("--check");

const REPOS = [
  { dir: "usecase-wohhup-wbgt-alerts", title: "WBGT Alerts",
    blurb: "Wet-bulb globe temperature advisories, the 5-minute exceedance state machine, monthly sheet fill, and Water Parade." },
  { dir: "usecase-wohhup-noise-meter-alerts", title: "Noise Meter Alerts",
    blurb: "NoiseLynx scraping, the cadence assessments (5-minute, half-hourly, hourly), periodic summaries and sheet sync." },
  { dir: "usecase-haze-alerts", title: "Haze Alerts",
    blurb: "NEA PSI ingestion and the hourly regional haze advisory." },
  { dir: "usecase-lightning-alerts", title: "Lightning Alerts",
    blurb: "NEA lightning detections against each project's widened rings, episode tracking and evidence." },
  { dir: "usecase-issue-chaser", title: "Issue Chaser",
    blurb: "Reads a Safety workbook and chases open issues on per-severity cadences, plus read-only daily summaries." },
  { dir: "usecase-wohhup-coy-housekeeping-waterparade", title: "Subcon Activities",
    blurb: "Housekeeping intake from forwarded WhatsApp, and the morning manpower/activity reports." },
  { dir: "mdw-lambda-ailytics", title: "Ailytics",
    blurb: "Ailytics safety-tracking webhooks, Telegram relay and delivery retry." },
];

const DOCBLOCK = /\/\*\*(.*?)\*\//gs;
const HEADER = /^\s*\*?\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9/_{}-]*)\s*$/m;

/** Every .js file in a repo that is not a dependency or a test. */
function sourceFiles(dir) {
  const out = [];
  const walk = (path) => {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry === ".git" || entry === "test" || entry === "tests") continue;
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** Strip the leading ` * ` from a docblock body. */
function undecorate(block) {
  return block
    .split("\n")
    .map((line) => line.replace(/^\s*\*ances?\s?/, "").replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
}

/**
 * Split a docblock into the pieces a spec needs.
 *
 * Deliberately conservative: anything not recognised as a parameter or example
 * is kept as description text rather than dropped, so a warning about a route
 * that is not side-effect free survives into the spec.
 */
function parseDoc(block) {
  const text = undecorate(block);
  const lines = text.split("\n");
  const header = lines[0].trim();
  const [, method, path] = header.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/) ?? [];

  const params = [];
  const notes = [];
  const summaryLines = [];
  let mode = "summary";

  for (const raw of lines.slice(1)) {
    const line = raw.trimEnd();
    if (/^(Params|Optional JSON params|Shared params|Query params)/i.test(line)) { mode = "params"; continue; }
    if (/^Examples?\b/i.test(line)) { mode = "example"; continue; }
    if (/^(WARNING|NOTE|Returns|It never|A body)/i.test(line)) { mode = "notes"; notes.push(line); continue; }

    if (mode === "params") {
      const m = line.match(/^-\s+([A-Za-z0-9_\s/]+?)\s*:\s*(.*)$/);
      if (m) {
        const names = m[1].split("/").map((n) => n.trim()).filter(Boolean);
        const rest = m[2].trim();
        const typeMatch = rest.match(/^([A-Za-z|\[\]\s"'.]+?)\s*(?:—|--|—)\s*(.*)$/);
        params.push({
          names,
          type: (typeMatch ? typeMatch[1] : rest.split(/\s{2,}|—/)[0]).trim(),
          description: (typeMatch ? typeMatch[2] : "").trim(),
        });
        continue;
      }
      // A wrapped continuation line belongs to the parameter above it.
      if (params.length && /^\s{2,}\S/.test(raw)) {
        params[params.length - 1].description += " " + line.trim();
        continue;
      }
      if (!line.trim()) continue;
      mode = "notes";
    }
    if (mode === "summary") { summaryLines.push(line); continue; }
    if (mode === "notes" && line.trim()) notes.push(line);
  }

  const summary = summaryLines.join(" ").replace(/\s+/g, " ").trim();
  return { method, path, summary, params, notes: notes.join(" ").replace(/\s+/g, " ").trim() };
}

/** `handlerFn.allowedKeys = [...]` or `allowedKeys: [...]` — the enforced set. */
function allowedKeysFor(text, path) {
  const near = text.indexOf(path);
  const patterns = [/allowedKeys\s*=\s*\[([^\]]*)\]/g, /allowedKeys:\s*\[([^\]]*)\]/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (near === -1 || Math.abs(match.index - near) < 4000) {
        return match[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
    }
  }
  return null;
}

/**
 * Route facts from the repo's README tables.
 *
 * Several repos document their cron cadence and behaviour in a markdown table
 * and their docblocks carry only parameters — noise's route docblocks open
 * straight into "Optional JSON params". Without this the generated summary for
 * fifteen of its routes would be empty, which is the one thing a spec sheet
 * cannot be.
 */
function readmeFacts(dir) {
  const facts = new Map();
  let text;
  try { text = readFileSync(join(dir, "README.md"), "utf8"); } catch { return facts; }
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const pathCell = cells.find((c) => /`\s*(?:GET|POST|PUT|PATCH|DELETE)?\s*(\/[A-Za-z0-9/_-]+)\s*`/.test(c));
    if (!pathCell) continue;
    const path = pathCell.match(/(\/[A-Za-z0-9/_-]+)/)?.[1];
    if (!path) continue;
    const others = cells.filter((c) => c !== pathCell && !/^`?(GET|POST|PUT|PATCH|DELETE)`?$/i.test(c));
    // A cadence cell names a time or an interval; the behaviour cell is prose.
    const schedule = others.find((c) => /SGT|hourly|daily|minute|every |:\d\d|cron/i.test(c) && c.length < 120);
    const behaviour = others
      .filter((c) => c !== schedule && !/^`?yarn |^`?npm /.test(c))
      .sort((a, b) => b.length - a.length)[0];
    const existing = facts.get(path) ?? {};
    facts.set(path, {
      schedule: existing.schedule ?? (schedule ? schedule.replace(/`/g, "") : null),
      behaviour: existing.behaviour ?? (behaviour ? behaviour.replace(/`/g, "") : null),
    });
  }
  return facts;
}

/**
 * Last-resort summary, read off the path.
 *
 * Some routes are neither prose-documented nor on a cron, so neither the
 * docblock nor the README says what they are — the two sheet exports are
 * on-demand and open straight into `Params:`. A humanised path beats an empty
 * summary, and `x-summary-source` says which of the three it came from so a
 * reader knows what is authored and what is inferred.
 */
function summaryFromPath(path) {
  const tail = path.replace(/^\/(api\/)?/, "").replace(/[/_-]+/g, " ").trim();
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) + "." : path;
}

/**
 * The HTTP method index.js actually checks for a path.
 *
 * Assuming POST put `POST /version` and `POST /health` in three specs, which is
 * simply wrong — they are GET probes. Looks in the same statement as the path
 * rather than anywhere in the file, so an unrelated method check nearby cannot
 * claim it.
 */
function methodFor(indexText, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const match of indexText.matchAll(new RegExp(`[^\n]*['"]${escaped}['"][^\n]*`, "g"))) {
    const method = match[0].match(/\b(GET|POST|PUT|PATCH|DELETE)\b/);
    if (method) return method[1];
  }
  return "POST";
}

/** Infer a type for a key the code accepts but the docblock never described. */
function inferredType(name) {
  if (/^(dry_?run|force|debug|preflight|historical|simulate|skip|include|overwrite)/i.test(name)) return "boolean";
  if (/(_codes|Codes|_ids|Ids|dates|profiles)$/.test(name)) return "array";
  if (/(days|ms|minutes|hours|limit|max|count)$/i.test(name)) return "number";
  return "string";
}

function yamlString(value) {
  const s = String(value ?? "");
  if (!s) return '""';
  if (/[:#\-?*&!|>%@`{}\[\],\n"']/.test(s) || /^\s|\s$/.test(s)) {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  return s;
}

function openapiType(declared) {
  const t = String(declared || "").toLowerCase();
  if (t.includes("boolean")) return { type: "boolean" };
  if (t.includes("string[]") || t.includes("[]")) return { type: "array", items: { type: "string" } };
  if (t.includes("number") || t.includes("integer")) return { type: "number" };
  return { type: "string" };
}

const summaryReport = [];

for (const repo of REPOS) {
  const dir = join(ROOT, repo.dir);
  let files;
  try { files = sourceFiles(dir); } catch { summaryReport.push(`${repo.dir}: NOT FOUND, skipped`); continue; }

  const routes = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const [, block] of text.matchAll(DOCBLOCK)) {
      if (!HEADER.test(block)) continue;
      const doc = parseDoc(block);
      if (!doc.path) continue;
      doc.source = relative(dir, file);
      doc.enforced = allowedKeysFor(text, doc.path);
      routes.set(`${doc.method} ${doc.path}`, doc);
    }
  }

  const facts = readmeFacts(dir);
  const indexText = readFileSync(join(dir, "index.js"), "utf8");
  // Both quote styles: ailytics' dispatch uses single quotes throughout, and a
  // double-quote-only match silently found none of its six routes.
  const dispatched = [...new Set([...indexText.matchAll(/['"](\/[A-Za-z0-9/_-]+)['"]/g)].map((m) => m[1]))]
    .filter((p) => !p.startsWith("/logos"));
  const documented = new Set([...routes.values()].map((r) => r.path));
  const undocumented = dispatched.filter((p) => !documented.has(p));

  const lines = [];
  lines.push("# Generated by usecase-wohhup-ops-dashboard/scripts/build-service-openapi.mjs");
  lines.push("# Do not hand-edit — rerun the generator instead.");
  lines.push("#");
  lines.push("# Each route's summary carries x-summary-source saying where it came from:");
  lines.push("#   docblock  the route's own /** */ header, the most reliable");
  lines.push("#   readme    a cron/route table row in README.md");
  lines.push("#   path      inferred from the route name, because neither of the above");
  lines.push("#             described it. Treat these as placeholders.");
  lines.push("# x-accepted-keys, where present, is the enforced allowedKeys list from the");
  lines.push("# code — those routes reject any other body key with a 400.");
  lines.push("openapi: 3.1.0");
  lines.push("info:");
  lines.push(`  title: ${yamlString(repo.title + " — service API")}`);
  lines.push("  version: 1.0.0");
  lines.push(`  description: ${yamlString(repo.blurb)}`);
  lines.push("servers:");
  lines.push("  - url: https://<lambda-url>");
  lines.push(`    description: ${yamlString("AWS Lambda function URL. Outbound listener calls carry Authorization: Bearer $LAMBDA_AUTH_TLK_KEY.")}`);
  lines.push("paths:");

  // A repo with no route docblocks would otherwise emit `paths: {}`, the least
  // useful thing a spec sheet can say. List what index.js actually dispatches,
  // described from the README table where there is one, and let
  // x-parameters-undocumented carry the caveat.
  for (const path of undocumented) {
    const method = methodFor(indexText, path);
    routes.set(`${method} ${path}`, {
      method,
      path,
      summary: "",
      params: [],
      notes: "",
      source: "index.js",
      enforced: null,
      fromDispatchOnly: true,
    });
  }

  const ordered = [...routes.values()].sort((a, b) => a.path.localeCompare(b.path));
  if (!ordered.length) lines.push("  {}");

  for (const route of ordered) {
    lines.push(`  ${route.path}:`);
    lines.push(`    ${route.method.toLowerCase()}:`);
    const fact = facts.get(route.path) ?? {};
    // The docblock's prose wins; the README fills in where a docblock opens
    // straight into its parameter list.
    const source = route.summary ? "docblock" : fact.behaviour ? "readme" : "path";
    const summary = (route.summary || fact.behaviour || summaryFromPath(route.path))
      .replace(/\s+/g, " ")
      .trim();
    lines.push(`      summary: ${yamlString(summary.slice(0, 180))}`);
    lines.push(`      x-summary-source: ${source}`);
    const description = [route.summary || fact.behaviour, route.notes].filter(Boolean).join(" ").trim();
    // Only when it adds something beyond the summary already shown.
    if (description && description !== summary) lines.push(`      description: ${yamlString(description)}`);
    if (fact.schedule) lines.push(`      x-schedule: ${yamlString(fact.schedule)}`);
    lines.push(`      x-source-file: ${yamlString(route.source)}`);
    if (route.fromDispatchOnly) {
      lines.push("      x-parameters-undocumented: true");
      lines.push(
        `      x-note: ${yamlString("Found in index.js; this route carries no docblock, so no parameters are asserted here.")}`,
      );
    }
    if (route.enforced) {
      lines.push("      x-strict-body: true");
      lines.push(`      x-accepted-keys: [${route.enforced.map(yamlString).join(", ")}]`);
    }

    const named = route.params.flatMap((p) => p.names.map((n) => ({ ...p, name: n })));
    if (route.method !== "GET" && named.length) {
      lines.push("      requestBody:");
      lines.push("        required: false");
      lines.push("        content:");
      lines.push("          application/json:");
      lines.push("            schema:");
      lines.push("              type: object");
      if (route.enforced) lines.push("              additionalProperties: false");
      lines.push("              properties:");
      for (const p of named) {
        const t = openapiType(p.type);
        lines.push(`                ${p.name}:`);
        lines.push(`                  type: ${t.type}`);
        if (t.items) lines.push("                  items:\n                    type: string");
        if (p.description) lines.push(`                  description: ${yamlString(p.description)}`);
        if (route.enforced && !route.enforced.includes(p.name)) {
          lines.push(`                  x-documented-but-rejected: ${yamlString("named in the docblock but not in allowedKeys — the route would 400 on it")}`);
        }
      }
      const undocumentedKeys = (route.enforced ?? []).filter((k) => !named.some((p) => p.name === k));
      if (undocumentedKeys.length) {
        for (const key of undocumentedKeys) {
          const type = inferredType(key);
          lines.push(`                ${key}:`);
          lines.push(`                  type: ${type}`);
          if (type === "array") lines.push("                  items:\n                    type: string");
          lines.push(`                  description: ${yamlString("accepted by the route but not described in its docblock; type inferred from the name")}`);
        }
      }
    } else if (route.method !== "GET") {
      lines.push("      requestBody:");
      lines.push("        required: false");
      lines.push("        content:");
      lines.push("          application/json:");
      lines.push(`            schema: { type: object, description: ${yamlString("no parameters documented; an empty body is the scheduled call")} }`);
    }
    lines.push("      responses:");
    lines.push('        "200": { description: Success }');
    lines.push(
      route.enforced
        ? '        "400": { description: Rejected — an unknown body key, or a parameter the handler refused }'
        : '        "400": { description: Rejected — a parameter the handler refused }',
    );
    lines.push('        "500": { description: Handler failure }');
  }

  if (undocumented.length) {
    lines.push("x-undocumented-routes:");
    lines.push(
      `  description: ${yamlString("dispatched in index.js with no docblock; listed under paths with x-parameters-undocumented")}`,
    );
    // Nested under a key: a `description` mapping and a bare sequence at the
    // same indent is not valid YAML, and three specs parsed as broken before
    // this was caught.
    lines.push("  routes:");
    for (const path of undocumented.sort()) lines.push(`    - ${yamlString(path)}`);
  }

  const target = join(dir, "openapi.yml");
  const body = lines.join("\n") + "\n";

  // Parse before writing. Emitting a `description` mapping and a bare sequence
  // at the same indent produced three unparseable specs, and a spec sheet that
  // no tool can open is worse than none — the failure was invisible until
  // something tried to read it.
  let parsed;
  try {
    parsed = YAML.parse(body);
  } catch (error) {
    console.error(`\n${repo.dir}: generated YAML is invalid, nothing written.\n  ${error.message}`);
    process.exitCode = 1;
    continue;
  }
  const pathCount = Object.keys(parsed?.paths ?? {}).length;
  const missingSummary = Object.entries(parsed?.paths ?? {})
    .filter(([, ops]) => Object.values(ops).some((op) => !op.summary))
    .map(([path]) => path);
  if (missingSummary.length) {
    console.error(`${repo.dir}: no summary for ${missingSummary.join(", ")}`);
    process.exitCode = 1;
  }
  if (pathCount !== ordered.length) {
    console.error(`${repo.dir}: emitted ${ordered.length} routes but ${pathCount} parsed back`);
    process.exitCode = 1;
  }
  let existing = null;
  try { existing = readFileSync(target, "utf8"); } catch {}
  const changed = existing !== body;
  if (!CHECK && changed) writeFileSync(target, body);
  summaryReport.push(
    `${repo.dir.padEnd(46)} ${String(ordered.length).padStart(2)} routes` +
      (undocumented.length ? `, ${undocumented.length} undocumented` : "") +
      (CHECK ? (changed ? "  [DRIFT]" : "  [up to date]") : changed ? "  [written]" : "  [unchanged]"),
  );
}

console.log(summaryReport.join("\n"));
