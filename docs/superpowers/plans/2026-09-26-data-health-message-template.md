# Data Health Message Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let WBGT and Noise projects customize Data Health reminder wording through a safe, placeholder-limited template.

**Architecture:** HALO validates and edits a nullable per-project `data_health_message_template` configuration field. The server-only Data Health worker renders either that template or its built-in default immediately before calling the existing project sender/proxy; recipient routing, cadence, incident policy, and sender selection remain unchanged.

**Tech Stack:** Next.js 16/React 19/TypeScript HALO, Supabase/Postgres migrations, Node.js Data Health worker.

**Spec:** `docs/superpowers/specs/2026-09-26-data-health-message-template-design.md`

## Global Constraints

- `data_health_message_template` is nullable on WBGT and Noise config rows; blank uses the safe worker default.
- Only `{{project_code}}`, `{{service}}`, `{{status}}`, and `{{latest_receipt}}` are valid placeholders.
- Unknown or malformed placeholders are refused in HALO and cancel server-side dispatch if a legacy/direct write bypassed HALO.
- A template cannot specify a chat id, sender URL, client id, secret, cadence, retry, incident state, or TEST canary target.
- HALO remains configuration/display-only and never calls a WhatsApp endpoint.
- Sender routing remains dedicated `data_health_group_ids` only; no fallback to ordinary project alert groups.
- Template migrations must be adopted by the WBGT/Noise owning repositories before their live schemas are changed.

## Review Focus

- Blank, null, and whitespace-only templates must all produce the default, not an empty WhatsApp body (Task 2).
- A misspelled or unmatched `{{...}}` token must be rejected before save and must cancel worker delivery if present in the database (Tasks 1 and 2).
- Placeholder replacement must be literal and complete; replacement values must never be interpreted as another placeholder (Task 2).
- A custom template must not alter the configured sender or dedicated recipients (Task 2).
- The field must stay visible without a project-enable gate and resolve as an ordinary config edit, not a Data Health setup flow (Task 1).

---

## Repository and file map

| Repository | Files | Responsibility |
| --- | --- | --- |
| HALO | `lib/data-health-template.ts`, `lib/field-spec/providers/{wbgt,noise}.ts`, `lib/row-rules.ts`, tests | Placeholder grammar, save validation, and editor presentation. |
| WBGT / Noise owners | `supabase/migrate_data_health_message_template.sql` | Add each source table's nullable template column exactly once. |
| Data Health worker | `src/message-template.js`, `src/delivery-dispatcher.js`, tests | Default and custom rendering, with fail-closed validation before the existing sender call. |

### Task 1: Add the template configuration contract to HALO and source migrations

**Files:**
- Create: `lib/data-health-template.ts`
- Create: `tests/data-health-template.test.ts`
- Modify: `lib/field-spec/providers/wbgt.ts`
- Modify: `lib/field-spec/providers/noise.ts`
- Modify: `lib/row-rules.ts`
- Modify: `tests/data-health-ui-contract.test.ts`
- Create: `usecase-wbgt-alerts/supabase/migrate_data_health_message_template.sql`
- Create: `usecase-noise-alerts/supabase/migrate_data_health_message_template.sql`

**Interfaces:**
- Consumes: `string | null | undefined` stored template values.
- Produces: `validateDataHealthTemplate(value: unknown): { valid: true } | { valid: false; message: string }` and the editable `data_health_message_template` field overlay.

- [ ] **Step 1: Write failing template-contract tests**

```ts
assert.deepEqual(validateDataHealthTemplate("{{project_code}} {{status}}"), { valid: true });
assert.equal(validateDataHealthTemplate("{{unknown}} ").valid, false);
assert.equal(validateDataHealthTemplate("hello {{status").valid, false);
```

Add source-text tests that both service field providers label the text field “Data Health message template”, explain all four tokens, place it with Delivery, and have no `showIf` gate. Assert each owning migration adds a nullable `text` column.

- [ ] **Step 2: Run focused tests to verify red**

Run: `npm test -- --test-name-pattern="Data Health.*template"`

Expected: FAIL because the grammar, field overlays, and migrations are absent.

- [ ] **Step 3: Implement the shared validation and HALO configuration overlay**

Implement the exact placeholder allow-list in `lib/data-health-template.ts`; blank/null/whitespace are valid and mean default. Reject unmatched braces and every token outside the four allowed names. Add a `text` widget field named `data_health_message_template` beneath `data_health_group_ids` in both Delivery groups, with help naming the allowed tokens. Add the same validation to the existing row-rule path used by config saves.

- [ ] **Step 4: Add the two additive source migrations**

Each migration contains only `add column if not exists data_health_message_template text`; do not backfill templates or alter alert routing.

- [ ] **Step 5: Run focused tests to verify green**

Run: `npm test -- --test-name-pattern="Data Health.*template"`

Expected: PASS.

- [ ] **Step 6: Commit separately by repository**

```bash
git add lib/data-health-template.ts lib/field-spec/providers/wbgt.ts lib/field-spec/providers/noise.ts lib/row-rules.ts tests/data-health-template.test.ts tests/data-health-ui-contract.test.ts
git commit -m "feat: configure data health message templates"
```

Commit the two source migrations in their owning repositories with `feat: add <service> data health message template`.

### Task 2: Render templates safely in the Data Health worker

**Files:**
- Create: `src/message-template.js`
- Create: `tests/message-template.test.js`
- Modify: `src/delivery-dispatcher.js`
- Modify: `tests/delivery-dispatcher.test.js`

**Interfaces:**
- Consumes: `renderDataHealthMessage(template, event)`, where `event` has `projectCode`, `service`, `tone`, and `newestReceivedAt`.
- Produces: `{ ok: true, message: string } | { ok: false, reason: "invalid_template" }`; `dispatchDelivery()` returns `{ state: "cancelled", reason: "invalid_template" }` without posting when rendering fails.

- [ ] **Step 1: Write failing renderer tests**

```js
assert.equal(renderDataHealthMessage("{{project_code}} / {{status}}", event).message, "TEST / No recent data");
assert.equal(renderDataHealthMessage(null, event).message, DEFAULT_DATA_HEALTH_TEMPLATE_RENDERED);
assert.deepEqual(renderDataHealthMessage("{{sender_url}}", event), { ok: false, reason: "invalid_template" });
```

Cover recovery status, no receipt, whitespace-only values, all four tokens, unmatched braces, unknown tokens, and a replacement value that itself contains `{{status}}`.

- [ ] **Step 2: Run worker renderer tests to verify red**

Run: `node --test tests/message-template.test.js tests/delivery-dispatcher.test.js`

Expected: FAIL because no renderer exists and dispatcher still uses fixed copy.

- [ ] **Step 3: Implement `renderDataHealthMessage(template, event)`**

Use the same exact grammar as HALO (duplicated only if the worker remains a separately deployed Node package). Format service uppercase, status as `Delayed` / `No recent data` / `Recovered`, and receipt in Asia/Singapore or `No receipt yet`. Substitute via a single token scan, not chained replacements, so replacement text cannot become executable syntax.

- [ ] **Step 4: Integrate rendering into `createDispatcher()`**

Read only `config.data_health_message_template` after the existing fresh-routing check. On invalid template, return cancelled before `post`; otherwise supply the renderer output as the existing sender's `message` field. Do not change adapter payload keys or sender/routing comparisons.

- [ ] **Step 5: Run worker tests to verify green**

Run: `npm test`

Expected: PASS, including existing dedicated-group, retry, and canary tests.

- [ ] **Step 6: Commit**

```bash
git add src/message-template.js src/delivery-dispatcher.js tests/message-template.test.js tests/delivery-dispatcher.test.js
git commit -m "feat: render data health message templates"
```

### Task 3: Verify end-to-end contracts without a live WhatsApp send

**Files:**
- Modify: `docs/superpowers/specs/2026-09-26-data-health-message-template-design.md` only if implementation uncovers an ambiguity
- Modify: Data Health canary runbook
- Test: HALO and worker full suites

**Interfaces:**
- Consumes: HALO config values and worker-rendered content.
- Produces: a canary checklist that confirms saved template preview/routing and leaves `DATA_HEALTH_DELIVERY_ENABLED=0` until separate live approval.

- [ ] **Step 1: Write a failing source-contract test for the canary checklist**

Assert the runbook requires a blank/default preview or an allowed-token custom preview, requires TEST-only sender/destination review, and never authorizes a browser call or automatic live send.

- [ ] **Step 2: Run it to verify red**

Run: `node --test tests/canary-contract.test.js`

Expected: FAIL until the checklist covers template validation.

- [ ] **Step 3: Update the controlled-canary runbook**

Add a pre-send review of the rendered TEST message without logging the group id, sender URL, client id, or message in server logs. Keep the existing manual approval and global off switch requirements intact.

- [ ] **Step 4: Run complete verification sequentially**

Run in HALO: `npm test && npm run typecheck && npm run build`

Run in worker: `npm test`

Expected: all tests pass. Run HALO commands sequentially because `next build` and standalone `tsc` both write generated `.next` metadata.

- [ ] **Step 5: Commit**

```bash
git add docs/canary-runbook.md tests/canary-contract.test.js
git commit -m "docs: verify data health message templates in canary"
```

## Plan self-review

- **Spec coverage:** Task 1 owns nullable source columns, HALO editing, grammar, and save-time validation. Task 2 owns default/custom rendering and fail-closed dispatch. Task 3 owns the safe non-live verification path.
- **Type consistency:** Task 1's template grammar is represented as `valid`/`invalid`; Task 2's renderer returns `ok`/`invalid_template`, and dispatcher maps only the invalid state to cancellation.
- **Review focus:** Every listed edge case is assigned to Task 1 or Task 2 tests; routing and live-send boundaries are retained by Task 3.
- **Proportion:** This plan covers the template extension only; concrete Supabase/Lambda worker composition remains a separate deployment prerequisite.
