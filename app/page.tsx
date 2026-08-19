import { redirect } from "next/navigation";

import { DashboardShell, type ServiceData } from "@/components/DashboardShell";
import { getFieldSpec, listConfigs } from "@/lib/config-repository";
import { getGroupNames } from "@/lib/group-names";
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

  const chatIds = new Set<string>();
  for (const result of rows) {
    if (result.status !== "fulfilled") continue;
    for (const row of result.value as Record<string, unknown>[]) {
      for (const column of [
        "whatsapp_group_id",
        "wa_group_ids",
        "whatsapp_group_ids",
        "alert_whatsapp_gid",
        "poc_alert_wa_groups",
        "whatsapp_wbgt_source_chat_ids",
      ]) {
        String(row[column] ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.endsWith("@g.us"))
          .forEach((entry) => chatIds.add(entry));
      }
    }
  }
  // One small shared table — cheap enough to render with the cards.
  const groupNames = await getGroupNames([...chatIds]);

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
      initialGroupNames={groupNames.map}
      groupNamesMeta={{
        configured: groupNames.configured,
        storeReady: groupNames.storeReady,
        refreshedAt: groupNames.refreshedAt,
        setupHint: groupNames.setupHint ?? null,
      }}
      session={{ email: session.email, canEdit: session.canEdit, isLocalBypass: session.isLocalBypass }}
    />
  );
}
