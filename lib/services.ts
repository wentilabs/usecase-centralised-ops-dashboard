/**
 * The six centralised services this dashboard controls. `idColumn` is the row
 * identity used for reads and writes — ailytics and subcon key on a uuid `id`,
 * the rest on project_code.
 */
export type ServiceKey =
  | "wbgt"
  | "noise"
  | "haze"
  | "lightning"
  | "ailytics"
  | "subcon"
  | "issueChaser";

export type ServiceDefinition = {
  key: ServiceKey;
  label: string;
  /**
   * Label for the tag on a project card, where the space is a few characters
   * wide. Falls back to `label`; set it only where the full name is too long to
   * sit beside a project code without wrapping.
   */
  shortLabel?: string;
  schema: string;
  table: string;
  idColumn: string;
};

/** The card tag's text — short form where one exists. */
export function tagLabel(service: ServiceKey): string {
  return SERVICES[service].shortLabel ?? SERVICES[service].label;
}

export const SERVICES: Record<ServiceKey, ServiceDefinition> = {
  wbgt: { key: "wbgt", label: "WBGT", schema: "wbgts", table: "wbgt_project_configs", idColumn: "project_code" },
  noise: { key: "noise", label: "Noise", schema: "noise-meters", table: "noise_project_configs", idColumn: "project_code" },
  haze: { key: "haze", label: "Haze", schema: "haze", table: "haze_project_configs", idColumn: "project_code" },
  lightning: { key: "lightning", label: "Lightning", schema: "lightning", table: "lightning_project_configs", idColumn: "project_code" },
  ailytics: { key: "ailytics", label: "Ailytics", schema: "ailytics", table: "project_configs", idColumn: "id" },
  // Housekeeping intake. The repo was reduced to a single `/housekeeping-intake`
  // route: Water Parade moved to the WBGT service, and manpower classification,
  // extraction and every outbound message moved to the base template. The schema
  // is still named after the original scope (`manpower_activity`) and the
  // operator-facing name is still Subcon Activities; neither is worth renaming.
  subcon: {
    key: "subcon",
    label: "Subcon Activities",
    shortLabel: "Subcon",
    schema: "manpower_activity",
    table: "project_configs",
    idColumn: "id",
  },
  issueChaser: {
    key: "issueChaser",
    label: "Issue Chaser",
    shortLabel: "Chaser",
    schema: "issue_chaser",
    table: "project_configs",
    idColumn: "project_code",
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
