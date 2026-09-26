# Data Health Reminder Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver TEST-only WBGT and Noise Data Health reminders using each project’s configured sender and dedicated operations group, with bounded retries, recovery, and a safe rollout path.

**Architecture:** A new `usecase-data-health` Node.js Lambda owns automatic health evaluation, incident/outbox state, and delivery dispatch. It reads the existing WBGT/Noise configuration and readings tables, sends through source-specific adapters using each project's `lambda_url` and `client_id`, and persists server-only state in `ops`. HALO remains configuration/display-only and exposes the new per-project recipient field through its existing live-schema editor.

**Tech Stack:** Node.js Lambda, AWS EventBridge Rules, Supabase/Postgres service role, HTTPS/WhatsApp listener adapters, Next.js 16/React 19/TypeScript HALO.

**Spec:** `docs/superpowers/specs/2026-09-26-data-health-reminder-delivery-design.md`

## Global Constraints

- HALO must never call a WhatsApp endpoint or own delivery credentials.
- Apply only forward, additive migrations; do not backfill, alter readings rows, or change existing customer-alert destinations.
- `data_health_group_ids` is nullable on WBGT and Noise config rows; blank means monitor-only and no fallback destination is allowed.
- WBGT and Noise thresholds are both amber at 1h/red at 4h, measured from newest `created_at`.
- Amber repeats at most every 12h; red repeats at most every 6h; recovery sends once after a previously notified incident becomes green.
- A failed delivery has one initial attempt plus retries after 1, 3, and 5 minutes; no body/credential/raw provider response enters logs or browser surfaces.
- The first live deployment configures only WBGT TEST and Noise TEST with the provided internal group through HALO; no group identifier is committed.
- All unsafe/missing configuration, source-table, or state-read paths fail closed and cannot guess another project’s sender or group.

## Review Focus

- A project’s ordinary `whatsapp_group_id` must never become a Data Health fallback; Task 5 tests blank dedicated groups remain silent.
- A source config changed after enqueue must cancel the old delivery rather than send to the stale group; Task 3 tests snapshot mismatch cancellation.
- Concurrent worker invokes must not dispatch the same delivery twice; Task 2 tests the lease/claim function’s single winner.
- The 1/3/5-minute retry delays apply after each failure, not from the original due time; Task 3 tests all four timestamps.
- WBGT TEST and Noise TEST must remain separate even though they share a project code and group; Tasks 1 and 6 test the composite identity and two canary outcomes.

---

## Repository and file map

| Repository | Files | Responsibility |
| --- | --- | --- |
| New `usecase-data-health` | `package.json`, `src/health-policy.js`, `src/incident-policy.js`, `src/config-readers.js`, `src/delivery-adapters/{wbgt,noise}.js`, `src/outbox.js`, `src/worker.js`, `api/data-health-evaluate.js`, `api/data-health-dispatch.js` | Platform-wide worker: pure policy, safe reads, atomic state transitions, source sender adapters, and scheduled entrypoints. |
| New `usecase-data-health` | `db/migrations/2026-09-26-data-health-worker.sql`, `tests/*.test.js`, `docs/canary-runbook.md` | Server-only `ops` state, integration seams, and controlled TEST rollout. |
| `usecase-wbgt-alerts` | `supabase/migrate_data_health_groups.sql` | Add nullable `wbgts.wbgt_project_configs.data_health_group_ids`. |
| `usecase-noise-alerts` | `supabase/migrate_data_health_groups.sql` | Add nullable `noise-meters.noise_project_configs.data_health_group_ids`. |
| HALO (`usecase-centralised-ops-dashboard`) | `lib/field-spec/providers/wbgt.ts`, `lib/field-spec/providers/noise.ts`, `lib/card-summary/groups.ts`, `tests/auth-policy.test.ts`, `tests/data-health-ui-contract.test.ts` | Render the recipient group picker/names without creating a setup flow or sender. |

### Task 1: Establish the worker’s pure health and reminder contracts

**Files:**
- Create: `usecase-data-health/package.json`
- Create: `usecase-data-health/src/health-policy.js`
- Create: `usecase-data-health/src/incident-policy.js`
- Create: `usecase-data-health/tests/health-policy.test.js`
- Create: `usecase-data-health/tests/incident-policy.test.js`

**Interfaces:**
- Consumes: `{ service: "wbgt" | "noise", projectCode: string, newestCreatedAt: string | null }`, explicit `now`.
- Produces: `assessHealth(observation, now) -> { tone: "green" | "amber" | "red", label, newestReceivedAt }`; `evaluateIncident(previous, observation, now) -> { incident, notificationKind?: "opened" | "escalated" | "repeat" | "recovered" }`.

- [ ] **Step 1: Write failing health-policy tests**

```js
assert.equal(assessHealth(wbgtAtTwoHours, now).tone, "amber");
assert.equal(assessHealth(wbgtAtFourHours, now).tone, "red");
assert.equal(assessHealth(noiseAtTwelveHours, now).tone, "amber");
assert.equal(assessHealth(noiseAtTwentyFourHours, now).tone, "red");
```

Include null/latest future timestamps and prove keying uses `(service, projectCode)`, so WBGT TEST and Noise TEST cannot collide.

- [ ] **Step 2: Run the policy tests to verify red**

Run: `node --test tests/health-policy.test.js tests/incident-policy.test.js`

Expected: FAIL because the policy modules do not exist.

- [ ] **Step 3: Create the Node.js test harness and implement `assessHealth()` and `evaluateIncident()`**

Add a CommonJS `package.json` with a `node --test tests/*.test.js` test script. Use the documented `created_at` budgets. A first amber/red observation yields `opened`; a worsening amber→red yields `escalated`; due repeat uses the 12h/6h budget; green produces `recovered` only when the prior incident records a recipient-notified state.

- [ ] **Step 4: Add failing recurrence tests, then implement the minimal recurrence rule**

```js
assert.equal(evaluateIncident(amberNotifiedAt(nowMinus12Hours), amberObservation, now).notificationKind, "repeat");
assert.equal(evaluateIncident(redNotifiedAt(nowMinus6Hours), redObservation, now).notificationKind, "repeat");
assert.equal(evaluateIncident(redNotifiedAt(nowMinus5Hours), redObservation, now).notificationKind, undefined);
```

- [ ] **Step 5: Run policy tests to verify green**

Run: `node --test tests/health-policy.test.js tests/incident-policy.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src/health-policy.js src/incident-policy.js tests/health-policy.test.js tests/incident-policy.test.js
git commit -m "feat: define data health reminder policy"
```

### Task 2: Add server-only incident, outbox, and attempt persistence

**Files:**
- Create: `usecase-data-health/db/migrations/2026-09-26-data-health-worker.sql`
- Create: `usecase-data-health/src/outbox.js`
- Create: `usecase-data-health/tests/outbox.test.js`

**Interfaces:**
- Consumes: `claimDueDelivery(now, workerId)` and `scheduleNotification(incident, kind, routing, dueAt)`.
- Produces: one claimed delivery lease, immutable `recordAttempt(deliveryId, attempt)` rows, and terminal `delivered | exhausted | cancelled` state.

- [ ] **Step 1: Write failing migration/contract tests**

Assert the migration creates the three `ops` tables, a unique source-service/project/condition incident key, a unique delivery idempotency key **per destination**, append-only attempts, and an atomic claim function that returns one row to one claimant.

- [ ] **Step 2: Run the outbox test to verify red**

Run: `node --test tests/outbox.test.js`

Expected: FAIL because the migration and outbox adapter are absent.

- [ ] **Step 3: Implement the additive migration and `src/outbox.js`**

Use `ops.data_health_incidents`, `ops.data_health_notification_deliveries`, and `ops.data_health_notification_attempts`. Split, trim, and de-duplicate the configured comma-separated group IDs before creating one delivery per destination. Grant only the worker service role; do not expose schemas/tables to browser/PostgREST roles. The claim function must lock/lease one due record and permit recovery after lease expiry.

- [ ] **Step 4: Add the concurrent-claim characterization test and run it**

```js
const [left, right] = await Promise.all([claimDueDelivery(now, "left"), claimDueDelivery(now, "right")]);
assert.equal([left, right].filter(Boolean).length, 1);
```

Run: `node --test tests/outbox.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/2026-09-26-data-health-worker.sql src/outbox.js tests/outbox.test.js
git commit -m "feat: persist data health notification work"
```

### Task 3: Deliver through project-specific senders with bounded retries

**Files:**
- Create: `usecase-data-health/src/config-readers.js`
- Create: `usecase-data-health/src/delivery-adapters/wbgt.js`
- Create: `usecase-data-health/src/delivery-adapters/noise.js`
- Create: `usecase-data-health/src/delivery-dispatcher.js`
- Create: `usecase-data-health/tests/delivery-dispatcher.test.js`

**Interfaces:**
- Consumes: a claimed delivery, fresh source config, and injected `post(url, { chatId, message, clientId })`.
- Produces: `dispatchDelivery(delivery, now) -> { state: "delivered" | "retrying" | "exhausted" | "cancelled" }`.

- [ ] **Step 1: Write failing adapter and routing tests**

```js
assert.deepEqual(posted, {
  url: testConfig.lambda_url,
  body: { chatId: testGroupId, message: expectedBody, clientId: testConfig.client_id },
});
assert.equal(await dispatchDelivery(noDedicatedGroup, now).state, "cancelled");
assert.equal(await dispatchDelivery(staleRoutingSnapshot, now).state, "cancelled");
```

Assert no ordinary `whatsapp_group_id`, `alert_whatsapp_gid`, or Water Parade field is read as a fallback.

- [ ] **Step 2: Run dispatcher tests to verify red**

Run: `node --test tests/delivery-dispatcher.test.js`

Expected: FAIL because source adapters/dispatcher do not exist.

- [ ] **Step 3: Implement source adapters and `dispatchDelivery()`**

Validate nonblank `lambda_url`, `client_id`, and currently configured `data_health_group_ids` before sending. Render only the approved amber/red/recovery copy. Re-read config immediately before every attempt and cancel snapshot mismatch rather than using stale routing. The delivery must target the one group ID stored on its outbox record, never the unsplit list.

- [ ] **Step 4: Add the failing retry-schedule test, then implement it**

```js
assert.deepEqual(nextAttemptTimes(failedInitial, now), [plusMinutes(now, 1), plusMinutes(now, 4), plusMinutes(now, 9)]);
assert.equal(afterThirdRetryFailure.state, "exhausted");
```

Record every outcome as an immutable attempt. Do not retry inline; schedule the next outbox due time.

- [ ] **Step 5: Run dispatcher tests to verify green**

Run: `node --test tests/delivery-dispatcher.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config-readers.js src/delivery-adapters src/delivery-dispatcher.js tests/delivery-dispatcher.test.js
git commit -m "feat: dispatch data health reminders safely"
```

### Task 4: Add evaluation and minute-dispatch Lambda entrypoints

**Files:**
- Create: `usecase-data-health/src/worker.js`
- Create: `usecase-data-health/api/data-health-evaluate.js`
- Create: `usecase-data-health/api/data-health-dispatch.js`
- Create: `usecase-data-health/tests/worker.test.js`
- Modify: `usecase-data-health/README.md`

**Interfaces:**
- Consumes: service-role Supabase client and `DATA_HEALTH_DELIVERY_ENABLED`.
- Produces: authenticated HTTP handlers `POST /data-health-evaluate` and `POST /data-health-dispatch`; no public browser route.

- [ ] **Step 1: Write failing worker tests**

Test that the evaluator reads every configured WBGT/Noise row, derives only its allow-listed table, isolates a project failure, and queues work only when delivery is enabled and a dedicated recipient is present. Test dispatcher does not call the sender when `DATA_HEALTH_DELIVERY_ENABLED !== "1"`.

- [ ] **Step 2: Run worker tests to verify red**

Run: `node --test tests/worker.test.js`

Expected: FAIL because worker/entrypoints are absent.

- [ ] **Step 3: Implement `evaluate()` and `dispatch()` with injected ports**

`evaluate(now)` performs the hourly health reads and schedules incident transitions. `dispatch(now)` claims due outbox records and uses Task 3. Keep `now`, database, and HTTP ports injectable; no handler sleeps. Guard both handlers with the deployment’s scheduler authentication and no default live delivery.

- [ ] **Step 4: Configure the two EventBridge Rules and document them**

Use one hourly evaluation rule and one every-minute dispatch rule. Document exact rule input/auth variables, the emergency `DATA_HEALTH_DELIVERY_ENABLED=0` off switch, and the no-public-route constraint.

- [ ] **Step 5: Run worker tests to verify green**

Run: `node --test tests/worker.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker.js api/data-health-evaluate.js api/data-health-dispatch.js tests/worker.test.js README.md
git commit -m "feat: schedule data health evaluation and delivery"
```

### Task 5: Add dedicated recipient fields to source configurations and HALO

**Files:**
- Create: `usecase-wbgt-alerts/supabase/migrate_data_health_groups.sql`
- Create: `usecase-noise-alerts/supabase/migrate_data_health_groups.sql`
- Modify: `lib/field-spec/providers/wbgt.ts`
- Modify: `lib/field-spec/providers/noise.ts`
- Modify: `lib/card-summary/groups.ts`
- Modify: `tests/auth-policy.test.ts`
- Modify: `tests/data-health-ui-contract.test.ts`

**Interfaces:**
- Consumes: nullable `data_health_group_ids` in `wbgts.wbgt_project_configs` and `noise-meters.noise_project_configs`.
- Produces: normal HALO `GroupPicker` editing and alias resolution for **Data Health groups**, without a Data Health policy/setup UI.

- [ ] **Step 1: Write failing HALO field-spec tests**

```ts
assert.equal(FIELDS.data_health_group_ids.widget, "groups");
assert.match(FIELDS.data_health_group_ids.help, /internal operations/i);
assert.ok(GROUP_COLUMNS.wbgt.some(({ column }) => column === "data_health_group_ids"));
assert.ok(GROUP_COLUMNS.noise.some(({ column }) => column === "data_health_group_ids"));
```

Assert it is separate from ordinary client WhatsApp destinations and has no `showIf`/project enable gate.

- [ ] **Step 2: Run the focused HALO tests to verify red**

Run: `npm test`

Expected: FAIL because the fields/migrations are absent.

- [ ] **Step 3: Implement the two nullable source migrations and HALO overlays**

The migrations only add nullable text columns. In HALO, add the field beneath each service’s Delivery group with `widget: "groups"`, plus `GROUP_COLUMNS` role `data health`. Do not add an enable switch, fallback, setup board action, or any sender code.

- [ ] **Step 4: Run the focused tests to verify green**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit independently in each affected repository**

```bash
git -C usecase-wbgt-alerts add supabase/migrate_data_health_groups.sql && git -C usecase-wbgt-alerts commit -m "feat: add WBGT data health recipients"
git -C usecase-noise-alerts add supabase/migrate_data_health_groups.sql && git -C usecase-noise-alerts commit -m "feat: add Noise data health recipients"
git add lib/field-spec/providers/wbgt.ts lib/field-spec/providers/noise.ts lib/card-summary/groups.ts tests/auth-policy.test.ts tests/data-health-ui-contract.test.ts
git commit -m "feat: configure data health recipient groups"
```

### Task 6: Run TEST-only canaries and preserve the rollback path

**Files:**
- Create: `usecase-data-health/docs/canary-runbook.md`
- Modify: `usecase-data-health/README.md`
- Test: `usecase-data-health/tests/canary-contract.test.js`

**Interfaces:**
- Consumes: deployed worker with delivery disabled, applied migrations, and groups entered through HALO for WBGT TEST and Noise TEST only.
- Produces: one auditable provider-accepted attempt per selected TEST source, without enabling any other project.

- [ ] **Step 1: Write the canary safety contract test**

```js
assert.deepEqual(canaryTargets(configs), [
  { service: "wbgt", projectCode: "TEST" },
  { service: "noise", projectCode: "TEST" },
]);
assert.equal(canaryTargets(configs).some((target) => target.projectCode !== "TEST"), false);
```

- [ ] **Step 2: Run it to verify red**

Run: `node --test tests/canary-contract.test.js`

Expected: FAIL because the rollout guard/runbook contract is absent.

- [ ] **Step 3: Implement the TEST-only canary guard and runbook**

Document: migrations first; delivery disabled; enter the provided internal group only through HALO; inspect group alias/sender URL/client ID; enable delivery; perform one authenticated evaluation then dispatch; verify one WBGT TEST and one Noise TEST provider-accepted attempt; verify no repeat before red’s six hours; restore a recent row and observe one recovery. Include the immediate off switch and a query that never returns message body/secrets.

- [ ] **Step 4: Run the canary contract test to verify green**

Run: `node --test tests/canary-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Run complete repository verification**

Run in HALO: `npm test && npm run typecheck && npm run build`

Run in worker: `node --test tests/*.test.js`

Expected: all tests pass. The local listener-sink integration proves payload shape and retry behavior; only the explicitly enabled TEST canary proves a credentialed provider call.

- [ ] **Step 6: Commit**

```bash
git add docs/canary-runbook.md README.md tests/canary-contract.test.js
git commit -m "docs: add data health TEST canary runbook"
```

## Plan self-review

- **Spec coverage:** Tasks 1–4 implement platform worker policy, durable state, source-specific sending, scheduler, failure/retry behavior, and off switch. Task 5 implements source config and HALO group picking. Task 6 implements both independent TEST canaries, live-integrations boundary, and rollback.
- **Type consistency:** Task 1 supplies composite health/incident identity; Task 2 persists its notifications; Task 3 dispatches Task 2’s claimed record; Task 4 invokes Tasks 1–3; Task 5 supplies the recipient field Task 3 reads; Task 6 uses the same service/project composite target.
- **Review-focus coverage:** Dedicated-only group routing is Task 5; stale routing and retry schedule are Task 3; atomic claim is Task 2; service-separated TEST identities are Tasks 1 and 6.
- **Proportion:** The plan names interfaces and tests without duplicating worker implementations. No implementation decision remains as a TODO.
