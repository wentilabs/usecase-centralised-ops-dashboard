# Data Health

How HALO decides whether a project is healthy, and what a service has to do to
be covered. Written so that a developer — or an agent — adding a new service can
work out the right answer without asking anyone.

## The question, in three parts

A project is healthy when, for each cadence it runs:

1. **Did the run happen?** The cron fired and the job executed.
2. **If it ran, did it send or error?** A run that completes without delivering
   is not a success.
3. **Is the data it acts on fresh?** A run can succeed on stale readings and
   report nothing wrong.

These fail differently and point at different people, so they are three
signals, not one. A project's pill shows the worst of them; the breakdown says
which.

**Cadence dependence is not computed anywhere.** The job already knows whether
it was due, and says so by writing `skipped_outside_project_cadence_window` (or
its service's equivalent). HALO reads that decision rather than reconstructing
it from configuration — the service is the source, and a second derivation would
disagree with it on exactly the hours that decide whether someone is woken up.

## What a service records

One row per `(project, cadence, invocation)` — including the invocations where
nothing was due, because the absence of rows is what tells us the cron itself
has stopped. `wbgt_job_runs` and `noise_job_runs` are the existing shape and the
one to copy:

```sql
create table if not exists "<schema>".<service>_job_runs (
  id          uuid primary key default gen_random_uuid(),
  job_type    text not null,          -- the cadence: 'noise-hourly', 'wbgt-5min'
  project_code text,                  -- the project; null only for estate-wide work
  status      text not null,          -- see the naming convention below
  records     integer not null default 0,
  errors      jsonb   not null default '[]'::jsonb,
  details     jsonb   not null default '{}'::jsonb,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
```

Prune it. WBGT and Noise delete rows older than 30 days with a `pg_cron` job;
at ~260 rows an hour for Noise, retention is not optional.

`status` is deliberately plain `text` with no CHECK. A service must be free to
describe a new outcome without a migration in two repositories — which is why
HALO classifies by **rule** rather than by a list it would have to be told.

## The naming convention

The prefix carries the meaning. Follow it and HALO colours a brand-new status
correctly without being changed:

| Prefix | Means | Colour |
| --- | --- | --- |
| `completed` | the run did its job | 🟢 green |
| `completed_with_…` | it ran and sent, but something was missing or broke | 🟠 amber |
| `skipped…` | the run was not due — an hour outside the cadence, a muted Sunday | 🟢 green |
| `suppressed…` | it ran and correctly chose not to send | 🟢 green |
| `failed…` | it did not run, did not send, or ended unsuccessfully | 🔴 red |
| `running` | in flight | 🟢 green |

The three colours mean:

- **🟢 green** — expected behaviour, *including deliberately doing nothing*.
- **🟠 amber** — it worked, but a value was missing or something non-critical
  broke. Worth reading, not worth waking anyone.
- **🔴 red** — it did not run, did not send, or ended unsuccessfully.

### An unrecognised status is amber, never green

Green would hide a status nobody has classified yet, which is the case where
silence is most likely to be wrong. Red would cry wolf on every harmless
addition upstream. Amber says *look at this* without claiming to know what it
is, and the interface prints the raw status so a reader can judge.

### Exceptions, and why there are four

A status whose name mispredicts its colour is listed in `EXCEPTIONS` in
`lib/health-status.ts`, with a stated reason. Today there are four, and each is
a `skipped…`/`suppressed…` that is really a missing value:

| Status | Colour | Why the prefix lies |
| --- | --- | --- |
| `skipped_google_sheet_not_configured` | 🟠 | the run **was** due and could not proceed — a sheet is missing, not a cadence |
| `skipped_unsupported_invocation_minute` | 🟠 | the scheduler invoked a minute the job does not handle: a wiring mistake, not a quiet hour |
| `suppressed_all_unavailable` | 🟠 | nothing was sent because no reading existed — absence of data, not a decision |
| `suppressed_all_unavailable_with_errors` | 🟠 | as above, and the run also recorded errors |

**A long exception list means the convention is not being followed.** The fix is
then the status name in the service, not another entry here.

## Hard rules first

**Decide everything configuration already determines before touching any data,
and name the rule that decided it.**

This is the single most important rule in this document, because breaking it
produces a log that is confidently wrong rather than merely incomplete.

### The case that proves it

WBGT logged this against CCCC, four times in an afternoon:

```
completed_with_issues   16 Oct, 18:31 SGT
  CCCC — set the CloudLynx label: reading 40 minutes old; production delivery suppressed
```

Read literally: a delivery was suppressed because the reading was stale, and
somebody should go and set a label. Every part of that is misleading. CCCC runs
`enable_hourly` only — `enable_intermittent_reports` is `false` — so at **:31
nothing was due at all**. The run was a correct no-op. The reading's age was
irrelevant, because no message was going to be sent at that minute whatever the
reading said.

What happened is that the job consulted the sensor first and the configuration
second, so it reported the first imperfection it found on a path it should never
have walked. The result is worse than silence: it sent a developer to look at a
sensor, in a service that was working exactly as configured.

### The ladder

Evaluate in this order, stop at the first rule that fires, and record that rule
as the status. Everything above the line is decided from configuration and the
clock alone, with **no reads, no vendor calls and no sends**:

| # | Question | Example status | Colour |
| --- | --- | --- | --- |
| 1 | Is the project enabled? | `skipped_project_disabled` | green |
| 2 | Is this capability switched on? | `skipped_intermittent_off`, `skipped_housekeeping_off` | green |
| 3 | Is this invocation one this project uses? | `skipped_outside_cadence_window`, `skipped_unsupported_invocation_minute` | green |
| 4 | Is the calendar open? | `suppressed_sunday`, `suppressed_public_holiday`, `skipped_lunch_hour`, `skipped_outside_site_hours` | green |
| 5 | Is delivery actually configured? | `failed_config_validation` | **red** |
| — | *— line: everything below reads data or sends —* | | |
| 6 | Did the source answer? | `failed_source_unavailable`, `completed_with_source_errors` | red / amber |
| 7 | Was the reading usable? | `suppressed_stale_reading` | amber |
| 8 | Did the listener accept it? | `sent`, `queued`, `unconfirmed`, `failed` | green / amber / red |

Rule 5 is the one red among the hard rules, and deliberately: a project that is
switched on, is due to send, and has nowhere to send to is misconfigured, and
nothing downstream will ever fix it.

### Two consequences worth stating

**A skip is not an error.** Rules 1–4 are the service doing its job. They belong
in `status`, never in `errors[]`, and `errors[]` should be empty on those runs.
An amber bar on every quarter-hour of a correctly-quiet afternoon trains people
to ignore the colour, which costs more than logging nothing would have.

**The reason names the rule, not the symptom.** `skipped_intermittent_off` says
what to check — the project's switches. "Reading 40 minutes old" sends somebody
to the vendor. When both are true, the rule that fired first is the one that
explains the outcome.

A useful test of whether the ladder is implemented in the right order: an
ineligible slot should perform **zero reads**. If the sensor was fetched, the
configuration was consulted too late.

### What to write

One row per project per invocation, whatever the outcome:

```
status        the rule that fired, from the ladder above
reason        optional, for a rule with variants — e.g. which holiday
errors[]      only what needs a human; empty for every rule 1–4 skip
```

A service that cannot yet record a row for an invocation it SKIPPED has not
finished this work: the absence of a row and a correct skip look identical from
outside, and that ambiguity is exactly what the strips exist to remove.

## Who decides a colour

**HALO owns the scale. Each service owns the mapping onto it.**

HALO defines three colours and what each means — that is a presentation concern
and belongs here. What a service's own words *mean* belongs to the service:
whether `partial` is "some recipients failed" or "partial by configuration" is
not something HALO can infer, and two services are allowed to answer
differently for the same word.

So a service declares its own mapping, in its own
`contracts/service.contract.json`, which HALO already vendors, pins by commit
and fails the build on drift. The block is additive — HALO's reader requires
only `schemaVersion`, `service.key`, `routes` and `configuration.fields`, and
`contracts:refresh` copies the file verbatim — so adding it changes nothing
else:

```json
"health": {
  "granularity": { "ingestion": "service", "delivery": "project" },
  "statuses": {
    "SENT": "green", "QUEUED": "green",
    "UNCONFIRMED": "amber", "PARTIAL": "amber", "SUPPRESSED_STALE": "amber",
    "FAILED": "red"
  }
}
```

Nothing has to be renamed. A service declares what its statuses **already**
mean — no migration, no CHECK constraint touched, no historical row
invalidated. Status names are matched case-insensitively, because Haze and
Lightning write theirs in upper case and the rest in lower, and that difference
carries no meaning.

### Resolution order

1. the service's own declaration, from its contract
2. the naming convention above
3. amber — an unclassified status must be visible

The convention is a **fallback, not a replacement**. It is what reads a service
that has declared nothing — which is all seven today — and a status added
tomorrow by someone who never opened the contract.

### `granularity`: what "per project" means per service

`ingestion`, `run` and `delivery` are declared separately, because they do not
share a granularity:

| Service | Ingestion | Run | Delivery |
| --- | --- | --- | --- |
| Noise, WBGT | per project | per project | per project |
| Haze, Lightning | **service** — one public feed fetched once | per project | per project |
| Ailytics | **service** — events are pushed in, nothing is fetched | per project | per project |
| Subcon, Issue Chaser | per project — one workbook each | per project | per project |

An **undeclared** signal is `none`, never `project`. A service that has not said
it reports a signal must read as *not covered*; showing it green is the one
mistake this page cannot afford.

## Current coverage

Audited against the live database on 2026-10-16: every log table in all seven
schemas was read, not just the ones HALO uses. Two questions per service — can
you tell whether a process RAN, and whether it DELIVERED — and whether the answer
is per project.

| Service | Ran? | Delivered? | Per project | Three states? |
| --- | --- | --- | --- | --- |
| Noise | `noise_job_runs` | — | ✅ | ✅ completed / completed_with_meter_issues / failed_config_validation |
| WBGT | `wbgt_job_runs` | Telegram only | ✅ | ✅ completed / completed_with_issues / skipped_outside_site_hours |
| Haze | — | `haze_notification_events` | ✅ | ✅ SENT / UNCONFIRMED / FAILED |
| Lightning | `lightning_tick_audit` | `lightning_events` | delivery only | ✅ but the run log is estate-wide |
| Issue Chaser | `delivery_runs` (dormant) | `outbound_submissions` | ✅ | ✅ |
| Ailytics | — | summary only | by uuid | partial |
| Subcon | — | — | ❌ | ❌ |

### Gaps, worst first

1. **Lightning cannot name its failing project.** Every one of the last 300
   ticks is `COMPLETED_WITH_ERRORS` with `fetch_status: SUCCESS`, `error_code:
   null` and `projects_failed: 1` of 28 — one project has failed on every tick
   for as long as the table goes back. The audit row is estate-wide, so it says
   *one* failed without saying *which*, and no per-project row is written
   (`lightning_events` FAILED rows are all from 6 Oct). A permanent amber nobody
   can act on is the worst kind of log: it trains people to ignore the colour.
2. **Subcon logs nothing about its own runs or sends.**
   `outbound_message_submissions` is declared and empty, `inbound_events` has
   been silent since 5 Sep, and only `housekeeping_events`
   (`completed` / `excused`) is live. There is no way to tell a quiet morning
   from a broken one.
3. **Haze has no run log at all.** Deliveries are recorded well, but an hour
   where the cron never fired leaves no trace anywhere — the absence of a
   notification row is indistinguishable from a correctly quiet hour.
4. **Ailytics has no run log**, and `cctv_activity_events` has no status column
   at all. Only `yesterday_summary_deliveries` carries an outcome, and it covers
   one of its several jobs.
5. **Declared-but-empty log tables**, which read as coverage and are not:
   `noise_data_health_deliveries`, `wbgt_notification_outbox`,
   `outbound_message_submissions`. `delivery_runs` has not been written since
   25 Sep and `haze_service_runtime` not since 14 Aug.

### What good already looks like

Noise and WBGT are the pattern to copy: one row per project per invocation, in
one table, with a status that answers all three states in its own name. A
service that adopts that shape needs no HALO change — the contract's `health`
block maps its words, and the strips draw it.

## Delivery: what HALO can read today

Three services write a per-project outbound ledger, and HALO reads the newest
row per project from each (`lib/delivery-reader.ts`):

| Service | Ledger | Status column | Keyed by |
| --- | --- | --- | --- |
| Haze | `haze.haze_notification_events` | `delivery_status` | `project_code` |
| Lightning | `lightning.lightning_events` | `delivery_status` | `project_code` |
| Issue Chaser | `issue_chaser.outbound_submissions` | `status` | `project_code` |

The other four are deliberately absent rather than guessed at, so the board says
*not covered* instead of showing a green it has not earned:

| Service | Why not |
| --- | --- |
| WBGT | `wbgt_notification_outbox` exists but is empty |
| Subcon | `outbound_message_submissions` exists but is empty |
| Ailytics | keys deliveries by `project_config_id` (a uuid), not `project_code` |
| Noise | no general delivery ledger — only the monthly report |

Noise and WBGT do decide a per-message outcome — `partial`, `read_failed`,
`stale_telegram_message`, `test_stale_reading_suppressed` — but these are
**console-logged only**. For those two, question 2 is still answered at run
granularity: `completed` implies a send, `completed_with_…` a partial one.
Writing those outcomes to a table beside the run row is what would close it.

**Which table is an integration detail, what the statuses mean is not.** The
mapping above lives in HALO because only HALO needs it; the colour of
`UNCONFIRMED` lives in haze's own contract, and HALO reads it from there. A
reader that classified statuses itself would drift the first time a service
added one.

### What `queued` proves, and what it does not

Since the listener queue landed, a service can confirm the listener **accepted**
a message and no more. Whether WhatsApp sent it is resolved later in the
listener's own `internal.whatsapp_outbound_queue` (`sent` / `dropped` /
`failed`), and **nothing reconciles the two** — no service joins its `queue_id`
back to that outcome. So `queued` is green because acceptance is the furthest
this side can honestly see. The gap is recorded here rather than hidden behind a
colour.

### One failure, one row

Delivery failures arrive in bulk, because a service posts to every project
through one listener. The first live run of this reader found Haze reporting
`UNCONFIRMED` for all 64 projects of its 10:00 run after six clean hours of
`SENT` — one listener-side event, which an ungrouped list renders as sixty-four
problems. `incidentsFrom` therefore groups on **service + signal + status text**
and reports a project count and a time range. Thirty identical rows is the same
alarm fatigue the colours were introduced to fix, one layer up.

## Staleness: the third signal

A run can report `completed` while the vendor returned nothing new, so run
status alone cannot see a frozen upstream. The freshness check is the newest
`created_at` in the project's own readings table —
`<code>_noise_data_daily`, `<code>_wbgt_data_hourly` — and it is only meaningful
for the two services that store readings. Haze and Lightning compute and
discard; Subcon, Chaser and Ailytics read someone else's store.

Judge it against the cadence, not the clock. A project whose last run row says
`skipped_outside_project_cadence_window` is not expected to have fresh readings
at all, and a fixed age budget reports a site that shut down on time as broken —
measured at 18:29 on an ordinary working day, a 1h/4h budget put 19 of 32 Noise
projects in danger while their own run rows said they were not due.

## Adding a service

1. Create `<service>_job_runs` with the columns above, in that service's schema,
   and grant `service_role` on it.
2. Write one row per `(project, cadence, invocation)`, including the skips.
   Status names follow the convention; a new outcome gets a new name rather than
   being squeezed into an existing one.
3. Prune it on a schedule.
4. Nothing else. HALO needs no change: it reads the table, classifies by rule,
   and the service appears.

If a status has to break the convention, add it to `EXCEPTIONS` with the reason
in the same commit — and consider renaming it in the service instead.
