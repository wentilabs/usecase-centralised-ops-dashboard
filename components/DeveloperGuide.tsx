import Link from "next/link";

import { ServiceTag } from "./ServiceTag";
import {
  SERVICE_SOURCES,
  TRANSPORT_LABEL,
  normalizeSourceType,
  profilesFor,
  rulesForRoute,
  sourceProfileFor,
  type SourceProfile,
} from "@/lib/source-model";
import { SERVICES, SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "@/lib/services";

/**
 * The on-call answer sheet: where readings come from, what drives them, and
 * what a reader loses when each one stops.
 *
 * Three things it deliberately does NOT do.
 *
 * It shows no credential values — only the names of the variables that hold
 * them. HALO does not have these secrets and must not start holding them.
 *
 * It states a schedule only where `load-model/crons.ts` can prove one, because
 * that file was read off the AWS console while the service READMEs disagree
 * with it. Where there is no proven rule it says so in those words rather than
 * repeating a README — a confident wrong schedule is worse here than an
 * admitted gap, since the person reading is mid-incident.
 *
 * It is a mirror, not a document. Everything below is derived from
 * `lib/source-model.ts`, which the tests check against the pinned contracts.
 */
export function DeveloperGuide({ rows, errors }: {
  rows: Partial<Record<ServiceKey, ProjectConfigRow[]>>;
  errors: Partial<Record<ServiceKey, string>>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-3 py-4 md:px-5">
      <header className="border-b border-border pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold">Where the readings come from</h1>
          <Link href="/" className="rounded-lg border border-border bg-card px-3 py-1 text-[13px] hover:border-primary">
            ← Dashboard
          </Link>
        </div>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          One page for whoever is covering: the upstream behind each service, how a reading physically
          arrives, what stops when that upstream does, and — for Noise and WBGT, where it differs per
          project — which portal each site is actually read from.
        </p>
        <p className="mt-1.5 max-w-3xl text-[12px] text-muted-foreground">
          No passwords are shown anywhere on this page, by design. Each source names the environment
          variable its service reads; the values live in that service&apos;s deployment and nowhere else.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        {SERVICE_KEYS.map((service) => (
          <ServiceSourceCard key={service} service={service} error={errors[service]} />
        ))}
      </section>

      {(["noise", "wbgt"] as const).map((service) => (
        <PerProjectTable key={service} service={service} rows={rows[service] ?? []} error={errors[service]} />
      ))}
    </main>
  );
}

function ServiceSourceCard({ service, error }: { service: ServiceKey; error?: string }) {
  const source = SERVICE_SOURCES[service];

  return (
    <article className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
      <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
        <ServiceTag service={service} />
        <span>{source.upstream}</span>
        <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {TRANSPORT_LABEL[source.transport]}
        </span>
      </h2>

      <p className="text-[13px] leading-snug">{source.how}</p>

      {/* The half that is actually useful mid-incident, and the half a README
          never says: not "what is this" but "what have I lost". */}
      <div className="rounded-lg border border-warn/40 bg-warn/10 p-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-warn">When it is down</div>
        <p className="mt-0.5 text-[12px] leading-snug">{source.breaks}</p>
      </div>

      {source.inbound.length ? <InboundRoutes service={service} routes={source.inbound} /> : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px]">
        {source.loginUrl ? (
          <a
            href={source.loginUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-primary hover:underline"
          >
            Open {source.upstream.split(",")[0]} ↗
          </a>
        ) : null}
        {source.loginUrlEnv ? (
          <span className="font-mono text-[10px] text-muted-foreground">{source.loginUrlEnv}</span>
        ) : null}
        <Link href={`/?service=${service}`} className="ml-auto text-muted-foreground hover:text-foreground">
          {SERVICES[service].label} tab →
        </Link>
      </div>

      {error ? <p className="text-[11px] text-danger">This service&apos;s rows could not be read: {error}</p> : null}
    </article>
  );
}

/**
 * The routes that bring data in, with the schedule HALO can prove behind each.
 *
 * An unproven schedule says so — but ONCE. `load-model/crons.ts` holds only the
 * rules read off the AWS console, and only those that can send a message, so an
 * ingestion-only service has nothing proven for any of its routes. Repeating
 * the caveat on each of WBGT's five reads as five separate problems rather than
 * one known gap, and buries the route names it is attached to.
 *
 * Inventing the missing ones from the service READMEs was the alternative and
 * is worse: WBGT's contradicts the console about its own hourly rule, so the
 * page would hand someone mid-incident a confident wrong schedule.
 */
function InboundRoutes({ service, routes }: { service: ServiceKey; routes: string[] }) {
  const resolved = routes.map((route) => ({ route, rules: rulesForRoute(service, route) }));
  const anyProven = resolved.some((entry) => entry.rules.length > 0);

  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Brought in by
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {resolved.map(({ route, rules }) => (
          <li key={route} className="leading-snug">
            <span className="font-mono text-[10px] text-primary/80">{route}</span>
            {rules.map((rule) => (
              <span key={rule.name} className="ml-1.5 text-[10px] text-muted-foreground">
                · {describeHours(rule.hours)} SGT <span className="font-mono opacity-70">{rule.utc}</span>
              </span>
            ))}
            {/* Only where its siblings DO carry one, so the odd one out is
                marked rather than the whole list being captioned twice. */}
            {!rules.length && anyProven ? (
              <span className="ml-1.5 text-[10px] italic text-muted-foreground/70">· schedule not mirrored</span>
            ) : null}
          </li>
        ))}
      </ul>
      {!anyProven ? (
        <p className="mt-1 text-[10px] italic leading-snug text-muted-foreground/70">
          schedule not mirrored in HALO — these are driven from the EventBridge console, and HALO only
          mirrors the rules that send a message
        </p>
      ) : null}
    </div>
  );
}

/** "every hour", or the list, so a 24-entry array does not fill the card. */
function describeHours(hours: readonly number[]): string {
  if (hours.length >= 24) return "every hour";
  if (!hours.length) return "no weekday run";
  return hours.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(", ");
}

/**
 * Which portal each project is actually read from.
 *
 * Grouped by profile rather than listed per project, because the useful shape
 * is "these six sites are on Geoscan" — a flat alphabetical list of thirty-two
 * rows makes the reader do the grouping themselves, and the grouping is the
 * answer.
 */
function PerProjectTable({ service, rows, error }: {
  service: "noise" | "wbgt";
  rows: ProjectConfigRow[];
  error?: string;
}) {
  const profiles = profilesFor(service)!;
  const byProfile = new Map<string, { codes: string[]; profile: SourceProfile | null }>();

  for (const row of rows) {
    const key = normalizeSourceType(row.source_type);
    const entry = byProfile.get(key) ?? { codes: [], profile: sourceProfileFor(service, row) };
    entry.codes.push(String(row.project_code ?? "—"));
    byProfile.set(key, entry);
  }

  // Largest group first: on a page read in a hurry, "24 projects are on the
  // default sign-in" is the fact that frames every other row.
  const groups = [...byProfile.entries()].sort((a, b) => b[1].codes.length - a[1].codes.length);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
        <ServiceTag service={service} />
        <span>Per-project sources</span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {rows.length} project{rows.length === 1 ? "" : "s"} · set by <code className="font-mono">source_type</code>
        </span>
      </h2>

      {error ? (
        <p className="mt-2 text-[12px] text-danger">Rows could not be read: {error}</p>
      ) : !rows.length ? (
        <p className="mt-2 text-[12px] text-muted-foreground">No projects configured.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Source</th>
                <th className="py-1.5 pr-3 font-medium">Sign in at</th>
                <th className="py-1.5 pr-3 font-medium">Credentials</th>
                <th className="py-1.5 font-medium">Projects</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([key, { codes, profile }]) => (
                <tr key={key} className="border-b border-border/50 align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{profile?.label ?? key}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">source_type = {key}</div>
                    {profile?.workerMode ? (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {profile.workerMode === "dedicated"
                          ? "scrapes alone"
                          : profile.workerMode === "single"
                            ? "one browser at a time"
                            : "shares the browser pool"}
                      </div>
                    ) : null}
                    {profile?.note ? (
                      <div className="mt-0.5 max-w-xs text-[10px] leading-snug text-muted-foreground">{profile.note}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    {profile ? (
                      <a
                        href={profile.loginUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary hover:underline"
                      >
                        {profile.upstream} ↗
                      </a>
                    ) : (
                      // A stored value with no adapter. The service throws on
                      // it, so this is a real fault and is worth looking loud.
                      <span className="text-danger">
                        No adapter for this value — the service refuses these projects.
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {profile ? (
                      <div className="flex flex-col gap-0.5">
                        {profile.credentialEnv.map((name) => (
                          <span key={name} className="font-mono text-[10px] text-muted-foreground">
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {codes.sort().map((code) => (
                        <span key={code} className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">
                          {code}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2.5 text-[11px] text-muted-foreground">
        Every profile listed above is offered in the {SERVICES[service].label} editor&apos;s{" "}
        <code className="font-mono">source_type</code> field. Changing it moves that project to a different
        portal and a different sign-in — it is not a label.
      </p>
    </section>
  );
}
