# Repository-family architecture review

This is the decision record for the maintainability refactor. It evaluates the
seven production services and HALO as one architectural family. Repository-local
`ARCHITECTURE.md`, `AGENTS.md`, configuration references, message-shape
documents, executable route registries, service contracts, SQL, and tests are
the evidence behind it.

Review baseline:

- services: `critical-refactor-for-maintainability`, based on the latest
  `origin/main` obtained for this effort;
- HALO: `critical-refactor-for-maintainability`, based on
  `origin/feat/nextjs-port`;
- endpoint names and methods are compatibility contracts because schedules and
  webhooks are configured outside these repositories;
- open mode when an optional secret is blank is intentional. The review records
  it and tests it; it does not silently harden it;
- customer-visible behavior, messages, state transitions, payloads, and data
  ownership outrank structural uniformity.

## Family conclusion

The family has good domain knowledge and unusually strong characterization
tests, but its architectural grammar is implicit. Most services already contain
the right conceptual layers—transport, use case, pure policy, adapter,
repository, renderer—but use different names and allow several large
orchestrators to span those layers. The highest-value target is shared
conventions and contracts, not a shared runtime package.

The target dependency direction is:

```text
transport -> application -> domain
                  |           ^
                  v           |
                ports <--- adapters
```

Each repository stays independently deployable. A service-owned contract
describes routes, authentication posture, configuration fields, ownership, and
options. HALO vendors an immutable revision while live schema introspection
continues to decide which columns actually exist. TypeScript migration should
follow extraction seams, never precede them.

### Family risk ranking

| Rank | Risk | Why it matters to an LLM |
| --- | --- | --- |
| Critical | Large orchestration modules mix policy and side effects in Ailytics, Noise, WBGT/Water Parade, and Issue Chaser. | A local-looking edit can reorder persistence, delivery, correlation, or retries. |
| High | Configuration meaning historically lived in HALO, SQL, code, and prose independently. | An agent can edit the wrong source or present a dangerous field as ordinary configuration. |
| High | Similar routes use materially different auth modes, including intentional open mode. | “Standardizing security” can break schedules or remove a required HMAC. |
| High | SQL setup and upgrade migrations can describe different effective schemas. | A clean install may pass while production upgrade fails, or vice versa. |
| Medium | Folder names and boundaries differ across services. | Knowledge learned in one repository transfers poorly. |
| Medium | Infrastructure adapters often expose broad surfaces. | Tests need large mocks and application logic can depend on provider details. |
| Medium | JavaScript leaves normalized events, config, decisions, and write plans implicit. | Invalid states remain representable deep inside a workflow. |
| Low | Some historical names are awkward or misleading. | Renaming would create more risk than the local readability benefit unless expand-and-contract is justified. |

## 1. Ailytics CCTV safety tracking

### A–B. Intent and current architecture

The intended architecture is a central intake and issue-lifecycle service with
Supabase as state, Google Sheets as projection, thin project adapters, and an
LLM closure decision. The actual flow has clear entrypoints and adapters, but
`usecases/ailytics_safety_tracking/index.js` owns parsing, classification,
correlation, activity/issue lifecycle, retention, delivery, and closure
orchestration in roughly one reasoning unit.

### C–F. Maintainability, variability, modularity, consistency

Local reasoning is strong for status summaries and weak for the central safety
flow. Project variability is correctly data-driven. Positional parsing,
correlation precedence, lossy references, and closure rules are essential domain
differences, not candidates for family-wide generic helpers. Telegram,
WhatsApp, Sheets, storage, and OpenAI should implement narrow local ports using
the same names as sibling services.

### G. Risks

- **Critical:** changing the central module can alter several state machines.
- **High:** an unrecognized upstream status becomes compliant silently.
- **High:** model failure and a legitimate refusal both become `no_action`.
- **Medium:** mutable-looking projection and runtime fields invite edits in the
  wrong system.

### H–I. Target and incremental plan

Keep one deployment and existing schema. Characterize sequences first; extract
pure alert parsing/classification, ordered correlation, separate activity and
issue lifecycle services, retention policy, renderer, and closure port. Convert
each extracted seam to strict TypeScript, then type repositories and adapters;
convert the entrypoint last.

## 2. Haze alerts

### A–B. Intent and current architecture

Haze already aims at a conventional pipeline: route, API adapter, job, pure
band/message helpers, NEA/Supabase/WhatsApp adapters. It is the smallest and
clearest service and therefore the best family pilot.

### C–F. Maintainability, variability, modularity, consistency

Discoverability and blast radius are good. Configuration owns project,
schedule, region, threshold, and message variation. The remaining weakness is
that time eligibility, delivery policy, and broad Supabase access are not yet
expressed through typed contracts. Preserve the service-specific PSI/PM2.5
policies while standardizing route, config, repository, clock, renderer, and
notification vocabulary.

### G. Risks

- **High:** dispatcher method metadata is descriptive; enforcing it would be a
  behavior change.
- **Medium:** the hourly dry-run path has a historical side effect.
- **Medium:** broad persistence functions obscure which state a job may write.

### H–I. Target and incremental plan

Use Haze to prove strict TypeScript emitted as CommonJS without changing
`index.handler`. Type normalized readings, project config, decisions, ports,
and results; convert pure bands/messages/calendar rules; inject clock and ports
into jobs; convert adapters and composition last.

## 3. Issue Chaser

### A–B. Intent and current architecture

Issue Chaser reads Safety workbooks as issue snapshots, selects and renders
chasers or summaries, sends WhatsApp messages, and stores cadence/delivery
state. Health, previews, project checks, summaries, and Novade-name sync are
real separate capabilities even though central orchestration makes them appear
closer than they are.

### C–F. Maintainability, variability, modularity, consistency

Configuration and message styles are strong extension points. Selection,
routing, rendering, and delivery planning need explicit boundaries. Sheet
writes must remain capability-specific: Novade sync is a narrow PIC update, not
permission for a general workbook repository. Scheduled routes are open;
operator routes are open only when their optional token is absent.

### G. Risks

- **High:** a generalized Sheet abstraction could widen writes.
- **High:** optional operator auth is easy to “fix” incompatibly.
- **Medium:** selector, routing, and renderer changes share a large context.

### H–I. Target and incremental plan

Extract typed Safety rows, selection decisions, delivery plans, cadence policy,
renderer registry, and narrow Sheet write ports. Migrate each report capability
independently, keeping live integration tests opt-in and the scheduled routes'
payload defaults unchanged.

## 4. Lightning alerts

### A–B. Intent and current architecture

Lightning has the strongest existing domain architecture: a composition root,
normalized detections, a pure engine, explicit transitions, store adapter,
renderers, and use-case orchestration. Scheduled non-HTTP invocation, HTTP
suffix matching, SMS HMAC, and ordinary optional service auth coexist at the
transport boundary.

### C–F. Maintainability, variability, modularity, consistency

The engine gives excellent local reasoning and should be the state-machine
reference for the family. Large tick/delivery modules and a broad store remain
the main hotspots. Detection-source and message variation already have the
right conceptual extension points. Its special invocation and auth behavior
are legitimate domain/transport differences to preserve.

### G. Risks

- **High:** transport cleanup can break non-HTTP scheduled events or suffix
  matching.
- **High:** a unified auth middleware can erase the SMS/optional-key split.
- **Medium:** persistence and delivery breadth increases tick blast radius.

### H–I. Target and incremental plan

Retain the engine. Type detections, zones, transitions, route/auth metadata,
repository ports, and delivery outcomes. Split tick orchestration into load,
evaluate, persist, render, and notify stages; narrow the store; convert adapters
and entrypoints only after parity tests cover every invocation shape.

## 5. Subcon Activities

### A–B. Intent and current architecture

This service centralizes housekeeping intake and scheduled activity, manpower,
housekeeping, Sheet, and photo-refresh capabilities while project base services
retain Manpower/Machines ownership. Supabase is housekeeping state and the
HOUSEKEEPING tab is a projection with customer-owned cells that must survive.

### C–F. Maintainability, variability, modularity, consistency

Capability directories exist, but HTTP/EventBridge normalization and some
report/Sheet orchestration remain broad. `enabled`, `enable_housekeeping`, and
the per-report flags are intentionally independent and must not be normalized
into one family-wide meaning. Matching, aggregation, rendering, delivery, and
projection plans are the useful common vocabulary.

### G. Risks

- **Critical:** broad Sheet refactoring can overwrite preserved customer cells.
- **High:** collapsing independent flags changes live delivery behavior.
- **Medium:** LLM fallback can obscure deterministic matching ownership.

### H–I. Target and incremental plan

First characterize exact Sheet write ranges and direct scheduled inputs. Add a
thin route registry, normalized intake event, deterministic classification port,
report models, and pure projection plans. Type pure matching/aggregation and
rendering before the Sheet and persistence adapters.

## 6. Noise alerts

### A–B. Intent and current architecture

Noise combines NoiseLynx acquisition, raw readings, several assessment
cadences, limits management, client and ops delivery, and a complex analysis
workbook. Its route/API/use-case/platform shape is recognizable, but workbook
and synchronization modules combine calculation, layout, and remote mutation.

### C–F. Maintainability, variability, modularity, consistency

Message formatter and schedule configuration are extensive and appropriate.
Historical aliases and the quoted SQL identifier are compatibility facts, not
cleanup opportunities. The workbook is the largest reasoning-distance problem:
an agent must understand coordinates, formulas, existing content, and Google
operations together. Pure write plans would align it with the family grammar
without a shared Sheets runtime.

### G. Risks

- **Critical:** workbook edits can damage layout or formulas across projects.
- **High:** filtering meters at the wrong stage can lose stored evidence.
- **High:** schedule/window semantics differ subtly among cadences.
- **Medium:** broad browser and Sheets modules are difficult to mock locally.

### H–I. Target and incremental plan

Snapshot workbook plans and message outputs first. Split workbook layout,
formulas, ranges, and ordered writes; split sync into load/validate/plan/apply;
then extract cadence policies and one formatter registry. Type normalized
readings, limits, decisions, write plans, and ports before adapters.

## 7. WBGT and Water Parade

### A–B. Intent and current architecture

WBGT ingests scraped, NEA, Telegram, and WhatsApp readings; evaluates hourly
and edge-triggered five-minute behavior; persists state; renders advisories;
and delivers them. Successful hot top-of-hour delivery can create a separate
Water Parade lifecycle using rosters, confirmations, reminders, evidence, and
Sheet projection. These are two bounded contexts in one deployable service.

### C–F. Maintainability, variability, modularity, consistency

Pure threshold and transition modules are strong. The Water Parade central
module and hourly orchestration remain large. Shared boundaries do not imply a
shared state machine: hourly bands and five-minute zones must remain separate.
Source adapters can share a normalized reading contract; WBGT and Water Parade
should share infrastructure ports but not application internals.

### G. Risks

- **Critical:** Water Parade decomposition can alter correlation, delivery, or
  projection ordering.
- **High:** job-state columns look editable and change future decisions.
- **High:** route bodies fail closed on unknown keys because ignoring a scope
  key widens a live run.
- **High:** one external Telegram webhook requires HMAC while other routes are
  intentionally open or data-authorized.

### H–I. Target and incremental plan

Extract Water Parade cycle, intake, correlation, roster, reminder, media, and
projection services behind typed ports. Separately split hourly reading
selection, cadence, state, rendering, and delivery. Preserve exhaustive
threshold tests, strict request keys, the first-evaluation silence, and exact
delivery-to-cycle gate.

## 8. HALO ops dashboard

### A–B. Intent and current architecture

HALO is a live-schema-driven control plane for seven independent services. Its
Next.js routes serve the UI, token API, and MCP; deterministic application code
validates, plans, and writes; database triggers audit all changes. OpenAPI is the
single agent-operation source. Service semantics have historically been a
large curated map and now also come from pinned service-owned contracts.

### C–F. Maintainability, variability, modularity, consistency

HALO has strong tests and security boundaries. Field semantics and onboarding
definitions now live in one provider per service. Onboarding validation,
schema enrichment, value resolution, and disabled-row planning have named
generic modules behind a small façade. Card summaries now separate group
resolution, schedules, pills, search, links, emphasis, and diffs. Each service
owns its pill provider and its schedule/cadence provider; shared card helpers
contain cross-service mechanics only. Chat planning now separates its proposal
model, language/model-output interpretation, deterministic estate resolution
and draft construction, and prompt rendering behind a compatibility façade.
The remaining high context pressure is in the Lightning map. Live
introspection remains the existence/type/default authority while
contracts provide meaning, ownership, and options. The dashboard must adapt to
historical service schemas rather than force runtime renames.

### G. Risks

- **Critical:** a UI write path can mutate live production configuration.
- **High:** stale curated semantics can confidently mislead operators and LLMs.
- **High:** hardcoded snapshots without revision verification can drift.
- **Medium:** large registries make a service addition touch unrelated context.

### H–I. Target and incremental plan

Keep the Next.js/TypeScript base. Field semantics are now split per service and
service/SQL contracts have a controlled immutable refresh/check command, and
card pills plus schedule/cadence summaries are service-owned. Model
interpretation is also separated from deterministic proposal execution. Next,
decompose the map by state/geometry/loading/presentation. Never let a model
write directly.

## J. Concrete follow-up actions

Each task below is independently reviewable and must preserve public behavior.

| Repository / problem | Proposed change and files | Benefit | Risk / scope / dependencies |
| --- | --- | --- | --- |
| Ailytics central flow spans domains. | Add characterization scenarios, then extract parser/classifier, correlation, activity lifecycle, issue lifecycle, retention, and closure port from `usecases/ailytics_safety_tracking/index.js`. | Local reasoning; smaller additive extension points; family application/domain vocabulary. | **High / L /** sequence fixtures and current adapters first. |
| Ailytics model failure is operationally silent. | Add typed closure outcomes and observability at the application boundary without changing fail-closed behavior. | Distinguishes refusal from provider failure for agents and operators. | **Medium / S /** closure characterization; real model smoke remains explicit. |
| Haze is the TypeScript pilot. | Add strict TS build beside stable `index.js`; type contracts, then pure bands/messages/time policies and jobs. | Proves family migration mechanics at lowest risk. | **Medium / M /** emitted CommonJS parity and deployment test. |
| Haze persistence surface is broad. | Introduce reading, runtime, config, and event repository ports around `platform/supabase.js`. | Makes permitted writes visible in interfaces and tests. | **Medium / M /** typed models first. |
| Issue Chaser central orchestration mixes selection and effects. | Extract selector, routing policy, renderer, and delivery-plan modules from `usecases/issue_chaser`. | Feature additions become policy/renderer registration instead of central edits. | **High / M /** golden messages and cadence fixtures. |
| Issue Chaser Sheet writes could widen. | Define read snapshot and PIC-only write ports in `platform/sheets.js`. | Encodes least-authority behavior for humans and agents. | **High / S /** Novade sync tests. |
| Lightning tick/delivery is broad. | Retain `lib/engine.js`; split application stages and narrow `platform/store.js` ports. | Makes the best family state-machine architecture locally complete. | **Medium / M /** transition and delivery parity. |
| Lightning transport has three invocation/auth modes. | Type route metadata and transport decisions without unifying their semantics. | Prevents generic middleware from breaking schedules or SMS. | **High / S /** scheduled, HTTP, suffix, optional-key, and HMAC tests. |
| Subcon Sheet mutation is high blast radius. | Produce pure ordered projection plans, then apply through a narrow adapter. | Agents can test intended cells without Google access. | **High / L /** workbook fixtures and preservation snapshots. |
| Subcon flags look like a master hierarchy. | Add typed capability predicates for intake, housekeeping, and each report. | Makes independent behavior explicit and transferable. | **Medium / S /** existing gate truth tables. |
| Noise workbook mixes plan and apply. | Split `noise-analysis-workbook.js` and sync job into layout/formula/range plans plus mutation adapter. | Largest reduction in reasoning distance in Noise. | **High / L /** golden write plans and formulas. |
| Noise cadence implementations drift structurally. | Introduce normalized cadence inputs/decisions and a renderer registry while retaining distinct policies. | Shared grammar without forcing different rules together. | **Medium / M /** all boundary and alias tests. |
| WBGT and Water Parade share an oversized module boundary. | Extract Water Parade cycle/intake/correlation/roster/reminder/media/projection services. | Establishes two clear bounded contexts in one deployment. | **High / L /** lifecycle, correlation, and projection scenarios. |
| WBGT hourly flow mixes source, decision, state, and send. | Extract normalized reading selection, cadence decision, state-write plan, renderer, and notification port. | Additive sources/renderers; explicit state transitions. | **High / L /** threshold sweeps, strict-body and delivery-cycle tests. |
| HALO service semantics are monolithic. | Move each service's curated overrides to `lib/services/<service>/fields.ts`; retain a small contract/introspection merger. | A service change needs one local semantic provider. | **Medium / M /** field coverage and snapshot tests. |
| HALO contract snapshots can drift. | Add `contracts:check` and explicit `contracts:refresh` tooling that validates repository, SHA, schema, and byte equality. | Reproducible cross-repo updates and trustworthy provenance. | **Low / S /** all sibling checkouts available locally. |
| HALO onboarding and chat mix interpretation with execution. | Split service definitions, validation, row plans, model proposal, deterministic resolution, and persistence. | Models propose; deterministic code proves and executes. | **High / L /** current no-mutation and onboarding tests. |
| SQL evolution lacks one family gate. | For every service, add fresh-schema and fixture-upgrade checks; compare effective config columns to contract and HALO. | Makes additive SQL changes and eventual renames provable. | **High / L /** disposable Postgres/Supabase test runtime. |

## Migration gates

Every refactor slice must pass these gates before the old path is removed:

1. exact public routes, methods, payload aliases, and response shapes;
2. both blank and configured optional-auth modes, plus every mandatory signature;
3. golden message or ordered write-plan parity where customers see output;
4. state-transition, idempotency, retry, and partial-failure scenarios;
5. configuration contract versus effective SQL schema and HALO semantics;
6. fresh-schema and upgrade-fixture SQL checks for database changes;
7. repository test suite, deployment verification, and HALO test/typecheck/build;
8. an explicit live-smoke plan using only `TEST` or disabled projects.

This sequence deliberately standardizes documentation, contracts, terminology,
and verification before folder moves or runtime-library extraction. Shared code
is justified only after repeated local interfaces are stable and the dependency
would reduce, rather than increase, total reasoning distance.
