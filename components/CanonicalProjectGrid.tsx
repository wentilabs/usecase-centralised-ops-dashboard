"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CompanyMark } from "./CompanyMark";
import { ServiceTag } from "./ServiceTag";
import {
  canonicalProjectMapHref,
  canonicalProjectMatches,
  canonicalSheetHref,
  type CanonicalProject,
} from "@/lib/canonical-projects";
import { shouldFocusPropose, shouldFocusSearch } from "@/lib/search-hotkey";
import { SERVICES, SERVICE_KEYS, type ServiceKey } from "@/lib/services";

/**
 * The four common workbooks, in the order the detail page lists them so the
 * two screens cannot disagree about what a site's sheets are called.
 */
const SHEET_LINKS = [
  ["Safety", "safety_workbook_id"],
  ["Manpower", "manpower_workbook_id"],
  ["Noise", "noise_workbook_id"],
  ["WBGT", "wbgt_workbook_id"],
] as const;

/**
 * A quick link, as a subtle button rather than bare underlined text.
 *
 * These sit in a row of four or five: as plain links they ran together into one
 * blue smear, and each has its own target, so each wants its own edge. Kept
 * quiet — a border and a background that only lift on hover — because the
 * card's real action is opening the project, and four loud buttons would
 * compete with it.
 */
const QUICK_LINK =
  "rounded-md border border-border/70 bg-background/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary";

function ProjectCard({ project }: { project: CanonicalProject }) {
  const aliases = SERVICE_KEYS.filter((service) => project.service_aliases[service]);
  const sheets = SHEET_LINKS
    .map(([label, field]) => ({ label, href: canonicalSheetHref(project[field]) }))
    .filter((entry) => entry.href !== null);
  const map = canonicalProjectMapHref(project);

  return (
    // `relative` and `overflow-hidden`: the mark is absolutely positioned and
    // sized in pixels, so without clipping it escapes a short card.
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary">
      {project.company ? <CompanyMark company={project.company} opacity="opacity-40" box="h-[90px] w-[150px]" /> : null}

      {/* The whole card opens the project. A stretched overlay rather than
          wrapping everything in one anchor, because the workbook and map links
          below are anchors too and an anchor cannot contain another — they sit
          above this on z-10 and keep their own targets. */}
      <Link
        href={`/projects/${project.id}`}
        className="absolute inset-0 z-0"
        aria-label={`Open ${project.primary_alias}`}
      />

      <div className="pointer-events-none relative z-0">
        <span className="font-mono font-semibold group-hover:underline">{project.primary_alias}</span>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {project.site_name ?? project.company ?? "No site name or company"}
        </p>
        {project.site_address ? <p className="mt-1 text-xs text-muted-foreground">{project.site_address}</p> : null}
      </div>

      {/* The dashboard's own service pills, in the dashboard's order, so a
          service is the same colour and the same word wherever you meet it. */}
      {aliases.length ? (
        <div className="pointer-events-none relative z-0 mt-3 flex flex-wrap gap-1">
          {aliases.map((service) => (
            <ServiceTag key={service} service={service} title={`${SERVICES[service].label}: ${project.service_aliases[service]}`} />
          ))}
        </div>
      ) : (
        <p className="pointer-events-none relative z-0 mt-3 text-[11px] text-muted-foreground">No service aliases yet</p>
      )}

      {sheets.length ? (
        <div className="relative z-10 mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
          {sheets.map((sheet) => (
            <a key={sheet.label} href={sheet.href ?? undefined} target="_blank" rel="noreferrer" className={QUICK_LINK}>
              📗 {sheet.label}
            </a>
          ))}
        </div>
      ) : null}

      {/* Its own row: a map is a different kind of destination from a workbook,
          and on a narrow card it otherwise wrapped to the end of the sheets and
          read as a fifth one. */}
      {map ? (
        <div className={`relative z-10 flex ${sheets.length ? "mt-1.5" : "mt-3 border-t border-border/60 pt-3"}`}>
          <a href={map} target="_blank" rel="noreferrer" className={QUICK_LINK}>📍 Map</a>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The canonical projects registry, as cards rather than a three-column list.
 *
 * Full width and a denser grid because this is a directory: the question it
 * answers is "which site is this and where are its things", and the previous
 * layout showed a name, one line of subtitle and a count of aliases — every
 * link it could have offered was one navigation away.
 */
export function CanonicalProjectGrid({ projects }: { projects: CanonicalProject[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  // ⌘F / Ctrl+F, on the same rule the dashboard uses — including its escape
  // hatch, so a second press still reaches the browser's own find.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const node = search.current;
      if (!node) return;
      if (shouldFocusSearch(event, document.activeElement === node)) {
        event.preventDefault();
        node.focus();
        node.select();
        return;
      }
      // ⌘P belongs to Propose everywhere, but the bar that reviews and applies
      // what it returns lives on the dashboard. Route there focused rather
      // than grow a second one here with nothing behind it.
      if (shouldFocusPropose(event, false)) {
        event.preventDefault();
        router.push("/?propose=1");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  const shown = useMemo(() => projects.filter((project) => canonicalProjectMatches(project, query)), [projects, query]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Code, alias, company, site or address…  (⌘F · ⌘P to propose)"
          className="w-full max-w-md rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <span className="text-xs text-muted-foreground">
          {shown.length === projects.length ? `${projects.length} projects` : `${shown.length} of ${projects.length}`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {shown.map((project) => <ProjectCard key={project.id} project={project} />)}
        {!shown.length ? (
          <p className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {projects.length ? `Nothing matches “${query}”.` : "No canonical projects yet. Review reconstructed candidates before creating records."}
          </p>
        ) : null}
      </div>
    </>
  );
}
