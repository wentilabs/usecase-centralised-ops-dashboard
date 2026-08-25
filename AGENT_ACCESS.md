# Giving an agent access to HALO

HALO's own UI is a browser app for people. This file is about the other door: an
HTTP API with a published contract, and an MCP endpoint, so a model can read and
change the same configuration under a credential you can revoke.

[AGENTS.md](./AGENTS.md) § *The agent-facing API* explains **why** each piece is
shaped the way it is. This file is **how to use it**.

## What is actually running

Three things, and only the first two are separate code paths:

| layer | where | what it is |
| --- | --- | --- |
| **HTTP API** | `app/api/**/route.ts` | The 13 endpoints. Everything else is a description of these. |
| **Contract** | `lib/openapi.ts` → `/openapi.json`, `/openapi.yaml` | OpenAPI 3.1, authored in TypeScript, committed as `openapi.yaml`. |
| **MCP** | `lib/mcp.ts` → `POST /api/mcp` | Tools **derived from the contract**, dispatched back through the HTTP API. |

The shape worth understanding: **MCP is not a second API.** A tool call becomes an
HTTP request to this same app, carrying the caller's own credential, so MCP can
never do something the HTTP API would refuse. One scope check in one route
handler governs both doors.

That is also why the contract is OpenAPI **3.1** rather than 3.0: in 3.1 a schema
object *is* JSON Schema 2020-12, which is exactly what an MCP tool's
`inputSchema` must be. So the tool list is a mechanical transform of the spec,
and there is one description of the API rather than two that drift.

```
agent ──bearer──▶ POST /api/mcp ──derives tools from──▶ lib/openapi.ts
                       │
                       └──re-issues the call as HTTP──▶ /api/config/... (scope check here)
```

## Getting a credential

```bash
node --env-file=.env scripts/mint-api-token.mjs reporting-bot read
node --env-file=.env scripts/mint-api-token.mjs ops-agent read,write,jobs "on-call automation"
```

The plaintext `halo_…` token is printed **once**. Only its SHA-256 hash reaches
`ops.api_tokens`, so a lost token is re-minted, never recovered.

Revoke by name:

```sql
update ops.api_tokens set revoked_at = now() where name = 'reporting-bot';
```

### Scopes

Additive and deliberately **not** hierarchical:

| scope | grants | does not grant |
| --- | --- | --- |
| `read` | every `GET` | anything else — holding `write` alone does not let you read |
| `write` | `PATCH`, and the `POST`s that are not jobs | reading, and running jobs |
| `jobs` | `POST /api/jobs/{job}` | anything else; checked *on top of* `write` |

`jobs` is separate because a job can make a service send WhatsApp messages to a
live construction site. A token allowed to do that should not thereby be able to
read every project's configuration.

The token's name becomes the audit actor (`agent:<name>`) on every config change,
which is stricter attribution than a person editing Supabase directly gets —
those record no actor at all.

**A bearer credential is resolved before the cookie path**, so an agent's
permissions never depend on browser session state and a bearer request can never
inherit the loopback dev bypass.

## The tools

| tool / operationId | HTTP | scope | notes |
| --- | --- | --- | --- |
| `getSession` | `GET /api/session` | read | Start here: it reports which scopes the credential carries. |
| `getSchema` | `GET /api/schema` | read | The column shape, **introspected from the live database**. Not fixed in the server. |
| `reloadSchema` | `POST /api/schema/reload` | write | Pick up columns added to Supabase since boot. |
| `listProjects` | `GET /api/projects` | read | Every service's rows. |
| `updateProjectConfig` | `PATCH /api/config/{service}/{rowId}` | write | The one that changes production. Idempotent. |
| `listAudit` | `GET /api/audit` | read | Who changed what. |
| `listGroupNames` | `GET /api/group-names` | read | WhatsApp group ids → current names. |
| `listNoiseMeters` | `GET /api/noise-meters` | read | |
| `getOnboardingRequirements` | `GET /api/onboard/{service}` | read | What a new project needs, per service. |
| `createProject` | `POST /api/onboard/{service}` | write | Creates the row (and readings table where a service needs one). |
| `geocodeAddress` | `GET /api/onboard/geocode` | read | OneMap lookup. Reaches outside. |
| `runExport` | `POST /api/exports/{export}` | write | Returns a **file**, not JSON — see below. |
| `runJob` | `POST /api/jobs/{job}` | jobs | **Destructive.** Not idempotent: a second call sends again. |

Annotations are derived from the operation rather than hand-declared, so a new
endpoint cannot be added without them. `runJob` is the only `destructiveHint`.
`updateProjectConfig` is *not* marked destructive — it overwrites a value rather
than destroying a record — and the description carries the weight instead.

## Worked examples

Every command below was run against `npm run dev` on `localhost:5178`, where the
loopback bypass grants all three scopes — which is why they work without a token
locally. Off loopback, add `-H "Authorization: Bearer halo_…"` to each.

Read what you are allowed to do:

```bash
curl -s -H "Authorization: Bearer halo_…" localhost:5178/api/session
```

Change one column, safely:

```bash
curl -s -X PATCH localhost:5178/api/config/wbgt/TJR \
  -H "Authorization: Bearer halo_…" -H "Content-Type: application/json" \
  -d '{"changes":{"enable_hourly":true},"baseUpdatedAt":"2026-08-25T15:07:00Z","note":"site went live"}'
```

`baseUpdatedAt` is the `updated_at` you read. Send it and a concurrent edit gets
you `409` instead of silently losing someone's change; omit it only when you
accept overwriting. `note` is stored in the audit trail. Only columns the schema
marks editable are accepted.

Speak MCP by hand:

```bash
curl -s -X POST localhost:5178/api/mcp \
  -H "Authorization: Bearer halo_…" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

```bash
curl -s -X POST localhost:5178/api/mcp \
  -H "Authorization: Bearer halo_…" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"listProjects","arguments":{}}}'
```

Discovery without a credential — the shape is not secret:

```bash
curl -s -X OPTIONS localhost:5178/api/mcp    # server info, protocol, tool count
curl -s localhost:5178/openapi.json | head
```

Point an MCP client at it. Anything that speaks streamable-HTTP MCP needs two
things — the URL `https://<host>/api/mcp` and an `Authorization: Bearer halo_…`
header. In Claude Code that is:

```bash
claude mcp add --transport http halo https://<host>/api/mcp --header "Authorization: Bearer halo_…"
```

## Things that will trip you up

- **There is no staging.** A write changes what a service does on its next cron
  tick. Try things on a project with `enabled = false`.
- **`runJob` is real.** It can send WhatsApp messages to a site and drive a
  browser session against CloudLynx.
- **Arguments are flat.** Path, query and body properties sit side by side —
  `{"service":"haze","rowId":"…","changes":{…}}` — because a model handles that
  far more reliably than a nested shape. Anything the operation does not declare
  is dropped rather than forwarded.
- **Exports do not come back over MCP.** A file response is described in words
  with its size, and you are told to call the endpoint directly; megabytes of
  base64 in a model's context helps nobody.
- **`GET /api/mcp` is a 405 on purpose.** The server is stateless JSON over POST
  — no SSE stream to open, and saying so beats hanging a client. Batched JSON-RPC
  requests are refused for the same reason.
- **The production server URL is not in the repo.** The `servers` list carries
  localhost plus, only when `HALO_PUBLIC_URL` is set, the real host. A guessed
  hostname in a contract an agent resolves is worse than a missing one.
- **The schema is live.** `getSchema` reflects Supabase as it is now, so a column
  added by a migration appears without a deploy — unlabelled, in an "Other"
  bucket, until HALO is taught about it.

## Keeping it honest

```bash
npm run openapi     # regenerate the committed openapi.yaml after editing lib/openapi.ts
npm test            # tests/openapi.test.ts and tests/mcp.test.ts
```

`tests/openapi.test.ts` asserts **both directions** — every route handler has an
operation and every operation has a handler — plus unique lowerCamelCase
`operationId`s, a real description on every operation, a documented 401, and that
the committed YAML is not stale. It also checks that declared parameter names are
the ones the handlers actually read, which is how two wrong query-parameter names
were found: they were only visible by *calling* the tools.

A spec describing endpoints that do not exist is worse than no spec, because an
agent acts on it.
