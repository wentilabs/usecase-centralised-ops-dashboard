# Centralised Services Dashboard

Next.js control surface for the project configs behind all five centralised
alert services — **WBGT, Noise, Haze, Lightning and Ailytics** — in one place.
It reads them live from Supabase and writes edits back, validated against the
live schema, with a shared change history.

Built to the same conventions as `wenti-penta-ocean-safety-fe`: Next 16 App
Router, Supabase Auth with a server-side allow-list in `middleware.ts`, pure
unit-tested policy modules, and an Amplify build guarded by a deployment
contract test. See [DEPLOYMENT.md](./DEPLOYMENT.md).

## Run locally

```bash
cp .env.example .env.local   # SUPABASE_URL + SUPABASE_SECRET_KEY are enough locally
npm install
npm run dev                  # http://localhost:5178
```

On a loopback hostname auth is bypassed, so no sign-in is needed for local work.
Set `LOCAL_AUTH_BYPASS=false` to exercise the real login flow.

## Scripts

| | |
|---|---|
| `npm run dev` | local dashboard |
| `npm run build` / `npm start` | production build (auth enforced) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | policy, validation and summary unit tests |

## How it works

- **Schema is introspected**, not hardcoded: PostgREST's OpenAPI doc supplies
  column types, defaults and enum values, and `lib/field-spec.ts` adds labels,
  grouping, conditional visibility and the values of CHECK-constrained columns.
  A column added to Supabase becomes editable immediately — it appears under
  "Other" until it is given a label.
- **Writes are guarded**: unknown/read-only columns refused, values coerced and
  validated, no-ops dropped, and an `updated_at` check means an edit made
  elsewhere is reported rather than silently overwritten.
- **History is shared**: a Postgres trigger records every change to
  `ops.config_audit`, including edits made directly in the Supabase table
  editor. Dashboard writes are stamped with the operator's email and note;
  unstamped rows show as *changed outside the dashboard*.

## Auth

| Env | Effect |
|---|---|
| `NEXT_PUBLIC_AUTH_SUPABASE_URL` / `..._PUBLISHABLE_KEY` | the Supabase Auth project used for email OTP sign-in |
| `WHITELIST_EMAILS` / `WHITELIST_DOMAINS` | who may sign in — **fails closed** if unset or if Supabase is unreachable |
| `EDITOR_EMAILS` | who may change anything; everyone else is read-only |
| `LOCAL_AUTH_BYPASS` | loopback-only dev convenience, ignored in production |

## Deploy

AWS Amplify, via `amplify.yml`. Set every variable above in the Amplify
environment (`SUPABASE_SECRET_KEY` is server-only and must never be prefixed
with `NEXT_PUBLIC_`). Run
[`supabase/config_audit_setup.sql`](./supabase/config_audit_setup.sql) once and
expose the `ops` schema in Supabase → Settings → API.
