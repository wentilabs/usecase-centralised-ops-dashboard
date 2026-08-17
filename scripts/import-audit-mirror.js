#!/usr/bin/env node
"use strict";

/**
 * One-off: carry the local audit.log.jsonl history into ops.config_audit.
 *
 * The Postgres trigger only starts recording once it exists, so changes made
 * before the migration live only in the local mirror. This inserts them as
 * source='imported' rows so the shared history reaches back to day one.
 *
 * Usage:
 *   node scripts/import-audit-mirror.js            # dry run, prints what it would do
 *   node scripts/import-audit-mirror.js --apply
 */

const fs = require("fs");
const path = require("path");

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

loadDotEnv(path.join(__dirname, "..", ".env"));

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const STATE_DIR = process.env.STATE_DIR || path.join(__dirname, "..");
const MIRROR = path.join(STATE_DIR, "audit.log.jsonl");
const APPLY = process.argv.includes("--apply");

// Older mirror entries recorded the usecase, not the table name.
const TABLE_BY_USECASE = {
  wbgt: "wbgt_project_configs",
  noise: "noise_project_configs",
  haze: "haze_project_configs",
  lightning: "lightning_project_configs",
  ailytics: "project_configs",
};
const SCHEMA_BY_USECASE = {
  wbgt: "wbgts",
  noise: "noise-meters",
  haze: "haze",
  lightning: "lightning",
  ailytics: "ailytics",
};

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY missing");
  if (!fs.existsSync(MIRROR)) {
    console.log(`No mirror at ${MIRROR} — nothing to import.`);
    return;
  }

  const rows = [];
  for (const line of fs.readFileSync(MIRROR, "utf8").split("\n").filter(Boolean)) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      console.warn("skipping malformed line");
      continue;
    }
    const usecase = e.usecase || null;
    rows.push({
      at: e.at,
      schema_name: SCHEMA_BY_USECASE[usecase] || "unknown",
      table_name: e.table_name || TABLE_BY_USECASE[usecase] || "unknown",
      row_id: e.row_id || e.project_code || "unknown",
      project_code: e.project_code || e.row_id || null,
      changes: e.changes || {},
      actor_email: e.actor_email || null,
      note: e.note || null,
      source: "imported",
    });
  }

  console.log(`${rows.length} mirror entr${rows.length === 1 ? "y" : "ies"} from ${MIRROR}`);
  for (const r of rows) {
    console.log(`  ${r.at}  ${r.table_name}/${r.row_id}  ${Object.keys(r.changes).join(",")}  ${r.actor_email || "-"}`);
  }
  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to insert these into ops.config_audit.");
    return;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/config_audit`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Profile": "ops",
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `insert failed: ${res.status} ${text.slice(0, 300)}\n` +
        "Has supabase/config_audit_setup.sql been run, and is `ops` an exposed schema? " +
        "Note the setup grants select+update (not insert) — grant insert to service_role for this import, then revoke.",
    );
  }
  console.log(`Imported ${JSON.parse(text).length} rows.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
