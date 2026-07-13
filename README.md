# WohHup Ops Dashboard

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

## Guarantees

- Supabase is **never written to** — the only writes are to the local `links.store.json`.
- Server binds to `127.0.0.1` only.
