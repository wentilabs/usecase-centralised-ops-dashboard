# Deployment — AWS Amplify

Same shape as `wenti-penta-ocean-safety-fe`: a Next 16 app built by Amplify from
`amplify.yml`, with identity handled by Supabase Auth and authorization by a
server-side allow-list in `middleware.ts`.

`tests/amplify-deployment-contract.test.ts` guards the parts of that shape a
dependency bump could silently break — run `npm test` before every deploy.

## The contract

| Requirement | Why |
|---|---|
| `next` pinned to `16.x` (currently 16.2.3), React 19 | the version proven to build and run on Amplify in the sibling apps |
| `middleware.ts` present, **no root `proxy.ts`** | Next 16 renames middleware to proxy; the working apps keep `middleware.ts` and must not carry both |
| Node 22 (`.nvmrc`, `engines.node`) | matches the Amplify build image |
| `package-lock.json` committed | `npm ci` in preBuild needs it |
| `SUPABASE_SECRET_KEY` **without** a `NEXT_PUBLIC_` prefix | a prefix would ship the privileged key in the client bundle |

## One-time Supabase setup

1. Run [`supabase/config_audit_setup.sql`](./supabase/config_audit_setup.sql) in
   the SQL editor. It creates `ops.config_audit` and attaches an `after update`
   trigger to all five config tables, so every change is recorded — including
   ones made directly in the Supabase table editor.
2. Add `ops` to **Supabase → Settings → API → Exposed schemas**. Without it the
   history panel reports a setup hint instead of rows.

## Amplify app setup

1. **Create the app** → host a web app → connect this repo → branch
   `feat/nextjs-port` (or `main` once merged). Amplify detects Next.js and uses
   `amplify.yml` from the repo root; no build overrides needed.
2. **Environment variables** (App settings → Environment variables):

   | Variable | Notes |
   |---|---|
   | `SUPABASE_URL` | config project |
   | `SUPABASE_SECRET_KEY` | **server-only** — never prefix with `NEXT_PUBLIC_` |
   | `NEXT_PUBLIC_AUTH_SUPABASE_URL` | dedicated Supabase Auth project |
   | `NEXT_PUBLIC_AUTH_SUPABASE_PUBLISHABLE_KEY` | publishable by design |
   | `WHITELIST_DOMAINS` and/or `WHITELIST_EMAILS` | **required** — with neither set, nobody can sign in (fails closed) |
   | `EDITOR_EMAILS` | optional; set it to make everyone else read-only |

   Do **not** set `LOCAL_AUTH_BYPASS` in Amplify. It is ignored in production
   anyway, but leaving it out avoids any doubt.
3. **Supabase Auth** → URL configuration → add the Amplify domain to the
   redirect allow-list, so OTP sign-in completes on the deployed origin.
4. **Deploy**, then verify below.

## Verify after deploy

```bash
curl -si https://<app>.amplifyapp.com/ | head -1        # 307 → /login when signed out
curl -s  https://<app>.amplifyapp.com/api/projects      # {"error":"Unauthorized"}
curl -sD - -o /dev/null https://<app>.amplifyapp.com/ | grep -i x-frame-options
```

Then in a browser: sign in with an allow-listed address, open one project, make
a harmless change on a **disabled** project, and confirm it appears in 🕘
History with your email against it.

## Operating notes

- **New Supabase columns** appear without a redeploy — `POST /api/schema/reload`
  clears the cached introspection. They land under "Other" until given a label
  in `lib/field-spec.ts`.
- **Read-only accounts** lose their Edit buttons and are refused server-side, so
  the UI and the API agree.
- **Local development** is unaffected: `npm run dev` on a loopback host bypasses
  auth entirely (`LOCAL_AUTH_BYPASS=false` to exercise the real login flow).
- **Rollback** is Amplify's redeploy-this-version button; nothing in the app
  holds state, and the audit trail lives in Postgres.
