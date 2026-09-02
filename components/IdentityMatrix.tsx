"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";

import type { Cluster, Evidence } from "@/lib/project-identity";
import type { ServiceKey } from "@/lib/services";

/**
 * Which project codes across the seven services are the same physical site.
 *
 * Read-only, and derived on every request rather than stored: a saved copy goes
 * stale the moment someone onboards a project, and a stale identity map is
 * worse than none — it is the thing a bulk operation would trust.
 *
 * The matrix is the point. A list of aliases tells you `CFC` and
 * `Clifford Centre` are one site; a row across all seven services also shows
 * that issue-chaser has neither, which is the question anyone actually arrives
 * with. So gaps are rendered, not omitted.
 *
 * Mobile follows the house rule — unprefixed classes describe the phone, `md:`
 * restores the desktop. The table itself scrolls inside its own container with
 * the site column pinned, because eight columns will never fit a phone and
 * collapsing them to cards would lose the comparison the page exists for.
 */

const FILTERS = [
  { key: "all", label: "All sites" },
  { key: "alias", label: "Aliased only" },
  { key: "issueChaser", label: "Missing from Issue Chaser" },
  { key: "subcon", label: "Missing from Subcon" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

/** One line of plain English per rule, so a reader need not know the code. */
function describe(evidence: Evidence): string {
  switch (evidence.kind) {
    case "shared-chat":
      return `Shares WhatsApp group ${evidence.chatId}`;
    case "identical-code":
      return "Codes identical once case and punctuation are folded away";
    case "code-prefix":
      return `"${evidence.shorter}" is the start of "${evidence.longer}"`;
    case "code-abbreviation":
      return `"${evidence.shorter}" reads as an abbreviation of "${evidence.longer}"`;
    case "override":
      return `Signed off by review — ${evidence.note}`;
  }
}

export function IdentityMatrix({
  clusters,
  services,
  errors,
}: {
  clusters: Cluster[];
  services: { key: ServiceKey; label: string }[];
  /** Per-service read failures. A missing service is not an empty service. */
  errors: { key: ServiceKey; message: string }[];
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(
    () =>
      clusters.filter((cluster) => {
        if (filter === "all") return true;
        if (filter === "alias") return cluster.codes.length > 1;
        return !cluster.members.some((member) => member.service === filter);
      }),
    [clusters, filter],
  );

  const aliased = clusters.filter((c) => c.codes.length > 1).length;
  const unresolved = clusters.filter((c) => c.tier === "suggested").length;
  const codes = new Set(clusters.flatMap((c) => c.codes)).size;

  return (
    <div className="flex flex-col gap-4 px-3 pb-16 pt-3 md:gap-5 md:px-5 md:pb-10 md:pt-4">
      <header className="flex flex-col gap-2">
        <Link href="/" className="w-fit text-[13px] text-muted-foreground hover:text-primary">
          ← Back to projects
        </Link>
        <h1 className="text-lg font-semibold md:text-xl">Site identity</h1>
        <p className="max-w-[68ch] text-[13px] leading-relaxed text-muted-foreground">
          Each service keys projects by its own <code className="text-foreground">project_code</code> and
          nothing links them, so one site can be <code className="text-foreground">CFC</code> in three
          services and <code className="text-foreground">Clifford Centre</code> in a fourth. This is
          derived from the live configuration every time the page loads, then corrected by the rulings
          in <code className="text-foreground">project-identity-overrides.ts</code>.
        </p>
      </header>

      {errors.length ? (
        <div className="rounded-xl border border-danger/50 bg-danger/10 p-3 text-[13px]">
          <span className="font-semibold text-danger">Incomplete.</span>{" "}
          {errors.map((e) => e.key).join(", ")} could not be read, so sites may look absent from a
          service that simply did not answer.
          {errors.map((e) => (
            <div key={e.key} className="mt-1 font-mono text-[11px] text-muted-foreground">
              {e.key}: {e.message}
            </div>
          ))}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { label: "sites", value: clusters.length },
          { label: "distinct codes", value: codes },
          { label: "carry more than one code", value: aliased },
          { label: "unresolved", value: unresolved, warn: unresolved > 0 },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card px-3 py-2">
            <dt className="text-[11px] text-muted-foreground">{stat.label}</dt>
            <dd
              className={`text-xl font-semibold tabular-nums ${stat.warn ? "text-warn" : ""}`}
            >
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <nav className="flex flex-wrap gap-1">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setFilter(option.key)}
            aria-pressed={filter === option.key}
            className={`rounded-lg border px-3 py-1.5 text-[13px] md:py-1 ${
              filter === option.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:border-primary"
            }`}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[12px] tabular-nums text-muted-foreground">
          {shown.length} of {clusters.length}
        </span>
      </nav>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-border bg-card px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Site
              </th>
              {services.map((service) => (
                <th
                  key={service.key}
                  className="whitespace-nowrap border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {service.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((cluster) => {
              const per = new Map(cluster.members.map((m) => [m.service, m.projectCode]));
              const expanded = open === cluster.canonical;
              return (
                <Fragment key={cluster.canonical}>
                  <tr
                    onClick={() => setOpen(expanded ? null : cluster.canonical)}
                    className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2 text-left font-mono font-medium"
                    >
                      {cluster.canonical}
                      {cluster.codes.length > 1 ? (
                        <span className="ml-1.5 rounded-full bg-warn/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-warn">
                          {cluster.codes.length}
                        </span>
                      ) : null}
                      {cluster.tier === "suggested" ? (
                        <span
                          className="ml-1.5 align-middle text-[10px] text-warn"
                          title="Linked by reading the names only — needs a ruling"
                        >
                          ?
                        </span>
                      ) : null}
                    </th>
                    {services.map((service) => {
                      const code = per.get(service.key);
                      if (!code) {
                        return (
                          <td key={service.key} className="px-3 py-2 text-muted-foreground/45">
                            —
                          </td>
                        );
                      }
                      const alias = code !== cluster.canonical;
                      return (
                        <td
                          key={service.key}
                          className={`whitespace-nowrap px-3 py-2 font-mono ${
                            alias ? "text-warn" : "text-muted-foreground"
                          }`}
                        >
                          {code}
                        </td>
                      );
                    })}
                  </tr>
                  {expanded ? (
                    <tr className="border-b border-border/60">
                      <td colSpan={services.length + 1} className="bg-muted/30 px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Why these are one site
                        </div>
                        {cluster.evidence.length ? (
                          <ul className="mt-1 flex flex-col gap-0.5">
                            {cluster.evidence.map((evidence, index) => (
                              <li key={index} className="text-[12.5px] text-foreground/85">
                                {describe(evidence)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-[12.5px] text-muted-foreground">
                            One code, one service group — nothing to link.
                          </p>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="max-w-[68ch] text-[12px] leading-relaxed text-muted-foreground">
        <span className="text-warn">Amber</span> marks a service that spells the site differently.{" "}
        <span className="text-muted-foreground/45">—</span> means the site is not onboarded there. A row
        can be tapped for the evidence behind it. Nothing on this page writes anything; corrections go
        in <code>project-identity-overrides.ts</code>.
      </p>
    </div>
  );
}
