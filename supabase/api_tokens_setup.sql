-- =============================================================================
-- ops.api_tokens — machine credentials for the agent-facing API.
--
-- HALO's browser auth is a Supabase session cookie behind a Turnstile CAPTCHA.
-- An agent has no browser and cannot pass a CAPTCHA, so it needs a second
-- identity path. This is it.
--
-- Design notes that matter:
--
--   * The token itself is NEVER stored. Only its SHA-256 hash is, so a leak of
--     this table does not leak usable credentials. The plaintext is shown once,
--     at mint time, and cannot be recovered afterwards.
--   * Scopes are explicit and additive: 'read', 'write', 'jobs'. A token with
--     only 'read' cannot change configuration however the API is called, which
--     is the whole reason for issuing per-agent tokens rather than one shared
--     secret.
--   * `name` is an identity, not a label. It is written into ops.config_audit as
--     the actor for anything this token changes — so an agent's writes are
--     better attributed than a human editing Supabase directly, which records
--     no actor at all.
--   * Revocation is a timestamp, not a delete, so an expired token's history
--     still resolves to a name.
--
-- Idempotent. Run once in the Supabase SQL editor.
-- =============================================================================

create schema if not exists ops;

create table if not exists ops.api_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- SHA-256 of the plaintext token, hex encoded. The token is never stored.
  token_hash text not null unique,
  scopes text[] not null default array['read']::text[]
    check (cardinality(scopes) > 0 and scopes <@ array['read','write','jobs']::text[]),
  note text,
  created_at timestamptz not null default now(),
  created_by text,
  last_used_at timestamptz,
  -- Set to revoke. Kept rather than deleted so past audit rows still resolve.
  revoked_at timestamptz
);

create index if not exists api_tokens_hash_idx on ops.api_tokens (token_hash) where revoked_at is null;

-- Only the service role may read these. There is no policy for anon or
-- authenticated: a browser must never be able to enumerate credentials, even
-- hashed ones.
alter table ops.api_tokens enable row level security;
revoke all on ops.api_tokens from anon, authenticated;
grant select, insert, update on ops.api_tokens to service_role;

-- Inspect (never shows a usable token):
--   select name, scopes, created_at, last_used_at, revoked_at from ops.api_tokens order by created_at desc;
-- Revoke:
--   update ops.api_tokens set revoked_at = now() where name = '<name>';
