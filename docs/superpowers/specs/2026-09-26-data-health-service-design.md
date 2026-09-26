# Data Health Service Design

## Purpose and approved pilot

HALO must show whether each configured project is receiving source data. The
first production-shaped pilot covers WBGT and Noise only; it is automatic for
every existing and future configuration row in those services. It creates no
monitoring policy, asks operators to select no tables, writes no Google Sheet,
and does not send WhatsApp messages in this phase.

The card shows a compact **Data health** row immediately below its existing
sheet/action links. WBGT and Noise cards show a coloured ingestion result;
Haze, Lightning, Ailytics, Subcon Activities, and Issue Chaser remain neutral
until their table contracts are independently verified. Delivery health stays
neutral everywhere in this pilot. `provider accepted` remains distinct from
delivered/read in the later delivery-telemetry rollout.

## Product behavior

### What an operator sees

For every WBGT and Noise project card, HALO derives the corresponding source
table from the same project-code convention already used when onboarding a
project:

| Service | Schema | Derived table | Ingestion evidence |
| --- | --- | --- | --- |
| WBGT | `wbgts` | `<normalized-code>_wbgt_data_hourly` | newest `created_at`; source-time sanity from `reading_timestamp` |
| Noise | `noise-meters` | `<normalized-code>_noise_data_daily` | newest `created_at`; source-time sanity from `date` + `time_hhmm` |

`created_at` is the authoritative freshness timestamp. It answers the user
question: did HALO's underlying service receive data? Source timestamps are
shown only as sanity evidence because a device or upstream feed may supply an
old or incorrect clock.

The displayed states are:

| State | Colour | Meaning |
| --- | --- | --- |
| Receiving | green | the newest inserted row is within the service's pilot freshness budget |
| Delayed | amber | rows still arrive, but the newest insert exceeded the warning budget |
| No recent data / table unavailable | red | no row exists, no recent row is available, or the expected per-project table cannot be read |
| Monitor unavailable | red | the source query timed out or failed for a reason not attributable to project data |
| Not yet covered | neutral | a non-pilot service, or a project code whose table name cannot safely be derived |

For the initial pilot, WBGT warns after two hours and becomes critical after
four; Noise warns after twelve hours and becomes critical after twenty-four.
These are explicit initial operational budgets, not a claim that either
service's customer-facing schedule has those intervals. The card includes the
newest receipt time and the state wording so an operator can distinguish a
source-data problem from a monitor failure.

No recipient setup appears in this pilot. The eventual field
`data_health_recipient_group_ids` remains a future source-service migration:
it must be a normal group-picker field on each source configuration table,
with a dedicated operations fallback (`DATA_HEALTH_DEFAULT_GROUP_IDS`) and
never a customer delivery-group fallback. HALO must not render or write that
field until all source table migrations are available and reviewed.

## Architecture

```text
HALO server page
  ├── existing seven configuration reads
  └── automatic WBGT/Noise health reader (read-only, allow-listed catalog)
          └── one newest-row query per derived project table
                    └── DataHealthRow on the matching ProjectCard
```

`lib/data-health.ts` is the pure policy boundary. It owns the pilot catalog,
table derivation, timestamp parsing, and the deterministic colour/label
decision. It receives explicit `now` and observation inputs so it is unit
testable without a server.

`lib/data-health-repository.ts` is server-only. It receives a list of
configured WBGT/Noise rows, uses only the catalog-derived schema/table names,
queries `created_at` and source-time evidence with `limit=1`, and returns a
map keyed by `(service, project code)`. A per-project failure returns a health
result for that card; it never breaks the dashboard or another service. The
reader uses a timeout and does not perform writes.

`app/page.tsx` fetches health alongside config rows with `Promise.allSettled`.
It passes results to `DashboardShell`, which preserves them when its editable
config rows update locally, and then to `ProjectCard` and `DataHealthRow`.
The dedicated Data Health board is a read-only estate summary: it says that
WBGT and Noise are automatically monitored and shows the number in each
colour; all other services explicitly say `Not yet covered`.

The implementation must use the existing `noiseTableForProject` and
`wbgtTableForProject` functions rather than duplicate normalization. It must
not add Data Health to `ServiceKey`, to config schema introspection, to
onboarding, or to the audit trigger setup.

## Failure and compatibility rules

- Existing config rows behave exactly as before except for the additive card
  status. No existing service configuration, scheduler, alert recipient, API,
  or message changes.
- A missing or unreadable **derived table** is red and says that the table is
  unavailable; it does not say the project has stopped sending data.
- A network timeout, credential failure, or unexpected PostgREST error is red
  and says `Monitor unavailable`; it does not assert data loss.
- An empty table is red `No data received yet`; it is not treated as a query
  failure.
- Invalid `created_at`, absent source timestamp, and unsupported services are
  neutral/explicitly labelled evidence limits, never silently parsed as fresh.
- HALO reads with the production server credential already required for config
  display. Nothing becomes browser-readable and no secret is added to the
  client bundle.
- Because the query is one newest row per monitored project, the pilot remains
  read-only and bounded. The page must fail per-card, not all-or-nothing.

## Persistence, invocation, and rollback

This pilot adds **no database table, column, index, trigger, migration, or
backfill**. The obsolete optional-policy migration and policy repository are
removed from this branch rather than applied; their model conflicts with
compulsory configuration-derived monitoring.

Health is invoked on normal dashboard server renders and browser refresh. It
is not a scheduler and it does not notify anybody. The future independent Data
Health runtime will persist observations/incidents and own recipient delivery;
its eventual telemetry schema is outside this pilot.

Rollback is code-only: revert the pilot commits or remove the page-level
health reader. Since this adds no persistence or source-service changes,
rolling back cannot alter live alerts or delete evidence.

## Regression proof and release checks

Unit tests must prove:

1. the catalog derives WBGT and Noise table names through the onboarding
   naming helpers, and every other service is neutral;
2. exact warning/critical boundaries and future/invalid timestamps;
3. empty-table, missing-table, timeout, and unexpected-error wording remain
   distinct;
4. per-card result keys cannot collide across services;
5. `provider accepted` remains a distinct delivery label.

Repository tests must prove the reader selects only the narrow field set,
uses the required profile, and keeps one project failure isolated. UI tests
must prove the card renders the supplied automatic result below links and the
board does not offer a policy setup action.

Before release run the focused health tests, the complete `npm test`,
`npm run typecheck`, and `npm run build`. A local browser check is useful for
layout, but it is not proof that production credentials or source tables are
available. No Google Sheet job, source-data write, or WhatsApp send is part of
the verification.
