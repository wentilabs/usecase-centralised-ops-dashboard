# AGENTS.md

Read this before editing. It records the decisions that are easy to break and
expensive to debug.

## What this repo is

**HALO Centralised Services** — the control surface for the project
configuration behind seven centralised services that share one Supabase project:

| Service | Key | Schema | Table | Row identity |
|---|---|---|---|---|
| WBGT | `wbgt` | `wbgts` | `wbgt_project_configs` | `project_code` |
| Noise | `noise` | `noise-meters` | `noise_project_configs` | `project_code` |
| Haze | `haze` | `haze` | `haze_project_configs` | `project_code` |
| Lightning | `lightning` | `lightning` | `lightning_project_configs` | `project_code` |
| Ailytics | `ailytics` | `ailytics` | `project_configs` | **`id` (uuid)** |
| Subcon Activities | `subcon` | `manpower_activity` | `project_configs` | **`id` (uuid)** |
| Issue Chaser | `issueChaser` | `issue_chaser` | `project_configs` | `project_code` |

Each service has its own repo (`usecase-*-alerts`, `mdw-lambda-ailytics`,
`usecase-issue-chaser`, `usecase-wohhup-coy-housekeeping-waterparade`) that reads
these tables and sends WhatsApp messages. This app only edits configuration; it
never sends anything.

Names differ between schema and UI in two places, and neither should be
"corrected". **Subcon Activities** is the operator-facing name for what is now a
housekeeping-intake plus morning-report service; its schema is still
`manpower_activity` after the repo's original scope. **Issue Chaser** is keyed
`issueChaser` in code — the only camelCase service key — because its schema is
`issue_chaser` and the key has to be a valid identifier.

A service must also be exposed to PostgREST before HALO can read it at all
(Supabase → Settings → API → Exposed schemas). Issue Chaser returned a clean
per-service error for a while purely because that had not been done.

Next 16 (App Router) · React 19 · TypeScript · Tailwind 3 · deployed on AWS
Amplify. See `DEPLOYMENT.md`.

## The one rule that matters

**Writes go straight to production.** There is no staging copy. Saving a field
here changes what a live site's alerts do on their next cron run. When testing
a write, use a project with `enabled = false` and revert it afterwards.

## Architecture decisions worth preserving

**The schema is introspected, not hardcoded.** `lib/config-repository.ts` reads
PostgREST's OpenAPI document for column types, defaults and pg-enum values.
`lib/field-spec.ts` is only a *human overlay* on top: labels, help text,
grouping, conditional visibility, and the allowed values of CHECK-constrained
columns (introspection cannot see those). A column added to Supabase is
therefore editable immediately — it simply appears under "Other" until someone
gives it a label. **Do not replace this with a hardcoded field list**; the whole
point is that the alerts repos add columns often and the dashboard must not
silently omit them.

**Authorization runs in the Node runtime, not the Edge.** `middleware.ts` runs
on the Edge, where `process.env` only contains values inlined at *build* time.
An allow-list added to the host environment after a build is invisible there.
So middleware enforces the allow-list only when it can see it, and otherwise
defers to `app/page.tsx` and the route handlers, which read the live
environment and still fail closed. If you move an authorization check, keep it
on the Node side.

**Policy modules are pure and unit-tested.** `lib/auth-policy.ts`,
`lib/route-policy.ts`, `lib/config-values.ts` and `lib/card-summary.ts` take
their inputs explicitly (env defaults only as default parameters) so the rules
can be tested without a server. Follow that pattern rather than reading
`process.env` in the middle of logic.

**Writes are guarded in this order** (`app/api/config/[service]/[rowId]`):
validate against the live schema → reject unknown and read-only columns →
coerce values → drop no-ops → `PATCH` with an `updated_at` equality filter
(optimistic concurrency; zero rows back means someone else changed it) →
annotate the audit row. Keep that order.

**History is written by a Postgres trigger, not by this app.**
`supabase/config_audit_setup.sql` creates `ops.config_audit` and an
`after update` trigger on all six config tables, so a change made directly in
the Supabase table editor is recorded too. **Adding a service means re-running
that file** — the trigger is what makes its history work at all. The dashboard only *annotates* the
row its own write produced (matched on the returned `updated_at`) with the
operator's email and note. Rows without an actor render as "changed outside the
dashboard". Do not make the app the primary writer of audit rows — coverage
would drop to dashboard-only edits.

## Conventions

- **Comments explain why, never what.** Most comments in this repo exist
  because the reason is non-obvious (Edge vs Node env, single-use CAPTCHA
  tokens, the trigger-annotation pattern). Delete a comment only if the reason
  is gone.
- **Fail closed.** Unconfigured or unreachable auth denies. Never add a code
  path that admits on error.
- **Never `NEXT_PUBLIC_` the config key.** `SUPABASE_SECRET_KEY` is server-only;
  the prefix would ship it in the browser bundle. `tests/amplify-deployment-contract.test.ts`
  asserts this.
- **Dark theme via tokens.** Colours come from the HSL custom properties in
  `app/globals.css` and the Tailwind aliases (`bg-card`, `text-muted-foreground`,
  `text-on`, `text-warn`, `text-danger`). Avoid raw Tailwind palette shades like
  `bg-amber-100` — they were all removed for contrast reasons; use translucent
  accents (`bg-amber-400/15`) if you need a tint.
- **Responsive by one rule: unprefixed = phone, `md:` = desktop.** The desktop
  surface is the one operators already know, so every mobile change must be
  additive: write the phone style unprefixed and restore the existing desktop
  value behind `md:`. Never change an existing desktop utility to make a phone
  look right. The split shows up as two headers in `DashboardShell` (one
  `md:hidden`, one `hidden md:flex`), a `md:hidden` tap overlay on the card, and
  two mobile-only components — `ProjectSheet` (the details a phone card drops)
  and `ServiceDrawer` (the tabs, counts, refreshes and identity that do not fit
  a phone bar). Both are `md:hidden` at the root so a resize cannot surface them.
  `tests/mobile-contract.test.ts` guards all of it.
- **Pill tones mean four different things.** `on` is a switch that is on; an
  off pill renders struck through. `tone: "warn"` (amber) is a state that is
  active but worth noticing rather than celebrating — a meter filter. `tone:
  "info"` (blue) is a capability called out so it is not lost among the cadence
  switches — Water Parade. Toned pills are emitted first and take priority in the
  four-pill mobile cap, so they cannot hide behind the `+N`. Do not encode "this
  is not the default" as `on: false`: it renders as a dead switch and reads as
  the opposite of the truth.
- **A called-out pill appears only when it applies.** Water Parade is on for 1 of
  25 WBGT projects; a struck-through pill on the other 24 would be noise rather
  than emphasis. Same reasoning as the meter filter.
- **A card has three states, not two.** `cardEmphasis()` returns `active`
  (something is scheduled), `manual` (a WBGT project whose readings arrive as
  photos: enabled, `enable_scrape = false`, and photo source chats configured)
  or `idle`. Manual projects have no cadence at all, so the old binary test
  greyed them out and sank them as if they were dead — they now get a lighter
  scrim, a MANUAL badge and a middle sort rank. `hasCadence()` stays a pure "is
  anything scheduled" test; use `emphasisRank()` for ordering.
- **Chat ids are chosen by name, stored as ids.** Any column holding WhatsApp
  group ids gets `widget: "groups"` (see `lib/field-spec.ts`), which renders the
  `GroupPicker`: type a group name, pick from the matches, get a pill. What is
  written is unchanged — the same comma-separated id list every service already
  parses. Names come from `ops.whatsapp_group_names`; a column using the picker
  must also appear in `CHAT_ID_COLUMNS` or its ids never get a name, which
  `tests/auth-policy.test.ts` asserts.
- **Timestamps** render through `formatSgt()` — Asia/Singapore, `en-SG`.
- **Secrets never enter the repo.** `.env` and `.env.production` are gitignored.

## Outbound-only switches

Several columns read as "enabled" but gate **only** part of a service. Labelling
any of them plainly "enabled" would say the opposite of what is true:

| Service | Column | Off still does |
|---|---|---|
| Subcon | `enabled` | the whole housekeeping intake — it gates the morning report only |
| Subcon | `enable_housekeeping` | the morning report — it gates the intake only |
| WBGT | `water_parade_enabled` | cycles, roster snapshots, inbound events, photo decisions, reminder audits |
| Ailytics | `forward_pending_to_whatsapp` | stores the PENDING activity and writes activity history |
| Ailytics | `enabled` | lets existing issues still be closed over WhatsApp — it gates Telegram intake only |
| Noise | `noise_meters_included` | scraping, calculations, Sheets, ops fail-safes keep every meter |
| Issue Chaser | `enabled` | nothing on its own: a chaser style must also be on, and a CHECK refuses one unless `enabled` already is |

Each one's `help` text says what carries on regardless. `hasCadence` counts
`water_parade_enabled`, because a project with no WBGT cadence but Water Parade
on is still sending reminders and must not be scrimmed as idle.

**Subcon has no master switch at all.** Its two routes are independent:
`enable_housekeeping` gates `POST /housekeeping-intake` and `enabled` gates
`POST /daily-activity-manpower-summary`. `isProjectOn` in `ProjectCard` therefore
asks per service rather than reading `config.enabled`, and the badge says
`BOTH ROUTES OFF` rather than `DISABLED`, because that is what it means. This
column set has changed twice — it briefly had no `enabled` column at all — so
check the live schema before trusting any description of it, including this one.

## Outbound meter selection (noise)

`noise_meters_included` decides which meters reach the **client-facing** noise
messages. Semantics are set by `usecases/noise/outbound-meter-filter.js`:
comma-separated NoiseLynx RecIDs, and **blank/NULL means every meter**. Scraping,
calculations, Google Sheets and the ops fail-safes always keep every meter, so
this is "who is told", not "which meters run" — the help text says so, because
the natural reading is the wrong one.

RecIDs are bare numbers (`6408`), so the editor renders pill toggles labelled
with `noise_limits.noise_meter_loc` and keeps the id as a subtitle
(`components/MeterPicker.tsx`, meters fetched per project from
`/api/noise-meters`). Deliberately the official name, not the outbound display
alias — configuration should name what the database stores.

**Blank is not the same as listing every current RecID**, and `lib/meter-selection.ts`
exists to keep that straight:

- everything enabled serialises back to **NULL**, so the project keeps following
  its meters; an exhaustive list would freeze today's set and a meter added later
  would silently stop reaching the client.
- NULL rather than `""` specifically, because the rows are NULL and writing `""`
  over one leaves the editor permanently dirty.
- a RecID in the column that is not an active meter is shown as an amber
  `(unknown)` pill rather than dropped — the service logs `[ERROR]` and omits it,
  and rewriting it away behind the operator's back would hide the mistake.
  Completeness is therefore measured over real meters only, or a stale id left
  switched off would block the collapse to NULL.
- a meter with no RecID cannot be named by any allowlist, so it is a
  non-toggleable `(no RecID)` pill. None exist today (all 114 active meters have
  one), but if one appears, turning filtering on at all excludes it.

## xlsx / PDF export

`⤓ Export xlsx` on the WBGT and noise tabs. The services do the work (see their
own docs); HALO collects the inputs and proxies through `app/api/exports/[export]`.
Two formats, both rendered by Google so the sheet's appearance survives: `xlsx`
stays editable, `pdf` is the more faithful of the two.

**A failed preflight must still look like a readiness report.** Choosing a
project asks the service whether the export can run. The first version returned
a bare `{ error }` when that call failed, and the dialog treated
`ready === undefined` the same as `ready === false` — so the button was disabled
with nothing rendered, and there was no way to tell "blocked" from "never
answered". `ready` is now three-valued in effect: `true`, `false`, or absent
meaning no report came back, which the dialog shows explicitly. The route
converts service failures into a `service_error` blocker rather than a 502.

The preflight also reports `service_account_email`. That is the fastest way to
tell a changed credential set apart from a missing scope, and it is the address a
workbook has to be shared with.

## Sheet jobs

The action row under the header triggers endpoints that already exist on the
alert-service Lambdas: noise bootstrap, noise sync, WBGT fill. `lib/jobs.ts` is
the registry; HALO proxies through `app/api/jobs/[job]` rather than calling from
the browser, so the service URLs stay server-side and triggering a job needs the
same editor permission as a config write.

**Only noise and WBGT have actions.** That is a decision, not an oversight: every
other service's routes are cron-driven, and `baseUrlEnv` is typed to the two URLs
HALO actually holds. One deliberate gap is worth naming — haze added
`POST /api/haze-report-now` (an on-demand PSI report for one project), and HALO
does not expose it. Adding it would mean a `HAZE_API_URL` env var, widening the
`baseUrlEnv` union, and a caution in the dialog, because that route honours
neither the Sunday/public-holiday mutes nor working hours (INV-HAZE-16 in the
haze repo). Asked and declined for now — call the route directly meanwhile.

**The payload shapes differ between endpoints and must not be unified.**
Verified against the handlers: the noise endpoints take `project_code` /
`start_date` / `end_date`; `wbgt-sheet-fill` takes `projectCode` / `from` / `to`,
because its `resolveDates()` only enumerates a range when given `from` *and*
`to`; and `wbgt-scrape` needs a mandatory `historical: true` on top, since
`parseScrapeRequest()` rejects `from`/`to` without it and treats a bare
`projectCode` as a normal current-window scrape — omitting it would silently
scrape today. Hence one `buildPayload` per job, with a test pinning each shape.

**Each job also has a precondition**, re-checked server-side, because every one
of them reports success while doing nothing when it is unmet:

- sheet jobs need a sheet id. Real rows use placeholders — WCP's
  `google_sheet_id` is `"-"`, TBS's `monthly_sheet_id` is `""` — so
  `readSheetId()` rejects the same literals `normalizeGoogleSheetId()` treats as
  unset in the noise repo.
- `wbgt-scrape` needs an upstream: the scrape job filters on
  `enable_scrape !== false` and skips with `project_scrape_disabled_<code>`. That
  makes the MANUAL projects ineligible, which the dialog says in those words.

`maxSpanDays` mirrors a limit the endpoint enforces itself (31 for the historical
scrape), so the range is refused before the round trip. Declared `flags` are
allow-listed in the route — an undeclared flag is dropped rather than forwarded.

Requires `NOISE_API_URL` and `WBGT_API_URL`. Unset, the button still appears and
names the missing variable rather than failing silently.

## Group names (the alias store)

`ops.whatsapp_group_names` maps chat id → group name. Two paths fill it, and the
split is deliberate:

| | What it does | Cost |
|---|---|---|
| `npm run groups:backfill` | Every distinct `@g.us` id in the listener log, by keyset-skipping `from` (one request per group, not per message) | ~20s to enumerate 641 groups, ~2min for a cold full run |
| ⟳ Chat aliases (`?refresh=1`) | Walks back ~12k recent messages, taking each group's newest name; also *discovers* groups no project references | a few seconds |

The backfill is a script rather than an endpoint because enumerating every id
exceeds a serverless request budget. The incremental scan is what the button
runs, and it is what keeps the picker's dropdown current.

**When resolving a name, filter `chatName=not.is.null` first.** Many rows store
it as null, so taking the single latest row reported "unnamed" for 277 of 641
groups whose name sat one row further back; filtering recovered 254 of them.
23 groups genuinely have no name anywhere and correctly render as raw ids.

## Adding a service

`SERVICES` in `lib/services.ts` is the entry point, but a service is only half
wired at that point. This list is what adding Issue Chaser actually took, in
order:

1. **Expose the schema to PostgREST** (Supabase → Settings → API → Exposed
   schemas). Nothing else works until this is done, and the symptom is a
   per-service `406 PGRST106`, not an obvious misconfiguration.
2. `lib/services.ts` — the `SERVICES` entry and the `ServiceKey` union. Add
   `shortLabel` if the full name will not fit beside a project code; there is a
   12-character ceiling on the card tag, enforced by a test.
3. `lib/field-spec.ts` — `READONLY` (identity + audit stamps), `CHECK_ENUMS`
   (values behind a CHECK rather than a pg enum), `FIELDS` (labels, widgets,
   `showIf`), `GROUPS` (order). Anything unlisted lands under "Other". Include
   `company` in both, or it lands there too.
4. `lib/card-summary.ts` — `GROUP_COLUMNS` (which columns hold chat ids, and
   what each is for), `pillsFor`, `firesAt`, `hasCadence`, and `autoLinks` if it
   derives sheet links.
5. `components/ProjectCard.tsx` — `TAG_TONE`.
6. `lib/onboarding.ts` — an `ONBOARDING` definition, if the service should offer
   `＋ Add project`. A test asserts every registered service has one.
7. Nothing, for chat-name resolution: `app/page.tsx` feeds the alias store from
   `chatIdsIn`, which derives its columns from `GROUP_COLUMNS`. Step 4 is the
   only place a new group-id column has to be named.
8. `supabase/config_audit_setup.sql` — attach the audit trigger to the new
   table, naming its identity column, then re-run the file.
9. `supabase/migrate_company_column.sql` in the service's own repo, so the table
   carries `company` like the rest.

`tests/auth-policy.test.ts` and `tests/onboarding.test.ts` assert steps 2, 3, 4
and 6 for every registered service, and the exhaustive `Record<ServiceKey, …>`
types make the typechecker point at a missing `GROUP_COLUMNS` or `TAG_TONE`
entry rather than letting it fail at runtime.

Two things happen automatically and need no work: the OpenAPI document and the
MCP tool list both read `SERVICE_KEYS`, so a new service appears in the
`service` enum of `updateProjectConfig` and friends as soon as it is registered.
Regenerate the committed spec with `npm run openapi`.

One thing that bit: `/api/schema` used `Promise.all`, so registering a service
whose schema was not yet exposed took the **whole endpoint** down and turned the
dashboard into a 500. It settles per service now — but the lesson generalises,
so prefer `allSettled` for anything that fans out across services.

## Editing the field spec

Adding a column to a service means adding an entry to `FIELDS[service]` and
listing it in `GROUPS[service]` in `lib/field-spec.ts`. Useful keys:

- `hidden` — never render (identity, audit stamps, job-owned runtime state)
- `showIf: { field, equals }` — render only while another field holds a value;
  a hidden field's pending edit is discarded so what you cannot see cannot be
  saved
- `row` — fields sharing a row key sit side by side on one compact row
- `widget` — `toggle | select | number | text | hhmm | csv | multi | sheet`

Columns owned by the alert jobs (e.g. WBGT's `top_of_hour_band`, Lightning's
`lightning_project_runtime` state) belong in `READONLY` or `hidden`, not in the
editor.

## Creating a project

`＋ Add project` on every service tab. `lib/onboarding.ts` holds one definition
per service and is the only place that knows what creating a row involves — the
route and the dialog are generic over it.

**Rows are always created disabled**, and `enabled` is not settable from the
dialog. Every service's own docs prescribe that order, and it is the only safe
default when half the fields may still be blank.

What varies, and why the definitions are not copies of each other:

| | what creating a row involves |
|---|---|
| haze, lightning, subcon, Issue Chaser | one insert |
| ailytics | one insert, but five NOT NULL columns are routinely unknown, so a blank one is written `""` and never `null` |
| wbgt, noise | a per-project readings table **first**, via a `security definer` RPC, then the row — and for wbgt a `wbgt_sensors` row after it |

Rules that are easy to get wrong and are pinned by tests:

- **The project-code rule follows the service, not HALO.** haze, lightning and
  Issue Chaser CHECK `^[A-Z0-9][A-Z0-9-]{0,47}$`; ailytics constrains nothing;
  wbgt and noise have no CHECK but derive a table name that must start with a
  letter. One shared regex accepted codes Postgres then rejected.
- **Only require what the table demands.** A field marked required that the
  database would accept as null is a dialog inventing a rule and blocking a
  legitimate draft row.
- **DDL runs first.** A config row pointing at a readings table that was never
  created is the half-onboarded state the ordering avoids. A companion row runs
  last, and a failure there is reported rather than thrown, because the config
  row is real and editable by then.
- **A group column uses the picker, never free text.** Both directions are
  tested: every group column in a flow must be `kind: "groups"`, and no column
  the alias store resolves may be rendered as anything else.
- **Computed fields are enforced server-side.** `resolveValue` ignores whatever
  the draft carries for one, so a hand-crafted POST cannot put a mismatched
  Google Sheet tab name on an ailytics row.
- **Say what HALO cannot do.** Every definition carries `outsideHalo`, shown
  before and after creation. Sharing a workbook, deploying an adapter, importing
  `noise_limits`, matching a CloudLynx sensor label — a row without them looks
  finished and does nothing.

Onboarding is **not** audited: the trigger behind `ops.config_audit` is
`AFTER UPDATE` only, so row creation and deletion leave no trail. The row's own
`created_at` is the only record.

## Identity: the `company` column

Every config table carries a nullable `company`, for identity only — no service
reads it. Backfilled from `instance_name` (`wohhup`/`wohhup-backup` → Wohhup,
`obayashi` → Obayashi, `pentaocean` → PentaOcean), and deliberately left NULL
where that implied nothing rather than defaulting to Wohhup and inventing an
attribution. Nine of 108 rows came out blank, all of them with no delivery
configured.

Plain text with no CHECK — a new company should never need a migration — so the
known values live in `COMPANIES` as dropdown options instead. Guided in the UI,
permissive in the database.

It surfaces two ways: as a watermark behind the card (`CompanyMark`), and in the
search box. Logos live in `public/company/` and are referenced by file, so
replacing one is dropping in a file. Two things there are load-bearing:
`pointer-events-none`, without which the mark would swallow every click on the
card beneath it; and a per-logo `tweak` for scale and brightness, because the
artwork was drawn for white paper — PentaOcean's navy wordmark vanishes on a dark
card without a brightness lift.

## The search box

Matches project code, company, **and the card's own switched-on pills**, so
"water parade" returns the projects that have it. Only pills that are ON count:
matching a struck-through pill would return exactly the projects the searcher
does not want. It reads from `pillsFor`, so a new switch becomes searchable the
moment it becomes a pill — there is no label list to maintain.

## Formatter previews

A formatter column is a dropdown of opaque names — `date_loc_name_12h_complete_list`
says nothing about the message it produces — so anyone but the author picked one by
guessing. The circled `?` beside a field label opens `components/FormatterPreview.tsx`:
the options in a left rail, the real WhatsApp message on the right, one click apart so
two candidates can be compared.

**Nothing in there is written from memory.** A wrong example is worse than no example,
because it gets trusted:

- **noise** — lifted verbatim from that repo's own `MESSAGE_SHAPES.md` by
  `scripts/build-message-previews.mjs` into `lib/message-previews.generated.ts`.
  Re-run it (needs the noise repo checked out as a **sibling** of this one;
  `NOISE_REPO=` overrides the path) after the noise message shapes change.

  This is the one part of the previews that can rot without anything failing, and
  it did: the script's default path was absolute under `$HOME`, the estate moved
  into `wh-centralised-services/`, and it silently stopped running while its
  committed output kept looking well-formed — eleven bubbles fell a message
  format behind. The default is now resolved from the script's own location, and
  `tests/message-previews.test.ts` regenerates into a temp file and compares
  whenever the sibling repo is present. Do not replace that comparison with a
  check that the file merely exists.
- **wbgt** and **haze** — produced by *executing* those repos' own builders
  (`buildFiveMinAlertMessage`, `buildHazeMessage`) and pasting the output, because
  their docs are organised by reading band rather than by formatter value.

Two things to keep right when adding one:

- `kind: "cadence"` for an option whose text is byte-identical to its siblings and
  only the *timing* differs (WBGT's `intermittent_reports_formatter`). Showing a
  bubble alone there implies a difference that is not there, so those carry a
  quarter-hour firing table and share one body via `PREVIEW_CONTEXT`.
- `isFallback` marks the option a **blank** column resolves to, from the service's
  own fallback table. The panel opens on it and says so.

`tests/message-previews.test.ts` asserts the inventory explicitly rather than deriving
it. That is deliberate: a new formatter value ships in a service repo, the dropdown
picks it up from the live schema automatically, and the panel would silently not list
it. A second test reads the formatter-shaped keys back out of `FIELDS` in
`lib/field-spec.ts` and fails unless each one has a preview or an entry in that file's
`KNOWN_WITHOUT_PREVIEW` map — so the trigger is "someone added the field", which is
exactly when the preview should be written. Record a gap there with its reason rather
than inventing an example; a stale entry fails too, once the preview exists.

One formatter can depend on another. WBGT's `five_min_alert_formatter = full` renders
whichever `hourly_message_formatter` the project uses, so neither field explains itself
alone — both carry a `PREVIEW_CONTEXT` intro naming the other, and `full` shows the same
crossing under both wordings. Check for that kind of inheritance by *running* the
builder with each combination rather than reading it: passing the wrong parameter name
silently falls back to the default and makes two settings look identical.

Cross-check the live schema as well, which is how `wbgt.hourly_message_formatter` was
found sitting unlabelled in the "Other" bucket:

```bash
curl -s localhost:5178/api/schema | grep -o '"[a-z_]*formatter"'
```

## The smart chat, and bulk changes

`lib/chat-intent.ts` turns a sentence into a change to ONE project;
`lib/chat-scope.ts` is the half that handles several. `app/api/chat/route.ts`
picks between them. Both files share one rule, and it is the rule to defend:

**Which projects a sentence will change is decided in code, never by the model.**
One project resolved wrongly is a wrong site getting a message; fifty resolved
wrongly is fifty. So project codes, company names, service names and the
"all projects" phrasing are all parsed against closed sets HALO already holds.
The model is left with the job only it can do — mapping an outcome onto columns
and values.

The scope precedence in `resolveScope` is safety-critical and written out in its
doc comment. The part worth repeating here: **a service name alone is not a bulk
scope.** "noise projects should mute Sundays" reads as bulk to a person and as an
unfinished sentence to a machine, so it comes back asking for the word "all"
rather than writing to every noise site.

Four things follow from the same caution:

- **`set` is refused across services.** The same outcome is different columns on
  different services, so a cross-service `set` would need per-service column
  mapping that nothing validates. It asks for one service instead. Group removal
  and `defaults` have no such problem — both resolve their columns per service,
  in code.
- **A group removal carries a phrase, never chat ids.** `parseBulkOp` drops any
  ids the model volunteers. Which groups a phrase means is `matchGroupNames` over
  the real alias store, and the operator sees the match list before anything is
  written.
- **`defaults` skips columns whose default is null.** Every column has a default
  and for a delivery-group column that default is blank, so the naive reading
  would empty a live site's WhatsApp list — a project that then runs its cadences
  and sends to nobody. See `defaultsFor`.
- **Writes are still one PATCH per row**, through the same endpoint the editor
  uses, so each keeps its own validation, its own optimistic-concurrency check
  and its own audit row carrying the sentence. There is deliberately no bulk
  write endpoint; a test asserts none exists.

`matchGroupNames` requires **every** identity token of the phrase to appear —
fuzzy means tolerant of how a name is written, not of words missing from it. At
half-coverage, "X WL coordinations" matched 92 unrelated groups including
"AE - Site Coordination All Vendors". See trap 15.

## The Singapore lightning map

`components/LightningMap.tsx`, opened from the ⚡ button on the lightning
actions row or from a lightning card's own `⚡ Lightning map` link. It exists to
settle one conversation: a client says there was lightning overhead and asks why
no alert came. Read-only, and available to read-only accounts — the person
fielding that question is often not the person who may change a configuration.

Four things about it are load-bearing, and all four are in `lib/lightning-map.ts`
with tests, because a map that draws the wrong circle would prove something
untrue to a client:

- **The window filters on `published_at`, not `occurred_at`.** A strike NEA told
  us about at 23:58 could not have fired a 23:52 alert. Real lag is two to four
  minutes; the tooltip shows both stamps and the difference.
- **The drawn radius is not `red_radius_m`.** The engine tests
  `haversine − site_extent − uncertainty(type) ≤ radius`, so the qualifying
  circle is `radius + site_extent + uncertainty` (INV-LTG-02 — the margins
  *widen* the ring). `ringsFor` does this; every project runs zero margins today,
  which is exactly why drawing the raw column would look correct until it wasn't.
  Amber is omitted entirely when `amber_enabled` is false (INV-LTG-13).
- **The counts come from their own query, not from what is drawn.** The map
  layer follows the viewport and is capped, so counting hits from it would give a
  number that changes when you pan. `evidenceFor` reads a separate, tight box
  around the focused project.
- **That query asks only for the types a tier counts.** A storm is
  overwhelmingly intra-cloud: filtering to `G` took one site's worst hour from
  2,130 rows to 15. This is what keeps the evidence query under the cap, and the
  cap is what keeps the claim true — see trap 14.

**Zoom is continuous, tiles are not.** The projection helpers all take a numeric
zoom and work fine with a fractional one, so `zoom` is a float; tiles render at
`Math.round(zoom)` and the layer is CSS-scaled by the difference, which stays
within [1/√2, √2]. That is what makes a pinch stretch the pixels already on
screen instead of waiting for a tile fetch — a new tile set is only pulled when
the gesture crosses a half-level. The canvas needs no transform at all, because
it draws from the fractional zoom directly and therefore stays registered with
the tiles mid-gesture.

Gestures: one finger drags, two pinch (anchored on the start, so out-and-back
returns exactly), a trackpad two-finger scroll pans, and a mouse wheel zooms
about a third of a level per notch. The wheel listener is bound natively with
`{ passive: false }` — React registers wheel handlers as passive, where
`preventDefault` is ignored, and without it a pinch zooms the whole browser.

`lightning.lightning_detections` holds **every** NEA detection unfiltered and is
never pruned; the ingest path deliberately does not clip to a bounding box, so an
empty result means NEA reported nothing rather than that something was discarded.

## The agent-facing API

**[AGENT_ACCESS.md](./AGENT_ACCESS.md)** is the practical guide: minting a token,
the scope table, the thirteen tools, and verified curl and MCP examples. This
section is the reasoning behind the shape.

`lib/openapi.ts` is the single source of truth for HALO's API contract, served at
`/openapi.json` and `/openapi.yaml`, with a committed `openapi.yaml` for reading in the
repo. Authored in TypeScript rather than as a YAML file and rather than generated: the App
Router has no central router to introspect, and authoring in TS means the document is
type-checked and `tests/openapi.test.ts` can import it to check it against the handlers
that actually exist.

That test is the point of the exercise. A spec describing endpoints that do not exist is
worse than no spec, because an agent acts on it. It asserts both directions — every route
handler has an operation, every operation has a handler — plus unique lowerCamelCase
`operationId`s (agent frameworks turn these into tool names), a real description on every
operation, a documented 401, and that the committed YAML is not stale. Run
`npm run openapi` after editing the spec.

Two rules worth keeping:

- **A description says what changes in the world**, not what the endpoint returns. An agent
  reading "updates a row" behaves differently from one reading "changes production
  behaviour on the next cron tick". A test enforces that every mutating operation says so.
- **Never invent a server URL.** The deployed hostname is not recorded in this repo, so the
  production entry appears only when `HALO_PUBLIC_URL` is set. A guessed URL in a contract
  an agent resolves is worse than a missing one.

### MCP

`/api/mcp` speaks MCP over Streamable HTTP, JSON only — no SSE, no session ids. That is a
permitted subset and the right one here: every operation is a short request/response, so
there is nothing to stream.

Tools are **derived from the OpenAPI document**, not hand-listed (`lib/mcp.ts`). That is
why the spec is 3.1 rather than 3.0 — in 3.1 the schema objects *are* JSON Schema 2020-12,
which is exactly what an MCP `inputSchema` must be, so the conversion is mechanical and
there is one description of the API rather than two that drift.

Two decisions worth keeping:

- **Arguments are flattened.** Path, query and body properties sit side by side, because a
  model handles `{"service": "haze", "changes": {…}}` far more reliably than a nested
  `{"path": …, "body": …}`. `toCallPlan` puts each back where it belongs, and anything the
  operation does not declare is dropped rather than forwarded.
- **A call is dispatched by making the corresponding HTTP request against this same app**,
  carrying the caller's own credential. MCP therefore cannot acquire a capability the HTTP
  API does not already grant, and a scope check written once in a route handler governs
  both surfaces.

Safety annotations are derived from the operation rather than declared, so a new endpoint
cannot be added without one. `runJob` is the only tool marked `destructiveHint` — it can
make a service send WhatsApp messages to a live construction site — and the only one that
is not idempotent. `updateProjectConfig` is idempotent and not destructive even though it
changes production; the description carries that weight, not the flag.

### Bearer tokens

Agents authenticate with `Authorization: Bearer halo_…`, resolved inside
`getDashboardSession` **before** the cookie path — so a bearer request never inherits the
loopback dev bypass. Only the SHA-256 hash reaches `ops.api_tokens`; the plaintext is shown
once by `scripts/mint-api-token.mjs` and is not recoverable.

Scopes are additive and deliberately **not** hierarchical: `read`, `write`, `jobs`. Holding
`write` does not confer `read`, and neither confers `jobs` — a token that may trigger a job
that sends WhatsApp messages to a site should not thereby be able to read every project's
configuration. `POST /api/jobs/{job}` checks the `jobs` scope on top of `canEdit`.

A token's name becomes its audit actor (`agent:<name>`), which means an agent's writes are
better attributed than a human editing Supabase directly — those record no actor at all.

## Verifying a change

```bash
npm run typecheck
npm test          # policy, validation, summaries, Amplify deployment contract
npm run build
npm run dev       # http://localhost:5178 — auth is bypassed on loopback
```

`npm test` compiles with `tsconfig.test.json`; a new pure module must be added
to its `include` list to be testable.

Check any UI change at **both** widths — a phone (375px) and the desktop layout
(>= 768px). The mobile surfaces are reachable only below 768px, and a desktop
regression is invisible on a phone.

```bash
# The responsive contract alone (npm test -- <flags> does not filter: the extra
# args land after the file glob).
npx tsc -p tsconfig.test.json && node --test .test-dist/tests/mobile-contract.test.js
```

## Traps that have already bitten

1. `NEXT_PUBLIC_*` values are inlined at **build** time — changing one in the
   host console does nothing until a rebuild.
2. Amplify does not reliably pass console variables to the running server, so
   `amplify.yml` writes them into `.env.production` during the build. If a
   variable is mysteriously missing at runtime, check that build step, and check
   whether a build-settings override saved in the Amplify console is shadowing
   the repo's `amplify.yml`.
3. Next 16 renames middleware to `proxy.ts`. This repo keeps `middleware.ts`
   and must not also contain a root `proxy.ts`; the contract test asserts both.
4. Supabase's sign-in email contains a code **and** a link — opening the link
   consumes the one-time token, after which the code reads as invalid.
   `app/auth/confirm/route.ts` exists so the link path works too.
5. The shared auth project enforces CAPTCHA; sign-in fails without
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, and Turnstile only accepts hostnames listed
   on the widget in Cloudflare.
6. Plain CSS appended to `app/globals.css` lands **after** Tailwind's utilities,
   so an unscoped custom class out-ranks `md:py-4` and silently changes the
   desktop. The `.pt-safe` / `.pb-safe` helpers are therefore wrapped in
   `@media (max-width: 767px)`.
7. iOS zooms the whole page when a focused control's text is under 16px, which
   made the editor jump on every tap. Fixed once, globally, by raising
   `input, select, textarea` to 16px under `max-width: 767px` — do not undo it
   by styling a control's font size inline.
8. The introspected-schema cache lives on `globalThis`, not in module scope.
   Next bundles route handlers separately from server components, so a
   module-scoped `Map` gave `/api/schema/reload` a *different* cache from the one
   `app/page.tsx` reads: the API returned the new columns while the dashboard
   served the stale spec until the server restarted. `/api/session` reports
   `cachedSpecs` so this is checkable — render the dashboard, then read it; a
   non-zero value means the two paths share one cache.
9. **Not every service spells its master switch `enabled`, and Subcon has none.**
   Its two routes are independent — `enable_housekeeping` gates the intake,
   `enabled` gates the morning report — so `isProjectOn` in `ProjectCard` asks
   per service. That column set has now changed twice: it briefly had no
   `enabled` at all, then got one back meaning something narrower. **Read the
   live schema before trusting any description of that table, this one
   included.** Issue Chaser has the inverse quirk: `enabled` alone sends
   nothing, because a CHECK refuses any chaser style unless `enabled` is already
   true, so you enable first and switch styles on second. Ailytics' `enabled`
   gates Telegram intake only — a disabled project can still have existing
   issues closed over WhatsApp. Lightning has a CHECK that rejects
   `enable_red_band_poc_mentions` unless both POC lists are non-empty, so those
   three fields must be saved together.
10. **A disabled project must stay legible.** It used to carry `opacity-60` *and*
   a 45% scrim, which stacked into something unreadable — the card was in the DOM
   but effectively invisible, and since every newly created project starts
   disabled, there was no way to switch one on from the UI. De-emphasis is now
   carried by the border and a loud badge, never by dimming the content, and the
   remaining scrim applies only to an *enabled* project with nothing scheduled.
11. **WBGT's `poc_phone_numbers` is not only a number list.** The single exact
   value `manpower-sheet` resolves today's sender/PIC phones from the Manpower
   tab instead. Mixing the sentinel with digits is not a partial success: the
   service returns NO numbers, so nobody is mentioned and nothing errors.
12. A stored haze value is not always a value in force. `four_hourly` (on for 21
    of 24 projects) sends at 08:00/12:00/16:00/20:00 SGT and **bypasses**
    `alert_only_when_at_least`, so a card that quoted the stored gate would
    misdescribe the project — the pill row reports `every band` instead. Haze
    working hours have the opposite trap: the service reads one configured end
    as *no* window at all, so the card only renders a range when both ends are
    set. Both are asserted in `tests/auth-policy.test.ts`.
13. **A test that matches the letter of something instead of its purpose will
    pass while the thing regresses.** Four of these appeared in one session and
    each looked fine: an assertion that `opacity-60` is absent from
    `ProjectCard.tsx` matched a *comment* explaining why it was removed; a check
    that a disabled Water Parade pill does not match the search passed whether
    or not the filter existed, because that pill is omitted entirely when off; a
    pinned opacity digit broke twice on deliberate changes; and the OpenAPI
    contract test verified paths and methods while two operations declared query
    parameter names the handlers never read. The habit that catches all four:
    after writing an assertion, break the code deliberately and confirm the test
    fails. If it still passes, the test is decoration.

14. A truncated evidence query is a **false** all-clear, not a
   hedged one. The lightning map once reported "no qualifying strike" for a
   window that contained a ground strike 1.8 km inside a 3 km ring: the 500 most
   recently published detections in the box did not reach back far enough.
   PostgREST also caps any result at 1000 rows and returns 1000 for a larger
   request without complaining, so raising `limit` is not a fix. The fixes are
   the type filter and a tight box; if the cap is still hit, the UI refuses to
   make the claim rather than shading it.

15. **Fuzzy matching that tolerates missing words is not fuzzy, it is
   broad.** `matchGroupNames` first scored a name by how many of the phrase's
   tokens it contained and accepted half. For the two-token phrase
   "X WL coordinations" that means "any one token", and it matched 92 of 118
   groups in the estate — "AE - Site Coordination All Vendors" on the word
   coordination, "[Wen] Meeting Notes" on a three-letter prefix. Requiring every
   token, with a three-character floor on prefix matches, took it to the 25 real
   WL/Wentilabs coordination groups. Tolerance belongs in how a token may be
   SPELLED — synonym, inflection, one word or two — never in how many of them
   have to be there.
