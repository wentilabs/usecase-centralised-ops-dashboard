"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { OnboardDialog } from "./OnboardDialog";
import { onboardingDraftFromCanonicalProject } from "@/lib/canonical-project-onboarding";
import type { CanonicalProject } from "@/lib/canonical-projects";
import { onboardingFor, withSchemaFields } from "@/lib/onboarding";
import type { ServiceFieldSpec } from "@/lib/field-spec";
import type { ProjectConfigRow, ServiceKey } from "@/lib/services";

/**
 * Onboard one service to this project without leaving the project.
 *
 * This was a link to `/?onboard=<service>&project=<id>`, which opened the same
 * dialog on the dashboard — correct, but it cost the page you were working
 * from. Onboarding a site is rarely one service, so after each one you had to
 * navigate back and find the project again.
 *
 * The dialog itself is unchanged: OnboardDialog already took `onClose`,
 * `onCreated`, an `initialDraft` and the canonical ids, because the dashboard
 * needed exactly this. All that is new here is owning the open/closed state
 * beside the service it belongs to, and refreshing in place afterwards so the
 * next service starts from the row that was just written.
 */
export function AddServiceButton({
  service,
  project,
  rows,
  spec,
  groupNames,
}: {
  service: ServiceKey;
  project: CanonicalProject;
  rows: ProjectConfigRow[];
  /** Live columns, so creating offers everything the editor would let you change. */
  spec: ServiceFieldSpec | null;
  groupNames: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const base = onboardingFor(service);
  // A service with no onboarding definition cannot be created from here; say
  // nothing rather than offer a button that opens an empty dialog.
  if (!base) return null;
  const definition = withSchemaFields(base, spec);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-block text-xs text-primary hover:underline"
      >
        Add service →
      </button>
      {open ? (
        <OnboardDialog
          definition={definition}
          rows={rows}
          groupNames={groupNames}
          // The canonical record is the reason this project exists, so its
          // values arrive as visible suggestions rather than hidden defaults.
          initialDraft={onboardingDraftFromCanonicalProject(definition, project)}
          canonicalProjectId={project.id}
          canonicalProjectLabel={project.primary_alias}
          onClose={() => setOpen(false)}
          onCreated={() => {
            // Close and re-read rather than navigate: the point is to stay
            // here and add the next service, and the roles above this button
            // should already show the row that was just created.
            setOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
