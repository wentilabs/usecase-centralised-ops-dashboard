import { notFound, redirect } from "next/navigation";

import { CanonicalProjectDetail } from "@/components/CanonicalProjectDetail";
import { getCanonicalProject, listConfigs } from "@/lib/config-repository";
import { SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "@/lib/services";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CanonicalProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getDashboardSession();
  if (!session.allowed) redirect("/unauthorized");
  const project = await getCanonicalProject((await params).id).catch(() => null);
  if (!project) notFound();
  const settled = await Promise.allSettled(SERVICE_KEYS.map((service) => listConfigs(service)));
  const rows: Partial<Record<ServiceKey, ProjectConfigRow[]>> = {};
  const errors: Partial<Record<ServiceKey, string>> = {};
  SERVICE_KEYS.forEach((service, index) => {
    const result = settled[index];
    if (result.status === "fulfilled") rows[service] = result.value;
    else errors[service] = result.reason instanceof Error ? result.reason.message : String(result.reason);
  });
  return <CanonicalProjectDetail project={project} rows={rows} errors={errors} canEdit={session.canEdit} />;
}
