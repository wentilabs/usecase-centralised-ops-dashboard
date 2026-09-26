# Automatic WBGT and Noise Data Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show automatic, read-only ingestion health for every configured WBGT and Noise project in HALO, while keeping all other services neutral.

**Architecture:** A pure catalog and evaluator own table derivation and state classification. A server-only reader fetches the newest narrow evidence row from the two allow-listed source schemas and isolates errors per project. The page passes that result through the existing dashboard/card composition; the existing board becomes a read-only estate summary rather than a policy-setup surface.

**Tech Stack:** Next 16 App Router, React 19, TypeScript, Tailwind 3, Supabase PostgREST.

**Spec:** `docs/superpowers/specs/2026-09-26-data-health-service-design.md`

## Global Constraints

- The pilot is automatic for WBGT and Noise configuration rows: no policy, enable switch, table-picker, migration, source-data write, Google Sheet write, or WhatsApp send.
- Use `noiseTableForProject` and `wbgtTableForProject`; do not duplicate project-code normalization or accept table/column input from the browser.
- `created_at` is ingestion freshness; source event fields are supplementary evidence only.
- WBGT boundaries are 2h warning / 4h critical; Noise boundaries are 12h warning / 24h critical.
- Missing table, empty table, and monitor/query failure must have distinct labels and must never falsely state that the source stopped sending data.
- Keep Data Health outside `ServiceKey`, config introspection, onboarding, audit triggers, and customer alert configuration.
- Preserve a neutral delivery label and retain the existing exact distinction: provider accepted is not delivered/read.
- Per-project source failures must not break the page or another project’s result; server-side secrets stay server-only.

## Review Focus

- A project code containing spaces, punctuation, or mixed case must resolve through the existing naming helper, never a hand-built identifier.
- A timestamp exactly on the warning/critical threshold must have one defined state; a future or invalid timestamp must never appear fresh.
- `404`/PostgREST table absence, an empty successful response, and a timeout must produce different operator copy.
- WBGT and Noise can use the same project code without result-map collisions.
- A browser refresh or an in-memory config edit must not leave a card with a result that belongs to a different service/project row.

### Task 1: Replace the optional-policy domain model with the automatic health catalog

**Files:**
- Modify: `lib/data-health.ts`
- Modify: `tests/data-health.test.ts`
- Delete: `supabase/data_health_setup.sql`

**Consumes:** The approved pilot budgets and table/field contracts in the spec.

**Produces:** `healthKey(service, projectCode)`, `healthTarget(service, projectCode)`, `assessIngestionHealth(target, newestRow, now)`, and a `ProjectHealth` type consumed by the server reader and UI.

- [ ] **Step 1: Write failing unit tests** for WBGT/Noise target construction, unsupported neutral target, exact freshness boundaries, empty rows, invalid/future timestamps, and collision-safe health keys. Keep the provider-accepted delivery-label regression test.
- [ ] **Step 2: Run the focused health test** and confirm it fails because the automatic catalog/evaluator API does not exist.
- [ ] **Step 3: Implement the smallest pure catalog/evaluator** in `lib/data-health.ts`. Use the existing naming functions; model evidence states (`row`, `empty`, `missing_table`, `monitor_error`) separately; produce only colour, operator label, newest receipt, and optional source-time evidence.
- [ ] **Step 4: Run the focused health test** and confirm it passes.
- [ ] **Step 5: Remove `supabase/data_health_setup.sql`** only after the tests prove the policy model is no longer imported. It must not be applied or replaced with a migration.
- [ ] **Step 6: Run `npm test -- --test-name-pattern="data health"`** and confirm the health contract passes.
- [ ] **Step 7: Commit** with `feat: define automatic data health catalog`.

### Task 2: Add isolated, read-only source-table evidence reads

**Files:**
- Modify: `lib/data-health-repository.ts`
- Create: `tests/data-health-repository.test.ts`

**Consumes:** `healthTarget`, `healthKey`, `assessIngestionHealth`, and `ProjectHealth` from Task 1; configured rows grouped by service from `app/page.tsx`.

**Produces:** `listProjectHealth(configured: Partial<Record<ServiceKey, ProjectConfigRow[]>>, options?) -> Promise<Map<string, ProjectHealth>>` for page composition.

- [ ] **Step 1: Write failing repository tests** with an injected fetch implementation. Assert one newest-row request uses the correct schema/profile and narrow select list (`created_at,reading_timestamp` for WBGT; `created_at,date,time_hhmm` for Noise), uses `order=created_at.desc&limit=1`, never reads unsupported services, and retains a useful result when a sibling request returns empty/404/times out.
- [ ] **Step 2: Run the repository test** and confirm it fails because `listProjectHealth` does not exist.
- [ ] **Step 3: Implement the server-only reader** with an eight-second abort timeout, derived/encoded table path only, and per-project `Promise.allSettled` handling. Map a genuine 404/undefined table to `missing_table`; map transport/permission/unexpected errors to `monitor_error`; do not log rows or secrets.
- [ ] **Step 4: Run the repository test** and confirm it passes.
- [ ] **Step 5: Run the focused data-health test group** and confirm both domain and repository contracts pass.
- [ ] **Step 6: Commit** with `feat: read WBGT and Noise ingestion evidence`.

### Task 3: Compose automatic health into cards and the estate board

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/DashboardShell.tsx`
- Modify: `components/ProjectCard.tsx`
- Modify: `components/DataHealthRow.tsx`
- Modify: `components/DataHealthBoard.tsx`
- Create: `tests/data-health-ui-contract.test.ts`

**Consumes:** `listProjectHealth` map from Task 2 and `ProjectHealth` from Task 1.

**Produces:** An automatic-colour card row under sheet/action links, plus a read-only estate board with WBGT/Noise totals and neutral non-pilot services.

- [ ] **Step 1: Write failing UI/source-contract tests** that assert page composition supplies health, `ProjectCard` passes the card’s own `(service, project_code)` result to `DataHealthRow` below links, the row describes automatic monitoring without setup copy, and the board has no `Set up policy` control.
- [ ] **Step 2: Run the UI contract test** and confirm it fails against the current neutral placeholder/setup board.
- [ ] **Step 3: Compose `listProjectHealth` in `app/page.tsx`** after config reads. On a top-level reader failure pass an empty map so cards stay neutral; do not fail the existing dashboard.
- [ ] **Step 4: Thread the map through `DashboardShell` and `ProjectCard`**, resolving keys with `healthKey` rather than a project-code-only record. Preserve the matching map on local row edits and browser refresh.
- [ ] **Step 5: Update `DataHealthRow` and `DataHealthBoard`** to render supplied health labels/evidence, neutral delivery, and automatic/read-only wording using existing semantic Tailwind tokens. Keep unprefixed phone styles and desktop behavior behind `md:`.
- [ ] **Step 6: Run the UI contract and mobile contract tests** and confirm they pass.
- [ ] **Step 7: Commit** with `feat: show automatic data health in HALO`.

### Task 4: Remove legacy policy surface and verify the branch

**Files:**
- Modify: `docs/superpowers/specs/2026-09-26-data-health-service-design.md` only if implementation reveals a precise contract correction
- Modify: `docs/superpowers/plans/2026-09-26-data-health-halo-surface.md` with a short superseded notice, or remove it if it is unreferenced
- Modify: `tests/data-health.test.ts` and `tests/data-health-ui-contract.test.ts` only for any verified coverage gap

**Consumes:** Tasks 1–3.

**Produces:** A branch with no accidental policy setup affordance or migration artifact, verified for local inspection.

- [ ] **Step 1: Search the codebase** for obsolete policy concepts (`project_health_configs`, `Set up policy`, `validateHealthPolicyDraft`, `listDataHealthPolicies`) and write a failing characterization assertion for any runtime reference that remains.
- [ ] **Step 2: Run that test** and confirm it identifies the remaining obsolete surface, if any.
- [ ] **Step 3: Remove only obsolete runtime references**; retain the historical plan as clearly superseded if it is useful provenance. Do not remove unrelated delivery-telemetry design material.
- [ ] **Step 4: Run focused tests, `npm test`, `npm run typecheck`, and `npm run build`**, reading each result. Start `npm run dev` only for local visual inspection; do not invoke jobs or external sends.
- [ ] **Step 5: Commit** with `chore: retire obsolete data health policy surface` if this task changes tracked files.

## Self-Review

**Spec coverage:** Tasks 1–2 implement deterministic automatic status and per-project error isolation; Task 3 gives cards and the board their supported display; Task 4 removes the incompatible optional-policy remnants and runs the complete verification. No task pretends to implement notifications, delivery telemetry, source migrations, or non-pilot table adapters.

**Interface consistency:** Task 1’s `ProjectHealth` and collision-safe `healthKey` are used by Task 2’s reader and Task 3’s props. `ProjectConfigRow` remains the only source row shape. The repository is the only code that reaches source tables.

**Risk coverage:** The review-focus inputs are pinned in Tasks 1–3: identifier normalization, boundary timestamps, distinct failure classes, cross-service key collisions, and stale client state.

**Compatibility:** All mutations are confined to the dashboard source and tests. There is no Supabase write, migration execution, scheduler, job invocation, or customer-message change.
