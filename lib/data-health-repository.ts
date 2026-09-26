import "server-only";

import { dataHealthAvailability, latestSnapshots, type HealthPolicy, type HealthSnapshot } from "./data-health";

type Observation = { policy_id: string; health_dimension: "data" | "delivery"; outcome: string; evaluated_at: string };

function config() {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  return { url, key };
}

async function read(path: string) {
  const { url, key } = config();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${url}/rest/v1/${path}`, { cache: "no-store", signal: controller.signal, headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "data_health" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : [];
  } finally { clearTimeout(timeout); }
}

export { dataHealthAvailability, latestSnapshots };

export async function listDataHealthPolicies(): Promise<HealthPolicy[]> {
  return read("project_health_configs?select=*&order=project_code.asc") as Promise<HealthPolicy[]>;
}

export async function listLatestHealthSnapshots(): Promise<Map<string, HealthSnapshot>> {
  const rows = await read("probe_observations?select=policy_id,health_dimension,outcome,evaluated_at&order=evaluated_at.desc&limit=2000") as Observation[];
  const snapshots = new Map<string, HealthSnapshot>();
  for (const row of rows) {
    const current = snapshots.get(row.policy_id) ?? { policy_id: row.policy_id, data_outcome: "neutral", delivery_outcome: null, evaluated_at: row.evaluated_at };
    if (row.health_dimension === "data") current.data_outcome = row.outcome as HealthSnapshot["data_outcome"];
    if (row.health_dimension === "delivery") current.delivery_outcome = row.outcome as HealthSnapshot["delivery_outcome"];
    snapshots.set(row.policy_id, current);
  }
  return snapshots;
}
