# Data Health HALO Surface Implementation Plan

> **Superseded:** This optional-policy plan was replaced by
> `2026-09-26-automatic-wbgt-noise-health.md`. The approved pilot derives
> monitoring from existing WBGT and Noise configuration rows and does not
> create a `data_health` policy schema, setup flow, or migration.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HALO's configurable, read-safe Data Health surface: per-source-card status, a policy editor for dedicated operations recipients, and an estate-wide tab.

**Architecture:** Data Health remains outside `ServiceKey`. HALO reads and writes only `data_health.project_health_configs` through server-side repository functions, and reads the latest immutable observation per policy. Existing source cards receive a compact `Data health` row; when the schema, policy, or telemetry is absent, it renders a neutral state rather than a failure. The separately deployed runner and the remaining source-service delivery adapters are not part of this dashboard repository plan.

**Tech Stack:** Next 16 App Router, React 19, TypeScript, Tailwind 3, Supabase PostgREST with server-side secret.

**Spec:** `docs/superpowers/specs/2026-09-26-data-health-service-design.md`

## Global Constraints

- Do not add Data Health to the seven-member `ServiceKey` registry or change existing service onboarding.
- All HALO writes are production writes: policy rows begin disabled and are validated server-side.
- Keep `ops.outbound_delivery_events` server-only; no browser route exposes message or provider evidence.
- Data and delivery states are independent; `provider_accepted` is never labelled Delivered or Read.
- No configured policy, unavailable schema, or source without an event feed renders neutral `not monitored`, never red.
- Attach `ops.record_config_change('id')` to the policy table, but never to runner state/history tables.

## Review Focus

- A source code that happens to match another service must not be treated as the same policy; uniqueness is canonical-project ID plus source service. Tested in Task 1.
- A missing/unexposed `data_health` schema must leave the seven existing service tabs usable and show neutral state. Tested in Task 2.
- A read-only user may inspect status/history but must receive 403 for policy mutations. Tested in Task 3.
- A policy cannot enable without recipients and an applicable check, including delivery checks unsupported by the producer. Tested in Task 1 and Task 3.
- `provider_accepted`, pending, failed, delivered, and read must retain their distinct labels/colours. Tested in Task 1 and Task 4.

## File Structure

- `supabase/data_health_setup.sql` — additive schema, policy constraints, audit trigger attachment, and RLS/grants.
- `lib/data-health.ts` — pure policy/observation types, validation, badge mapping, and card-state derivation.
- `lib/data-health-repository.ts` — server-only PostgREST reads/writes for policy rows and latest observations.
- `app/api/data-health/route.ts` and `app/api/data-health/[id]/route.ts` — authenticated read/create/update routes.
- `components/DataHealthRow.tsx` — compact card row with independent data/delivery badges.
- `components/DataHealthPolicyDialog.tsx` — policy form with recipient group picker, disabled-by-default creation, and validation feedback.
- `components/DataHealthBoard.tsx` — estate-wide read view filtered by source service/state.
- `components/ProjectCard.tsx`, `components/ProjectSheet.tsx`, `components/DashboardShell.tsx`, and `app/page.tsx` — compose policy state into existing cards and a dedicated board without altering existing service tabs.
- `tests/data-health.test.ts`, `tests/data-health-route.test.ts`, `tests/data-health-ui-contract.test.ts` — pure, route, and rendering-contract coverage.

### Task 1: Define the policy contract and additive database migration

**Files:**
- Create: `supabase/data_health_setup.sql`
- Create: `lib/data-health.ts`
- Create: `tests/data-health.test.ts`

**Consumes:** canonical `ops.projects` identity and the seven existing `ServiceKey` values as an allowed source-service enum only.

**Produces:** `HealthPolicyDraft`, `HealthPolicy`, `HealthSnapshot`, `validateHealthPolicyDraft()`, and `healthBadge()` for later repository/UI tasks.

- [ ] **Step 1: Write failing pure contract tests** for disabled defaults, recipient/applicable-check enablement requirements, canonical/source uniqueness, and the exact `provider_accepted` label.
- [ ] **Step 2: Run `npm test -- --test-name-pattern=data-health`** and confirm the missing module/test fails.
- [ ] **Step 3: Implement `lib/data-health.ts`** with explicit source-service values, neutral/green/amber/red status mapping, and no delivery/read inference from provider acceptance.
- [ ] **Step 4: Add `supabase/data_health_setup.sql`** with `project_health_configs`, append-only observations/incidents/notification deliveries, `(canonical_project_id, source_service)` uniqueness, `enabled=false` default, audit trigger, and server-only grants. Do not apply it to production.
- [ ] **Step 5: Run `npm test -- --test-name-pattern=data-health`** and confirm the contract passes.
- [ ] **Step 6: Commit** with `feat: add data health policy contract`.

### Task 2: Add fail-closed, per-schema repository reads

**Files:**
- Create: `lib/data-health-repository.ts`
- Modify: `lib/config-repository.ts`
- Modify: `app/page.tsx`
- Test: `tests/data-health.test.ts`

**Consumes:** Task 1 policy types and the repository's server-only request pattern.

**Produces:** `listDataHealthPolicies()`, `listLatestHealthSnapshots()`, and `dataHealthAvailability()`; page props contain a policy/snapshot map plus an unavailable-neutral state.

- [ ] **Step 1: Add failing tests** that simulate policy reads, newest-observation selection, and a `PGRST106`/unreachable data-health schema.
- [ ] **Step 2: Run the focused test** and confirm it fails before the repository module exists.
- [ ] **Step 3: Implement `lib/data-health-repository.ts`** using the same secret-only timeout behavior as `config-repository`; settle Data Health reads independently so an unavailable schema never breaks service configs.
- [ ] **Step 4: Extend `app/page.tsx`** to pass a source-project lookup keyed by `(source service, source alias)` and a neutral availability result into the shell.
- [ ] **Step 5: Run focused tests** and confirm existing service rows still render when Data Health is unavailable.
- [ ] **Step 6: Commit** with `feat: read data health policy state safely`.

### Task 3: Add authenticated policy API and recipient configuration

**Files:**
- Create: `app/api/data-health/route.ts`
- Create: `app/api/data-health/[id]/route.ts`
- Create: `components/DataHealthPolicyDialog.tsx`
- Test: `tests/data-health-route.test.ts`

**Consumes:** Task 1 validation and Task 2 repository functions.

**Produces:** authenticated list/create/patch endpoints and a dialog that uses existing group-name aliases but stores comma-separated chat IDs.

- [ ] **Step 1: Write failing route tests** for unauthorized read, read-only write, invalid enablement, unknown columns, and optimistic-concurrency conflict.
- [ ] **Step 2: Run the route tests** and confirm they fail before routes exist.
- [ ] **Step 3: Implement the routes** using `getDashboardSession`, server-side validation/coercion, audit annotation, and the existing write-guard order. New policies insert disabled; only an editor can enable a validated policy.
- [ ] **Step 4: Implement `DataHealthPolicyDialog`** with Status, Data health, Delivery health, Sensitivity, and Operations delivery sections; use `GroupPicker` for recipient groups and do not expose raw outbound evidence.
- [ ] **Step 5: Run route tests** and confirm no write path exists for read-only users.
- [ ] **Step 6: Commit** with `feat: configure data health recipients`.

### Task 4: Compose card row, mobile detail, and estate board

**Files:**
- Create: `components/DataHealthRow.tsx`
- Create: `components/DataHealthBoard.tsx`
- Modify: `components/ProjectCard.tsx`
- Modify: `components/ProjectSheet.tsx`
- Modify: `components/DashboardShell.tsx`
- Test: `tests/data-health-ui-contract.test.ts`, `tests/mobile-contract.test.ts`

**Consumes:** policy/snapshot maps from Task 2 and the editor from Task 3.

**Produces:** a row below sheet/action links on every card, the same mobile detail content, and a dedicated Data Health board without changing source-service navigation semantics.

- [ ] **Step 1: Write failing UI-contract tests** for row placement below links, independent Data/Delivery labels, neutral unmonitored presentation, and the dedicated board being outside `ServiceKey`.
- [ ] **Step 2: Run focused UI tests** and confirm they fail before components exist.
- [ ] **Step 3: Implement `DataHealthRow`** using token-based green/amber/red/neutral styles, preserving label text such as `Delivery: Provider accepted` and `Delivery: not monitored`.
- [ ] **Step 4: Compose it into desktop cards and mobile `ProjectSheet`**, opening the policy dialog/history context without changing Edit, Sheets, or job controls.
- [ ] **Step 5: Implement `DataHealthBoard` and shell navigation** as a dedicated estate view, not an eighth service tab; read-only users can view it and editors can open policy configuration.
- [ ] **Step 6: Run `npm test`, `npm run typecheck`, and `npm run build`**; verify mobile contract remains satisfied.
- [ ] **Step 7: Commit** with `feat: show data health in HALO cards`.

### Task 5: Document production enablement and local preview

**Files:**
- Modify: `docs/superpowers/specs/2026-09-26-data-health-service-design.md`
- Modify: `DEPLOYMENT.md`
- Test: `tests/data-health-ui-contract.test.ts`

**Consumes:** Tasks 1–4.

**Produces:** a clear migration/enablement order and local inspection route with no Google Sheets writes.

- [ ] **Step 1: Add failing documentation assertions** for migration-before-policy creation, neutral state before source adapters emit events, and the MBS `Provider accepted` limitation.
- [ ] **Step 2: Run the focused documentation test** and confirm it fails.
- [ ] **Step 3: Document** deployment ordering: apply `data_health_setup.sql`, expose only the policy schema to PostgREST, run audit setup, deploy HALO, configure policies disabled, enable after recipient validation; do not expose event history to browser users.
- [ ] **Step 4: Run full checks and start `npm run dev`** for a local card/board inspection. Do not invoke Google Sheet jobs or the live MBS E2E.
- [ ] **Step 5: Commit** with `docs: describe data health HALO enablement`.

## Self-Review

**Spec coverage:** Tasks 1–4 cover policy identity, neutral safe states, recipients/cooldowns/mutes, card/mobile/board surfaces, audit, source-event privacy, and delivery label honesty. The runner's scheduled scans and source-specific adapters remain independently deployable work; Task 5 makes that boundary explicit.

**Type consistency:** `HealthPolicyDraft` feeds route validation and dialog state; repository maps feed `DataHealthRow` and `DataHealthBoard`; no type expands `ServiceKey`.

**Review focus coverage:** Task 1 tests identity and labels; Task 2 tests unavailable schema; Task 3 tests authorization/enabling; Task 4 tests layout/state rendering.

**Proportion:** This plan intentionally implements the HALO configuration/read surface only. It does not falsely treat the MBS pilot as platform-wide telemetry or invent a scheduler inside HALO.
