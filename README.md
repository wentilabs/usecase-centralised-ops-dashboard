# Centralised Services Dashboard

Local, read-only floating-cards view of both alert systems' `*_project_configs`
tables (WBGT `wbgts` schema + Noise `noise-meters` schema — same Supabase project).

Zero npm dependencies. One tiny Node process. Nothing runs in the background —
data is fetched only on page load or when you press ⟳ Refresh.

## Setup (once)

```bash
cp .env.example .env
# paste SUPABASE_URL and SUPABASE_SECRET_KEY (same values as the alerts repos' .env)
```

The service-role key is required so RLS doesn't hide disabled projects.
It never leaves this machine — the browser only talks to localhost.

## Run

```bash
npm start        # → http://localhost:5178
```

Leave it running while you work; it idles at ~0 CPU.

## Using it

- **Tabs** All / WBGT / Noise, **search** by project code, **⟳ Refresh** to re-sync from Supabase.
- Each card shows: enabled state, cadence toggle pills, message formatters (noise),
  computed "fires at" timings, WhatsApp group/client chips, and hyperlinks
  (Google Sheets, lambda proxy).
- **Right-click a card** → *Add link…* / *Add note…* (e.g. AWS console URLs, EventBridge rules).
- **Right-click a manual link/note** → *Delete this item*.
- Manual links/notes persist to `links.store.json` (gitignored, local only).

## Auth

Locally, on a loopback hostname, auth is bypassed and everything works as
before. Deployed (`NODE_ENV=production`) the dashboard requires a Supabase Auth
email OTP sign-in and an allow-listed address, and **fails closed** when auth is
unconfigured or unreachable. `EDITOR_EMAILS` makes everyone else read-only —
their Edit buttons disappear and writes are refused server-side.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the EC2 + Cloudflare Access runbook.

## Change history

Every config change is recorded in `ops.config_audit` by a Postgres trigger, so
edits made directly in the Supabase table editor are captured too. Dashboard
writes are stamped with the operator's email and their note; unstamped rows show
as **changed outside the dashboard** in the editor's 🕘 History. Run
[`supabase/config_audit_setup.sql`](./supabase/config_audit_setup.sql) once, and
expose the `ops` schema in Supabase's API settings.

## Guarantees

- Writes are confined to the five `*_project_configs` tables, `ops.config_audit`
  and the local links store; validated against the live schema, guarded by an
  `updated_at` concurrency check, and refused for read-only accounts.
- Read-only/derived columns (job state, audit stamps, identity) can never be written.
- Binds to `127.0.0.1` unless `HOST` says otherwise.
