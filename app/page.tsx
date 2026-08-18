import { redirect } from "next/navigation";

import { DashboardShell, type ServiceData } from "@/components/DashboardShell";
import { getFieldSpec, listConfigs } from "@/lib/config-repository";
import { SERVICES, SERVICE_KEYS } from "@/lib/services";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getDashboardSession();

  // The real authorization gate: this runs in the Node runtime, where the
  // allow-list env vars are always readable, and it fails closed.
  if (!session.allowed) redirect("/unauthorized");

  // One failing service must not blank the whole dashboard.
  const [rows, specs] = await Promise.all([
    Promise.allSettled(SERVICE_KEYS.map((key) => listConfigs(key))),
    Promise.allSettled(SERVICE_KEYS.map((key) => getFieldSpec(key))),
  ]);

  const services: ServiceData[] = SERVICE_KEYS.map((key, index) => {
    const rowsResult = rows[index];
    const specResult = specs[index];
    return {
      key,
      label: SERVICES[key].label,
      idColumn: SERVICES[key].idColumn,
      rows: rowsResult.status === "fulfilled" ? rowsResult.value : [],
      error:
        rowsResult.status === "rejected"
          ? rowsResult.reason instanceof Error
            ? rowsResult.reason.message
            : String(rowsResult.reason)
          : null,
      spec: specResult.status === "fulfilled" ? specResult.value : null,
    };
  });

  return (
    <DashboardShell
      services={services}
      fetchedAt={new Date().toISOString()}
      session={{ email: session.email, canEdit: session.canEdit, isLocalBypass: session.isLocalBypass }}
    />
  );
}
