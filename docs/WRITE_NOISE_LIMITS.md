# [WRITE NOISE LIMITS]

**Built and complete, 8 Sep 2026.** The editor works and
`supabase/audit_noise_limits.sql` has been applied, so every limits change —
hand-made or from the refresh — is recorded from that date. Verified live: a
value change writes one entry carrying its from/to, and an `imported_at`-only
touch, which is what a refresh does to a row it re-confirmed, writes nothing.

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

## How the three prerequisites were settled

- **`noise_limits` has no `updated_at`, so `imported_at` is the token.** It is
  already "when this row was last written" — the refresh stamps it on everything
  it merges — so it works as a version. The editor sends back the newest one it
  saw and the write refuses with a 409 if any row has moved past it. This is a
  check-then-write, not a true compare-and-swap; the losing window is the few
  hundred milliseconds between the read and the upsert, on a table written by one
  cron and this editor. If `updated_at` is ever added, move to the `updateConfig`
  pattern.
- **The audit trigger is applied, and records BOTH writers.** An early draft
  scoped it by a WHEN clause to rows carrying the marker, which would have
  discarded the evidence it exists for: a refresh moving a limit is the vendor
  changing what a site is assessed against. What keeps the volume honest is the
  empty-diff guard plus `imported_at` in the skipped columns — so volume tracks
  real changes rather than runs. Deletes are still not captured.
- **The marker is a checkbox**, defaulting to whatever the meter already is, so
  saving never changes a meter's standing by accident. Unticking does not clear
  an existing marker — removing protection is not something this screen does.

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

## Two things the live run taught

**The upsert needs an explicit `on_conflict`.** PostgREST resolves against the
PRIMARY key by default, which here is the bigserial `id` the payload does not
carry — so every row read as an insert and the five-column unique constraint
rejected the whole batch with a 23505. Naming the same conflict target the
refresh uses (`LIMITS_CONFLICT`) fixes it. No unit test would have caught this.

**A partial save produces a partly-protected meter.** Sending one band with
`protect: true` marks only that band's rows, which is the state TRI NM01 is in.
The API is right to do exactly what it was asked; the editor avoids it by sending
every band of both day types on save, changed or not.

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
