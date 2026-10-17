import ailyticsContractJson from "../contracts/services/ailytics.contract.json";
import hazeContractJson from "../contracts/services/haze.contract.json";
import issueChaserContractJson from "../contracts/services/issue-chaser.contract.json";
import lightningContractJson from "../contracts/services/lightning.contract.json";
import noiseContractJson from "../contracts/services/noise.contract.json";
import subconContractJson from "../contracts/services/subcon.contract.json";
import wbgtContractJson from "../contracts/services/wbgt.contract.json";

export type ContractField = {
  label: string;
  group: string;
  mutable: boolean;
  role: string;
  help: string;
  options?: string[];
};

/**
 * What a service says about its own health reporting.
 *
 * Optional. Current services declare their common status outcomes; a status
 * missing from the declaration is read by the name convention in
 * `lib/health-status.ts` instead.
 *
 * It lives in the service's contract rather than in HALO because only the
 * service knows what its own words mean: whether `partial` is "some recipients
 * failed" or "partial by configuration" is not something HALO can infer, and
 * two services are allowed to answer differently for the same word.
 */
export type ContractHealth = {
  /**
   * Which signals this service reports, and at what granularity.
   *
   * `service` means one answer for the whole estate — Haze and Lightning fetch
   * one public feed, so "did ingestion work" has no per-project answer.
   * `project` means one answer per project code. `none` means this service does
   * not report that signal at all, which must read as "not covered" rather than
   * as healthy.
   */
  granularity?: Partial<Record<"ingestion" | "run" | "delivery", "service" | "project" | "none">>;
  /** This service's own status values, mapped to the shared three colours. */
  statuses?: Record<string, "green" | "amber" | "red">;
};

export type ServiceContract = {
  schemaVersion: 1;
  service: { key: string; displayName: string };
  runtime: { handler: string; language: string; moduleFormat: string };
  routes: Array<{
    method: string;
    path: string;
    kind: string;
    authentication: string;
  }>;
  configuration: {
    schema: string;
    table: string;
    identityColumn: string;
    fields: Record<string, ContractField>;
    constraints: Array<{ name: string; help: string }>;
  };
  /** Optional; see ContractHealth. */
  health?: ContractHealth;
};

function validateContract(value: unknown, expectedKey: string): ServiceContract {
  if (!value || typeof value !== "object") throw new Error(`Invalid ${expectedKey} service contract`);
  const contract = value as Partial<ServiceContract>;
  if (contract.schemaVersion !== 1 || contract.service?.key !== expectedKey) {
    throw new Error(`Unexpected ${expectedKey} service contract identity`);
  }
  if (!Array.isArray(contract.routes) || !contract.configuration?.fields) {
    throw new Error(`Incomplete ${expectedKey} service contract`);
  }
  for (const [name, field] of Object.entries(contract.configuration.fields)) {
    if (!field.label || !field.group || !field.help || typeof field.mutable !== "boolean" || !field.role) {
      throw new Error(`Incomplete ${expectedKey}.${name} field contract`);
    }
  }
  return contract as ServiceContract;
}

export const SERVICE_CONTRACTS: Readonly<Record<string, ServiceContract>> = Object.freeze({
  ailytics: validateContract(ailyticsContractJson, "ailytics"),
  haze: validateContract(hazeContractJson, "haze"),
  issueChaser: validateContract(issueChaserContractJson, "issueChaser"),
  lightning: validateContract(lightningContractJson, "lightning"),
  noise: validateContract(noiseContractJson, "noise"),
  subcon: validateContract(subconContractJson, "subcon"),
  wbgt: validateContract(wbgtContractJson, "wbgt"),
});

export function serviceContractFor(service: string): ServiceContract | null {
  return SERVICE_CONTRACTS[service] ?? null;
}

/**
 * The colour this service declares for one of its own statuses, or null.
 *
 * Case-insensitive, because Haze and Lightning write their statuses in upper
 * case and the rest in lower, and that difference carries no meaning.
 *
 * Returns null rather than guessing when the service has declared nothing —
 * the caller then falls back to the name convention, which is the whole reason
 * this is allowed to be absent.
 */
export function contractHealthColour(service: string, status: unknown): "green" | "amber" | "red" | null {
  const declared = serviceContractFor(service)?.health?.statuses;
  if (!declared) return null;
  const key = String(status ?? "").trim().toLowerCase();
  if (!key) return null;
  for (const [name, colour] of Object.entries(declared)) {
    if (name.trim().toLowerCase() === key) {
      // A contract is vendored from another repository, so a value outside the
      // three colours is possible and must not reach the UI as a class name.
      return colour === "green" || colour === "amber" || colour === "red" ? colour : null;
    }
  }
  return null;
}

/** What this service reports for one signal, defaulting to "not covered". */
export function contractHealthGranularity(
  service: string,
  signal: "ingestion" | "run" | "delivery",
): "service" | "project" | "none" {
  const declared = serviceContractFor(service)?.health?.granularity?.[signal];
  // Undeclared is "none", never "project": a service that has not said it
  // reports a signal must show as not covered rather than as healthy, which is
  // the one mistake this page cannot afford.
  return declared === "service" || declared === "project" ? declared : "none";
}

export function contractFieldFor(service: string, field: string): ContractField | null {
  return serviceContractFor(service)?.configuration.fields[field] ?? null;
}

export function contractReadonlyFields(service: string): string[] {
  const fields = serviceContractFor(service)?.configuration.fields ?? {};
  return Object.entries(fields)
    .filter(([, field]) => !field.mutable)
    .map(([name]) => name);
}

export function contractOptionsFor(service: string): Record<string, string[]> {
  const fields = serviceContractFor(service)?.configuration.fields ?? {};
  return Object.fromEntries(
    Object.entries(fields)
      .filter((entry): entry is [string, ContractField & { options: string[] }] => Boolean(entry[1].options))
      .map(([name, field]) => [name, [...field.options]]),
  );
}
