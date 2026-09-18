import { clusterProjects, type Cluster, type ServiceRow } from "./project-identity";
import { SERVICE_KEYS, isServiceKey, type ProjectConfigRow, type ServiceKey } from "./services";

/**
 * HALO's human-approved record of one physical site. It is deliberately not a
 * service configuration: service tables remain the source of runtime truth.
 */
export type CanonicalProject = {
  id: string;
  primary_alias: string;
  alternate_aliases: string[];
  service_aliases: Partial<Record<ServiceKey, string>>;
  company: string | null;
  site_name: string | null;
  site_address: string | null;
  latitude: number | null;
  longitude: number | null;
  safety_workbook_id: string | null;
  manpower_workbook_id: string | null;
  send_message_url: string | null;
  reply_message_url: string | null;
  send_document_url: string | null;
  whatsapp_instance_name: string | null;
  whatsapp_client_id: string | null;
  timezone: string | null;
  public_holiday_region: string | null;
  general_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CanonicalProjectDraft = Omit<CanonicalProject, "id" | "created_at" | "updated_at">;

export type CandidateConflict = {
  field: keyof CanonicalProjectDraft | "service_aliases";
  values: { value: string; source: string }[];
};

export type CanonicalProjectCandidate = {
  key: string;
  cluster: Cluster;
  draft: CanonicalProjectDraft;
  conflicts: CandidateConflict[];
};

const NULL_LIKE = new Set(["", "-", "—", "n/a", "na", "none", "null"]);

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized && !NULL_LIKE.has(normalized.toLowerCase()) ? normalized : null;
}

function numberOrNull(value: unknown): number | null {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyDraft(primaryAlias = ""): CanonicalProjectDraft {
  return {
    primary_alias: primaryAlias,
    alternate_aliases: [],
    service_aliases: {},
    company: null,
    site_name: null,
    site_address: null,
    latitude: null,
    longitude: null,
    safety_workbook_id: null,
    manpower_workbook_id: null,
    send_message_url: null,
    reply_message_url: null,
    send_document_url: null,
    whatsapp_instance_name: null,
    whatsapp_client_id: null,
    timezone: null,
    public_holiday_region: null,
    general_notes: null,
  };
}

type CommonField = Exclude<keyof CanonicalProjectDraft, "primary_alias" | "alternate_aliases" | "service_aliases" | "site_name" | "public_holiday_region" | "general_notes">;

type FieldSource = { service: ServiceKey; column: string };

/** Only exact semantic equivalences are suggested. Similar names are not enough. */
const COMMON_FIELD_SOURCES: Record<CommonField, FieldSource[]> = {
  company: SERVICE_KEYS.map((service) => ({ service, column: "company" })),
  site_address: [
    { service: "haze", column: "site_address" },
    { service: "lightning", column: "site_address" },
  ],
  latitude: [
    { service: "haze", column: "latitude" },
    { service: "lightning", column: "latitude" },
  ],
  longitude: [
    { service: "haze", column: "longitude" },
    { service: "lightning", column: "longitude" },
  ],
  safety_workbook_id: [{ service: "issueChaser", column: "safety_sheet_id" }],
  manpower_workbook_id: [
    { service: "subcon", column: "spreadsheet_id" },
    { service: "wbgt", column: "manpower_spreadsheet_id" },
  ],
  send_message_url: SERVICE_KEYS.map((service) => ({ service, column: "lambda_url" })),
  reply_message_url: [{ service: "ailytics", column: "reply_lambda_url" }],
  send_document_url: [{ service: "ailytics", column: "lambda_url_image" }],
  whatsapp_instance_name: SERVICE_KEYS.map((service) => ({ service, column: "instance_name" })),
  whatsapp_client_id: SERVICE_KEYS.map((service) => ({ service, column: "client_id" })),
  timezone: SERVICE_KEYS.map((service) => ({ service, column: "timezone" })),
};

function sourceRows(rows: ServiceRow[]) {
  const indexed = new Map<string, ProjectConfigRow>();
  for (const row of rows) indexed.set(`${row.service}\u0000${row.projectCode}`, row.row);
  return indexed;
}

function collectValues(
  field: CommonField,
  cluster: Cluster,
  rows: Map<string, ProjectConfigRow>,
): { value: string; source: string }[] {
  const found: { value: string; source: string }[] = [];
  for (const source of COMMON_FIELD_SOURCES[field]) {
    const member = cluster.members.find((entry) => entry.service === source.service);
    if (!member) continue;
    const row = rows.get(`${member.service}\u0000${member.projectCode}`);
    const value = text(row?.[source.column]);
    if (value) found.push({ value, source: `${source.service}.${source.column}` });
  }
  return found;
}

/**
 * Turn live service rows into reviewable, non-persisted candidates. A value is
 * suggested only when every nonblank source agrees; conflicts stay blank until
 * an operator decides which value represents the site.
 */
export function canonicalProjectCandidates(rows: ServiceRow[]): CanonicalProjectCandidate[] {
  const indexed = sourceRows(rows);
  return clusterProjects(rows).map((cluster) => {
    const draft = emptyDraft(cluster.canonical);
    draft.alternate_aliases = cluster.codes.filter((code) => code !== cluster.canonical).sort();
    const conflicts: CandidateConflict[] = [];

    for (const service of SERVICE_KEYS) {
      const aliases = [...new Set(cluster.members.filter((member) => member.service === service).map((member) => member.projectCode))];
      if (aliases.length === 1) draft.service_aliases[service] = aliases[0];
      if (aliases.length > 1) {
        conflicts.push({
          field: "service_aliases",
          values: aliases.map((value) => ({ value, source: `${service}.project_code` })),
        });
      }
    }

    for (const field of Object.keys(COMMON_FIELD_SOURCES) as CommonField[]) {
      const values = collectValues(field, cluster, indexed);
      const distinct = [...new Set(values.map((entry) => entry.value))];
      if (distinct.length === 1) {
        if (field === "latitude" || field === "longitude") {
          draft[field] = numberOrNull(distinct[0]) as never;
        } else {
          draft[field] = distinct[0] as never;
        }
      } else if (distinct.length > 1) {
        conflicts.push({ field, values });
      }
    }

    return { key: cluster.codes.slice().sort().join("|"), cluster, draft, conflicts };
  });
}

function optionalText(value: unknown, label: string, problems: string[]) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    problems.push(`${label} must be text.`);
    return null;
  }
  return value.trim() || null;
}

/** Validates registry data independently of browser UI and Supabase. */
export function validateCanonicalProjectDraft(value: unknown): { draft: CanonicalProjectDraft | null; problems: string[] } {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const problems: string[] = [];
  const primaryAlias = optionalText(raw.primary_alias, "Primary alias", problems);
  if (!primaryAlias) problems.push("Primary alias is required.");

  const rawAliases = raw.alternate_aliases;
  const alternateAliases = Array.isArray(rawAliases)
    ? [...new Set(rawAliases.map((entry) => optionalText(entry, "Alternate alias", problems)).filter((entry): entry is string => Boolean(entry)))]
    : rawAliases === undefined
      ? []
      : (problems.push("Alternate aliases must be a list."), []);

  const rawServiceAliases = raw.service_aliases;
  const serviceAliases: Partial<Record<ServiceKey, string>> = {};
  if (rawServiceAliases && (typeof rawServiceAliases !== "object" || Array.isArray(rawServiceAliases))) {
    problems.push("Per-service aliases must be an object.");
  } else {
    for (const [service, alias] of Object.entries((rawServiceAliases ?? {}) as Record<string, unknown>)) {
      if (!isServiceKey(service)) {
        problems.push(`Unknown service alias key: ${service}.`);
        continue;
      }
      const normalized = optionalText(alias, `${service} alias`, problems);
      if (normalized) serviceAliases[service] = normalized;
    }
  }

  const latitude = raw.latitude === null || raw.latitude === undefined || raw.latitude === "" ? null : Number(raw.latitude);
  const longitude = raw.longitude === null || raw.longitude === undefined || raw.longitude === "" ? null : Number(raw.longitude);
  if (latitude !== null && !Number.isFinite(latitude)) problems.push("Latitude must be a number.");
  if (longitude !== null && !Number.isFinite(longitude)) problems.push("Longitude must be a number.");
  if ((latitude === null) !== (longitude === null)) problems.push("Coordinates need both latitude and longitude, or neither.");

  const draft: CanonicalProjectDraft = {
    primary_alias: primaryAlias ?? "",
    alternate_aliases: alternateAliases.filter((alias) => alias !== primaryAlias),
    service_aliases: serviceAliases,
    company: optionalText(raw.company, "Company", problems),
    site_name: optionalText(raw.site_name, "Site name", problems),
    site_address: optionalText(raw.site_address, "Site address", problems),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    safety_workbook_id: optionalText(raw.safety_workbook_id, "Safety workbook", problems),
    manpower_workbook_id: optionalText(raw.manpower_workbook_id, "Manpower workbook", problems),
    send_message_url: optionalText(raw.send_message_url, "Send-message URL", problems),
    reply_message_url: optionalText(raw.reply_message_url, "Reply-message URL", problems),
    send_document_url: optionalText(raw.send_document_url, "Send-document URL", problems),
    whatsapp_instance_name: optionalText(raw.whatsapp_instance_name, "WhatsApp instance", problems),
    whatsapp_client_id: optionalText(raw.whatsapp_client_id, "WhatsApp client ID", problems),
    timezone: optionalText(raw.timezone, "Timezone", problems),
    public_holiday_region: optionalText(raw.public_holiday_region, "Public-holiday region", problems),
    general_notes: optionalText(raw.general_notes, "General notes", problems),
  };

  for (const [label, url] of [
    ["Send-message URL", draft.send_message_url],
    ["Reply-message URL", draft.reply_message_url],
    ["Send-document URL", draft.send_document_url],
  ] as const) {
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") problems.push(`${label} must be an HTTP(S) URL.`);
    } catch {
      problems.push(`${label} must be an HTTP(S) URL.`);
    }
  }

  return { draft: problems.length ? null : draft, problems };
}

export function blankCanonicalProjectDraft(): CanonicalProjectDraft {
  return emptyDraft();
}
