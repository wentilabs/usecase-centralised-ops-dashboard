"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ConfigEditor } from "./ConfigEditor";
import { ExportDialog } from "./ExportDialog";
import { JobDialog } from "./JobDialog";
import { OnboardDialog } from "./OnboardDialog";
import { ProjectCard } from "./ProjectCard";
import { ProjectSheet } from "./ProjectSheet";
import { ServiceDrawer } from "./ServiceDrawer";
import { emphasisRank, formatSgt } from "@/lib/card-summary";
import { exportsForService, jobsForService, type ExportDefinition, type JobDefinition } from "@/lib/jobs";
import { onboardingFor } from "@/lib/onboarding";
import type { ServiceFieldSpec } from "@/lib/field-spec";
import type { ProjectConfigRow, ServiceKey } from "@/lib/services";

export type ServiceData = {
  key: ServiceKey;
  label: string;
  idColumn: string;
  rows: ProjectConfigRow[];
  error: string | null;
  spec: ServiceFieldSpec | null;
};

export type SessionInfo = {
  email: string | null;
  canEdit: boolean;
  isLocalBypass: boolean;
};

export type GroupNamesMeta = {
  configured: boolean;
  storeReady: boolean;
  refreshedAt: string | null;
  setupHint: string | null;
};

export function DashboardShell({
  services,
  fetchedAt,
  session,
  initialGroupNames,
  groupNamesMeta,
  visoUrl,
}: {
  services: ServiceData[];
  fetchedAt: string;
  session: SessionInfo;
  initialGroupNames: Record<string, string>;
  groupNamesMeta: GroupNamesMeta;
  /** Base URL of Viso (wa-mirror); null hides the chat links. */
  visoUrl: string | null;
}) {
  const [tab, setTab] = useState<ServiceKey>(services[0]?.key ?? "wbgt");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Record<string, ProjectConfigRow[]>>(() =>
    Object.fromEntries(services.map((service) => [service.key, service.rows])),
  );
  const [editing, setEditing] = useState<{ service: ServiceData; row: ProjectConfigRow } | null>(null);

  // Mobile-only surfaces: the service/actions drawer, and the card detail sheet
  // that carries the details the phone card leaves out.
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewing, setViewing] = useState<{ service: ServiceData; row: ProjectConfigRow } | null>(null);
  const [job, setJob] = useState<JobDefinition | null>(null);
  const [exporter, setExporter] = useState<ExportDefinition | null>(null);
  const [onboarding, setOnboarding] = useState(false);

  // Names arrive with the page from ops.whatsapp_group_names; refreshing
  // re-reads the listener log and updates that shared table for everyone.
  const [groupNames, setGroupNames] = useState(initialGroupNames);
  const [namesMeta, setNamesMeta] = useState(groupNamesMeta);
  const [refreshingNames, setRefreshingNames] = useState(false);

  const router = useRouter();
  const [reloading, startReload] = useTransition();
  const [reloadingData, setReloadingData] = useState(false);

  /**
   * Re-read the config rows and drop the cached schema introspection, so a
   * column added to Supabase since this page loaded shows up. Cheap: no
   * listener queries.
   */
  const refreshData = useCallback(async () => {
    setReloadingData(true);
    try {
      await fetch("/api/schema/reload", { method: "POST" }).catch(() => {});
      startReload(() => router.refresh());
    } finally {
      setReloadingData(false);
    }
  }, [router]);

  const refreshGroupNames = useCallback(async () => {
    setRefreshingNames(true);
    try {
      const res = await fetch("/api/group-names?refresh=1");
      if (!res.ok) return;
      const body = (await res.json()) as {
        map: Record<string, string>;
        configured: boolean;
        storeReady: boolean;
        refreshedAt: string | null;
        setupHint?: string;
      };
      setGroupNames(body.map ?? {});
      setNamesMeta({
        configured: body.configured,
        storeReady: body.storeReady,
        refreshedAt: body.refreshedAt,
        setupHint: body.setupHint ?? null,
      });
      startReload(() => router.refresh());
    } finally {
      setRefreshingNames(false);
    }
  }, [router]);

  const active = services.find((service) => service.key === tab) ?? services[0];

  const visible = useMemo(() => {
    const list = rows[active.key] ?? [];
    return list
      // Company is matched as well as project code, so "obayashi" narrows the tab
      // to that company's projects — the reason the column exists.
      .filter((row) => {
        if (!query) return true;
        const needle = query.toLowerCase();
        return (
          String(row.project_code ?? "").toLowerCase().includes(needle) ||
          String(row.company ?? "").toLowerCase().includes(needle)
        );
      })
      .slice()
      .sort((a, b) => {
        // Scheduled first, then manual-ingestion projects, then idle ones.
        const rank = emphasisRank(active.key, b) - emphasisRank(active.key, a);
        return rank || String(a.project_code ?? "").localeCompare(String(b.project_code ?? ""));
      });
  }, [rows, active, query]);

  function rowIdOf(service: ServiceData, row: ProjectConfigRow) {
    return String(row[service.idColumn as keyof ProjectConfigRow] ?? row.project_code ?? "");
  }

  return (
    <div className="min-h-screen">
      {/* ---------------------------------------------------------------------
       * Mobile top bar. Deliberately one row: which service you are in, the
       * search box (the primary way to find a project code on a phone), and a
       * refresh. Everything else lives in the drawer.
       * ------------------------------------------------------------------- */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-3 pb-2 backdrop-blur pt-safe md:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={`Service: ${active.label}. Open menu`}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] font-semibold"
        >
          <span aria-hidden>☰</span>
          {active.label}
        </button>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter code…"
          aria-label="Filter by project code"
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 outline-none focus:border-primary"
        />

        <button
          type="button"
          onClick={() => void refreshData()}
          disabled={reloadingData || reloading}
          aria-label="Refresh configs"
          className="shrink-0 rounded-lg border border-border bg-card px-2.5 py-2 text-sm disabled:opacity-50"
        >
          {reloadingData || reloading ? "…" : "⟳"}
        </button>
      </header>

      {/* ---------------------------------------------------------------------
       * Desktop header — unchanged.
       * ------------------------------------------------------------------- */}
      <header className="sticky top-0 z-30 hidden flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background/95 px-5 py-2.5 backdrop-blur md:flex">
        <h1 className="mr-1 whitespace-nowrap text-base font-semibold">🗂️ HALO Centralised Services</h1>

        <nav className="flex gap-1">
          {services.map((service) => (
            <button
              key={service.key}
              type="button"
              onClick={() => setTab(service.key)}
              className={`rounded-lg border px-3 py-1 text-[13px] ${
                service.key === active.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary"
              }`}
            >
              {service.label}
            </button>
          ))}
        </nav>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by project code…"
          className="w-[220px] rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary"
        />

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {services.map((service) => `${(rows[service.key] ?? []).length} ${service.label}`).join(" · ")} · fetched{" "}
            {formatSgt(fetchedAt)} SGT
          </span>
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void refreshData()}
              disabled={reloadingData || reloading}
              title="Re-read project configs from Supabase and pick up any newly added columns"
              className="rounded-lg border border-border bg-card px-2 py-1 text-xs hover:border-primary disabled:opacity-50"
            >
              {reloadingData || reloading ? "Refreshing…" : "⟳ Refresh"}
            </button>

            {namesMeta.configured ? (
              <button
                type="button"
                onClick={() => void refreshGroupNames()}
                disabled={refreshingNames}
                title={
                  namesMeta.setupHint ??
                  (namesMeta.refreshedAt
                    ? `Chat aliases last refreshed ${formatSgt(namesMeta.refreshedAt)} SGT. Re-reads every group's current name from the WhatsApp listener log — takes a few seconds.`
                    : "Read each group's name from the WhatsApp listener log — takes a few seconds.")
                }
                className="rounded-lg border border-border bg-card px-2 py-1 text-xs hover:border-primary disabled:opacity-50"
              >
                {refreshingNames
                  ? "Aliasing…"
                  : namesMeta.storeReady
                    ? "⟳ Chat aliases"
                    : "⚠ Chat aliases"}
              </button>
            ) : null}
          </span>

          {session.isLocalBypass && !session.email ? (
            <span className="rounded-full bg-muted px-2 py-0.5" title="Local development bypass">
              local
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {session.email}
              {session.canEdit ? null : (
                <span className="rounded-full bg-warn/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warn">
                  read-only
                </span>
              )}
            </span>
          )}
        </div>
      </header>

      {jobsForService(active.key).length ||
      exportsForService(active.key).length ||
      onboardingFor(active.key) ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 md:px-5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {active.label} actions
          </span>
          {/* Creating a row is the only insert in the app, so it leads the row
              and needs the same edit right as a config change. */}
          {session.canEdit && onboardingFor(active.key) ? (
            <button
              type="button"
              onClick={() => setOnboarding(true)}
              title={onboardingFor(active.key)?.description}
              className="rounded-lg border border-on/40 bg-on/10 px-3 py-1.5 text-xs font-medium text-on hover:bg-on/20"
            >
              {onboardingFor(active.key)?.label}
            </button>
          ) : null}
          {/* Jobs change production, so they need edit rights. An export only
              reads, so a read-only account may still take a copy. */}
          {session.canEdit
            ? jobsForService(active.key).map((definition) => (
                <button
                  key={definition.key}
                  type="button"
                  onClick={() => setJob(definition)}
                  title={definition.description}
                  className="rounded-lg border border-primary/35 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
                >
                  {definition.label}
                </button>
              ))
            : null}
          {exportsForService(active.key).map((definition) => (
            <button
              key={definition.key}
              type="button"
              onClick={() => setExporter(definition)}
              title={definition.description}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
            >
              {definition.label}
            </button>
          ))}
        </div>
      ) : null}

      <main className="grid grid-cols-1 gap-3 px-3 py-3 sm:grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(330px,1fr))] md:gap-3.5 md:px-5 md:py-4">
        {active.error ? (
          <p className="col-span-full rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
            {active.label}: {active.error}
          </p>
        ) : null}

        {visible.map((row) => {
          const rowId = rowIdOf(active, row);
          return (
            <ProjectCard
              key={rowId}
              service={active.key}
              label={active.label}
              config={row}
              rowId={rowId}
              canEdit={session.canEdit && Boolean(active.spec)}
              onEdit={() => setEditing({ service: active, row })}
              onOpen={() => setViewing({ service: active, row })}
              groupNames={groupNames}
              visoUrl={visoUrl}
            />
          );
        })}

        {!visible.length && !active.error ? (
          <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No projects match.</p>
        ) : null}
      </main>

      {menuOpen ? (
        <ServiceDrawer
          services={services.map((service) => ({
            key: service.key,
            label: service.label,
            count: (rows[service.key] ?? []).length,
            failed: Boolean(service.error),
          }))}
          activeKey={active.key}
          onSelect={setTab}
          onClose={() => setMenuOpen(false)}
          fetchedAt={fetchedAt}
          session={session}
          names={{
            configured: namesMeta.configured,
            storeReady: namesMeta.storeReady,
            refreshedAt: namesMeta.refreshedAt,
            busy: refreshingNames,
          }}
          onRefreshData={() => void refreshData()}
          onRefreshNames={() => void refreshGroupNames()}
          dataBusy={reloadingData || reloading}
        />
      ) : null}

      {/* The sheet's row comes from `rows`, so an edit saved from within it is
          reflected the next time it is opened. */}
      {viewing ? (
        <ProjectSheet
          service={viewing.service.key}
          label={viewing.service.label}
          config={
            (rows[viewing.service.key] ?? []).find(
              (row) => rowIdOf(viewing.service, row) === rowIdOf(viewing.service, viewing.row),
            ) ?? viewing.row
          }
          rowId={rowIdOf(viewing.service, viewing.row)}
          canEdit={session.canEdit && Boolean(viewing.service.spec)}
          onEdit={() => {
            setEditing({ service: viewing.service, row: viewing.row });
            setViewing(null);
          }}
          onClose={() => setViewing(null)}
          groupNames={groupNames}
          visoUrl={visoUrl}
        />
      ) : null}

      {onboarding && onboardingFor(active.key) ? (
        <OnboardDialog
          definition={onboardingFor(active.key)!}
          rows={rows[active.key] ?? []}
          onClose={() => setOnboarding(false)}
          onCreated={() => void refreshData()}
        />
      ) : null}

      {job ? (
        <JobDialog job={job} rows={rows[job.service] ?? []} onClose={() => setJob(null)} />
      ) : null}

      {exporter ? (
        <ExportDialog
          definition={exporter}
          rows={rows[exporter.service] ?? []}
          onClose={() => setExporter(null)}
        />
      ) : null}

      {editing && editing.service.spec ? (
        <ConfigEditor
          service={editing.service.key}
          serviceLabel={editing.service.label}
          spec={editing.service.spec}
          row={editing.row}
          rowId={rowIdOf(editing.service, editing.row)}
          groupNames={groupNames}
          onClose={() => setEditing(null)}
          onSaved={(updated) =>
            setRows((prev) => ({
              ...prev,
              [editing.service.key]: (prev[editing.service.key] ?? []).map((row) =>
                rowIdOf(editing.service, row) === rowIdOf(editing.service, updated) ? updated : row,
              ),
            }))
          }
        />
      ) : null}
    </div>
  );
}
