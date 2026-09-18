import { redirect } from "next/navigation";

import { CanonicalProjectCandidates } from "@/components/CanonicalProjectCandidates";
import { canonicalProjectCandidates } from "@/lib/canonical-projects";
import { listCanonicalProjects, listConfigs } from "@/lib/config-repository";
import type { ServiceRow } from "@/lib/project-identity";
import { SERVICE_KEYS } from "@/lib/services";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ImportCanonicalProjectsPage() {
  const session = await getDashboardSession();
  if (!session.allowed) redirect("/unauthorized");
  const [settled, existingProjects] = await Promise.all([
    Promise.allSettled(SERVICE_KEYS.map((service) => listConfigs(service))),
    listCanonicalProjects(),
  ]);
  const rows: ServiceRow[] = [];
  const unavailableServices: string[] = [];
  SERVICE_KEYS.forEach((service, index) => {
    const result = settled[index];
    if (result.status !== "fulfilled") {
      unavailableServices.push(service);
      return;
    }
    for (const row of result.value) {
      const projectCode = String(row.project_code ?? "").trim();
      if (projectCode) rows.push({ service, projectCode, row });
    }
  });
  return <CanonicalProjectCandidates candidates={canonicalProjectCandidates(rows)} existingProjects={existingProjects} canEdit={session.canEdit} unavailableServices={unavailableServices} />;
}
