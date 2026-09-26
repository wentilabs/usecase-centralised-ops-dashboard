# MBS Delivery-Health Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce durable, retry-aware MBS WBGT delivery evidence that the future Data Health service can use to report WhatsApp-server acceptance without claiming recipient delivery or read status.

**Architecture:** Add an append-only `ops.outbound_delivery_events` feed in the shared Supabase project. The MBS Lambda writes `intent`, `attempted`, and terminal provider events around its existing WhatsApp call, but only when a caller supplies explicit, enabled telemetry metadata. First adopters are the MBS WBGT advisory and Water Parade reminder paths; the Data Health runner will consume this feed in its own subsequent implementation.

**Tech Stack:** Node.js 22 AWS Lambda, Axios, `@supabase/supabase-js`, PostgreSQL/Supabase, existing plain Node assertion tests.

**Spec:** `docs/superpowers/specs/2026-09-26-data-health-service-design.md`

## Global Constraints

- Preserve the existing `POST /wbgt-reading` endpoint, payload, scheduling, message content, destinations, and fail-soft WBGT/Water Parade behavior.
- This phase monitors only MBS's `wbgt_advisory` and `water_parade_reminder` messages; it must not label unrelated MBS messages as WBGT.
- `ack: 1` is **WhatsApp server accepted**; only a future persisted `ack: 2` / `ack: 3` can be labelled delivered / read.
- Delivery telemetry is opt-in and fail-open: a missing deployment setting or a Supabase telemetry failure must never prevent a customer message.
- Keep delivery evidence append-only. Do not store message body, mention targets, raw provider response, secrets, or stack traces.
- Do not infer an MBS source project from a chat ID. The deployment must provide the exact WBGT alias through `OUTBOUND_DELIVERY_TELEMETRY_PROJECT_CODE`; the initial production value is `MBS`.
- Migrations are additive and forward-only. Source-service runtime tables and HALO's seven-service registry remain unchanged.

## Review Focus

- A listener response with HTTP success but `success: false`, no matching destination result, or no message ID must become `provider_rejected` evidence without changing the caller's existing success semantics; test it in Task 3.
- A telemetry insert or update timeout/error must leave the outbound Axios call and its result untouched; test it in Task 2 and Task 3.
- A Water Parade send has no project code in its call site; it must use the configured exact alias and retain its non-blocking error boundary; test it in Task 4.
- A deployment with no enabled telemetry configuration must write no delivery rows and preserve every current send path; test it in Task 2.
- Duplicate or retrying Lambda invocations must have separate attempt IDs but retain enough dimensions to be grouped by Data Health; test event uniqueness and dimensions in Task 2.

---

## Required Feature Briefing

### 1. Customer behavior

**Repository-proven before state:** MBS logs the listener response in CloudWatch and returns it to the immediate caller, but does not persist outbound WhatsApp outcomes. WBGT continues after a send failure; Water Parade is explicitly fail-soft. The listener's current success response includes a provider message ID and `ack: 1`.

**After state:** No customer-facing message, recipient, schedule, or endpoint changes. Operators will later be able to see, per MBS WBGT delivery, whether MBS formed an intent, attempted the listener call, received WhatsApp-server acceptance, or received an error/rejection. The only customer-visible behavior remains exactly as it is today.

**Engineering recommendation:** Treat `ack: 1` as `provider_accepted` / “WhatsApp accepted,” not Delivered. A 2xx listener response whose body lacks a successful result is recorded as `provider_rejected`; it still preserves the caller's existing return value and logging behavior.

### 2. Affected invariants

**Repository-proven:** MBS WBGT's `POST /wbgt-reading` loops independently over destination groups; Water Parade failures never fail the WBGT response; existing source configurations use exact alias `MBS` for MBS sensor delivery. HALO's Data Health design must not widen the seven-member source-service registry.

**Preserved:** endpoint/payload contracts, fail-soft outbound behavior, Water Parade's existing listener-derived duplicate guard, HALO's existing services and source tables.

**Extended:** Data Health gains an explicit, normalized source-delivery evidence contract in `ops` rather than parsing CloudWatch text.

### 3. Compatibility

**Additive:** a new shared event table, one MBS telemetry utility, optional final metadata argument on two existing send helpers, and explicit metadata at two MBS call sites.

**Unchanged:** `/wbgt-reading`, its `{ groupIds }` body, handler response body, listener endpoint paths/payloads, message text, sending account, timeout, and customer-visible retry behavior. Existing calls that do not pass telemetry remain byte-for-byte equivalent in outbound payload and do not write events.

### 4. Persistence

**Required:** additive migration in the MBS repository creates `ops.outbound_delivery_events` plus query indexes. Each row is immutable and represents one transition for a generated `attempt_id`; no source-config table, audit trigger, or listener table changes.

**Schema:**

| Column | Purpose |
|---|---|
| `id` | UUID primary key |
| `attempt_id` | UUID shared by all transitions for one destination send |
| `event_type` | `intent`, `attempted`, `provider_pending`, `provider_accepted`, `provider_rejected`, or `transport_failed` |
| `source_system` | fixed `mdw-lambda-wh-mbs` |
| `source_service` | fixed `wbgt` for this phase |
| `source_project_code` | exact configured WBGT alias, never inferred from a chat ID |
| `message_class` | `wbgt_advisory` or `water_parade_reminder` |
| `destination_chat_id`, `client_id` | correlation dimensions only |
| `provider_message_id`, `provider_ack` | nullable listener evidence |
| `http_status`, `error_kind` | nullable safe failure classification |
| `occurred_at` | UTC event time |

The database enforces the event vocabulary, source/message-class vocabulary, nonblank identifiers, and uniqueness of `(attempt_id, event_type)`. Index `(source_service, source_project_code, message_class, destination_chat_id, occurred_at desc)` for Data Health window reads, and `(provider_message_id)` for a later listener-receipt reconciler.

### 5. Existing data

**Repository-proven:** historic CloudWatch logs contain message IDs and `ack: 1`, but they are not a complete, durable normalized event stream and failures are not correlated into attempts.

**After migration:** no backfill. Existing rows and historic MBS sends stay unmonitored. With no `OUTBOUND_DELIVERY_TELEMETRY_ENABLED=1` and nonblank `OUTBOUND_DELIVERY_TELEMETRY_PROJECT_CODE`, MBS writes no event and behavior remains unchanged. Events with a null provider ID/ack are valid only for the safe failure/pending event types.

### 6. Invocation

**Repository-proven:** the MBS Lambda's existing `POST /wbgt-reading` route fetches one reading and processes every supplied destination; it calls `processWBGTReadingFromAPI`, which sends a WBGT advisory. On Moderate/High readings, it independently invokes the Water Parade reminder. The central WBGT service continues to invoke this route; there is no new scheduled route.

**Recommendation:** Define a delivery intent at the point MBS has decided to send to one destination. Emit `intent` and `attempted` immediately around the existing Axios call, then a terminal provider event from the same response/error. A future Data Health catalog compares intended versus accepted messages in completed windows; this phase deliberately does not pretend that every configured cadence creates a message.

### 7. Regression proof

**Required:** SQL contract checks for constraints/indexes; pure telemetry tests for disabled, accepted, pending, rejected, failed, duplicate-attempt and writer-failure paths; sender characterization tests that assert original listener payload/return/error behavior; and WBGT/Water-Parade wiring tests that assert exactly the metadata described above. Run the existing WBGT and Water Parade unit suites after the targeted tests.

### 8. Rollback

**Immediate off-switch:** set `OUTBOUND_DELIVERY_TELEMETRY_ENABLED` to anything other than `1` (or clear the project-code setting). The Lambda sends normally and writes no new events.

**Code rollback:** deploy the preceding Lambda bundle; the optional metadata arguments are backwards compatible. **Data rollback:** retain the additive event table for forensic continuity; it receives no new rows when the switch is off. Do not delete production events.

## File Structure

### MBS Lambda repository: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs`

- `db/migrations/2026-09-26-outbound-delivery-events.sql` — shared, append-only delivery evidence table and indexes.
- `utils/outbound-delivery-events.js` — validates opt-in metadata, converts listener response/error into safe events, and writes fail-open to `ops.outbound_delivery_events`.
- `utils/sendMessage.js` — optional telemetry metadata boundary around existing standalone and mention sends; no listener payload change.
- `handlers/safety-handlers.js` — attaches `wbgt_advisory` metadata to the MBS WBGT advisory only.
- `usecases/health_safety/water_parade_reminder.js` — attaches `water_parade_reminder` metadata to Water Parade only.
- `tests/test-outbound-delivery-events.js` — unit contract for event construction and writer failure behavior.
- `tests/test-send-message-telemetry.js` — Axios payload/return/error characterization with opt-in telemetry transitions.
- `tests/test-wbgt-delivery-telemetry.js` — verifies the two MBS flows supply the right distinct metadata and retain fail-soft behavior.

### HALO repository: `/Users/wentilabs/Desktop/usecase-centralised-ops-dashboard-qaqc-feature`

- `docs/superpowers/specs/2026-09-26-data-health-service-design.md` — clarify that normalized source-delivery events are produced in `ops.outbound_delivery_events`; no HALO runtime/UI implementation in this source-evidence phase.

## Interfaces

```js
// utils/outbound-delivery-events.js
// `null` means telemetry is disabled or unconfigured.
function mbsWbgtTelemetry(messageClass) -> {
  sourceSystem: 'mdw-lambda-wh-mbs',
  sourceService: 'wbgt',
  sourceProjectCode: string,
  messageClass: 'wbgt_advisory' | 'water_parade_reminder'
} | null

// Writes one immutable event. It resolves false after logging a telemetry error;
// it never rejects a message-send caller.
async function writeOutboundDeliveryEvent(event, { client = getSupabaseClient(), now = () => new Date(), id = randomUUID } = {}) -> boolean

// Calls `send` unchanged and writes intent/attempted/terminal telemetry when telemetry is non-null.
async function sendWithDeliveryTelemetry({ chatId, clientId, telemetry, send, responseToEvent }) -> unknown
```

The send helpers gain a final optional `telemetry = null` argument:

```js
sendWhatsAppMessage(chatId, message, clientId, timeout, telemetry)
sendWhatsAppMessageWithMentions(chatId, message, clientId, timeout, telemetry)
```

`telemetry` is internal metadata only. It is never included in a listener HTTP payload.

## Tasks

### Task 1: Add the append-only source-delivery schema

**Files:**
- Create: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs/db/migrations/2026-09-26-outbound-delivery-events.sql`
- Modify: `docs/superpowers/specs/2026-09-26-data-health-service-design.md`
- Test: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs/tests/test-outbound-delivery-events.js`

**Consumes:** the MBS/Lambda source identity and Data Health's normalized-attempt requirement.

**Produces:** the `ops.outbound_delivery_events` SQL contract and an explicit Data Health source table name for later read adapters.

- [ ] **Step 1: Write SQL contract assertions in `tests/test-outbound-delivery-events.js`**

```js
assert.match(sql, /create table ops\.outbound_delivery_events/i);
assert.match(sql, /provider_accepted/);
assert.match(sql, /unique \(attempt_id, event_type\)/i);
assert.match(sql, /source_service, source_project_code, message_class, destination_chat_id, occurred_at/i);
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `node tests/test-outbound-delivery-events.js`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Create the additive migration**

Create the `ops` schema if absent, create the table and the two indexes defined in the feature briefing, and grant only the existing service-role/runtime access used by the MBS and future Data Health services. Do not expose this telemetry table through HALO/PostgREST for browser access.

- [ ] **Step 4: Amend the Data Health design's delivery section**

Name `ops.outbound_delivery_events` as the source-owned normalized evidence feed. State that Data Health reads it with server credentials and that receipt events are a later additive producer capability.

- [ ] **Step 5: Run the contract test to verify it passes**

Run: `node tests/test-outbound-delivery-events.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs add db/migrations/2026-09-26-outbound-delivery-events.sql tests/test-outbound-delivery-events.js
git -C /Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs commit -m "feat: add outbound delivery event schema"
git add docs/superpowers/specs/2026-09-26-data-health-service-design.md
git commit -m "docs: define source delivery evidence feed"
```

### Task 2: Build the fail-open delivery-event writer

**Files:**
- Create: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs/utils/outbound-delivery-events.js`
- Modify: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs/tests/test-outbound-delivery-events.js`

**Consumes:** Task 1's immutable event vocabulary and the existing `getSupabaseClient()` service-role client.

**Produces:** `mbsWbgtTelemetry`, `writeOutboundDeliveryEvent`, and pure response/error classification functions used by Task 3 and Task 4.

- [ ] **Step 1: Add failing unit cases for the telemetry configuration and event transitions**

```js
assert.equal(mbsWbgtTelemetry('wbgt_advisory'), null, 'disabled config emits no metadata');
assert.deepEqual(classifyListenerResponse(responseFor(chatId, 1)), {
  eventType: 'provider_accepted', providerAck: 1, providerMessageId: 'true_chat_message', httpStatus: 200,
});
assert.equal(classifyListenerResponse({ success: false }, chatId).eventType, 'provider_rejected');
assert.equal(classifySendError({ response: { status: 502 } }).eventType, 'transport_failed');
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `node tests/test-outbound-delivery-events.js`

Expected: FAIL because the module exports do not exist.

- [ ] **Step 3: Implement `utils/outbound-delivery-events.js`**

Use `crypto.randomUUID()` only when telemetry is enabled. Validate the message class and nonblank deployment project code. `ack === 0` emits `provider_pending`; `ack >= 1` with a successful matching destination result and message ID emits `provider_accepted`; malformed/negative results emit `provider_rejected`. Reduce an Axios error to an HTTP status and a bounded category (`timeout`, `http_4xx`, `http_5xx`, `network`, `unknown`)—never persist a raw error, request, response, or message text.

Write each event through `getSupabaseClient().schema('ops').from('outbound_delivery_events').insert(...)`. Catch/log every telemetry failure and return `false`; do not throw. `intent` and `attempted` use the same generated `attempt_id`, while terminal events retain it.

- [ ] **Step 4: Add writer-failure and event-identity tests**

```js
const attempts = await recordAttempt({ telemetry, chatId }, failingWriter);
assert.equal(attempts, false);
assert.equal(sendWasNotCalledByTheWriter, true);
assert.notEqual(firstAttempt.attempt_id, secondAttempt.attempt_id);
assert.equal(firstAttempt.source_project_code, 'MBS');
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `node tests/test-outbound-delivery-events.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs add utils/outbound-delivery-events.js tests/test-outbound-delivery-events.js
git -C /Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs commit -m "feat: add fail-open delivery telemetry writer"
```

### Task 3: Instrument the two generic MBS send boundaries without changing their listener contracts

**Files:**
- Modify: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs/utils/sendMessage.js:62-122`
- Create: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs/tests/test-send-message-telemetry.js`

**Consumes:** Task 2's telemetry writer and response classification interfaces.

**Produces:** opt-in event sequences around standalone and mentions sends; every existing sender call remains compatible.

- [ ] **Step 1: Write Axios boundary characterization tests**

```js
const result = await sendWhatsAppMessage(chatId, 'same body', clientId, 30000, telemetry);
assert.deepEqual(postedPayload, { chatId, message: 'same body', clientId });
assert.deepEqual(result, listenerResponse);
assert.deepEqual(eventTypes, ['intent', 'attempted', 'provider_accepted']);

await assert.rejects(() => sendWhatsAppMessage(chatId, 'same body', clientId, 30000, telemetry), /502/);
assert.deepEqual(eventTypes, ['intent', 'attempted', 'transport_failed']);
```

- [ ] **Step 2: Run the sender test to verify it fails**

Run: `node tests/test-send-message-telemetry.js`

Expected: FAIL because the helpers have no telemetry argument/events.

- [ ] **Step 3: Add the final optional telemetry argument to both send helpers**

Keep the current Axios endpoint, payload, timeout, log copy, resolved return value, and thrown error exactly intact. When metadata is null, take the current code path with no telemetry work. When present, emit `intent` before the outbound decision, `attempted` immediately before Axios, then a classified terminal event after response/error. Await the writer only through its fail-open interface so an insert failure cannot prevent Axios or alter the original error.

- [ ] **Step 4: Add disabled and malformed-response regression cases**

```js
await sendWhatsAppMessage(chatId, body, clientId, timeout, null);
assert.equal(eventCalls.length, 0);
assert.deepEqual(eventTypesFor({ success: true, results: [] }), ['intent', 'attempted', 'provider_rejected']);
```

- [ ] **Step 5: Run the sender test to verify it passes**

Run: `node tests/test-send-message-telemetry.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs add utils/sendMessage.js tests/test-send-message-telemetry.js
git -C /Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs commit -m "feat: instrument opt-in WhatsApp delivery attempts"
```

### Task 4: Opt in only the MBS WBGT advisory and Water Parade paths

**Files:**
- Modify: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs/handlers/safety-handlers.js:3258-3279`
- Modify: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs/usecases/health_safety/water_parade_reminder.js:290-300`
- Create: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs/tests/test-wbgt-delivery-telemetry.js`

**Consumes:** Task 2's `mbsWbgtTelemetry` and Task 3's final optional send-helper metadata argument.

**Produces:** the first two correctly scoped source-delivery producers for Data Health.

- [ ] **Step 1: Write flow-specific failing tests**

```js
assert.deepEqual(capturedWbgtSend.telemetry, telemetryFor('wbgt_advisory'));
assert.deepEqual(capturedWaterParadeSend.telemetry, telemetryFor('water_parade_reminder'));
assert.equal(wbgtResult.data.messageSent, true, 'acceptance path keeps existing response');
assert.equal(waterParadeResult.ok, false, 'send failure remains non-blocking to its caller');
```

- [ ] **Step 2: Run the flow test to verify it fails**

Run: `node tests/test-wbgt-delivery-telemetry.js`

Expected: FAIL because neither flow supplies telemetry metadata.

- [ ] **Step 3: Pass explicit telemetry to the two sends**

Pass `mbsWbgtTelemetry('wbgt_advisory')` only to `processWBGTReadingFromAPI`'s standalone advisory call. Pass `mbsWbgtTelemetry('water_parade_reminder')` only to `runWaterParadeReminderTick`'s mention send. Do not attach it to other helpers, images, documents, or replies. Do not add `project_code` to `/wbgt-reading`; deployment configuration remains the exact source identity boundary.

- [ ] **Step 4: Run targeted and existing behavior tests**

Run: `node tests/test-wbgt-delivery-telemetry.js && node tests/test-water-parade-reminder.js && node tests/test-wbgt-e2e.js`

Expected: PASS. The E2E continues to suppress WhatsApp because `USE_LOCAL_ENV=true`; it is not proof of production delivery telemetry.

- [ ] **Step 5: Commit**

```bash
git -C /Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs add handlers/safety-handlers.js usecases/health_safety/water_parade_reminder.js tests/test-wbgt-delivery-telemetry.js
git -C /Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs commit -m "feat: emit MBS WBGT delivery evidence"
```

### Task 5: Deploy safely and establish the source-feed contract

**Files:**
- Modify: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs/README.md`
- Test: `/Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs/tests/test-outbound-delivery-events.js`

**Consumes:** Tasks 1–4's table and source-event behavior.

**Produces:** operationally safe enablement instructions and a durable contract for the next Data Health implementation plan.

- [ ] **Step 1: Add a failing documentation/contract assertion**

```js
assert.match(readme, /OUTBOUND_DELIVERY_TELEMETRY_ENABLED/);
assert.match(readme, /OUTBOUND_DELIVERY_TELEMETRY_PROJECT_CODE/);
assert.match(readme, /ack: 1.*accepted/i);
assert.match(readme, /not.*delivered|not.*read/i);
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `node tests/test-outbound-delivery-events.js`

Expected: FAIL because the deployment contract is undocumented.

- [ ] **Step 3: Document deployment, canary, and rollback**

Document the two environment variables; initial exact value `MBS`; the required migration-before-toggle order; a read-only validation query that counts event types without printing message bodies; and the immediate off-switch. State explicitly that Data Health must display `Provider accepted` for `provider_accepted` until a listener implementation emits and persists receipt events.

- [ ] **Step 4: Run the full relevant regression suite**

Run: `node tests/test-outbound-delivery-events.js && node tests/test-send-message-telemetry.js && node tests/test-wbgt-delivery-telemetry.js && node tests/test-water-parade-reminder.js && node tests/test-wbgt-e2e.js`

Expected: PASS. Also run the repository's documented pre-deploy test command if one exists; record any credential-dependent/live checks separately.

- [ ] **Step 5: Perform deployment verification after explicit production-change approval**

Apply the additive migration, deploy with telemetry disabled, then set `OUTBOUND_DELIVERY_TELEMETRY_ENABLED=1` and `OUTBOUND_DELIVERY_TELEMETRY_PROJECT_CODE=MBS`. Observe one normal scheduled WBGT delivery and verify immutable `intent → attempted → provider_accepted` rows for its `attempt_id`. Do not send a special customer-facing test message.

- [ ] **Step 6: Commit**

```bash
git -C /Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs add README.md tests/test-outbound-delivery-events.js
git -C /Users/wentilabs/Desktop/code-repo/mdw-lambda-wh-mbs commit -m "docs: describe MBS delivery telemetry rollout"
```

## Self-Review

**Spec coverage:** The plan implements the spec's normalized outbound-attempt prerequisite, expected/attempted/provider-acceptance distinction, unsupported-receipt honesty, source-project identity safety, append-only evidence, backwards compatibility, testing, and staged rollout. It intentionally does not create the Data Health runtime, policy tables, HALO tab/card, incidents, or notifier; those depend on this source feed but form a separate independently deployable project.

**Step scan:** Every implementation task begins with a failing test, names concrete files/interfaces, preserves the exact existing send contract, and ends with focused verification and a commit.

**Type consistency:** `mbsWbgtTelemetry` produces the optional `telemetry` object accepted by both send functions; Task 3 creates transitions that Task 1's SQL vocabulary permits; Task 4 is the only caller that supplies MBS WBGT metadata.

**Review focus:** The five risky boundary cases are each assigned to Tasks 2–4, where their assertions are explicit.

**Proportion:** This plan is deliberately limited to the MBS evidence producer. The Data Health service and HALO UI remain a subsequent plan because neither can be shipped or meaningfully tested before this source telemetry contract exists.
