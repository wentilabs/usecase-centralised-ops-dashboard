import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DeveloperGuide } from "@/components/DeveloperGuide";
import { listConfigs } from "@/lib/config-repository";
import { SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "@/lib/services";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Developer" };

/**
 * Where the raw readings come from, for whoever is on call.
 *
 * Written for the question a colleague asked out loud: "where do the raw
 * readings come from — is it an API, Browserbase, etc.? Then I can better help
 * debug when you're not here." The answer existed, spread across seven
 * repositories, which is no use to someone holding a phone at 2am.
 *
 * Read-only and open to read-only accounts, deliberately. The whole point is
 * that anyone covering can open it, and it exposes nothing a service row does
 * not already show — no credential value appears here, only the name of the
 * variable that holds one.
 */
export default async function DeveloperPage() {
  const session = await getDashboardSession();
  if (!session.allowed) redirect("/unauthorized");

  // Per-service, not all-or-nothing: one unreachable schema must read as "could
  // not be read" rather than as a service with no projects. On this page that
  // distinction matters more than most — a service listed with no projects
  // looks like a service nobody needs to check.
  const settled = await Promise.allSettled(SERVICE_KEYS.map((key) => listConfigs(key)));
  const rows: Partial<Record<ServiceKey, ProjectConfigRow[]>> = {};
  const errors: Partial<Record<ServiceKey, string>> = {};
  SERVICE_KEYS.forEach((service, index) => {
    const result = settled[index];
    if (result.status === "fulfilled") rows[service] = result.value;
    else errors[service] = result.reason instanceof Error ? result.reason.message : String(result.reason);
  });

  return <DeveloperGuide rows={rows} errors={errors} />;
}
