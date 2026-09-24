# Canonical projects

`ops.projects` is HALO's human-approved registry of physical sites. It stores a
stable UUID, aliases, and a deliberately small set of common resources. It is
not a replacement for any service configuration table.

## Source of truth

- Runtime configuration and customer behaviour remain owned by the seven
  service tables.
- `ops.projects` owns only canonical identity and operator-approved common
  information.
- A canonical edit never propagates into a service row.
- Service aliases are exact strings, not normalised values: each retains the
  spelling that its service currently uses.
- New projects begin with no per-service alias overrides. Onboarding uses the
  primary alias for every service, while alternate aliases capture customer or
  legacy names. A per-service override is edited only on an existing project
  when a live service truly uses a different code.

## First setup

1. Ensure `supabase/config_audit_setup.sql` has already been applied.
2. Run `supabase/create_canonical_projects.sql` in the Supabase SQL editor. If
   the registry already exists, also run
   `supabase/migrate_canonical_project_service_workbooks.sql`.
3. Open **Projects** in HALO and choose **Rebuild from current projects**.
4. Inspect every canonical field in the compact, horizontally scrollable table.
   Safety, manpower, Noise analysis, and WBGT monthly sheet ids include direct
   Google Sheets links.
5. Use **Edit** on one row when it needs correction, then use the separate
   **Add to projects** action. A row can be added unchanged.

The reconstruction view reads live service rows and writes nothing until an
operator presses **Add to projects** on one row. It never renames, enables, or
alters a service row. Already-saved candidates link to their canonical project
instead of offering a duplicate save.

The three delivery URLs are prefilled from HALO's server-side deployment
configuration: `DEFAULT_LAMBDA_URL_SEND`, `DEFAULT_LAMBDA_URL_REPLY`, and
`DEFAULT_LAMBDA_URL_IMAGE`. Existing service URLs remain source evidence. HALO
still derives listener siblings only from a `lambda_url` ending exactly in
`/send-message` and continues to show conflicts, but it does not let legacy
row wiring replace the configured dashboard defaults.

A project saved before those variables existed has them null. Its editor now
shows each URL greyed as a placeholder with a **Use this** button, rather than
an empty box — offered, not written, so the row is unchanged until someone takes
it. The mapping lives once in `lib/env-defaults.ts`; see AGENTS.md, "Columns the
deployment decides".

## Onboarding from a canonical project

The project page's **Add this service** link opens the existing service-owned
onboarding dialog. HALO proposes only exact approved mappings, such as Haze and
Lightning coordinates, the Issue Chaser safety workbook, or Subcon's manpower
workbook. The operator reviews every value; service-specific fields remain in
the normal onboarding dialog, and the new row is still always disabled.

After a successful insert HALO records the exact service alias in
`ops.projects.service_aliases`. If that HALO-only update fails, the response
states so plainly; the disabled service row is not modified or enabled.

The Noise analysis workbook and WBGT monthly workbook are stored as separate
canonical references. They prefill only `noise.google_sheet_id` and
`wbgt.monthly_sheet_id`, respectively, in the existing disabled-row onboarding
dialog; they never synchronize into a live service row automatically.

## Adding another service later

Add its key to the existing HALO service registry first. `service_aliases` is a
JSON object keyed by registered service key, so the canonical registry schema
does not need a migration for an eighth service. Add a prefill mapping only
when the two fields are documented as the same resource; a similar name is not
enough.
