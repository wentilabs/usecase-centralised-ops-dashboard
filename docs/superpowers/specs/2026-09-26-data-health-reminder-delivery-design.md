# Data Health Reminder Delivery Design

## Decision and scope

This is the second phase of Data Health. It adds reminders for the automatic
WBGT and Noise ingestion-health pilot while retaining the approved rule that
HALO is a configuration and display surface, never a WhatsApp sender.

The implementation is a **dedicated, platform-wide Data Health worker**. It
reads the same shared Supabase project as HALO and is deliberately not owned by
the MBS Lambda: MBS proves the listener protocol, but Data Health must apply to
all HALO projects as sources are added. The worker uses each project's existing
sender configuration rather than one global sending account.

The initial canary comprises the WBGT `TEST` project and the Noise `TEST`
project. They use the same dedicated internal WhatsApp group but are two
independent deliveries: each resolves its own sender configuration, incident,
retry queue, and provider outcome. The group ID is entered through HALO after
deployment; it is not committed to source, a migration, an environment default,
or a message fixture. Project codes are only unique within a service, so the
canary runbook always names both the source service and `TEST`.

Only WBGT and Noise are delivery-enabled in this phase. The remaining five
HALO services retain neutral Data Health status and receive no new fields or
messages until their source-table and sender contracts have been independently
verified.

## Customer behavior

Every WBGT and Noise project remains automatically monitored. A project sends
Data Health reminders only after an operator configures its dedicated
`data_health_group_ids` field. This field is a normal HALO group picker and is
the **only** Data Health destination: the worker must never fall back to the
project's existing customer-alert, expiry-alert, Water Parade, or other group.

For a configured project:

| Observed transition/state | Delivery behavior |
| --- | --- |
| green → amber | Send one amber alert immediately; repeat every 12 hours while amber. |
| green/amber → red | Send one red alert immediately; repeat every 6 hours while red. A red transition does not wait for the amber interval. |
| amber/red → green | Send one recovery message, but only if the incident previously had a notification due to a configured destination. |
| group added while amber/red | Send the current-state alert on the next evaluation; this permits a safe TEST canary without fabricating source data. |
| group cleared, sender removed, or project becomes unsupported | Keep monitoring visible in HALO; cancel unsent work and send nothing. |

The canary message body is deliberately operational and standalone:

```text
⚠️ Data Health — TEST (<service>)
Status: No recent data
Latest receipt: 26 Sept, 16:14 SGT
```

Amber uses `Status: Delayed`. Recovery is:

```text
✅ Data Health — TEST (<service>) recovered
Latest receipt: 26 Sept, 17:22 SGT
```

Messages contain no table names, raw query/provider errors, credentials, or
customer alert formatting.

## Architecture and routing

```text
EventBridge hourly evaluation
  -> Data Health worker
       -> WBGT/Noise config + derived readings table reads
       -> atomic incident/outbox state transition in ops

EventBridge every-minute delivery tick
  -> Data Health worker
       -> atomically claim due outbox record
       -> source-specific delivery adapter
            -> configured lambda_url with configured client_id
            -> configured data_health_group_ids
       -> immutable attempt record + retry/outbox transition

HALO
  -> configures data_health_group_ids through normal source-table editing
  -> reads Health state and notification history summaries only
  -> never owns sender credentials or makes a WhatsApp call
```

The WBGT and Noise configuration contracts already establish the sender inputs:
`lambda_url` is the project send-message endpoint and `client_id` identifies the
sending account. A source-specific adapter validates and translates these
settings into that source's established listener payload (the MBS-proven shape
is `{ chatId, message, clientId }`). No adapter may infer, substitute, or share
a sender between projects. `instance_name` remains a source-runtime setting;
it is included only when that source's documented sender contract requires it.

The worker owns the ingestion thresholds already approved for the card pilot:
WBGT and Noise are both amber at 1 hour/red at 4 hours.
It reads the newest row by authoritative `created_at`, using the existing
derived table-name convention. The policy has explicit `now` input and matching
boundary tests; it does not call HALO to decide a state.

## Persistence and migrations

All persistence changes are forward-only and additive. No source reading row is
changed, backfilled, or deleted.

### Source configuration tables

The WBGT and Noise source repositories each add a nullable text column named
`data_health_group_ids` to their respective project configuration table. It is
a comma-separated list of WhatsApp group IDs using the same stored format that
HALO's `GroupPicker` already writes. NULL, blank, and whitespace-only all mean
no recipient and preserve silent legacy behavior.

HALO will expose the field through its normal schema introspection, with a
WBGT/Noise field-provider overlay that supplies the label **Data Health groups**,
the group picker, and clear help that these are internal operations recipients,
not client alert recipients. Its group column is added to `GROUP_COLUMNS` so
the alias store resolves group names normally. No Data Health setup dialog or
policy table is added to HALO.

### Server-only worker state

The worker migration creates three `ops` tables. They are not exposed to
PostgREST/browser users and are accessible only to the worker's service role.

1. `ops.data_health_incidents` has one current row per
   `(source_service, project_code, condition)`. It stores current tone,
   first/last observed timestamps, newest receipt timestamp, a monotonic
   revision, and whether the current incident has ever had a notification
   destination.
2. `ops.data_health_notification_deliveries` is the durable outbox. It stores
   incident revision, kind (`opened`, `escalated`, `repeat`, `recovered`),
   destination, the sender configuration snapshot needed for that delivery,
   state, due/claim timestamps, retry number, and final outcome. A uniqueness
   constraint makes one destination/kind/incident revision idempotent.
3. `ops.data_health_notification_attempts` is append-only: delivery id,
   attempt number, timestamp, provider outcome/status, and provider message ID
   where supplied. It stores a bounded error classification, not a raw response
   body or message content.

An atomic SQL function claims a single due delivery with a short lease before
the HTTP call. A second worker invocation cannot claim the same delivery, and
an expired lease can safely be reclaimed after a crash.

## Retry, recurrence, and failure behavior

The hourly evaluator only creates work; it never sleeps or retries inline. The
every-minute delivery tick handles current and retrying work.

For each due delivery the worker makes one initial call. If it fails, it records
the attempt and queues three retries with delays measured from the immediately
preceding failure:

| Attempt | Delay before attempt |
| --- | --- |
| initial | none |
| retry 1 | 1 minute |
| retry 2 | 3 minutes |
| retry 3 | 5 minutes |

After the third retry fails, the outbox delivery becomes `exhausted`. The next
amber/red repeat remains eligible at its regular 12/6-hour cadence, calculated
from the original due delivery rather than from a retry. This bounds a broken
recipient/sender to four attempts per reminder window. Successful sends become
`delivered`; a provider message ID is recorded when the existing source sender
returns one. This means **provider accepted**, not read or recipient delivery.

Before every attempt, the worker re-reads the current source config. If the
destination or sender no longer matches the queued snapshot, it marks the work
cancelled and does not send to a stale group. Any configuration, table-read, or
incident-state error fails closed: it is recorded for operators but cannot be
turned into a guessed destination or a notification blast.

## Invocation, compatibility, and rollout

Two new EventBridge Rules invoke the dedicated worker: one hourly evaluation
and one every-minute delivery dispatch. The worker has a global
`DATA_HEALTH_DELIVERY_ENABLED=0` default. Monitoring/evaluation can run with
the switch off, but no delivery row may call WhatsApp until it is explicitly
enabled after the canary migration and configuration are verified.

This is additive to existing WBGT and Noise routes and message semantics. It
does not modify their cron endpoints, change their client-facing destination
fields, make HALO a sender, or add Data Health to the seven-member `ServiceKey`
registry. Existing projects have a NULL new recipient field and therefore keep
their existing behavior exactly: card monitoring only, no new message.

Canary sequence:

1. Deploy worker and apply the two source-table migrations plus the server-only
   `ops` migration with delivery switch off.
2. Confirm the TEST card is currently red through HALO.
3. Configure only WBGT TEST and Noise TEST's Data Health group in HALO, then
   verify each group alias, sender URL, and client ID independently.
4. Enable delivery, run a single authenticated worker evaluation/dispatch, and
   verify one WBGT TEST and one Noise TEST message arrive in the provided
   internal group.
5. Confirm the immutable attempt row reports the provider result, then keep
   TEST red to verify no repeat appears before six hours. Restore a recent TEST
   row and verify the one recovery message.
6. Disable the delivery flag immediately if a message reaches an unintended
   destination, then inspect the outbox/attempt record before resuming.

## Feature-development briefing

1. **Customer behavior:** configured internal recipients receive immediate
   amber/red alerts, bounded repeats, and recovery; unconfigured projects stay
   silent while retaining card status. Sender/config/query failures are visible
   to operators and do not redirect a message elsewhere.
2. **Affected invariants:** HALO stays configuration-only; writes in HALO still
   use live-schema validation/concurrency/audit rules; chat IDs remain stored as
   IDs but picked by name; unknown delivery outcome is never labelled delivered
   or read. These are extended, not changed.
3. **Compatibility:** additive columns, worker tables, and EventBridge rules;
   no existing endpoint/payload/schedule/customer-alert destination changes.
4. **Persistence:** two nullable source config columns (one per pilot source)
   and three server-only `ops` tables plus claim-function/indexes. No backfill.
5. **Existing data:** NULL/blank recipient fields cause no notification; missing
   table/sender/config is fail-closed; legacy config rows continue to render and
   monitor normally.
6. **Invocation:** new hourly evaluator plus minute delivery dispatcher; source
   delivery uses each project’s existing sender endpoint and client identity.
7. **Regression proof:** unit-test threshold and transition rules, recurrence,
   1/3/5 retry schedule, stale-outbox cancellation, atomic claim/idempotency,
   source adapter payloads, HALO group field rendering, and no fallback to live
   client groups. Integration-test the worker against a local listener sink;
   run a single real TEST-only canary after explicit enablement.
8. **Rollback:** set `DATA_HEALTH_DELIVERY_ENABLED=0` or disable both rules to
   stop sends immediately; leave historical rows for audit; revert HALO field
   overlays independently. The nullable columns/tables may remain safely.

## Acceptance criteria

- No project sends a Data Health message unless its own dedicated group is
  configured and its project sender URL/client ID validate.
- Amber repeats no faster than 12 hours; red repeats no faster than 6 hours.
- A failed due delivery makes at most four attempts, with 1/3/5-minute retries.
- A recovery sends once after a previously notified incident returns green.
- The WBGT TEST and Noise TEST canaries are the only live sends before a
  separate production rollout decision.
- HALO never calls a WhatsApp endpoint and never exposes worker state/errors to
  browser clients beyond safe delivery summary fields.
