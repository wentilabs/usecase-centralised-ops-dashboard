import { notFound, redirect } from "next/navigation";

import { CanonicalProjectDetail } from "@/components/CanonicalProjectDetail";
import { chatIdsIn } from "@/lib/card-summary";
import { getCanonicalProject, getFieldSpec, listConfigs } from "@/lib/config-repository";
import { getGroupNames } from "@/lib/group-names";
import type { ServiceFieldSpec } from "@/lib/field-spec";
import { SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "@/lib/services";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CanonicalProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getDashboardSession();
  if (!session.allowed) redirect("/unauthorized");
  const project = await getCanonicalProject((await params).id).catch(() => null);
  if (!project) notFound();
  // Specs and group names come along because Add service now opens here
  // rather than on the dashboard: the same three inputs that page gathers.
  const [settled, specsSettled] = await Promise.all([
    Promise.allSettled(SERVICE_KEYS.map((service) => listConfigs(service))),
    Promise.allSettled(SERVICE_KEYS.map((service) => getFieldSpec(service))),
  ]);
  const rows: Partial<Record<ServiceKey, ProjectConfigRow[]>> = {};
  const errors: Partial<Record<ServiceKey, string>> = {};
  const specs: Partial<Record<ServiceKey, ServiceFieldSpec | null>> = {};
  SERVICE_KEYS.forEach((service, index) => {
    const result = settled[index];
    if (result.status === "fulfilled") rows[service] = result.value;
    else errors[service] = result.reason instanceof Error ? result.reason.message : String(result.reason);
    const spec = specsSettled[index];
    specs[service] = spec.status === "fulfilled" ? spec.value : null;
  });
  const configured = Object.values(rows).flat();
  const groupNames = await getGroupNames(chatIdsIn(configured));
  return <CanonicalProjectDetail project={project} rows={rows} errors={errors} canEdit={session.canEdit} specs={specs} groupNames={groupNames.map} />;
}
