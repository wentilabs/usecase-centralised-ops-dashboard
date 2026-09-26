"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { OnboardDialog } from "./OnboardDialog";
import { ServiceTag } from "./ServiceTag";
import { onboardingDraftFromCanonicalProject } from "@/lib/canonical-project-onboarding";
import type { CanonicalProject } from "@/lib/canonical-projects";
import type { ServiceFieldSpec } from "@/lib/field-spec";
import { onboardingFor, withSchemaFields } from "@/lib/onboarding";
import type { ProjectConfigRow, ServiceKey } from "@/lib/services";

/**
 * What the live rows say about this service's place in the project.
 *
 * Re-exported rather than declared here: the status is decided by
 * `lib/service-role.ts`, which is where the alias-matching rule lives and where
 * it can be tested without a DOM.
 */
export type { ServiceRoleStatus } from "@/lib/service-role";
import type { ServiceRoleStatus } from "@/lib/service-role";

function statusTone(status: ServiceRoleStatus): string {
  if (status === "Enabled") return "text-on";
  if (status === "Disabled") return "text-muted-foreground";
  return "text-warn";
}

/**
 * One service's role in a project, shaped like the dashboard's project card.
 *
 * Deliberately the same shape and the same coloured tag: these are the same
 * seven services, and a person moving between the two screens should not have
 * to re-learn which is which. The tag component owns the hue, so they cannot
 * drift.
 *
 * The whole card is the action, and which action depends on what is there — a
 * configured service opens its configuration, an absent one opens onboarding.
 * Two different destinations behind one gesture is the point: the question you
 * arrive with is "what about WBGT on this site", not "does a row exist yet".
 */
export function ServiceRoleCard({
  service,
  project,
  rows,
  alias,
  status,
  error,
  canEdit,
}: {
  service: ServiceKey;
  project: CanonicalProject;
  rows: ProjectConfigRow[];
  alias: string | null;
  status: ServiceRoleStatus;
  error?: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /**
   * Fetched when the dialog opens, not with the page.
   *
   * These two reads cost the project page about 240ms — group names alone was
   * 536ms measured on its own — to prepare a dialog most visits never open.
   */
  const [loaded, setLoaded] = useState<{ spec: ServiceFieldSpec | null; groupNames: Record<string, string> } | null>(null);
  const [loading, setLoading] = useState(false);

  const definition = onboardingFor(service);
  const canOnboard = canEdit && !alias && Boolean(definition);

  async function openDialog() {
    setOpen(true);
    if (loaded || loading) return;
    setLoading(true);
    try {
      const [schema, groups] = await Promise.all([
        fetch("/api/schema", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).catch(() => null),
        fetch("/api/group-names", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).catch(() => null),
      ]);
      setLoaded({
        // A failed read is not fatal: the dialog still offers the curated
        // fields, and the group picker falls back to raw chat ids.
        spec: (schema?.[service] as ServiceFieldSpec | undefined) ?? null,
        groupNames: (groups?.map as Record<string, string> | undefined) ?? {},
      });
    } finally {
      setLoading(false);
    }
  }

  /**
   * The same header the real card wears: tag on the left, the code beside it,
   * state on the right.
   *
   * An empty card used to be a tag adrift in the middle of a box, which read as
   * a different kind of object rather than as the same card without a row yet.
   * The code shown is the project's own, because that is what the row will be
   * called once it exists.
   */
  const body = (
    <>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <ServiceTag service={service} />
        <span className="truncate">{alias ?? project.primary_alias}</span>
        <span className={`ml-auto shrink-0 text-[11px] font-semibold ${statusTone(status)}`}>{status}</span>
      </h2>

      {/* The middle of the card IS the action. There are no pills, no schedule
          and no delivery to show, so filling that space with the one thing you
          came here to do beats a line of prose and a link in the corner. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
        {error ? (
          <p className="text-xs text-danger">{error}</p>
        ) : canOnboard ? (
          <>
            <span className="text-sm font-medium text-primary">{loading ? "Opening…" : "+ Add service"}</span>
            <span className="text-[11px] text-muted-foreground">Creates a disabled row for {project.primary_alias}</span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {alias ? "No matching row in this service" : "Not onboarded"}
          </span>
        )}
      </div>
    </>
  );

  // Matched to ProjectCard: same radius, padding and shadow, and the amber
  // border it gives a disabled project — an absent service is the state you
  // most need to pick out of a grid.
  const shell =
    "relative flex min-h-56 flex-col gap-2.5 rounded-2xl border-2 border-warn/40 bg-card p-3.5 text-left shadow-soft transition-colors hover:border-primary md:gap-3 md:p-4";

  if (alias) {
    return (
      <a href={`/?service=${encodeURIComponent(service)}`} className={shell}>
        {body}
      </a>
    );
  }

  if (!canOnboard) return <article className={shell}>{body}</article>;

  return (
    <>
      <button type="button" onClick={() => void openDialog()} className={`w-full ${shell}`}>
        {body}
      </button>
      {open ? (
        <OnboardDialog
          definition={withSchemaFields(definition!, loaded?.spec ?? null)}
          rows={rows}
          groupNames={loaded?.groupNames ?? {}}
          initialDraft={onboardingDraftFromCanonicalProject(withSchemaFields(definition!, loaded?.spec ?? null), project)}
          canonicalProjectId={project.id}
          canonicalProjectLabel={project.primary_alias}
          onClose={() => setOpen(false)}
          onCreated={() => {
            // Stay here and re-read: onboarding a site is rarely one service,
            // and the next one starts from the row just written.
            setOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
