-- Add the two service-owned workbook references to HALO's canonical registry.
-- This is additive and does not alter any of the seven service config tables.
-- Existing projects retain NULL until an operator saves or updates them.

alter table ops.projects
  add column if not exists noise_workbook_id text,
  add column if not exists wbgt_workbook_id text;
