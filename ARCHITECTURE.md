# Architecture

HALO is the configuration control surface for seven independently deployed
services. This guide maps its local ownership boundaries. The family-wide
migration contract is in `docs/SERVICE_FAMILY_ARCHITECTURE.md`; `AGENTS.md`
records the detailed operational invariants.

## Stability contract

- Live PostgREST schema introspection remains the discovery source. Curated
  metadata enriches it; it must not become a hardcoded replacement.
- Configuration writes go directly to production and retain validation,
  read-only filtering, no-op removal, optimistic concurrency, and audit
  annotation in that order.
- Audit history remains database-triggered so direct Supabase edits are visible.
- Node-side authorization fails closed. API-token permissions are enforced by
  the same HTTP routes whether called directly or through MCP.
- Local loopback auth bypass remains development-only. It must never admit a
  bearer request or apply in production.
- Service schema/table/key names and job payload shapes are external contracts;
  HALO adapts to them rather than normalizing them at runtime.

## Runtime flow

```text
browser / API token / MCP
  -> Next App Router route
  -> session + route policy
  -> config/job/onboarding application module
  -> live schema + curated semantics
  -> Supabase or service endpoint adapter
  -> database-triggered audit history
```

MCP is a translation of the OpenAPI contract back into HALO's own HTTP API. It
is not a privileged second implementation.

## Ownership map

| Concern | Owner | Direction |
| --- | --- | --- |
| UI routes and server handlers | `app/` | Keep handlers thin; call application modules. |
| Reusable UI | `components/` | Split large service-specific views from shared primitives. |
| Schema/config repository | `lib/config-repository.ts`, `lib/supabase/` | Preserve live introspection and server-only secrets. |
| Field semantics | `lib/field-spec/providers/`, merged by `lib/field-spec.ts` | Each service owns one semantic provider; the merger combines it with live introspection and service-contract snapshots. |
| Runtime-state audit filtering | `lib/job-state-policy.ts` | Typed pure policy shared by field read-only rules and history display. |
| Validation/coercion | `lib/config-values.ts`, constraint modules | Pure and exhaustive. |
| Auth/route policy | `lib/auth-policy.ts`, `lib/route-policy.ts` | Pure policy with Node-side enforcement. |
| Cards/search/summaries | `lib/card-summary/`, exported by `lib/card-summary.ts` | Group resolution, search, links, emphasis, and diffs have explicit owners; pills and schedule/cadence semantics are service-owned providers. |
| Jobs/exports | `lib/jobs.ts`, export modules | Registries with exact service payload builders. |
| Onboarding/chat planning | `lib/onboarding/providers/`, `lib/onboarding/`, `lib/chat-onboard.ts` | Definitions, validation, schema enrichment, value resolution, and insert planning have explicit owners; next isolate model interpretation. |
| Agent contract | `lib/openapi.ts`, `lib/mcp.ts` | One OpenAPI source, mechanically mapped to tools. |

## Sources of truth

- Column existence/types/defaults/enums: live PostgREST OpenAPI schema.
- Column meaning, grouping, conditional display, CHECK options, and read-only
  classification: curated metadata, migrating to service-owned snapshots.
- SQL baseline, lifecycle classification, ordering, supersession, and explicit
  destructive preconditions: service-owned migration plans vendored at the same
  immutable commit as each service contract.
- Configuration values: each service's Supabase configuration table.
- Change history: `ops.config_audit` database triggers.
- API/agent operations: `lib/openapi.ts`, checked against route handlers and
  committed YAML.
- Cross-repository target: `docs/SERVICE_FAMILY_ARCHITECTURE.md`.

## Safe extension rules

- Add a service through one service registry plus its contract snapshot,
  repository mapping, UI semantics, audit trigger, and tests.
- Add a field in the owning service first. HALO introspection makes it visible;
  semantic metadata then supplies label, help, group, constraints, and
  read-only classification.
- Add a job as a registry entry with an exact per-endpoint payload builder and
  precondition. Do not invent a common payload across incompatible services.
- Add a model-assisted operation as propose/review only; deterministic code
  validates and executes through existing API routes.
- Add an agent operation to OpenAPI first and mechanically expose it through
  MCP; never hand-maintain a second tool contract.

## Highest-priority decomposition

1. **Complete:** field semantics live in one provider per service behind a small
   merger and live-introspection fallback.
2. **Complete:** service definitions, validation, schema enrichment, value
   resolution, and disabled-row planning are separate named modules behind the
   stable `lib/onboarding.ts` façade. Route-level persistence remains the
   deliberate side-effect boundary.
3. Split `chat-onboard.ts` into interpretation, deterministic resolution, and
   proposal models.
4. **Complete:** `card-summary.ts` is a compatibility façade over named concern
   modules. Every service owns both its pill provider and its schedule/cadence
   provider; shared helpers contain formatting and cross-service mechanics only.
5. Decompose `LightningMap.tsx` into map state, geometry, data loading, and
   presentational components while retaining pure geometry tests.
6. **Complete:** versioned service-contract and SQL-evolution snapshots share
   one immutable upstream revision and a controlled refresh/check script.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. Tests must keep auth,
scope, route/OpenAPI/MCP parity, config validation, audit behavior, mobile
contracts, service semantics, exact job payloads, onboarding safety, and model
proposal non-mutation. Production-like writes use disabled projects and are
reverted with an audit note.

Run `npm run contracts:check` to verify both the service contract and SQL
evolution plan for every service against one pinned upstream commit. Refresh is
explicit and service-scoped with `npm run contracts:refresh -- <service...>`;
never copy either artifact by hand or pin them to different revisions.
