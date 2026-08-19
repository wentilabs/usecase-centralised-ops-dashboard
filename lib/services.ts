/**
 * The six centralised services this dashboard controls. `idColumn` is the row
 * identity used for reads and writes — ailytics and subcon key on a uuid `id`,
 * the rest on project_code.
 */
export type ServiceKey = "wbgt" | "noise" | "haze" | "lightning" | "ailytics" | "subcon";

export type ServiceDefinition = {
  key: ServiceKey;
  label: string;
  schema: string;
  table: string;
  idColumn: string;
};

export const SERVICES: Record<ServiceKey, ServiceDefinition> = {
  wbgt: { key: "wbgt", label: "WBGT", schema: "wbgts", table: "wbgt_project_configs", idColumn: "project_code" },
  noise: { key: "noise", label: "Noise", schema: "noise-meters", table: "noise_project_configs", idColumn: "project_code" },
  haze: { key: "haze", label: "Haze", schema: "haze", table: "haze_project_configs", idColumn: "project_code" },
  lightning: { key: "lightning", label: "Lightning", schema: "lightning", table: "lightning_project_configs", idColumn: "project_code" },
  ailytics: { key: "ailytics", label: "Ailytics", schema: "ailytics", table: "project_configs", idColumn: "id" },
  // The manpower/housekeeping/Water Parade service. Its schema is named after
  // the repo's original scope (`manpower_activity`); the operator-facing name
  // is Subcon Activities.
  subcon: {
    key: "subcon",
    label: "Subcon Activities",
    schema: "manpower_activity",
    table: "project_configs",
    idColumn: "id",
  },
};

export const SERVICE_KEYS = Object.keys(SERVICES) as ServiceKey[];

export function isServiceKey(value: string): value is ServiceKey {
  return Object.prototype.hasOwnProperty.call(SERVICES, value);
}

export type ProjectConfigRow = Record<string, unknown> & {
  project_code?: string;
  enabled?: boolean;
  updated_at?: string;
};
