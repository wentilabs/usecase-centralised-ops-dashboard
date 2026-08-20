# AGENTS.md

Read this before editing. It records the decisions that are easy to break and
expensive to debug.

## What this repo is

**HALO Centralised Services** — the control surface for the project
configuration behind six centralised services that share one Supabase project:

| Service | Schema | Table | Row identity |
|---|---|---|---|
| WBGT | `wbgts` | `wbgt_project_configs` | `project_code` |
| Noise | `noise-meters` | `noise_project_configs` | `project_code` |
| Haze | `haze` | `haze_project_configs` | `project_code` |
| Lightning | `lightning` | `lightning_project_configs` | `project_code` |
| Ailytics | `ailytics` | `project_configs` | **`id` (uuid)** |
| Subcon Activities | `manpower_activity` | `project_configs` | **`id` (uuid)** |

Each service has its own repo (`usecase-*-alerts`, `mdw-lambda-ailytics`,
`usecase-wohhup-coy-housekeeping-waterparade`) that reads these tables and sends
WhatsApp messages. This app only edits configuration; it never sends anything.

Two names differ between the schema and the UI. **Subcon Activities** is the
operator-facing name for the manpower / housekeeping / Water Parade service; its
schema is still called `manpower_activity` after the repo's original scope. Do
not rename the schema to match the label.

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
wired at that point. The rest, in order:

1. `lib/field-spec.ts` — `READONLY` (identity + audit stamps), `CHECK_ENUMS`
   (values behind a CHECK rather than a pg enum), `FIELDS` (labels, widgets,
   `showIf`), `GROUPS` (order). Anything unlisted lands under "Other".
2. `lib/card-summary.ts` — `GROUP_COLUMNS` (which columns hold chat ids, and
   what each is for), `pillsFor`, `firesAt`, `hasCadence`, and `autoLinks` if it
   derives sheet links.
3. `app/page.tsx` — add any new group-id column to the chat-name resolver list,
   or the cards show raw ids.
4. `supabase/config_audit_setup.sql` — attach the audit trigger to the new
   table, naming its identity column, then re-run the file.
5. Expose the schema to PostgREST (Supabase → Settings → API → Exposed schemas).

`tests/auth-policy.test.ts` asserts steps 1 and 2 for every registered service,
and the typechecker catches a missing `GROUP_COLUMNS` or `TAG_TONE` entry.

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
9. `enabled` is a master switch in five services but **not** in Subcon
   Activities, where it gates outbound WhatsApp only — the intake, the
   classification, the Supabase writes and the Google Sheet writes all continue
   when it is off. The card says `INTAKE ONLY` rather than `DISABLED` for that
   reason (`STATUS_WORDING` in `ProjectCard`), and `hasCadence` ignores it.
   Lightning also has a CHECK that rejects `enable_red_band_poc_mentions` unless
   both POC lists are non-empty, so those three fields must be saved together.
