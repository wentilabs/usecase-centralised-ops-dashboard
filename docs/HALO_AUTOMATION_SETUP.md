# Daily HALO “Copy errors” retrieval

This setup gives a local Codex scheduled task one operation: fetch the exact
plain-text report from HALO's `GET /api/data-health/copy-errors` route. The
route accepts a dedicated bearer token stored in Amplify. The local fetch script
reads the matching item from macOS Keychain and makes only that fixed HTTPS GET.
It does not use the signed-in browser session, HALO's dashboard session, or the
notification token.

The schedule is not configured by this change. The report URL, Amplify token,
Keychain item, deployment, and scheduled task still need to be set up.

## 1. Deploy the HALO route

Deploy the reviewed `usecase-wohhup-ops-dashboard` change through its usual
Amplify deployment. The new route is:

```text
GET https://<your-halo-host>/api/data-health/copy-errors
Authorization: Bearer <dedicated-token>
```

It returns `text/plain`, uses `Cache-Control: private, no-store`, and reports
the same process errors, current issues, recent service anomalies and anomaly
coverage note that the dashboard's Copy errors button produces. HALO returns
401 without the exact token. If an essential Data Health read fails, HALO returns
503 instead of a misleading empty report. It has no query parameters and cannot
invoke a write, refresh, notification or job action.

## 2. Create one dedicated token

Generate a random token locally; do not use your account password or reuse
`HALO_DATA_HEALTH_TOKEN`. For example, run `openssl rand -hex 32` in Terminal
and keep the output private. In Amplify, add this server-side environment
variable to the HALO application and the environment that serves the dashboard:

```text
HALO_DAILY_ERROR_REPORT_TOKEN=<the generated random token>
```

Save the variable and redeploy/restart the environment so the route receives it.
Do not add it to a `NEXT_PUBLIC_` variable, repository file, shell command,
Codex prompt, or chat. Keep this token separate from the existing notification
credential. Rotate it by replacing the Amplify value and the Keychain value.

## 3. Save the same token in this Mac's Keychain

Open **Keychain Access**, create a **New Password Item**, and set:

- Keychain Item Name: `HALO Daily Error Report`
- Account Name: `halo-daily-investigation`
- Password: the same random token saved in Amplify

Keep it in your login keychain. macOS may ask whether the Node executable can
read the item on the first run; allow the local Node runtime used by this
project. Do not paste the token into Codex or a terminal command.

## 4. Point the fetch script at HALO

Edit `docs/HALO_AUTOMATION_CONFIG.json` and set `reportUrl` to the deployed
HTTPS route, for example:

```json
"reportUrl": "https://<your-halo-host>/api/data-health/copy-errors"
```

The client rejects URLs unless they use HTTPS and the exact route path. The
hostname must be the real Amplify custom domain or approved Amplify domain.

## 5. Manually fetch once

From this repository, run:

```sh
node scripts/fetch-halo-report.mjs
```

The output should match the HALO Copy errors button's text. Confirm a missing or
wrong token returns no report. Check that the endpoint URL has no query string
and that it is not the `/api/data-health/notify` route.

## 6. Set up the daily investigation

Use the existing **WH centralised services** local project in Codex. Create a
standalone local scheduled task using `HALO_AUTOMATION_PROMPT.md`, daily at
15:00 in `Asia/Singapore`. Keep `mode` as `investigate-only`: the task may read
the eight service repositories and report likely causes, but must not edit
service code, push branches or create PRs. Run the prompt manually first and
confirm it fetches the report and investigates the correct repositories.

The Mac and Codex app need to be available for local scheduled runs. Verify the
schedule preview uses Singapore time before enabling it. A later change to
allow draft PRs needs a separate explicit authorization.

## Disable or rotate

Pause or remove the scheduled task to stop future retrieval. To revoke its
access, remove or replace `HALO_DAILY_ERROR_REPORT_TOKEN` in Amplify and update
or delete the matching Keychain item. The route fails closed if its token is
missing or shorter than 32 characters.
