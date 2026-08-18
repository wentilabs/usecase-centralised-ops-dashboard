"use client";

import { useMemo, useState } from "react";

import { ConfigEditor } from "./ConfigEditor";
import { ProjectCard } from "./ProjectCard";
import { formatSgt, hasCadence } from "@/lib/card-summary";
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

export function DashboardShell({
  services,
  fetchedAt,
  session,
}: {
  services: ServiceData[];
  fetchedAt: string;
  session: SessionInfo;
}) {
  const [tab, setTab] = useState<ServiceKey>(services[0]?.key ?? "wbgt");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Record<string, ProjectConfigRow[]>>(() =>
    Object.fromEntries(services.map((service) => [service.key, service.rows])),
  );
  const [editing, setEditing] = useState<{ service: ServiceData; row: ProjectConfigRow } | null>(null);

  const active = services.find((service) => service.key === tab) ?? services[0];

  const visible = useMemo(() => {
    const list = rows[active.key] ?? [];
    return list
      .filter((row) => !query || String(row.project_code ?? "").toLowerCase().includes(query.toLowerCase()))
      .slice()
      .sort((a, b) => {
        const cadence = Number(hasCadence(active.key, b)) - Number(hasCadence(active.key, a));
        return cadence || String(a.project_code ?? "").localeCompare(String(b.project_code ?? ""));
      });
  }, [rows, active, query]);

  function rowIdOf(service: ServiceData, row: ProjectConfigRow) {
    return String(row[service.idColumn as keyof ProjectConfigRow] ?? row.project_code ?? "");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background/95 px-5 py-2.5 backdrop-blur">
        <h1 className="mr-1 whitespace-nowrap text-base font-semibold">🗂️ Centralised Services</h1>

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
          {session.isLocalBypass && !session.email ? (
            <span className="rounded-full bg-muted px-2 py-0.5" title="Local development bypass">
              local
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {session.email}
              {session.canEdit ? null : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warn">
                  read-only
                </span>
              )}
            </span>
          )}
        </div>
      </header>

      <main className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-3.5 px-5 py-4">
        {active.error ? (
          <p className="col-span-full rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
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
            />
          );
        })}

        {!visible.length && !active.error ? (
          <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No projects match.</p>
        ) : null}
      </main>

      {editing && editing.service.spec ? (
        <ConfigEditor
          service={editing.service.key}
          serviceLabel={editing.service.label}
          spec={editing.service.spec}
          row={editing.row}
          rowId={rowIdOf(editing.service, editing.row)}
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
