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

## First setup

1. Ensure `supabase/config_audit_setup.sql` has already been applied.
2. Run `supabase/create_canonical_projects.sql` in the Supabase SQL editor.
3. Open **Projects** in HALO and choose **Rebuild from current projects**.
4. Inspect every canonical field in the horizontally scrollable table. Sheet
   ids include a direct link to their Google Sheet.
5. Use **Edit** on one row when it needs correction, then **Save project**.
   A row whose reconstructed values are already correct can be saved unchanged.

The reconstruction view reads live service rows and writes nothing until an
operator presses **Save project** on one row. It never renames, enables, or
alters a service row. Already-saved candidates link to their canonical project
instead of offering a duplicate save.

The three delivery URLs are reconstructed as one listener family. Every
service's `lambda_url` may contribute the send-message URL. When that value
ends exactly in `/send-message` (an optional trailing slash is accepted), HALO
also proposes the same base with `/reply-message` and `/send-document`.
Ailytics' explicit `reply_lambda_url` and `lambda_url_image` remain independent
evidence: if they disagree with the derived siblings, the field is left blank
as a conflict for the operator. Blank values, the legacy `-` placeholder, and
URLs that do not end in `/send-message` are never guessed into sibling routes.

## Onboarding from a canonical project

The project page's **Add this service** link opens the existing service-owned
onboarding dialog. HALO proposes only exact approved mappings, such as Haze and
Lightning coordinates, the Issue Chaser safety workbook, or Subcon's manpower
workbook. The operator reviews every value; service-specific fields remain in
the normal onboarding dialog, and the new row is still always disabled.

After a successful insert HALO records the exact service alias in
`ops.projects.service_aliases`. If that HALO-only update fails, the response
states so plainly; the disabled service row is not modified or enabled.

## Adding another service later

Add its key to the existing HALO service registry first. `service_aliases` is a
JSON object keyed by registered service key, so the canonical registry schema
does not need a migration for an eighth service. Add a prefill mapping only
when the two fields are documented as the same resource; a similar name is not
enough.
