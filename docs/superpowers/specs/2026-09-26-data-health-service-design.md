# Data Health Service Design

## Goal

Create a separately deployed Data Health service that detects delayed, missing,
or unexpectedly sparse source data and unhealthy outbound delivery for every
project configured in HALO, then notifies dedicated operations WhatsApp groups.
HALO configures and explains the monitor; it never runs scans or sends
messages.

## Product decision

Data Health is a first-class HALO operational surface that is surfaced inside
each existing source-service project card. Its compact health row appears below
that card's sheet and action links, while a dedicated Data Health tab provides
the cross-project operational view. It is not added to the seven-member
`ServiceKey` source-service registry.

The source registry represents one runtime configuration per project code and
feeds canonical aliases. Data Health instead needs multiple policies for one
canonical project: one per monitored source service. Adding it to that registry
would invent an alias, make valid multi-policy projects look ambiguous, and
change existing onboarding, chat scope, and generated OpenAPI behavior. A
dedicated surface preserves all seven source-service contracts.

## Customer behavior

An authorized operator can open the **Data health** row on any source-service
card, select that card's canonical project and source service, then create a
disabled health policy. The same policy is available from the dedicated Data
Health tab. After choosing operations recipient groups and enabling it, the
scheduled Data Health service evaluates the policy.

Each card answers:

1. Is monitoring enabled?
2. Does it check stale data, population decline, outbound delivery, or a
   combination?
3. When was each dimension last evaluated and what is its current state?
4. Which operations groups receive incident and recovery messages?

Examples:

- `Healthy — 184 rows in the last 15 min; newest reading 2 min ago`
- `Warning — 41 rows, 63% below comparable baseline`
- `Critical — no new reading for 47 min`
- `Monitor unavailable — source query timed out`
- `Delivery: Warning — 3 send attempts failed in the last completed window`
- `Delivery: Provider accepted — no delivery receipt is available`

The last state must never claim that source data is missing.

## Architecture

```text
HALO Data Health cards
        | authenticated policy configuration
        v
data_health.project_health_configs <--> ops.projects
        |                                  canonical aliases
        v
Scheduled Data Health service
        |--> allow-listed, read-only probe adapters --> source schemas
        |--> observations, incidents, delivery attempts
        '--> WhatsApp notification adapter --> operations groups
```

The Data Health runtime owns its scheduled endpoint, probe catalog,
observations, incident state, notification adapter, and versioned contract. It
accepts only validated policy IDs and never interpolates an operator-supplied
table or column name. HALO owns cards, authorization, configuration edits,
audit annotation, and recipient-name rendering.

## Scope

Included:

- WBGT, Noise, Haze, Lightning, Ailytics, Subcon Activities, and Issue Chaser
  when the canonical project has the corresponding approved alias.
- Staleness and completed-window population-trend monitoring.
- Outbound delivery monitoring: expected attempts, provider acceptance,
  persistent send failures, and delivery/read receipts where available.
- Per-project-and-source recipients, cooldowns, mutes, recovery messages,
  observations, incidents, and delivery history.
- A compact Data health row within every eligible source-service card, plus a
  dedicated Data Health tab for estate-wide operations.

Excluded:

- Free-form SQL, user-entered table names, or arbitrary column selection.
- Repairing data, replaying jobs, or altering customer-facing alert settings.
- Replacing source-service logs or deployment observability.
- Matching projects by similar codes across schemas; only `ops.projects` and
  its approved aliases establish identity.

## Policy configuration and cards

One policy represents one `(canonical project, source service)` pair. The
runner resolves that source's current alias from
`ops.projects.service_aliases` on every run. Its stored `project_code` is
only a display label, synchronized from `primary_alias`; it is never used to
join source data.

| Field | Meaning | Default |
|---|---|---|
| `enabled` | Permits scheduled evaluation and notification. | `false` |
| `canonical_project_id` | Identity in `ops.projects`. | required |
| `source_service` | One of the seven source services. | required |
| `project_code` | Synchronized card/audit display label. | derived |
| `data_checks` | `staleness`, `volume_trend`, or both. | both |
| `delivery_checks` | `expected_attempt`, `provider_acceptance`, and, when supported, `receipt`. | `expected_attempt`, `provider_acceptance` |
| `sensitivity` | `relaxed`, `standard`, or `strict`. | `standard` |
| `recipient_group_ids` | Operations WhatsApp group IDs. | required before enable |
| `notification_cooldown_minutes` | Minimum unresolved-reminder interval. | 360 |
| `notify_on_recovery` | Sends recovery after an incident closes. | `true` |
| `muted_until` | Explicit, time-bounded operational mute. | `null` |

The editor groups fields as **Status**, **Data health**, **Delivery health**,
**Sensitivity**, and **Operations delivery**. `enabled` is first. A policy
cannot be enabled without at least one applicable probe and recipient group.

Every eligible source-service card gains a compact **Data health** row directly
below its sheet/action links. It shows two independently coloured indicators:
green for healthy, amber for warning or collecting baseline, red for critical
or monitor unavailable, and neutral grey for disabled, not configured, or
unsupported telemetry. A capability label such as `Provider accepted` remains
written beside its colour; it is never shown as `Delivered` without a receipt.
The row opens that source service's health-policy editor and history; on a
phone, the same content appears in the existing detail sheet.

The expanded Data Health policy view retains HALO conventions: enabled/disabled
status, pills for `Stale data` and `Volume trend`, a toned warning pill for an
active incident, `Checks every …` cadence wording, group-name chips, and Viso
links when configured. The dedicated Data Health tab presents the same policies
as cards for estate-wide filtering and triage, but a policy remains anchored to
the source card that owns its project/service pair.

## Data model

The Data Health service owns a new `data_health` schema. Its configuration
table is exposed to PostgREST for HALO's live schema introspection. State and
history are read-only in HALO.

### `data_health.project_health_configs`

This configuration table has UUID `id`, the policy fields above, timestamps,
a foreign key to `ops.projects(id)`, and a unique constraint on
`(canonical_project_id, source_service)`. A trigger synchronizes
`project_code` when a canonical primary alias changes.

Attach the existing `ops.record_config_change('id')` trigger so the shared
audit trail records policy changes, authenticated operator, and note. Do not
attach it to runtime-state tables.

### `data_health.probe_observations`

Append-only evaluation evidence: policy ID, probe key, health dimension
(`data` or `delivery`), evaluation time, current completed window, row count,
newest source event, baseline value, normalized ratio, outcome (`healthy`,
`warning`, `critical`, `unknown`), and a structured reason. Delivery evidence
also carries expected, attempted, provider-accepted, delivery-confirmed, and
read-confirmed counts where the source/provider exposes them. Retention is an
explicit operational policy, never implicit deletion during a scan.

### `data_health.incidents`

One current lifecycle record per policy and probe condition, including severity,
opened/updated/resolved times, evidence reference, mute/escalation state, and
last notification time. A unique open-incident key prevents concurrent runs
from sending duplicate first alerts.

### `data_health.notification_deliveries`

Immutable attempt log: incident ID, recipient chat ID, message kind
(`opened`, `escalated`, `reminder`, `recovered`), provider message ID,
attempt time, and outcome. A delivery failure is visible without reopening or
duplicating the incident.

### `ops.outbound_delivery_events`

This is the common, append-only evidence feed written by source services; it
does **not** belong to HALO's browser-facing configuration surface. Data Health
reads it with server credentials and derives delivery observations from it.
Every service that sends a customer-facing WhatsApp message adopts this same
contract in the Lambda or worker that actually calls its WhatsApp provider.
One sender cannot stand in for another: MBS records MBS sends, the Noise
sender records Noise sends, and so on.

Each event includes:

| Field | Meaning |
|---|---|
| `attempt_id` | UUID for one destination send attempt; all transitions for that attempt share it. |
| `delivery_intent_key` | Optional stable key for retries of one logical scheduled/event-triggered message. Without it, retries are not inferred. |
| `event_type` | `intent`, `attempted`, `provider_pending`, `provider_accepted`, `provider_rejected`, `transport_failed`, `device_delivered`, or `read`. |
| `source_system` | Stable identifier for the Lambda or worker that emitted the event. |
| `source_service` | One of HALO's seven source-service keys. |
| `source_project_code` | The source service's exact configured alias. It is never inferred from a chat ID, group name, or similar project code. |
| `message_class` | Catalog-defined notification class, such as `hourly_report`, `threshold_alert`, or `water_parade_reminder`. |
| `destination_chat_id`, `client_id` | Destination and sending-account correlation dimensions. |
| `provider_message_id`, `provider_ack` | Nullable provider evidence. Raw provider acknowledgements are normalized by the producing adapter. |
| `http_status`, `error_kind` | Nullable safe transport/provider-failure classification; never raw errors or response bodies. |
| `occurred_at` | UTC time at which this immutable transition happened. |

The table has a UUID primary key, a uniqueness constraint on
`(attempt_id, event_type)`, and indexes for policy-window reads
(`source_service`, `source_project_code`, `message_class`,
`destination_chat_id`, `occurred_at DESC`) and later provider-message receipt
reconciliation. It stores no message body, attachment URL, mention target,
secret, request payload, or stack trace.

The emitter writes `intent` when it has made a decision to send to one
destination, `attempted` immediately before the provider call, and one
terminal/provider event after the response or error. Writing telemetry is
fail-open: an event-store error is logged safely but never suppresses or
changes an existing customer message. A source may use `delivery_intent_key`
to group its own retries. Data Health never guesses retry linkage from text,
chat ID, or timing alone.

## Probe catalog and health rules

A code-and-contract-defined catalog is the only place source schemas and table
names are named. Every probe declares a stable key, source service, authorized
source/view/function, alias resolver, project scope, event-time field, expected
interval, comparison window, supported data and delivery checks, sensitivity
thresholds, delivery-evidence capability, and human-readable copy.

A probe may use a narrowly scoped view or `security definer` function. The
runtime receives read-only source-data access and a separate credential limited
to writing its own schema.

For staleness, standard sensitivity warns after two expected intervals and is
critical after four. Relaxed multiplies bounds by 1.5; strict uses 0.75. A
missing historical event or insufficient baseline is `unknown`, not stale.

For volume trend, the current **completed** window is compared to the median of
the preceding 14 equivalent completed windows. At standard sensitivity, a ratio
below 0.50 warns and below 0.20 is critical. Relaxed and strict use
catalog-declared multipliers. A zero or insufficient baseline is `unknown`,
never a volume-loss alert.

The policy outcome is the highest applicable probe outcome. Query timeout,
schema drift, or permission failure becomes the distinct `monitor unavailable`
condition after two failed runs. It states that monitoring failed rather than
asserting data loss.

### Delivery health

Delivery health is evaluated separately from data health. A delivery-capable
probe compares scheduled or event-triggered delivery expectations with the
source service's normalized `ops.outbound_delivery_events` records. Its catalog
declares the exact supported `message_class` values, the source alias resolver,
the expected-message rule, grace period, and whether that rule supplies a
stable `delivery_intent_key`. It warns when an expected intent has not appeared
after its catalog grace period, and warns or becomes critical when provider
rejections or **source-correlated** exhausted retries exceed the declared
threshold. A provider-accepted message is healthy for acceptance, but is not
called delivered.

Delivery and read receipts are shown only when the configured WhatsApp provider
returns and persists them as `device_delivered` or `read` events. The producer,
not Data Health, maps its provider-specific acknowledgement values to these
normalised event types. For the current WhatsApp Web listener convention,
`ack: 1` means server accepted, `ack: 2` device delivered, and `ack: 3` read;
Data Health stores the raw acknowledgement only as supporting evidence.

The capability is per policy and per message class—not a global switch:

| Source adapter capability | Data Health check and card copy |
|---|---|
| no compatible event feed | `Delivery: not monitored` (neutral grey) |
| `intent`/`attempted` only | expected-attempt gap where the catalog can define expectations; otherwise `Delivery: attempts recorded` |
| provider terminal events | provider-acceptance/rejection health; successful state is `Delivery: Provider accepted` |
| source-correlated retry key | persistent/exhausted retry health |
| persisted delivery/read events | delivery/read health with `Delivered` or `Read` labels |

Data checks remain available for every eligible policy even when its delivery
adapter is not installed. Missing delivery telemetry is never converted into a
failed-delivery assertion, and one service's telemetry outage cannot change
another service's card.

### Source-adapter rollout

The common event feed applies to every HALO source service: WBGT, Noise, Haze,
Lightning, Ailytics, Subcon Activities, and Issue Chaser. Each source service
owns its adapter because only its sender knows whether a message was actually
intended, retried, suppressed, or handed to the provider. The adapter must use
the source row's exact configured project alias and must not make a cross-table
project match.

MBS WBGT is the first verified adapter because its live listener response
already exposes a provider message ID and acknowledgement. It is a pilot, not
a special product scope. Its two initial message classes are WBGT advisory and
Water Parade reminder. The remaining services adopt the same contract at their
own outbound boundary before Data Health enables their delivery checks. HALO
continues to render their delivery state as `not monitored` until that happens.

## Notifications

Messages are operational; they never reuse customer-facing templates or
recipients. A message identifies canonical project, source service, health
dimension, probe, severity, observed count or source-data age, delivery
attempt/acceptance/receipt evidence where relevant, detected Singapore time,
and a HALO card link when available. It omits raw database errors and secrets.

The runner sends once when an incident opens, again on escalation, then only
after the configured cooldown while unresolved. It sends one recovery when
healthy evidence returns and `notify_on_recovery` is true. A policy without
recipients is invalid before enablement. Failed WhatsApp sends are recorded and
retried under an idempotency key without creating another incident.

## HALO integration

HALO adds a dedicated Data Health repository adapter, route family, and screen
instead of widening `lib/services.ts`. This preserves the existing source
registry, canonical aliases, source-service onboarding, chat scope, and
generated OpenAPI service enum.

The UI adds:

- a Data Health tab with filter, refresh, cards, responsive details, and an
  isolated service/schema error;
- a compact Data health row below the existing action and sheet links on every
  eligible `ProjectCard`, including independent Data and Delivery colours and
  its disabled, baseline, healthy, warning, critical, and monitor-unavailable
  states;
- a source-card entry point that preselects that card's canonical project and
  source service, and offers only aliases present on the canonical project;
- the existing GroupPicker, group-alias store, and Viso support for
  `recipient_group_ids`; and
- read-only observation, incident, and delivery history beneath policy editing.

The Data Health contract records its schema, table, identity, scheduled route,
authentication, policy fields, and catalog probe keys. HALO uses it to enrich,
not replace, live schema introspection.

## Compatibility, migration, and rollback

The migration is additive: create the schema, configuration/state tables,
`ops.outbound_delivery_events`, indexes, RLS, constraints, audit attachment,
and PostgREST exposure for configuration only. It does not change any
source-service table, route, scheduler, message, authentication mode, or
configuration meaning. Source-event writers use server credentials; the event
table is not browser-exposed through PostgREST.

No project gets a policy automatically. A new policy is disabled and reports
`Collecting baseline` before enough evidence exists. Missing canonical
identity, alias, or catalog probe makes it visibly ineligible and sends no
notification. An unreadable Data Health schema is an isolated HALO error and
cannot blank existing tabs.

The immediate policy off-switch is `enabled = false`; the service-wide
off-switch is disabling its external scheduler. Each source adapter also has a
deployment-level telemetry off-switch, which stops new event writes without
changing customer sends. Rollback retains additive evidence tables but can
safely revert application code. No source-data migration needs reversal.

## Verification and rollout

The Data Health service requires unit tests for thresholds, baselines,
sensitivity, unknown state, source-query failures, expected-delivery gaps,
provider rejection, receipt capability, incidents, cooldowns, recovery, and
idempotency; contract tests for route/schema/catalog parity and each
source-adapter capability; scenario tests for healthy, stale, low-volume,
monitor-failure, muted, disabled, concurrent, delivery-failure, and
receipt-unavailable paths; and opt-in read-only integration checks.

Every source adapter requires characterization tests that its existing listener
payload, message recipient/content, endpoint, response, retry behavior, and
failure semantics are unchanged with telemetry disabled and enabled. It also
requires event-sequence tests for accepted, rejected, transport-failed, and
receipt-unavailable outcomes before its policy capability can be enabled.

HALO requires characterization tests proving seven-service behavior is
unchanged, plus coverage for placement below existing action/sheet links, card
rendering, mobile detail behavior, group-name resolution, recipient validation,
concurrency conflicts, audit annotation, canonical-project association,
RLS/audit SQL, and fanout isolation.

Rollout: deploy the additive migration with all source adapters disabled;
deploy each adapter independently and certify its event sequence against a
non-customer test or normal controlled send; deploy HALO's read-only cards;
then enable Data Health's scheduler. Enable production policies one at a time
after baseline collection, recipient confirmation, and verification that the
policy's declared delivery capability matches its source adapter. MBS WBGT is
the initial canary; it does not unlock delivery monitoring for the other six
services.

## Acceptance criteria

- Any canonical project/source-service pair with an approved alias and catalog
  probe can create a disabled policy and enable it later.
- Every eligible source-service card shows its Data health row directly below
  its existing action/sheet links, with an unambiguous configuration or health
  state on desktop and mobile.
- The runner detects evidence-backed staleness and population decline without
  reporting insufficient data or failed monitoring as data loss.
- Delivery health distinguishes expected attempts, provider acceptance, and
  confirmed delivery/read receipts; unsupported telemetry is visibly not
  monitored rather than treated as a delivery failure.
- Every delivery-enabled source service emits the common event contract with
  its exact source alias; a source without a certified adapter remains clearly
  unmonitored without disabling its data-health checks.
- Incidents are deduplicated, escalation-aware, recoverable, and auditable.
- Project-code collisions cannot cause cross-service or cross-project scans.
- Existing HALO behavior and all seven source-service contracts retain their
  prior behavior by default.
