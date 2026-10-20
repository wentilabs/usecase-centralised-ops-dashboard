import { redirect } from "next/navigation";

import { DashboardShell, type ServiceData } from "@/components/DashboardShell";
import { chatIdsIn } from "@/lib/card-summary";
import { getCanonicalProject, getFieldSpec, listConfigs } from "@/lib/config-repository";
import { getGroupNames } from "@/lib/group-names";
import { SERVICES, SERVICE_KEYS, isServiceKey } from "@/lib/services";
import { metrics } from "@/lib/server-metrics";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; onboard?: string; project?: string; propose?: string }>;
}) {
  const pageStarted = Date.now();
  const session = await metrics.time("page: session", () => getDashboardSession());

  // The real authorization gate: this runs in the Node runtime, where the
  // allow-list env vars are always readable, and it fails closed.
  if (!session.allowed) redirect("/unauthorized");

  // One failing service must not blank the whole dashboard.
  const [rows, specs] = await Promise.all([
    metrics.time("page: configs", () => Promise.allSettled(SERVICE_KEYS.map((key) => listConfigs(key)))),
    metrics.time("page: field specs", () => Promise.allSettled(SERVICE_KEYS.map((key) => getFieldSpec(key)))),
  ]);

  const configured = rows.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  // One small shared table — cheap enough to render with the cards. It returns
  // EVERY stored alias, not only the ids in use, which is what lets the group
  // picker offer chats no project references yet.
  const groupNames = await metrics.time("page: group names", () => getGroupNames(chatIdsIn(configured)));

  // Viso (wa-mirror) exposes /go/<chatId>, which resolves a chat to its company
  // and redirects, so HALO can link to a thread knowing only the group id.
  const visoUrl = (process.env.VISO_URL ?? "").replace(/\/+$/, "") || null;
  const requested = await searchParams;
  const requestedService = requested.service && isServiceKey(requested.service) ? requested.service : null;
  const onboardService = requested.onboard && isServiceKey(requested.onboard) ? requested.onboard : null;
  const onboardProject = onboardService && requested.project ? await getCanonicalProject(requested.project).catch(() => null) : null;

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
  // The readings-age health is NOT read here. It was, and it was the whole wait: measured on
  // 20 Oct, 3.6 s of a 3.7 s render was this one read (a newest-row query for each of 63 active
  // projects), against about 120 ms for everything else on the page together. The cards are useful
  // without it — they already render without their strips — so it loads after first paint from
  // `/api/data-health`, concurrently with the strips, and shows when it arrived.
  const serverRenderMs = Date.now() - pageStarted;
  metrics.record("page: total", serverRenderMs);

  return (
    <DashboardShell
      services={services}
      fetchedAt={new Date().toISOString()}
      serverRenderMs={serverRenderMs}
      initialGroupNames={groupNames.map}
      visoUrl={visoUrl}
      groupNamesMeta={{
        configured: groupNames.configured,
        storeReady: groupNames.storeReady,
        refreshedAt: groupNames.refreshedAt,
        setupHint: groupNames.setupHint ?? null,
      }}
      session={{ email: session.email, canEdit: session.canEdit, isLocalBypass: session.isLocalBypass }}
      initialService={requestedService}
      initialOnboard={onboardService && onboardProject ? { service: onboardService, project: onboardProject } : null}
      focusPropose={requested.propose === "1"}
    />
  );
}
