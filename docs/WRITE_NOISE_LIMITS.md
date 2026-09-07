# [WRITE NOISE LIMITS]

Parked plan, signed off 7 Sep 2026. Not started.

Editing a noise meter's permissible levels from HALO. The read side shipped on
the same day (`📏 Noise limits` on a noise card, `GET /api/noise-limits`); this is
the write side.

## What it does

1. **Write** a meter's limits — per band, per day type, per metric.
2. **Choose whether it is protected** from the limits refresh. A checkbox, not an
   automatic consequence of editing. Both states are legitimate: a correction
   that NoiseLynx should also carry is better left unprotected so the page stays
   the source of truth, and protection is for a value NoiseLynx must not own.
3. **Preview** the change before it is written — the same diff-then-confirm shape
   the config editor uses.
4. **Save.**

## Prerequisites, all three decisions rather than code

- **`noise_limits` has no `updated_at`.** Every other write in HALO carries a
  `baseUpdatedAt` and takes a 409 when the row moved underneath it. Either add
  the column or accept last-write-wins on this one table, deliberately and in
  writing.
- **No audit trigger covers the table.** `ops.config_audit` is attached to the
  seven `project_configs` tables only, so a limits edit would leave no history.
  Adding it means one more trigger in `supabase/config_audit_setup.sql`; the
  identity column would be `full_identifier` rather than `project_code`, since a
  project has several meters.
- **The marker is a checkbox.** See point 2 above. The save writes
  `source_file` when the box is ticked and leaves it alone when it is not.

## The sequencing rule the implementation must honour

Values and marker go in **one write per row**. Splitting them opens a window:

| order | a refresh landing in between |
| --- | --- |
| values, then marker | the values are overwritten — unprotected for that window |
| marker, then values | the refresh freezes the *old* values; the write then lands |
| one PATCH | atomic per row, no window |

## Shape of the edit

Storage is **per hour**; the editor is **per band**, because the band grid is
what an operator checks against NoiseLynx. A save expands a band to its hours:
`2am–5am` is 3 rows, `7am–7pm` is 12, a whole meter is 48.

The upsert key is
`(project_code, full_identifier, day_type_normalized, hour_start_minutes, hour_end_minutes)` —
the table's own unique constraint, and the one the refresh uses.

Protection is **per row**, so the marker has to be written to every row the
operator meant. `TRI NM01` is the live example of getting that half right:
marked on its 24 Mon-Sat rows, unmarked on its 24 Sun/PH rows, so half of it is
still being refreshed. The editor should make marking a whole meter one action.

## Behaviours that are INTENDED — do not "fix" these

Confirmed with the operator on 7 Sep 2026. Each looks like a bug from the
outside; all five are the agreed design, and the write path has to live with
them rather than correct them:

1. **No validation on the limit columns.** Plain nullable `double precision`, no
   CHECK. `6` where `61` was meant is accepted and loosens that limit by 55 dB.
   The preview step is the mitigation, not a constraint.
2. **Blank means "no limit", not zero**, and the refresh can never *clear* a
   limit — `chooseRefreshedLimit` keeps the stored value when the scrape has no
   positive number. Withdrawing a limit is manual-only and needs the marker.
3. **Editing a 12hr value can move the hourly threshold.** With no `leq_1hr` in a
   band the hourly assessment borrows `leq_12hr` (INV-NOISE-06 in the noise
   repo). The preview should show the borrowed value moving.
4. **A rename on NoiseLynx migrates protected rows.**
   `migrateExistingMeterIdentities` rewrites them to the new identifier before
   the merge, so the marker travels; only the superseded name is deleted.
5. **Two cases where protection is moot.** `active = false` rows are ignored
   entirely, and a project whose `source_type` is not `default` / `whgd` / `svs`
   is skipped by the refresh outright — which is why OBAYA's geoscan limits
   survive unmarked.

## Already in place

- `lib/noise-limits.ts` — `MANUAL_SOURCE_MARKER`, `isProtectedFromRefresh`,
  `collapseToBands` (hours → the eight source bands, ordered from 07:00),
  `groupLimitsByMeter` with per-day-type protection flags.
- `lib/config-repository.ts` — `listNoiseLimits`, `listProtectedNoiseMeters`.
- `app/api/noise-limits/route.ts`, `components/NoiseLimits.tsx` — the read view.
- `tests/noise-limits.test.ts` — including a cross-repo check that HALO's spelling
  of the marker still matches the noise service's.
- `supabase/protect_hmd_nm04_limits.sql` — the worked example of marking a meter,
  already applied to HMD NM04.

## Open

- Whether the audit entry should record the band an operator edited or the hours
  it expanded to. The hours are what changed; the band is what they typed.
- Whether a read-only account should see the editor disabled or not at all. The
  read view is deliberately open to read-only accounts, like the lightning map.
