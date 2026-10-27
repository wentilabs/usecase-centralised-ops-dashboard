# Service health contract

What a centralised service must write so that HALO's Data Health is accurate, without
HALO guessing and without any service rewording what it says.

Read [`DATA_HEALTH.md`](./DATA_HEALTH.md) for the reasoning and the history behind each
rule. This is the part a service developer follows.

## The one principle

**HALO reads; it never asks a service to change its words.** A service owns what its
statuses and errors *say*. HALO owns the four colours they are drawn in and what each
asks of a reader. Everything below is about making what a service already writes
*sufficient* — present, specific, and stable — not about changing it.

| Colour | Asks of a reader | A service gets it by writing… |
| --- | --- | --- |
| 🟢 green | nothing | `completed…`, `skipped…`, `suppressed…`, `running` |
| 🟩 stale (dark green) | "be aware": a sensor or feed is late; the service is fine | a late-reading line and nothing else (§5) |
| 🟠 amber | "a developer should look" | `completed_with_…`, or any status HALO does not recognise |
| 🔴 red | "this is broken" | `failed…`, `dropped…` |

## 1. Record every process, per project

- One row **per project per scheduled invocation**, including the ones that did nothing
  (`skipped_…`, `suppressed_…`). A delivery ledger can only log a send that happened, so
  on its own it cannot tell a correct skip from a cron that never fired. The run log can.
- Columns HALO reads: `project_code`, a free-text `status` (no `CHECK`), `errors` (see §3),
  a start time. A row with no `project_code` belongs to no card.
- The recorder must **swallow its own failures**. A health write that breaks the job it
  describes makes the log the cause of the outage.
- Dry runs are not recorded.
- Decide what is *config-determined* — disabled, capability off, wrong invocation, a
  muted day — **before** touching data, and record it as a skip. Only then read and send.
  A skip is not an error.

## 2. Name statuses so the colour follows from the name

HALO colours a status it has never seen from its prefix (table above), so a service that
follows the convention is right without HALO being told anything.

- `completed` / `skipped…` / `suppressed…` / `running` — green.
- `completed_with_…` — amber. The job made progress but has an actionable issue;
  the row must say what succeeded and what failed when that distinction matters.
  Do **not** use it for something a developer cannot act on (see §5).
- `failed…` — red.
- `dropped…` — red: the listener accepted a send and then gave up on it for good (§6).
- Anything else is **amber, by design**, so an unclassified status is visible rather than
  hidden. `bootstrap_required` is one such today. If a status does not follow the prefixes,
  either rename it or declare its colour (§7).
- A name must not lie. `skipped_google_sheet_not_configured` starts with `skipped` and
  means a run that was due and could not proceed; it needs an explicit exception, which is
  why such names are rare and listed in `lib/health-status.ts`.

## 3. Errors: what, on what, why — and stable

`errors` is a JSON array of sentences, **one finding per entry** (WBGT writes one per
affected sensor; they read as separate findings). A developer reading one should be able
to act without opening the database.

Every entry says, in this order:

1. **What was being done** — the step, in your own words.
2. **On what** — the resource: sheet and tab, table, chat id, endpoint. A tail of an
   opaque id is enough. Never a credential, a message body, or a recipient's number.
3. **Why — the upstream's own words, verbatim.** Wrap it, never replace it.
4. **What the service did about it**, when it matters: `will retry`, `held, not resent`.

```
not this:   The caller does not have permission
but this:   reading tab "cctv safety activity history" of sheet …q2Xk for status_summary:
            Google Sheets 403: The caller does not have permission
```

**Stable wording.** The same cause writes the same sentence. Put counts, timestamps and
request ids in the row's columns, not inside the sentence, so a repeat can be recognised as
a repeat.

**When you cannot interpret a reply**, say what you expected, what you received and where
they differ (key names and the fields the decision turned on — not the body). A bare
verdict hides a parsing bug behind a conclusion: Lightning reported 27 queued messages as
unconfirmed for exactly that reason.

**Two invariants HALO's audit checks** (`node scripts/audit-service-health.mjs`):

- **A non-green status writes at least one error.** Amber or red with no error is a colour
  with nothing behind it (`COLOUR-WITHOUT-EVIDENCE`). Today: Noise's
  `suppressed_all_unavailable` and `skipped_google_sheet_not_configured`.
- **A green status writes no errors.** An error under a reassuring name is a problem
  hiding (`GREEN-BUT-HAS-ERRORS`). Today: none.

## 4. Failures that have no moment to log

A project that cannot be evaluated at all — a rejected configuration — has no run, so no
bar. Persist the reason on the project's own row (Lightning's `last_error`) and HALO shows
it above the strip as a standing fault, sorted as one red. Clear it when the project
evaluates cleanly again.

## 5. Stale readings

*Noise and WBGT only — the two services that store readings.* A late reading is the
sensor's problem; HALO draws it **dark green** and never counts it as needing action.

HALO learns a run was only late in one of two ways. Pick the one that suits you:

**A. Keep writing what you write.** HALO recognises these lines
(`STALE_READING_LINES`, `lib/health-status.ts`):

| Service | Recognised |
| --- | --- |
| Noise | a line starting `Stale latest rows:` |
| WBGT | a line containing `reading N minutes old` |

Rules that follow from it:

- **Every** line of the run must be a late-reading line for the run to be dark green. One
  other finding makes the run amber. So **do not fold a different problem into a late-
  reading run's message**, and do not omit one — a missing sensor or a permission failure
  is a separate entry.
- Only a `completed_with_…` run is softened. A `failed…` run stays red.
- If you change the wording of a late-reading line, tell HALO or declare a status (B);
  otherwise those runs go amber again.

**B. Give lateness its own status.** Write `completed_with_stale_readings` (or any name)
and declare it `"stale"` in your contract's `health.statuses`. HALO then reads the
declaration and ignores your wording entirely.

Separately, HALO ages the newest row of each project's readings table (`created_at`) against
what the project's configured cadence, site hours and Sunday mute allow, and calls it
`delayed` or `no recent data` — both dark green. Nothing for the service to write.

## 6. Record the send decision and listener acceptance

For every project and scheduled job, record whether a message was expected,
intentionally skipped, or attempted. For each attempted recipient, record the
listener's result. A `queued` response with its queue ID, or a `sent` response
with its message ID, is sufficient Data Health evidence;
they describe listener acceptance and must not be presented as proof that a
person received or read a message. A rejected or unconfirmed response retains
its reason. Partial success must retain both successful and failed recipients.

Data Health does not require polling the listener queue to verify the final
WhatsApp outcome. If a service independently learns that a send failed, it can
still record the failure. A run completing, by itself, is not proof that a send
was expected or accepted. Missing or unreadable evidence is unknown, not green.

## 7. The `health` block of your contract

`contracts/service.contract.json` may declare, and HALO prefers a declaration to any rule:

```json
"health": {
  "granularity": { "ingestion": "none", "run": "project", "delivery": "project" },
  "statuses": { "queued": "green", "unconfirmed": "amber", "failed": "red",
                "completed_with_stale_readings": "stale" }
}
```

- `granularity` says per signal whether the answer is `project`, `service` (one answer for
  the estate, as Haze's public feed) or `none`. **An undeclared signal is `none`**, never
  `project`: a service that has not said it reports a signal reads as *not covered*, never
  as healthy.
- `statuses` maps your own words onto `green`, `stale`, `amber` or `red`. Only you know
  whether your `partial` means "some recipients failed" or "partial by configuration".
- A value outside those four is ignored, not trusted.

For verified schedules, `health.scheduleTimezone` is `UTC` and `health.schedules`
contains stable keys, routes, names, and arrays of due `hours` and `minutes`,
with optional `weekdays` (Sunday = 0) or `monthDays`. Noise and Subcon own the
declarations already used by HALO. They must be checked against the external
scheduler when it changes; a contract declaration does not prove a rule is
enabled or fired. A route with two rules needs two keys. Other services do not
gain schedule coverage merely by having a run log.

## 8. Evidence to add as services adopt the contract

Each service remains responsible for its own evidence. The target is a stable
job identity, invocation or run identity, scope (service or project), start and
completion times, outcome, and a reason for any failure. Record a scheduled
invocation independently from project decisions, because a handler can fail
before it reaches a project. A project decision distinguishes expected send,
accepted send, intentional skip, and failure; correlate any accepted send with
the identifier returned by its listener. Record stable cause codes and affected
resources where a service can provide them, alongside a safe human reason.

HALO treats an unreadable source, missing baseline, absent field, or unsupported
signal as unknown. A recent failure is historical evidence, while a current
issue requires current run, state, or schedule evidence. It groups matching
repeated reasons and retains the affected projects, first and last seen times,
and number of records. Grouping does not prove a shared cause or recovery.
Existing rows without the newer identifiers remain readable; they do not gain
invented identifiers or delivery outcomes.

These are adoption requirements, not a claim that every existing route already
emits every field. Track coverage per service and route as it is added.

## Checklist

- [ ] A row per project per scheduled run, skips included; no `project_code` is ever blank.
- [ ] Config-determined skips are decided before data is read.
- [ ] Every status follows the prefixes, or is declared in `health.statuses`.
- [ ] Every amber/red/stale status writes an error; no green status writes one.
- [ ] Each error says what, on what, and why (verbatim), with stable wording and no secrets.
- [ ] A late reading is a separate line from every other problem.
- [ ] Each expected send has a recorded decision and listener acceptance or failure; record a queue ID for `queued` or message ID for `sent`.
- [ ] `node scripts/audit-service-health.mjs` in HALO shows no `COLOUR-WITHOUT-EVIDENCE`,
      `GREEN-BUT-HAS-ERRORS` or `UNRECOGNISED` for the service.

## Pointer to paste into a service's `AGENTS.md`

> **Data Health.** What this service records in its run log is what HALO's Data Health
> shows. Follow HALO's [`docs/SERVICE_HEALTH_CONTRACT.md`](../usecase-wohhup-ops-dashboard/docs/SERVICE_HEALTH_CONTRACT.md):
> one row per project per run (skips included), statuses that follow the prefix convention,
> an error on every non-green status that says what, on what and why (the upstream's words,
> verbatim), late readings kept apart from other problems, and a recorded send decision and listener response. HALO never asks for wording to change; it asks for enough to act on.
