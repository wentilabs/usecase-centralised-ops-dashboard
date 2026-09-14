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

/** Mirrors WBGT's JS and SQL project-code normalization contract. */
export function wbgtTableForProject(projectCode: string): string {
  return `${normalizeCode(projectCode)}_wbgt_data_hourly`;
}
