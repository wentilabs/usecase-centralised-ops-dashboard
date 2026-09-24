import { notFound, redirect } from "next/navigation";

import { CanonicalProjectDetail } from "@/components/CanonicalProjectDetail";
import { getCanonicalProject, listConfigs } from "@/lib/config-repository";
import { resolveCanonicalEnvDefaults } from "@/lib/env-defaults";
import { SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "@/lib/services";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CanonicalProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getDashboardSession();
  if (!session.allowed) redirect("/unauthorized");
  // Both at once. Each Supabase round trip is about 100ms, so anything that
  // waits for the project before asking for rows doubles the page — which is
  // what filtering the rows by the project's own aliases turned out to cost:
  // a smaller payload, one trip later, and 10ms slower overall.
  const [project, settled] = await Promise.all([
    getCanonicalProject((await params).id).catch(() => null),
    Promise.allSettled(SERVICE_KEYS.map((service) => listConfigs(service))),
  ]);
  if (!project) notFound();
  const rows: Partial<Record<ServiceKey, ProjectConfigRow[]>> = {};
  const errors: Partial<Record<ServiceKey, string>> = {};
  SERVICE_KEYS.forEach((service, index) => {
    const result = settled[index];
    if (result.status === "fulfilled") rows[service] = result.value;
    else errors[service] = result.reason instanceof Error ? result.reason.message : String(result.reason);
  });
  // Same Viso base the dashboard passes, so a delivery chip on a card here
  // links to the mirrored thread exactly as it does there.
  const visoUrl = (process.env.VISO_URL ?? "").replace(/\/+$/, "") || null;
  // Resolved here rather than in the client component, for the same reason the
  // Viso base is: `process.env` in a client bundle is a different object.
  return <CanonicalProjectDetail project={project} rows={rows} errors={errors} canEdit={session.canEdit} visoUrl={visoUrl} deliveryDefaults={resolveCanonicalEnvDefaults(process.env)} />;
}
