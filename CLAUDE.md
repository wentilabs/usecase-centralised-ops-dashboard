# CLAUDE.md

See **[AGENTS.md](./AGENTS.md)** — it is the single source of truth for what
this repo is, its architecture decisions, conventions and known traps. This
file only adds notes specific to working here interactively.

## Before you touch anything

- **Writes hit production.** This app edits the live configuration that six
  centralised services read on a cron. If you need to test a write, pick a project
  with `enabled = false`, change one field, verify, and revert it in the same
  session. Say plainly which project you touched.
- **Check the branch.** `main` may still hold the older zero-dependency Node
  version; the Next.js app lives on its own branch. Confirm with
  `git branch --show-current` before assuming a file layout.

## Working style that fits this repo

- **Verify with the live system rather than by reading.** The Supabase
  credentials in `.env` are real: introspect the schema, query a row, run
  `npm run dev` and drive the UI. Several bugs here were only visible at
  runtime (Edge vs Node environment access, `[hidden]` losing to an id
  selector, a stale process serving a moved directory).
- **State what you could not verify.** Anything touching the auth project
  (sign-in, CAPTCHA, OTP) cannot be exercised without its keys; say so rather
  than implying it was tested.
- **Prefer one honest diagnostic over a guess.** When something is denied or
  missing, add or read a boolean that reveals which side is blind — that is how
  the allow-list problem was finally isolated.

## The lightning map

The ⚡ button on the lightning actions row opens an evidence map: NEA detections
against each project's real trigger rings, at a chosen time. It is read-only and
open to read-only accounts. Before changing anything in it, read the
**Singapore lightning map** section of AGENTS.md — the four load-bearing
decisions there (publish time, widened rings, a separate evidence query, and the
detection-type filter) are each the fix for a specific way the map can lie to a
client, and trap 14 records the one that actually happened.

## Giving an agent access

**[AGENT_ACCESS.md](./AGENT_ACCESS.md)** — the OpenAPI contract at
`/openapi.json`, the MCP endpoint at `/api/mcp`, how to mint and revoke a bearer
token, and what each scope does. On loopback the dev bypass grants all three
scopes, so the examples there run without a token.

## Useful commands

```bash
npm run dev                                  # localhost:5178, auth bypassed on loopback
curl -s localhost:5178/api/session           # who am I, and can the server see the allow-list
curl -s -X POST localhost:5178/api/schema/reload   # pick up columns added to Supabase
npm test                                     # includes the Amplify deployment contract
```
