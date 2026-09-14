# Centralised Service Family Architecture

This is the migration contract for the seven centralised services and HALO. It
describes the architecture they should converge on without requiring a rewrite
or changing production behavior.

## Scope and source branches

The service refactors start from the latest `main` branch:

- Ailytics CCTV safety tracking
- Haze alerts
- Issue Chaser
- Lightning alerts
- Subcon Activities / housekeeping
- Noise alerts
- WBGT and Water Parade

HALO starts from `feat/nextjs-port`, which is its current application branch.
Work is carried on `critical-refactor-for-maintainability` in every repository.

## Non-negotiable compatibility contract

Architecture work must preserve all of the following unless a later change is
separately approved and released as a behavior change:

1. Public endpoint paths and HTTP methods. External scheduler, webhook, and
   project-adapter configuration is not owned by these repositories, so an
   endpoint rename is a production breaking change.
2. Scheduled endpoint behavior. Schedules are configured externally; code may
   document a schedule but must not infer that it owns or can rename the rule.
3. Existing authentication modes. Where a service key is optional, a blank or
   absent key intentionally means open application-level access. This must be
   documented and tested, not silently hardened during a refactor. Deployment
   or gateway authentication remains a separate layer.
4. Payload aliases, response envelopes, status codes, idempotency keys, message
   shapes, database schema/table names, Google Sheet layouts, and retry rules.
5. Configuration defaults, including defaults that look unusual. A migration
   may make a default explicit but cannot reinterpret it.

Every migration step must be small enough to prove these properties with tests.
Moving code and changing behavior in the same commit is prohibited.

## Architectural objective

An engineer or coding agent should be able to answer five questions after
reading one architecture guide, one contract, and a focused test:

1. Which entrypoint receives the request or scheduled invocation?
2. Which application job coordinates the operation?
3. Which domain policy decides what should happen?
4. Which adapter performs each external read or write?
5. Which contract test prevents an accidental customer-visible change?

The repositories should share those concepts and names. They should not share
domain implementations merely to remove duplication.

## Target module grammar

New and migrated code should converge on this structure:

```text
src/
  entrypoints/
    lambda.ts
    local.ts
  transport/
    http/
      routes.ts
      router.ts
      request.ts
      response.ts
  application/
    jobs/
    services/
  domain/
    <bounded-context>/
      model.ts
      policies/
      renderers/
  ports/
    config-repository.ts
    state-repository.ts
    notification-channel.ts
    clock.ts
  adapters/
    supabase/
    google-sheets/
    whatsapp/
    telegram/
    <upstream-source>/
  config/
    environment.ts
    project-config.ts
  observability/
    log.ts
    errors.ts
test/
  contract/
  unit/
  scenario/
  integration/
supabase/
  schema.sql
  migrations/
docs/
  ARCHITECTURE.md
  CONFIGURATION.md
  OPERATIONS.md
```

This is a destination, not permission for a bulk move. Existing `api`,
`usecases`, `platform`, and `lib` directories remain valid while modules are
migrated behind stable contracts.

## Dependency rules

The intended dependency direction is:

```text
entrypoint -> transport -> application -> domain
                              |
                              v
                            ports <- adapters
```

- Domain modules are deterministic and do not read environment variables,
  clocks, databases, files, or the network.
- Application jobs own orchestration, idempotency order, and transaction-like
  sequences. They depend on ports, not concrete SDK clients.
- Adapters own third-party payloads, SDKs, HTTP calls, and persistence details.
- Transport owns API Gateway normalization, authentication, body validation,
  status codes, and response serialization.
- Entrypoints assemble dependencies and contain no business decisions.
- Configuration is parsed once at the boundary and passed as typed values.
- Logging is structured at application and adapter boundaries; domain policies
  return decisions rather than logging them.

Temporary deviations must be named in the local architecture guide so an agent
does not mistake transitional placement for the desired extension point.

## TypeScript decision

The target language for production and test code is strict TypeScript.
Migration should use compiled CommonJS first so language migration is not mixed
with a module-system or Lambda-packaging change.

Order of migration:

1. Add `tsconfig.json`, a type-check command, and build output ignored by Git.
2. Type boundary contracts first: route definitions, project configuration,
   domain decisions, port interfaces, and normalized third-party events.
3. Convert pure policies and renderers.
4. Convert application jobs after their dependencies have typed ports.
5. Convert adapters and entrypoints last.
6. Change module format only in a separate, fully tested decision.

Do not create broad `any`-typed facades to claim migration progress. At an
untyped boundary use `unknown`, validate it, and expose a narrow typed result.

## Public service contract

Each service will own one machine-readable contract containing:

- service key and display name;
- public routes, methods, purpose, and invocation kind (`scheduled`, `webhook`,
  `operator`, `diagnostic`, or `read`);
- current application authentication mode, including explicit open-when-empty
  behavior;
- Supabase schema, configuration table, and row identity;
- configuration fields with type, default, mutability, and semantic help;
- message-shape or strategy identifiers;
- state fields that HALO must never write;
- supported operator jobs and their exact payload shapes.

The executable route registry remains the runtime source of truth. Contract
tests compare it with the machine-readable document in both directions.

HALO must continue live PostgREST introspection for column discovery. Service
contracts enrich that schema with meaning; they must not replace it. A newly
deployed column therefore still appears immediately, while a missing semantic
description becomes a visible and testable documentation gap.

Because these are separate repositories, HALO will vendor versioned contract
snapshots with their source repository and commit recorded. An update script
will refresh them explicitly. Runtime requests must never depend on GitHub or a
second repository being available.

## Configuration ownership

Use these categories consistently:

- **Configuration:** values such as thresholds, recipients, schedules, source
  identifiers, sheet IDs, and feature enablement.
- **Policy:** interchangeable business decisions such as cadence eligibility,
  severity evaluation, closure validation, or aggregation.
- **Renderer:** a pure transformation from a domain result to a message or row.
- **Adapter:** infrastructure-specific I/O such as Supabase, Google Sheets,
  WhatsApp, Telegram, NEA, NoiseLynx, or OpenAI.
- **Runtime state:** delivery attempts, locks, last-alert values, issue status,
  and other values written by jobs. HALO treats these as read-only.

Customer names must not appear in policy identifiers. Legacy formatter aliases
may remain at the boundary, but normalize once to capability-based names and
test the alias until live data has been migrated.

## Database evolution

SQL cleanup is allowed when it improves ownership or removes genuinely unused
objects, but it follows expand-and-contract discipline:

1. Inventory live schemas, tables, functions, triggers, policies, indexes, and
   every code/query reference.
2. Capture the current DDL as a canonical baseline and add schema contract
   tests before editing it.
3. Add new structures without removing old readers or writers.
4. Backfill with measurable row-count and null checks.
5. Read from the new structure while dual-writing or retaining a reversible
   compatibility view where required.
6. Prove service tests, HALO schema ingestion, representative dry runs, and
   rollback.
7. Remove old structures only in a later release after production observation.

Do not rename a live schema or table for aesthetics. Historical names such as
`manpower_activity`, `noise-meters`, and the odd Noise column spelling are part
of deployed contracts until a specific migration proves otherwise.

## Verification layers

Every service should converge on the same test vocabulary:

- **Contract:** routes, methods, auth modes, payload aliases, config schema,
  message identifiers, adapter request/response shapes, and SQL parity.
- **Unit:** pure policy, parsing, normalization, rendering, and time rules.
- **Scenario:** end-to-end application flow with fake ports, including duplicate,
  stale, partial-failure, retry, disabled-project, and dry-run cases.
- **Integration:** opt-in live Supabase, Sheets, upstream, or listener checks.
- **Migration:** apply canonical schema plus every migration to an empty database,
  then upgrade a fixture representing the previous production version.

Deployment workflows must run all offline contract, unit, and scenario tests.
Live integration checks remain explicit release gates because credentials and
external side effects make them unsuitable for every CI run.

## Repository-specific migration order

### Ailytics

Highest priority is decomposing `usecases/ailytics_safety_tracking/index.js`.
Extract parsing and classification, correlation, activity lifecycle, issue
lifecycle, media retention, delivery, and closure validation one seam at a
time. Preserve the current fail-closed model decision, lossy references,
correlation order, and sheet-as-projection rule in scenario tests.

### Haze

Use this small service as the architecture pilot. Its route registry is the
first executable compatibility contract. Next isolate schedule eligibility,
report selection, and delivery state behind domain policies and repository /
notification ports. Preserve the documented non-side-effect-free hourly
`dryRun` behavior until it is changed as a separate product decision.

### Issue Chaser

Keep the Safety workbook as the snapshot boundary. Split selection, cadence,
routing, mention resolution, and delivery planning out of the central use case.
Operator token behavior remains optional when unset. The Novade-name writer
stays an explicit, narrow capability rather than a generic sheet editor.

### Lightning

Treat the existing engine, transitions, store, and delivery boundaries as the
family reference implementation. Reduce the remaining large tick/delivery
modules without replacing the proven state machine. Preserve scheduled
invocations with no HTTP method and optional `SERVICE_API_KEY` open mode.

### Subcon Activities

Separate housekeeping intake from the scheduled manpower/activity/reporting
capabilities inside the repository. Extract the large Lambda router and sheet
projection code behind capability-specific application services. Preserve its
historical schema and route names and its direct EventBridge event shapes.

### Noise

After the route contract, split workbook layout, workbook synchronization,
periodic summaries, message rendering, and scrape planning into bounded
contexts. The analysis workbook and sync modules are the largest reasoning
hotspots in the family; introduce characterization tests before each split.
Preserve every legacy formatter alias at the configuration boundary.

### WBGT and Water Parade

Keep one deployable service for now but make `wbgt` and `water-parade` explicit
bounded contexts. They may share delivery and persistence adapters, not domain
orchestration. Split the Water Parade central module by cycle, intake,
correlation, reminder, roster, and projection responsibilities.

### HALO

Keep Next.js, TypeScript, server-side authorization, live schema introspection,
optimistic concurrency, and database-triggered audit history. Split the large
field-spec, onboarding, chat-onboarding, card-summary, and map components by
service or policy. Merge service-owned contract metadata into introspection and
make missing labels/help/read-only classification visible in CI.

## Delivery sequence

1. Pin deployment verification and public routes.
2. Add this family contract and one local `ARCHITECTURE.md` per repository.
3. Define and validate the machine-readable service-contract schema.
4. Publish one pilot contract from Haze and consume its snapshot in HALO.
5. Add strict TypeScript scaffolding to Haze without changing emitted behavior.
6. Migrate Haze pure policies and use the result as the reference.
7. Apply the contract and TypeScript boundary pattern to the other services in
   risk order: Ailytics, Noise, WBGT, Subcon, Issue Chaser, Lightning.
8. Split HALO semantic metadata by service and source it from contract snapshots.
9. Establish canonical SQL baselines and migration tests before any cleanup.
10. Consider a shared package only after at least three repositories expose an
    identical, stable port whose duplication demonstrably increases reasoning
    cost. Domain policies remain local.

Each step is independently releasable and revertible. No step depends on a
flag-day conversion across repositories.
