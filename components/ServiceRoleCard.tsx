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

/** What the live rows say about this service's place in the project. */
export type ServiceRoleStatus =
  | "Enabled"
  | "Disabled"
  | "Not onboarded"
  | "Alias not found"
  | "Ambiguous alias"
  | "Could not read";

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

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <ServiceTag service={service} />
        <span className={`text-[11px] font-semibold ${statusTone(status)}`}>{status}</span>
      </div>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{alias ?? "No service alias recorded"}</p>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {alias ? "Open configuration →" : canOnboard ? (loading ? "Opening…" : "Add service →") : "Not onboarded"}
      </p>
    </>
  );

  const shell = "rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary";

  if (alias) {
    return (
      <a href={`/?service=${encodeURIComponent(service)}`} className={`block ${shell}`}>
        {body}
      </a>
    );
  }

  if (!canOnboard) return <article className={shell}>{body}</article>;

  return (
    <>
      <button type="button" onClick={() => void openDialog()} className={`block w-full ${shell}`}>
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
