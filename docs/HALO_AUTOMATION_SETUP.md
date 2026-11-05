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

Use the existing **WH centralised services** local project in Codex. The checked-in
configuration now sets `mode` to `draft-pr`, and
`HALO_AUTOMATION_PROMPT.md` records the user's authorization for unattended
feature-branch pushes and draft PRs in exactly the eight mapped repositories.
Update the existing **Daily HALO error investigation** scheduled task's saved
instructions to record the same explicit authorization and continue reading
`HALO_AUTOMATION_PROMPT.md`; the task must stop at investigation until both
places show the same scope. Use the existing daily schedule at 15:00 in
`Asia/Singapore`. The prompt requires fetching the mapped default branch and
creating an isolated feature branch from it: `main` for seven services and
`master` for Vibration.

Review Codex's local scheduled-task permission mode before relying on unattended
PR creation. The run needs permission to write isolated worktrees and access
GitHub for fetch, push and draft-PR creation. Do not select Full Access solely
for this task; use the narrowest available permissions. The Mac and Codex app
need to be available for local scheduled runs. Verify the schedule preview uses
Singapore time. Run it manually first and confirm it fetches the current report,
maps each service to the listed repository and uses the mapped branch base.

## Disable or rotate

Pause or remove the scheduled task to stop future retrieval. To revoke its
access, remove or replace `HALO_DAILY_ERROR_REPORT_TOKEN` in Amplify and update
or delete the matching Keychain item. The route fails closed if its token is
missing or shorter than 32 characters.

## Report evidence metadata

Copy errors and the read-only report route include the anomaly reader's
`checkedAt`, inclusive UTC bounds for its 48-hour query, and every service's
ready, legacy, partial, unavailable or loading read state, including empty
results. These states describe evidence availability, not service health.
Process histories have separately collected rolling windows and per-project
limits; standing current issues may be older. Missing findings never prove
health. The anomaly queries exclude records newer than their `checkedAt`.
