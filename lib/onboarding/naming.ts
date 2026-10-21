function normalizeCode(projectCode: string): string {
  return String(projectCode)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
/** Mirrors the Noise service's per-project readings-table convention. */
export function noiseTableForProject(projectCode: string): string {
  return `${normalizeCode(projectCode)}_noise_data_daily`;
}

/**
 * Mirrors `vibration.project_readings_table_name` in the vibration repo's
 * `supabase/migrate_project_reading_tables.sql`. Unlike the other two it REFUSES a
 * code outside `^[A-Z][A-Z0-9-]{0,31}$` rather than normalising it — the trigger
 * raises on one, so a name derived here for such a code would point at nothing.
 */
export function vibrationTableForProject(projectCode: string): string | null {
  const code = String(projectCode).trim();
  if (!/^[A-Z][A-Z0-9-]{0,31}$/.test(code)) return null;
  return `${code.toLowerCase().replace(/-/g, "_")}_vibration_data_daily`;
}

/** Mirrors WBGT's JS and SQL project-code normalization contract. */
export function wbgtTableForProject(projectCode: string): string {
  return `${normalizeCode(projectCode)}_wbgt_data_hourly`;
}
