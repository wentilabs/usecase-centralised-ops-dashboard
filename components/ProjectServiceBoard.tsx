"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfigEditor } from "./ConfigEditor";
import { ProjectCard } from "./ProjectCard";
import { ServiceRoleCard, type ServiceRoleStatus } from "./ServiceRoleCard";
import { SmartChat } from "./SmartChat";
import type { CanonicalProject } from "@/lib/canonical-projects";
import type { ServiceFieldSpec } from "@/lib/field-spec";
import { SERVICES, SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "@/lib/services";

/** The row a service holds for this project, and how to talk about it. */
type Role = {
  service: ServiceKey;
  alias: string | null;
  row: ProjectConfigRow | null;
  status: ServiceRoleStatus;
  error?: string;
};

function roleFor(
  service: ServiceKey,
  project: CanonicalProject,
  rows: ProjectConfigRow[],
  error?: string,
): Role {
  const alias = project.service_aliases[service] ?? null;
  const matching = alias ? rows.filter((row) => String(row.project_code ?? "").trim() === alias) : [];
  const status: ServiceRoleStatus = error
    ? "Could not read"
    : !alias
      ? "Not onboarded"
      : matching.length === 0
        ? "Alias not found"
        : matching.length > 1
          ? "Ambiguous alias"
          : matching[0].enabled === true
            ? "Enabled"
            : "Disabled";
  return { service, alias, row: matching.length === 1 ? matching[0] : null, status, error };
}

/**
 * This project's services, as the dashboard draws them.
 *
 * Literally the dashboard's ProjectCard, not a second rendering of the same
 * facts: the pills, the schedule line, the delivery chips and the sheet links
 * are the ones an operator already reads every day, and a summary written
 * separately here would drift from them the first time a service changed. The
 * card that has no row falls back to the onboarding card, in the same slot and
 * the same order, so the grid still answers "what does this site run" at a
 * glance.
 *
 * Editing opens the same right-hand drawer as the dashboard rather than
 * navigating: you are already looking at the project, and the point of being
 * here is to change one thing and see the card update behind it.
 */
export function ProjectServiceBoard({
  project,
  rows,
  errors,
  canEdit,
  visoUrl,
}: {
  project: CanonicalProject;
  rows: Partial<Record<ServiceKey, ProjectConfigRow[]>>;
  errors: Partial<Record<ServiceKey, string>>;
  canEdit: boolean;
  visoUrl: string | null;
}) {
  const [live, setLive] = useState(rows);
  const [editing, setEditing] = useState<{ service: ServiceKey; row: ProjectConfigRow; draft?: Record<string, unknown>; note?: string } | null>(null);
  const [specs, setSpecs] = useState<Partial<Record<ServiceKey, ServiceFieldSpec>>>({});
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Group names arrive after the page, not with it.
   *
   * The lookup measured 536ms on its own — more than the whole page — and the
   * cards are readable without it, showing raw chat ids until it lands. Paying
   * that before first paint to avoid a moment of ids is the wrong trade on a
   * page whose click already felt slow.
   */
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/group-names", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body?.map) setGroupNames(body.map as Record<string, string>);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** Field specs, fetched once, the first time something wants to edit. */
  const loadSpecs = useCallback(async () => {
    if (Object.keys(specs).length) return specs;
    const body = await fetch("/api/schema", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    const next = (body ?? {}) as Partial<Record<ServiceKey, ServiceFieldSpec>>;
    setSpecs(next);
    return next;
  }, [specs]);

  const openEditor = useCallback(
    async (service: ServiceKey, row: ProjectConfigRow, draft?: Record<string, unknown>, note?: string) => {
      const loaded = await loadSpecs();
      if (!loaded[service]) {
        setNotice(`Could not read ${SERVICES[service].label}'s columns, so its editor cannot open yet.`);
        return;
      }
      setEditing({ service, row, draft, note });
    },
    [loadSpecs],
  );

  const roles = useMemo(
    () => SERVICE_KEYS.map((service) => roleFor(service, project, live[service] ?? [], errors[service])),
    [project, live, errors],
  );

  const rowIdOf = (service: ServiceKey, row: ProjectConfigRow) =>
    String(row[SERVICES[service].idColumn as keyof ProjectConfigRow] ?? row.project_code ?? "");

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Services</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The dashboard&rsquo;s own cards for this project. Editing opens the same drawer and writes the same row.
          </p>
        </div>
      </div>

      {/* Scoped to this project: the sentence is sent with the project code, so
          "mute Sundays" here means this site rather than whichever one the
          model guesses from an unqualified request. */}
      {canEdit ? (
        <SmartChat
          fullWidth
          projectScope={project.primary_alias}
          onProposal={(proposal) => {
            const service = SERVICE_KEYS.find((key) => key === proposal.service);
            const row = service ? (live[service] ?? []).find((candidate) => String(candidate.project_code ?? "") === proposal.projectCode) : null;
            if (!service || !row) {
              setNotice(`That proposal is for ${proposal.projectCode}, which is not one of this project's services.`);
              return;
            }
            void openEditor(service, row, proposal.changes, proposal.summary);
          }}
          // A change across many projects, a sheet job or a set of new projects
          // are all reviewed on the dashboard, against every row they touch.
          // Saying so beats opening a surface here that shows one project's
          // worth of a change that spans twenty.
          onBatch={() => setNotice("That change covers more than this project — review it on the dashboard.")}
          onJobs={() => setNotice("Sheet jobs are run from the dashboard, where their scope is visible.")}
          onOnboard={() => setNotice("New projects are created from the dashboard's onboarding review.")}
        />
      ) : null}

      {notice ? (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{notice}</p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {roles.map((role) =>
          role.row ? (
            <ProjectCard
              key={role.service}
              service={role.service}
              config={role.row}
              rowId={rowIdOf(role.service, role.row)}
              canEdit={canEdit}
              groupNames={groupNames}
              visoUrl={visoUrl}
              onEdit={() => void openEditor(role.service, role.row!)}
              onOpen={() => void openEditor(role.service, role.row!)}
            />
          ) : (
            <ServiceRoleCard
              key={role.service}
              service={role.service}
              project={project}
              rows={live[role.service] ?? []}
              alias={role.alias}
              status={role.status}
              error={role.error}
              canEdit={canEdit}
            />
          ),
        )}
      </div>

      {editing && specs[editing.service] ? (
        <ConfigEditor
          service={editing.service}
          serviceLabel={SERVICES[editing.service].label}
          spec={specs[editing.service]!}
          row={editing.row}
          rowId={rowIdOf(editing.service, editing.row)}
          groupNames={groupNames}
          initialDraft={editing.draft}
          initialNote={editing.note}
          onClose={() => setEditing(null)}
          onSaved={(updated) =>
            setLive((previous) => ({
              ...previous,
              [editing.service]: (previous[editing.service] ?? []).map((row) =>
                rowIdOf(editing.service, row) === rowIdOf(editing.service, updated) ? updated : row,
              ),
            }))
          }
        />
      ) : null}
    </section>
  );
}
