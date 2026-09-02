import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IdentityMatrix } from "@/components/IdentityMatrix";
import { listConfigs } from "@/lib/config-repository";
import { clusterProjects, type ServiceRow } from "@/lib/project-identity";
import { SERVICES, SERVICE_KEYS } from "@/lib/services";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Site identity" };

/**
 * The resolved cross-service project identity map.
 *
 * Derived per request from the live configuration rather than stored. A saved
 * copy would go stale the moment a project is onboarded, and a stale identity
 * map is worse than none: it is precisely the thing a bulk operation would
 * trust when deciding whether a site already exists.
 *
 * Read-only, and open to read-only accounts — it writes nothing and exposes no
 * more than the dashboard already does.
 */
export default async function IdentityPage() {
  const session = await getDashboardSession();
  // Same gate as the dashboard: Node runtime, where the allow-list env vars are
  // readable, and it fails closed.
  if (!session.allowed) redirect("/unauthorized");

  // Per-service rather than all-or-nothing. One unreachable schema must show as
  // "could not be read", never as a service with no projects — that difference
  // decides whether a site looks like it needs onboarding.
  const settled = await Promise.allSettled(SERVICE_KEYS.map((key) => listConfigs(key)));

  const rows: ServiceRow[] = [];
  const errors: { key: (typeof SERVICE_KEYS)[number]; message: string }[] = [];
  SERVICE_KEYS.forEach((key, index) => {
    const result = settled[index];
    if (result.status === "rejected") {
      errors.push({
        key,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      return;
    }
    for (const row of result.value) {
      // `project_code`, never `SERVICES[key].idColumn` — ailytics keys rows by a
      // uuid `id`, and using that as the code would give every ailytics project
      // an identity nothing else can match.
      const code = String(row.project_code ?? "").trim();
      if (code) rows.push({ service: key, projectCode: code, row });
    }
  });

  return (
    <IdentityMatrix
      clusters={clusterProjects(rows)}
      services={SERVICE_KEYS.map((key) => ({ key, label: SERVICES[key].label }))}
      errors={errors}
    />
  );
}
