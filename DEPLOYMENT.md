# Deployment — EC2 behind Cloudflare Access

The dashboard writes to production config for all five centralised services, so
it authorizes **in the app** as well as at the edge. Cloudflare Access in front
is the first gate; Supabase Auth + an email allow-list is the second. Either one
alone would be a single point of failure.

## Security model

| Layer | What it does |
|---|---|
| Cloudflare Access | keeps the hostname off the public internet |
| Supabase Auth (email OTP) | establishes who the operator is, verified server-side on every request |
| `WHITELIST_EMAILS` / `WHITELIST_DOMAINS` | decides who may sign in — **fails closed** if unset or if Supabase is unreachable |
| `EDITOR_EMAILS` | decides who may *change* anything; everyone else is read-only |
| `ops.config_audit` | records every change, with the operator's email and note |

The `SUPABASE_SECRET_KEY` never leaves the server and is never sent to the
browser. Consider narrowing it to a role scoped to the five `*_project_configs`
tables plus `ops.config_audit`, so a bug here can't touch readings.

## One-time Supabase setup

1. Run [`supabase/config_audit_setup.sql`](supabase/config_audit_setup.sql) in the SQL editor.
   It creates `ops.config_audit` and attaches an `after update` trigger to every
   config table.
2. Add `ops` to **Supabase → Settings → API → Exposed schemas** (otherwise reads
   return 406 and the dashboard shows a setup hint instead of history).
3. Carry the pre-migration history over (optional):
   ```bash
   node scripts/import-audit-mirror.js          # dry run
   node scripts/import-audit-mirror.js --apply  # needs a temporary insert grant
   ```

## Box setup

```bash
# Node 20+ is required (the server uses global fetch). .nvmrc pins 22.
sudo useradd --system --home /srv/centralised-services ops
sudo install -d -o ops -g ops /srv/centralised-services /var/lib/centralised-services
sudo rsync -a --exclude .git --exclude node_modules ./ /srv/centralised-services/
```

Create `/etc/centralised-services.env` (`chmod 600`, owner `root:ops`) from
[`.env.example`](.env.example). In production you must set:

```
SUPABASE_URL=…
SUPABASE_SECRET_KEY=…
AUTH_SUPABASE_URL=…
AUTH_SUPABASE_PUBLISHABLE_KEY=…
WHITELIST_DOMAINS=yourcompany.com
EDITOR_EMAILS=you@yourcompany.com        # optional; omit to let all signed-in users edit
```

Carry your existing local state across so links and notes survive:

```bash
scp links.store.json audit.log.jsonl ec2:/tmp/
sudo install -o ops -g ops /tmp/links.store.json /tmp/audit.log.jsonl /var/lib/centralised-services/
```

Then install the unit:

```bash
sudo cp deploy/centralised-services.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now centralised-services
journalctl -u centralised-services -f
```

`GET /healthz` is public and unauthenticated — use it for the Cloudflare tunnel
or ALB health check.

## Networking

The unit binds **127.0.0.1** and expects `cloudflared` on the same host to
publish it. That is the safest arrangement: nothing is reachable without
traversing Cloudflare Access.

If Cloudflare fronts it via a load balancer instead, set `HOST=0.0.0.0` in the
unit **and** restrict the security group to Cloudflare IP ranges. Never do one
without the other — the app holds write credentials for every project config.

## Operating notes

- **New Supabase columns** appear without a restart via `POST /api/schema/reload`
  (the editor's schema is cached per process). They land under "Other" until
  they're given a label in `lib/field-spec.js`.
- **Log rotation** for the local mirror:
  ```
  /var/lib/centralised-services/audit.log.jsonl {
    weekly
    rotate 12
    compress
    missingok
    notifempty
    copytruncate
  }
  ```
- **History is now central.** Once deployed, prefer editing through the deployed
  instance; the Postgres trigger still captures anything changed directly in
  Supabase and the UI flags those rows as *changed outside the dashboard*.
- **Local development** keeps working unchanged: on a loopback hostname with
  `NODE_ENV` unset, auth is bypassed (`LOCAL_AUTH_BYPASS=false` to exercise the
  real login flow).

## Verification after deploy

```bash
curl -s https://ops.example.com/healthz                  # {"ok":true}
curl -si https://ops.example.com/ | head -1              # 302 → /login when signed out
curl -s https://ops.example.com/api/projects             # {"error":"Unauthorized"}
```

Then sign in through the browser, make one harmless change on a disabled
project, and confirm it appears in the editor's 🕘 History with your email
against it.
