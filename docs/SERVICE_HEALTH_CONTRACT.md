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
- `completed_with_…` — amber. Use it only for "it ran and sent, but something needs
  a developer". Do **not** use it for something a developer cannot act on (see §5).
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

## 6. Queued is not delivered: reconcile your queued sends

The listener answers a send with `queued` and a queue id, then tries it. It can give up
for good — `NOT_PARTICIPANT` ("this number is no longer a participant of this group") is
the case seen — and **it tells nobody**. A service that stops at `queued` reports a message
that never arrived as accepted, green, indefinitely. In the week to 20 Oct, 376 such drops
hit eleven chats.

A service that sends through the queue must therefore, for queue ids older than a few
minutes that it has not seen finish:

1. Ask `POST /proxy/outbound-status` (direct: `POST /outbound/status`) with
   `{ instanceName, clientId, queueIds: [...] }` — at most 100 per call, finished rows kept
   seven days. It reads the queue table only, never returns message content, and answers
   at once even before WhatsApp is ready. Through the proxy the answer is under `data`.
2. The answer is `{ success, items[], notFound, allTerminal, retentionDays }`. Each item has
   `queueId`, `status`, `chatId`, `attempts`, `completedAt`, `messageId` and, when there is
   something to say, `error: { code, text }`. `status` is one of:
   - `queued` / `sending` — not finished; leave the send `queued` and ask again later. A
     `queued` item that carries an `error` is waiting to retry after a failed attempt.
   - `sent` — WhatsApp's server accepted it (`ack ≥ 1`); not "delivered" or "read". Record
     `sent` with `messageId`. Green.
   - `failed` — will not be sent: bad input, a target that stays missing, or not delivered
     within 24 hours (`error.code` is `EXPIRED`). Record `failed…`. Red.
   - `dropped` — will not be sent: this number can no longer send to that group
     (`NOT_PARTICIPANT`, `ADMINS_ONLY`). Record a status beginning **`dropped`**. Red.
   - An id in `notFound` has aged out of the seven-day retention: say so in the log rather
     than leaving it `queued` for ever.
3. Write the outcome onto the ledger row, **and** into the run log's `errors` for the
   project for anything that is not `sent`, following §3 — the listener's own `error.code`
   and `error.text`, the chat, the queue id:

   ```
   120363405395020959@g.us: queue 57557 dropped — NOT_PARTICIPANT: WhatsApp rejected the send: this number is no longer a participant of this group
   ```

A final `failed` or `dropped` is **not** an instruction to repost: the message was accepted
and the listener has made its final decision.

Until a service does this, HALO cannot see a drop. It does not hold the key to the
listener's queue and will not be given it.

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

## Checklist

- [ ] A row per project per scheduled run, skips included; no `project_code` is ever blank.
- [ ] Config-determined skips are decided before data is read.
- [ ] Every status follows the prefixes, or is declared in `health.statuses`.
- [ ] Every amber/red/stale status writes an error; no green status writes one.
- [ ] Each error says what, on what, and why (verbatim), with stable wording and no secrets.
- [ ] A late reading is a separate line from every other problem.
- [ ] Queued sends are reconciled, and a dropped one is written as `dropped…`.
- [ ] `node scripts/audit-service-health.mjs` in HALO shows no `COLOUR-WITHOUT-EVIDENCE`,
      `GREEN-BUT-HAS-ERRORS` or `UNRECOGNISED` for the service.

## Pointer to paste into a service's `AGENTS.md`

> **Data Health.** What this service records in its run log is what HALO's Data Health
> shows. Follow HALO's [`docs/SERVICE_HEALTH_CONTRACT.md`](../usecase-wohhup-ops-dashboard/docs/SERVICE_HEALTH_CONTRACT.md):
> one row per project per run (skips included), statuses that follow the prefix convention,
> an error on every non-green status that says what, on what and why (the upstream's words,
> verbatim), late readings kept apart from other problems, and queued sends reconciled with
> `outbound/status`. HALO never asks for wording to change; it asks for enough to act on.
