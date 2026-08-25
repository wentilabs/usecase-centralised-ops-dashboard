#!/usr/bin/env node
/**
 * Mint a bearer token for the agent-facing API.
 *
 *   node --env-file=.env scripts/mint-api-token.mjs <name> <scope,scope> ["note"]
 *   node --env-file=.env scripts/mint-api-token.mjs reporting-bot read
 *   node --env-file=.env scripts/mint-api-token.mjs ops-agent read,write,jobs "on-call automation"
 *
 * The plaintext token is printed ONCE and is not recoverable — only its SHA-256
 * hash reaches the database. Losing it means minting a new one and revoking the
 * old, which is the intended trade.
 *
 * Revoke with:
 *   update ops.api_tokens set revoked_at = now() where name = '<name>';
 */

import { createHash, randomBytes } from "node:crypto";

const SCOPES = ["read", "write", "jobs"];
const PREFIX = "halo_";

const [name, scopeArg, note] = process.argv.slice(2);

if (!name || !scopeArg) {
  console.error("Usage: mint-api-token.mjs <name> <read[,write][,jobs]> [note]");
  process.exit(1);
}

const scopes = scopeArg.split(",").map((s) => s.trim()).filter(Boolean);
const unknown = scopes.filter((s) => !SCOPES.includes(s));
if (unknown.length) {
  console.error(`Unknown scope(s): ${unknown.join(", ")}. Valid: ${SCOPES.join(", ")}`);
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(name)) {
  console.error("Name must be lowercase letters, digits and hyphens — it becomes the audit actor.");
  process.exit(1);
}

const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SECRET_KEY ?? "";
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required. Try --env-file=.env");
  process.exit(1);
}

const token = PREFIX + randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

const res = await fetch(`${url}/rest/v1/api_tokens`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Profile": "ops",
    "Content-Type": "application/json",
    Prefer: "return=representation",
  },
  body: JSON.stringify({
    name,
    token_hash: tokenHash,
    scopes,
    note: note ?? null,
    created_by: process.env.USER ?? null,
  }),
});

const body = await res.text();
if (!res.ok) {
  console.error(`Could not mint the token: ${res.status} ${body.slice(0, 300)}`);
  if (res.status === 404) console.error("Run supabase/api_tokens_setup.sql first.");
  if (/duplicate|unique/i.test(body)) console.error(`A token named "${name}" already exists — revoke it or pick another name.`);
  process.exit(1);
}

console.log(`\nMinted "${name}" with scopes: ${scopes.join(", ")}`);
console.log("\nThis is shown once and cannot be recovered:\n");
console.log(`  ${token}\n`);
console.log("Use it as:  Authorization: Bearer <token>");
console.log(`Audit actor: agent:${name}\n`);
