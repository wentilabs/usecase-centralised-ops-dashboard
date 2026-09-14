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
