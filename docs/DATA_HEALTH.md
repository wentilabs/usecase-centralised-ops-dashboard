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
| `dropped…` | the listener accepted a send, then gave up on it for good | 🔴 red |
| `running` | in flight | 🟢 green |

The colours mean:

- **🟢 green** — expected behaviour, *including deliberately doing nothing*.
- **🟩 stale (dark green)** — the data is *late*. The sensor or its feed is the
  likely cause and the service itself did its job. Worth knowing, deliberately not
  attention-grabbing, and never counted as "to look at". See
  [Stale readings](#stale-readings-dark-green).
- **🟠 amber** — it worked, but a value was missing or something non-critical
  broke. Worth reading, not worth waking anyone.
- **🔴 red** — it did not run, did not send, or ended unsuccessfully.

Four colours, and each asks something different of a reader: green nothing, stale
"be aware", amber "a developer should look", red "this is broken". **Amber has to
keep meaning that third thing.** Anything that is amber for a reason a developer
cannot act on — a sensor that reports late — teaches people that amber is
background, and the next real amber is read as background too.

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
| 7 | Was the reading usable? | `suppressed_stale` | amber — **declared**, see below |
| 8 | Did the listener accept it? | `sent`, `queued`, `unconfirmed`, `failed` | green / amber / red |

Rule 5 is the one red among the hard rules, and deliberately: a project that is
switched on, is due to send, and has nowhere to send to is misconfigured, and
nothing downstream will ever fix it.

### Check that your names convert

A status the dashboard does not recognise is drawn **amber**, by design — so a
service whose log speaks its own dialect does not fail loudly, it paints its
normal operation as a problem. Haze's first run log did exactly this: the hourly
job's own words — `processed`, `outside_working_hours`, `below_alert_threshold`,
`sunday_no_send` — all came out amber, which would have made every quiet evening
an amber bar. Its tests asserted the status strings and never the colour.

Two ways to be right, in order of preference:

1. **Use the convention.** `completed` · `completed_with_<x>` · `skipped_<x>` ·
   `suppressed_<x>` · `failed_<x>`. The dashboard colours these by prefix, with
   no per-service configuration.
2. **Declare the exception** in your contract's `health.statuses`, for the few
   words the prefix would get wrong. `suppressed_` is green by prefix, so a
   `suppressed_stale` that must be amber is declared amber.

A service with a legacy vocabulary should translate **in the log only**, and
leave its HTTP result alone — consumers depend on those words. Haze does this
with `runStatusFor`.

To check a name, run it through `colourForStatus` (`lib/health-status.ts`);
HALO's `tests/run-log-colours.test.ts` holds the table of what each service
logs and the colour each should be.

### Some failures have no moment to log

A strip draws things that happened. The worst failure can have no event at all:
a project that is **rejected before it is ever evaluated** produces no delivery,
no run and no row of any kind.

Lightning is the case. SGK's configuration switched on manpower-sheet POC
mentions without a `manpower_sheet_id`, so the validator rejected it on every
tick — and it was never once evaluated, so never alerted, in a service where a
false CLEAR is the dangerous failure. The tick counted it in `projects_failed`
and logged the reason to the console only, so for a day it read as 300 identical
"1 of 28 failed" ticks that named nothing. On HALO its strip was a hundred calm
grey columns, which reads as "nothing to report".

So record a **standing fault** where the project's own state lives, in the
service's words — Lightning writes
`failed_config_validation: <the validator's errors>` to
`lightning_project_runtime.last_error`:

- **Don't touch the timestamp that says it ran.** `last_evaluated_at` stays
  empty; stamping it would claim the project was evaluated.
- **Clear it on success**, so a fixed project heals itself.
- **Don't rewrite an identical message** every tick.
- **Never let recording it stop the other projects.**

HALO reads `last_error` as state and shows it above the strip in red, as a board
entry of its own `config` signal, and sorts the project as one red.

### An error says what was SEEN, not only what was concluded

Lightning recorded `Listener response did not confirm the requested recipient`
against 27 messages the listener had in fact queued. The conclusion was wrong
because of a parsing bug, and that was fixed — but the wording was a second
failure. It stated a verdict and withheld the evidence, although the service was
holding the reply in its hand and that reply said `QUEUED` with a queue id. Anyone
reading "did not confirm" reasonably concluded the send had broken, and the only
way to learn otherwise was to open the stored attempt and read the JSON.

When a service cannot interpret a reply, the error must say **what it expected,
what it actually received, and where they differ** — enough that the reader can
tell "the other side refused" from "I could not read what the other side said":

```
not this:   Listener response did not confirm the requested recipient
but this:   no `results` array in the reply; top-level keys seen: data, action,
            success, instance, proxyDurationMs
```

The second names the cause (the reply was wrapped one level deeper than expected)
without anyone opening a database row. Two guidelines:

- **Describe the shape, don't dump the body.** Key names and the few fields the
  decision turned on, not the whole payload — replies can carry recipient numbers
  and message text that do not belong in a log line.
- **Never let the conclusion outrank the evidence.** If the service read the reply
  wrongly, a digest of what it read will look odd, and that oddness is the signal.
  A verdict alone hides it.

The same applies to every "unconfirmed" and "could not parse" outcome, not only
to listener replies.

### A log says what, where and why — and whether it will happen again

A status gives HALO a colour. The error is what a developer is handed after the
colour has got their attention, so it has to be enough to act on without opening a
database. Two real examples from one fortnight, both from `failed_unhandled_error`
runs, show the difference.

```
Ailytics, ZRA, job status_summary — written twice, at 18:00 on 18 and 19 Oct:
  The caller does not have permission

Ailytics, another project, the same week:
  Sheet "(IRN) CCTV Safety Sheet" is missing the required Status column.
```

The second can be acted on: it names the sheet and the column. The first says
*someone* is not permitted to do *something* to *something*. A developer cannot tell
which spreadsheet, which tab, which Google call, or which account lacks permission,
and it recurs every day at the same hour, so it is a standing fault being re-reported
as if it were new.

An error a developer can act on carries, in this order:

1. **What was being done** — the operation, in the service's own vocabulary
   (`reading the Activity History tab`, `sending the 09:00 summary to a group`,
   `probing reading table wcp_noise_data_daily`). The run row already has the job
   and the project; the sentence says the step within it.
2. **On what** — the resource, enough to find it: a sheet and tab name, a table, a
   chat id, an endpoint. A tail of an opaque id is enough (`…q2Xk`), never a secret.
3. **Why, in the upstream's own words, verbatim.** Wrap the upstream's message,
   never replace it: `Google Sheets 403: The caller does not have permission` keeps
   the sentence a reader can search for and adds the status they would otherwise have
   to guess. This is the rule that lets HALO keep every service's wording unchanged
   while still showing it.
4. **What the service did about it**, when it matters — `will retry`, `held, not
   resent`, `skipped`. A timeout the service retried is not the same fact as one it
   gave up on.

And, because a log line that repeats is information too, the error should be
**stable**: the same cause writes the same sentence. HALO can then say "this has
happened on every run since 18 Oct" instead of showing it as a new problem each
hour. Putting a timestamp, a count or a request id *inside* the sentence defeats
that; put them in the row's columns.

A bare upstream message is a symptom. Two failures this fortnight read identically
for different reasons — `Requested entity was not found.` (Issue Chaser, SGK) was a
wrong spreadsheet id, and could as easily have been a deleted tab or a revoked share.
Only the missing operation and resource separate them.

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

HALO defines four colours and what each means — that is a presentation concern
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

The convention is a **fallback, not a replacement**. The current service
contracts declare the common listener-acceptance outcomes; the convention
still covers a status added before its contract mapping is updated.

### `granularity`: what "per project" means per service

`ingestion`, `run` and `delivery` are declared separately, because they do not
share a granularity:

| Service | Ingestion | Run | Delivery |
| --- | --- | --- | --- |
| Noise, WBGT | per project | per project | per project |
| Haze | none declared; the public feed is estate-wide | none declared | per project |
| Lightning | **service** — one public feed fetched once | service | per project |
| Ailytics | none declared; events are pushed in | none declared | per project |
| Subcon | none declared | per project | per project |
| Issue Chaser | none declared | none declared | per project |

An **undeclared** signal is `none`, never `project`. A service that has not said
it reports a signal must read as *not covered*; showing it green is the one
mistake this page cannot afford.

## Current coverage

The baseline live-table audit was on 2026-10-16. Every run log below was added
on 17 Oct and **verified live on 18 Oct**: all four tables exist and are filling,
and every status they write converts to the colour a reader would expect. Two
questions per service — can you tell whether a process RAN,
and whether it DELIVERED — and whether the answer is per project.

| Service | Ran? | Delivered? | Per project | Three states? |
| --- | --- | --- | --- | --- |
| Noise | `noise_job_runs` | — | ✅ | ✅ completed / completed_with_meter_issues / failed_config_validation |
| WBGT | `wbgt_job_runs` | Telegram only | ✅ | ✅ completed / completed_with_issues / skipped_outside_site_hours |
| Haze | `haze_job_runs` — live; 30 projects at :00 and CRP at :02, from two invocations | `haze_notification_events` | ✅ | ✅ convention-named, translated in the log only |
| Lightning | `lightning_project_runtime.last_error` for a standing fault; `lightning_tick_audit` is estate-wide and unused | `lightning_events` | ✅ for faults and deliveries | ✅ |
| Issue Chaser | `issue_chaser.job_runs` — live; all 35 projects | `outbound_submissions` | ✅ | ✅ convention-named |
| Ailytics | `ailytics.job_runs` — live; all 5 projects | `yesterday_summary_deliveries` (by uuid, unused) | ✅ | ✅ convention-named |
| Subcon | `manpower_activity.job_runs` — live, **first rows when its cron next fires** | `outbound_message_submissions` (empty until sends are accepted) | ✅ | ✅ convention-named |

### Gaps, worst first

1. **Lightning's rejected project was named, fixed, and cleared itself.** For at
   least a day one project was counted as failed on every tick with nothing to say
   which. It was SGK: its configuration switched on manpower-sheet POC mentions
   without a `manpower_sheet_id`, so it was rejected on every tick and **never
   evaluated, so never alerted**. Lightning now writes the validator's sentence to
   `lightning_project_runtime.last_error` and HALO shows it above the project's
   strip. The configuration was then corrected (18 Oct, config v18); SGK's first
   ever evaluation ran three minutes later, ticks went from `COMPLETED_WITH_ERRORS`
   to `COMPLETED, 0 of 28`, and the fault cleared on the next tick without anyone
   touching it. The mechanism has now been seen working end to end.
2. **Subcon's run log is live.** 93 rows in its first cycle, every status the right
   colour, including `suppressed_sunday` on the Sunday it was first observed. Its
   own delivery ledger (`outbound_message_submissions`) only grows when a report
   is submitted.
3. **Run log first, ledger only while the table does not exist.** HALO reads a
   service's run log first and falls back to its delivery ledger **only while the
   run log's table cannot be read** — never when it is merely empty, because a
   cron that has stopped firing has an empty run log, and falling back would show
   green bars for a silent service. All four tables now exist, so the fallback is
   dormant; it is there for the next service that gains one.
4. **Ailytics' queue outcomes are still keyed by project UUID.** Its summary and
   pending-image ledgers cannot be joined to a project code without a lookup, so
   HALO reads only the new run log. Its intake events (`cctv_activity_events`)
   still carry no status column.
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

HALO's process reader (`lib/process-log.ts`) reads delivery ledgers for three
services and run logs for Noise, WBGT and Subcon. A delivery-ledger strip
answers whether a listener submission was accepted; a run-log strip answers
whether the scheduled job ran and what it decided. They are different signals.

| Service | Ledger | Status column | Keyed by |
| --- | --- | --- | --- |
| Haze | `haze.haze_notification_events` | `delivery_status` | `project_code` |
| Lightning | `lightning.lightning_events` | `delivery_status` | `project_code` |
| Issue Chaser | `issue_chaser.outbound_submissions` | `status` | `project_code` |

The other services are deliberately absent from the **delivery-ledger** reader:

| Service | Why not |
| --- | --- |
| WBGT | `wbgt_notification_outbox` exists but is empty |
| Subcon | HALO reads `manpower_activity.job_runs` for the run signal; the separate `outbound_message_submissions` ledger is not its process-strip source |
| Ailytics | keys deliveries by `project_config_id` (a uuid), not `project_code` |
| Noise | no general delivery ledger — only the monthly report |

Noise and WBGT retain recipient outcomes for specific paths such as monthly
reports, Telegram forwards, and internal Data Health reminders. HALO's current
process strip still reads their general cadence **run** rows, not those
recipient ledgers. A `completed` run is evidence that the cadence completed;
inspect its `details` and the relevant recipient ledger before claiming that
every WhatsApp recipient received a message.

**Which table is an integration detail, what the statuses mean is not.** The
mapping above lives in HALO because only HALO needs it; the colour of
`UNCONFIRMED` lives in haze's own contract, and HALO reads it from there. A
reader that classified statuses itself would drift the first time a service
added one.

### What `queued` proves, and what it does not

For a one-recipient listener request, an HTTP 200 result with
`success: true`, matching `chatId`, a WhatsApp `messageId` and `ack` is an
immediate confirmed send. The other accepted result has `success: true`,
`queued: true`, `code: "QUEUED"` and a `queueId`. Through the proxy, the listener
answer is under `data`. A timeout, network error, listener 5xx, or malformed
success cannot establish whether a queue row was inserted; the services
record that as `unconfirmed` and do not automatically repost it. An explicit
pre-acceptance rejection can remain eligible for a bounded service retry.
Each destination is a separate instruction; the result for one group never
substitutes for the result for another.

Since the listener queue landed, an initial `queued` response confirms that
the listener **accepted** a message; it does not confirm WhatsApp delivery or
provide a WhatsApp message ID. `queued` is green in the service contracts
because acceptance completed that submission. `unconfirmed` is amber because
the service cannot prove whether the listener accepted it, and `failed` is red.
HALO reads the service's persisted status; it does not poll the listener queue
or turn a green acceptance into a WhatsApp delivery receipt.

Two workflows do look up queue IDs when the later message ID matters. Ailytics
reconciles queued Pending images and promotes their activities from
`PENDING_DELIVERY` to `PENDING` only after a verified `sent` result with a
message ID. WBGT looks up a queued Water Parade reminder when a quoted reply
needs that reminder's WhatsApp ID. Other service ledgers retain queue IDs for
audit without polling every message. A final listener `failed` or `dropped`
outcome is not an instruction to repost a previously accepted submission.

### Queued is not delivered: the drop nobody sees

`queued` is green, correctly, for the question it answers: *did the listener accept
the message?* It does not answer *did the message reach the group?* — and the
listener can accept a message and later give up on it for good.

The listener drops a queued send, final and without retry, when WhatsApp refuses it
for a reason that will not change: `NOT_PARTICIPANT`, "this number is no longer a
participant of this group", is the one seen in practice. The row ends
`status = dropped` in the listener's own queue (`internal.whatsapp_outbound_queue`,
with `last_code` and `last_error`), and **nothing tells the service that sent it.**

This was found, not predicted. On 19 Oct an Issue Chaser summary for HLD recorded
`unconfirmed` for two of its seven groups. The listener's queue showed both had been
dropped with `NOT_PARTICIPANT` — and had been, about eighteen times a day each, since
the queue's records begin on 13 Oct. Across the estate, 376 drops in seven days hit
eleven chats, among them groups that C992's WBGT, Noise and Issue Chaser all send to.
Issue Chaser's ledger was matched against the drops and holds four sends recorded
`queued`, green, that the listener later dropped; the other services record queue ids
the same way and were not matched. For a week the Data Health board was green for
messages that never arrived.

The two HLD groups only showed up because their send happened to fail inside the
listener's eight-second window, so the answer came back immediately as a 502; a
queued send fails later, asynchronously, and in silence.

**What HALO can and cannot do.** HALO reads each service's own run logs and
ledgers, and its only credential for the listener is a read-only key that is refused
on the queue's schema. It will not be given the service key: by decision HALO holds no
credentials for the services it watches. So HALO **cannot see a drop** today, and no HALO change can fix that
alone. The fix belongs where the queue id already is:

> **A service that sends through the listener queue must reconcile its queued sends.**
> For queue ids older than a few minutes it asks the listener's `outbound/status`
> endpoint (through the proxy: `POST /proxy/outbound-status`, body `queueIds`, at most
> 100 per call), reads each item's `status` — `queued`, `sending`, `sent`, `failed` or
> `dropped` — and `error: { code, text }`, and writes the final outcome back onto its
> own ledger row, and into its run log's `errors` when it is `failed` or `dropped`.

WBGT (`platform/outbound-status.js`) and Ailytics (`connectors/whatsapp/outbound-status.js`)
already call that endpoint, to find a message's WhatsApp id; they do not record a
drop. Noise, Haze, Lightning, Issue Chaser and Subcon do not call it.

What the service writes is the contract with HALO. A reconciled `dropped` send is
recorded with a status that begins `dropped` (HALO reads that prefix as **red** with
no further change), and its error follows the standard above — the listener's own
`last_code` and `last_error`, the chat, the queue id:

```
status:  dropped
errors:  ["120363405395020959@g.us: queue 57557 dropped — NOT_PARTICIPANT: WhatsApp rejected the send: this number is no longer a participant of this group"]
```

A `failed` outcome is already red. `sent` after a `queued` is the confirmation — and
means WhatsApp's server accepted it, not that anyone's phone received or read it — and is
green. Until a service reconciles, its `queued` means exactly *accepted*, and the board
must not be read as delivery.

Noise and WBGT also have **Data Health reminder** routes and recipient ledgers.
Those internal reminders are distinct from HALO's Data Health dashboard, which
currently reads their `noise_job_runs` and `wbgt_job_runs` rows. A green run row
does not independently verify every recipient's WhatsApp delivery.

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

### A stale reading is not always a fault: ask the service

On a muted Sunday, four noise projects went red for doing exactly what they were
told. Their cadence windows covered the afternoon, so HALO — which models "should
something have happened this hour" from the configured hours — expected readings;
Noise had been skipping every run on purpose, `skipped_sunday_notifications_disabled`,
every five minutes. HALO cannot know about a calendar mute, and mirroring each
service's calendar rules would drift: WBGT still scrapes on a muted Sunday and
mutes only the send.

So when a project is about to be reported stale, HALO asks the service's own run
log, and treats the silence as deliberate only when **all** of these hold:

1. **The producer has not run since the last reading, and nothing has failed.**
   Not "no run at all". After each project's last reading the log held a
   five-minute alert run that finished twelve seconds later and a daily
   maintenance job three hours on — neither produces readings, so neither says
   anything about whether the pipeline works. Only the scrape does. If the scrape
   ran and produced no reading, that is the fault, and it stays red. A service
   declares which job produces its readings (`producer` in HALO's source table);
   both Noise and WBGT call it `scrape-…`.
2. **The newest run is a deliberate skip** — the service alive and choosing not to
   work. No run at all is not an explanation: a silent cron is exactly what a
   stale verdict is for.
3. **No recent skip names a fault.** `skipped_google_sheet_not_configured` starts
   with `skipped` and is a project that cannot run.

If HALO cannot ask, the red stands. The card keeps the time of the last reading
and says why it is idle in the service's own words, unrewritten.

The first two versions of this rule were wrong in opposite directions, which is
why the conditions above are so specific: reading only the newest few runs would
have cleared a project whose scrape had been running for weeks and finding
nothing, and asking "has any run since the reading been a non-skip?" cleared none
of the four.

### What "no recent data" means, and what it must carry

The rule is age against what the configuration can explain: the newest `created_at`
in the project's readings table, compared with the longest silence the project's own
cadence allows. Past that gap the reading is `delayed`, past twice it `no recent
data` — and **both are stale (dark green)**, not amber or red: the age of a reading
is a fact about the sensor, not about what the pipeline did. The label keeps saying
how late; the colour says whose problem it is. Red here is kept for what is actually
broken — an empty or missing table. Nothing more — in particular the rule does not
know *why* the table is quiet, so it must never be the only thing a developer is
handed.

**Every stale, amber and red carries its evidence**, in plain sentences on the card
(`ProjectHealth.evidence`):

- **Expected** — the cadence and hours HALO held the project to, and the longest
  normal silence they imply.
- **Seen** — how old the newest reading is.
- **Service log** — the newest run since that reading, in the service's own words,
  and how many runs carry the same message. A standing message repeated every hour
  is a different finding from a one-off.
- **Scrape** — when the producing job last ran for this project, and what it said.
  A scrape that has not run for a project in three weeks is not the same problem as
  one that runs every fifteen minutes and finds nothing, and the colour cannot tell
  them apart.

If the log cannot be read, those lines are simply absent; the evidence only ever
gets shorter, never invented, and the colour is unchanged.

**The calendar the project declares is part of what is expected.** Two rules, both
read from the row so they cannot drift from the service:

1. *A muted Sunday is not a finding.* A project with `remove_sunday_notifications`
   whose table has received nothing today is `idle — Sunday is muted`, keeping the
   time of its last reading. A reading that **did** arrive today is judged normally,
   so a site that reports on its muted day and then stops is still caught.
2. *Monday compares against Saturday.* The tolerated gap is measured back to the
   previous hour the project works in on a day it works. A break — overnight, a
   skipped lunch hour, a weekend — gets two hours' grace rather than one, because
   the first reading after a break arrives during the first hour back. Without it
   every site was amber each morning until its first reading landed, and every
   Sunday-muted site red until Monday's.

Public holidays are the service's calendar, not HALO's, so they stay with the run-log
testimony above rather than a copied holiday list.

**HALO failing to read is not a finding about the project.** A timeout or error
reading the table is amber with the sentence "HALO could not read the table" — not
red, because nothing is known to be wrong with the site, and not green, because a
project HALO could not look at must not look healthy.

The services' own *Data Health reminder* messages (`/api/wbgt-data-health`,
`/api/noise-data-health`) use a flat age rule — amber from one hour, red from four,
whatever the site hours or calendar — and are a separate source of exactly this
noise. They go to the data-health groups only, and WBGT's are restricted to `TEST`
during rollout; they are not changed by anything above.

## Stale readings (dark green)

A reading that arrives late is a fact about a **sensor**, not about the pipeline. The
service ran, found the latest row old, said so, and (for WBGT) held back a message it
would otherwise have sent from outdated data. Nothing the service did was wrong, and
nothing a developer changes in the service will make the sensor report. So it must not
be amber: amber is the colour that means *a developer should look*, and when most of
the amber on the board is a sensor being slow, the amber that is a real fault is the
one nobody reads.

Measured over the fortnight to 20 Oct 2026 (`node scripts/audit-service-health.mjs`):

| Service | `completed_with_…` runs | wrote only late-reading lines | still amber |
| --- | ---: | ---: | ---: |
| Noise | 12,091 | 10,970 (91%) | 1,121 |
| WBGT | 3,049 | 2,156 (71%) | 893 |

What stays amber is what a developer can act on: Noise's `No parseable rows: …`
(625 + 319 runs), WBGT's `Missing configured sensors: WBGT C? (Manual)` (854, a
standing configuration gap), and Google permission failures.

**Where HALO shows stale, and where it does not**

- *The age of the newest reading* (Noise and WBGT, from the readings table). Past the
  tolerated gap is `delayed`, past twice it `no recent data`; **both are dark green**,
  and the label keeps saying how late. The card lists what was expected and what was
  seen.
- *A run that only reported late readings.* Its status is still `completed_with_…`
  and its lines are unchanged; the run is drawn dark green because every line it wrote
  was the service saying a reading was late.
- *Never in "to look at".* The strip counts red and amber under that heading and stale
  separately and quietly (`· 36 stale`); the board lists late readings in their own calm
  section, after everything that needs acting on; the estate strip says "nothing to
  action" when stale is all there is. A project with a sensor problem sorts above a
  clean one and below any real fault.

**How a run is recognised as stale.** By the service's own wording, which HALO reads
and never asks to change (`STALE_READING_LINES` in `lib/health-status.ts`):

| Service | Line it writes | Pattern |
| --- | --- | --- |
| Noise | `Stale latest rows: PN NM01 Watertown Blk 71 …` | starts with `Stale latest rows:` |
| WBGT | `MBS IR2 (WC-3): reading 84 minutes old; production delivery suppressed` | contains `reading N minutes old` |

Three rules keep it honest, and each has a test:

1. **Every line must be a late reading.** One line that is not — a missing sensor, a
   permission failure — keeps the run amber. Lateness must never hide the part that
   needs acting on.
2. **Only a run that completed is softened.** A `failed…` run keeps its red: a stale
   line in a failed run is a symptom, not the explanation.
3. **No lines is not evidence of anything.** A `completed_with_…` run that wrote
   nothing stays amber.

**The better route, for a service that wants it.** Recognising wording is HALO guessing
at a sentence. A service that would rather say it outright gives lateness its own
status and declares it in its contract — `completed_with_stale_readings` — with
`"stale"` as the colour in `health.statuses`. A declaration outranks every rule above,
so HALO then stops reading the wording at all. Nothing about the sentence has to change
either way.

## Refreshing data health

Health is remembered for a while on purpose, because the reads behind it are not free:

| What | Held for | Why |
| --- | --- | --- |
| The strips (each card's hundred bars) | 5 minutes | A second of keyset paging per service |
| Standing faults, and Lightning's heartbeat and per-project runtime | 1 minute | Three small reads, shared |
| The configuration rows health is judged against | a few seconds | Every card needs them |
| The readings-age verdict (Noise, WBGT) | 1 minute | 63 reads, the slowest thing here; loaded after the page (see [`PERFORMANCE.md`](./PERFORMANCE.md)) |

That is right for a page left open and wrong for "I just fixed the sheet — has it cleared?". **Refresh health**
(beside the estate strip, and in the board's header) forgets all five, reads everything again together, and
shows when it finished (`POST /api/data-health/refresh`). It is labelled *Refresh health* because the header's
own *Refresh* reloads configuration, and two buttons with one name leave nobody sure which they pressed.

Two rules, each with a test:

- **A part that could not be read leaves the screen as it was.** The route answers `null` for a failed read,
  never an empty one, because an empty strips object would blank every card's history and an empty faults
  object would clear a standing fault: "could not look" drawn as "nothing is wrong".
- **A genuinely empty answer is applied.** No faults any more is exactly what a fix looks like, so SGK's fault must
  be able to clear. `lib/health-refresh.ts` is the one place that decides which is which.

Any signed-in viewer can use it, read-only accounts included: it reads what the page already shows, and a
read-only account is the one that most needs to see whether something cleared.

## Lightning: every alert, the tick, and the feed

Lightning is not like the services that run on a schedule. Its tick (`/api/lightning-tick`) runs
**every minute** and sends nothing unless something changes, so a quiet strip is the same picture
whether the sky is calm or the service has stopped. The goal is that any message sent has a recorded
outcome and any failed process is visible, **without a process of HALO's own per minute**:

> HALO never follows the tick. It reads, when the dashboard asks, three small tables the service
> already writes on every tick — from a 60-second cache, with no cron and no new rows.

| What | Where it comes from | Shown as |
| --- | --- | --- |
| **Every message sent, and whether it worked** — `RED`, `AMBER`, `ALL_CLEAR`, `DEGRADED`, `KICKOFF`, SMS | `lightning_events.delivery_status`, one row per event | A bar per event, labelled with its type. `SENT`, `QUEUED` green; `UNCONFIRMED`, `PARTIAL` amber; `FAILED` red; `SUPPRESSED_…` green. KICKOFF stays on the strip like any other event. |
| **The tick stopped, or finished badly** | `lightning_service_runtime` (one row, `service_key = 'nea'`) | A service-wide board entry: amber from 5 minutes since the last tick finished, red from 15; amber when it finished `COMPLETED_WITH_ERRORS` (with the failed-projects count); red when it `FAILED`. `SKIPPED_LOCK` is two ticks overlapping and is ignored. |
| **The NEA feed is behind** | the same row: `last_fetch_success_at`, `consecutive_fetch_failures`, `last_fetch_error` | **Stale (dark green)** while it is merely behind; **amber** once any enabled project's `last_notified_degraded` is true — Lightning has told sites "the warning service is down", and from then on workers are being told they are not covered. |
| **A project that stopped being evaluated** | `lightning_project_runtime.last_evaluated_at` | A standing fault above its strip (red) after 15 minutes, while the tick itself is alive. |
| **A STOP whose all-clear never went** | `last_notified_state = 'STOP'` and `active_stop_until_at` | A standing fault (red) 30 minutes past the clearance time: workers were told to stop and never told to resume. |
| **A project that cannot be evaluated** | `last_error` | The standing fault it always was, and it outranks the two above on that card. |

Rules that keep it honest, each with a test:

- **The per-project checks run only while the tick is alive.** If the tick has stopped, every project is
  "not evaluated"; the single tick notice says it better than twenty-eight cards.
- **A disabled project is never a fault.** It keeps its last evaluation time for ever. Enabled comes from
  the project's config, not the runtime row.
- **WATCH is not "stuck".** An amber warning clears silently, with no all-clear to miss, so only STOP is
  judged. A STOP with no recorded clearance time cannot be judged either.
- **A table that cannot be read says nothing**, rather than something wrong: an absent finding proves
  nothing, and the page says so.
- **Never `lightning_tick_audit`.** It holds one row per minute (about 43,000 over its 30 days). Nothing here
  needs it; the heartbeat row already says what the last tick did.

Whole-service findings carry a name where a project code would be (`tick`, `NEA feed`) and
`scope: "service"`, so the board lists them with the same wording and colours but does not offer to open a
project editor for them. Late-feed notices go to the board's calm "late readings" section, not to what needs
acting on.

**Still the estate-wide gap.** A `QUEUED` alert is green until the service checks it later with
`outbound/status` (see [Queued is not delivered](#queued-is-not-delivered-the-drop-nobody-sees)); Lightning
does not yet, so a queued RED the listener later drops would still read as accepted.

**For the Lightning contract** (a service-side follow-up, not done here): declare `ingestion: service` and
`run: service` under `health.granularity`, so the board's "not covered" note stops describing Lightning as
delivery-only.

## What each service writes today

Run `node scripts/audit-service-health.mjs [days]` to regenerate this from the live
run logs. It reads every service's run log through HALO's own classifier and flags
`COLOUR-WITHOUT-EVIDENCE` (amber or red with no error written), `GREEN-BUT-HAS-ERRORS`
and `UNRECOGNISED`. The findings of 20 Oct 2026 (14 days; Noise's log is larger than
the script's 60,000-row cap, so its counts are for the newest 60,000 rows) are the
work list below. The
services' error wording is **not** on it: nothing here asks any service to reword what
it says.

| Service | What HALO captures well | Where capture or evidence falls short |
| --- | --- | --- |
| **Noise** | Run log per project per cadence; late readings (91% of `completed_with_meter_issues`) now stale. | `suppressed_all_unavailable` (281) and `skipped_google_sheet_not_configured` (40) are amber with **no error written**: the colour has nothing behind it. `bootstrap_required` (8) is an unrecognised status, shown amber by default. `failed_config_validation` is 1,475 rows, 1,472 of them the same standing `Missing delivery config: lambda_url`; the other three (WCP, P105, CR106, failing together at 11:04 on 19 Oct) were table-probe failures whose message ended `…: ` with the reason blank, because the probe was a `HEAD` request and a failed `HEAD` has no body. The cause, found afterwards in the Noise repo (b13f743), was that newly onboarded reading tables had no `service_role` grant. They surfaced once a day because those projects' cadence windows are narrow, so that run was their only evaluation. The probe now keeps the database's own sentence, and adds the HTTP status, the time taken and the usual cause. Queued sends never reconciled. |
| **WBGT** | Run log per project; late readings (71%) now stale. | One status, `completed_with_issues`, carries both a late sensor and `Missing configured sensors` (854, a standing config gap) — only the wording separates them. `Missing configured sensors: WBGT C? (Manual)` repeats every run. Permission failures name the operation (`monthly sheet sync`) but not the sheet. Queued sends never reconciled beyond the Water Parade lookup. |
| **Haze** | Run log per project per hourly run, skips included. Clean: no errors in the window. | The NEA scrape is estate-wide and not tracked (by design). Queued sends never reconciled. |
| **Issue Chaser** | Run log per project and style; ledger with queue ids. | `failed_unhandled_error` ×3 `Requested entity was not found.` names no sheet, tab or operation. A listener 502 recorded only `Request failed with status code 502`; the listener's own `code`/`error`/`queueId` were discarded (fixed in the repo, awaiting commit). `skipped_feature_disabled` is 70% of all rows (7,056 of 10,080). Four sends recorded `queued` were later dropped by the listener. |
| **Ailytics** | Run log per project. | `failed_unhandled_error` ×2 `The caller does not have permission` (ZRA, `status_summary`, daily at the same hour) names no sheet, tab or Google call. |
| **Subcon** | Run log per project; clean, and 243 of 279 rows are `skipped_project_disabled`. | No failure in the window, so the quality of its errors is untested. |
| **Lightning** | Delivery ledger with the service's own declared statuses; a heartbeat row and per-project runtime rows on every tick (read by HALO, see above). | `FAILED` ×21 `timeout of Nms exceeded` names no endpoint. 26 `UNCONFIRMED` rows carry the older `did not confirm the requested recipient` wording (a digest of what was seen was added afterwards). |

### What HALO cannot capture yet

| Gap | Why | What closes it |
| --- | --- | --- |
| A queued send the listener later dropped or failed | The outcome exists only in the listener's queue; HALO has no key for it and must not get one. | Services reconcile queue ids through `outbound/status` and write `dropped` / `failed` back. See [Queued is not delivered](#queued-is-not-delivered-the-drop-nobody-sees). |
| Whether a standing error is new | An error text is a string with no recurrence. | Stable wording (above). HALO can then group by text; not built yet. |
| Which job produced a bar | — | Built. Every bar and modal row carries the service's own `job_type` (a ledger's `event_type`), so a red says whether it was the RED alert, the all-clear or the kickoff. |
| A reading that is late *and* its run was clean | Only the age check sees it, and only for Noise and WBGT. | Other services do not store readings; nothing to age. |

The contract for what a service must write so that none of this needs guessing is
[`SERVICE_HEALTH_CONTRACT.md`](./SERVICE_HEALTH_CONTRACT.md).

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
