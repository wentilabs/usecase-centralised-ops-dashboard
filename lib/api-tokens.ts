import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bearer credentials for the agent-facing API.
 *
 * Pure functions only — no I/O, so the parsing and scope rules are testable
 * without a database. `lib/config-repository.ts` does the lookup.
 *
 * The plaintext token is never stored anywhere: `ops.api_tokens` holds only the
 * SHA-256 hash, and the hash is what a request is resolved by. A leak of that
 * table therefore yields no usable credential.
 */

export const SCOPES = ["read", "write", "jobs"] as const;
export type Scope = (typeof SCOPES)[number];

/** Recognisable at a glance in a log or a leaked config, and greppable. */
export const TOKEN_PREFIX = "halo_";

export type TokenRecord = {
  id: string;
  name: string;
  scopes: string[];
  revoked_at: string | null;
};

export type TokenIdentity = {
  /** Written to ops.config_audit as the actor, so agent writes are attributable. */
  actor: string;
  scopes: Scope[];
  tokenId: string;
};

/**
 * The bearer token in a request, or null.
 *
 * Deliberately strict: only `Authorization: Bearer <token>`, only a token with
 * our prefix. A malformed header is treated as absent rather than as an error,
 * so a browser session with an unrelated Authorization header still works.
 */
export function bearerFrom(headerValue: string | null | undefined): string | null {
  const raw = String(headerValue ?? "").trim();
  const match = /^Bearer\s+(\S+)$/i.exec(raw);
  if (!match) return null;
  const token = match[1];
  return token.startsWith(TOKEN_PREFIX) && token.length > TOKEN_PREFIX.length + 20 ? token : null;
}

/** The lookup key for a plaintext token. Never reversible. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Compare two hex hashes without leaking timing.
 *
 * The lookup is by hash so the database has already done an equality match, but
 * a second constant-time compare costs nothing and keeps the property true if
 * the lookup ever changes to fetch-then-compare.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/** A record's scopes, dropping anything unrecognised rather than trusting it. */
export function scopesOf(record: TokenRecord): Scope[] {
  return (record.scopes ?? []).filter(isScope);
}

export function isRevoked(record: TokenRecord, now: Date = new Date()): boolean {
  if (!record.revoked_at) return false;
  const at = new Date(record.revoked_at).getTime();
  return Number.isFinite(at) && at <= now.getTime();
}

/**
 * Whether a set of scopes permits an operation.
 *
 * Scopes are additive and NOT hierarchical: `write` does not imply `read`, and
 * `jobs` implies neither. That is deliberate — a token that may trigger a
 * WhatsApp-sending job should not automatically be able to read every project's
 * configuration, and making it explicit keeps a minted token's power obvious
 * from its scope list alone.
 */
export function permits(scopes: Scope[], required: Scope): boolean {
  return scopes.includes(required);
}

/** The scope an HTTP method needs, before any per-route override. */
export function scopeForMethod(method: string): Scope {
  return method.toUpperCase() === "GET" ? "read" : "write";
}
