import Link from "next/link";

import { ServiceTag } from "./ServiceTag";
import { dataHealthDetail, healthKey, type ProjectHealth } from "@/lib/data-health";
import {
  SERVICE_SOURCES,
  SERVICE_STORAGE,
  EXPECTATION_NOTE,
  readingExpectation,
  readingsTableFor,
  storesReadings,
  type ReadingExpectation,
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
export function DeveloperGuide({ rows, errors, health }: {
  rows: Partial<Record<ServiceKey, ProjectConfigRow[]>>;
  errors: Partial<Record<ServiceKey, string>>;
  /** Ingestion health per project, from the shared data-health reader. */
  health: Map<string, ProjectHealth>;
}) {
  return (
    // Narrower gutter than the sibling pages: this one is a wide reference
    // table read across, and every pixel of gutter is a project code that wraps.
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-2 py-4 md:px-3">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <h1 className="text-2xl font-semibold">Where the readings come from</h1>
        <Link href="/" className="rounded-lg border border-border bg-card px-3 py-1 text-sm hover:border-primary">
          ← Dashboard
        </Link>
      </header>

      {/* The per-project tables lead. They are the half nobody can derive from
          a repository and the reason someone opens this page; the seven service
          cards are reference material underneath them. */}
      {(["noise", "wbgt"] as const).map((service) => (
        <PerProjectTable
          key={service}
          service={service}
          rows={rows[service] ?? []}
          error={errors[service]}
          health={health}
        />
      ))}

      <section className="grid gap-3 md:grid-cols-2">
        {SERVICE_KEYS.map((service) => (
          <ServiceSourceCard key={service} service={service} error={errors[service]} />
        ))}
      </section>
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
        <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {TRANSPORT_LABEL[source.transport]}
        </span>
      </h2>

      <p className="text-sm leading-snug">{source.how}</p>

      <Pipeline service={service} />

      {/* The half that is actually useful mid-incident, and the half a README
          never says: not "what is this" but "what have I lost". */}
      <div className="rounded-lg border border-warn/40 bg-warn/10 p-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-warn">When it is down</div>
        <p className="mt-0.5 text-[13px] leading-snug">{source.breaks}</p>
      </div>

      {source.inbound.length ? <InboundRoutes service={service} routes={source.inbound} /> : null}

      <DebugOrder service={service} />

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs">
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
          <span className="font-mono text-[11px] text-muted-foreground">{source.loginUrlEnv}</span>
        ) : null}
        <Link href={`/?service=${service}`} className="ml-auto text-muted-foreground hover:text-foreground">
          {SERVICES[service].label} tab →
        </Link>
      </div>

      {error ? <p className="text-xs text-danger">This service&apos;s rows could not be read: {error}</p> : null}
    </article>
  );
}

/**
 * Source → store → reader → out, in one line.
 *
 * The correction this page needed. "Browserbase scrape" on its own reads as
 * though the message job calls Browserbase; it does not. A scrape writes into
 * the project's own table and the cadence jobs read THAT — so a missing message
 * is a question about the table before it is a question about the scraper.
 *
 * Drawn only where there is a store to draw. Haze and lightning compute from
 * the API on each run and keep no readings, and a diagram implying otherwise
 * would send someone looking for a table that was never created.
 */
function Pipeline({ service }: { service: ServiceKey }) {
  const storage = SERVICE_STORAGE[service];
  const source = SERVICE_SOURCES[service];

  if (!storage.readingsTable) {
    // Why there is no table differs, and saying the wrong one misdirects. Haze
    // and lightning genuinely compute and discard; the sheet-backed services
    // have a store that simply is not ours; ailytics fetches nothing at all.
    const reason =
      source.transport === "sheets"
        ? "The workbook is the store, and it is not ours — open the sheet, not Supabase."
        : source.transport === "inbound"
          ? "Nothing is fetched, so there is no ingestion to inspect — events arrive or they do not."
          : "Computed at run time and not stored, so there is no table to inspect.";
    return (
      <p className="rounded-lg border border-border bg-muted/20 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
        {reason}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-border bg-muted/20 px-2.5 py-1.5 text-[11px]">
      <span>{source.upstream.split(" ·")[0]}</span>
      <span className="text-muted-foreground">→</span>
      {/* The stage that was missing, and the one to check first. */}
      <span className="font-mono text-primary">{storage.schema}.{storage.readingsTable}</span>
      <span className="text-muted-foreground">→</span>
      <span>cadence job</span>
      <span className="text-muted-foreground">→</span>
      <span>WhatsApp</span>
    </div>
  );
}

/**
 * What to check, in order, when a message did not arrive.
 *
 * Numbered because the order is the content: checking the scraper first is the
 * mistake this page exists to prevent, and a list of things to look at does not
 * say which to look at first.
 */
function DebugOrder({ service }: { service: ServiceKey }) {
  const storage = SERVICE_STORAGE[service];

  return (
    <details className="rounded-lg border border-border bg-muted/10 px-2.5 py-1.5">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Nothing arrived — check in this order
      </summary>
      <ol className="mt-1.5 flex list-decimal flex-col gap-1 pl-4 text-[12px] leading-snug">
        {storage.debugOrder.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {storage.supporting.length ? (
        <div className="mt-2 border-t border-border/60 pt-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tables worth opening
          </div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {storage.supporting.map((entry) => (
              <li key={entry.table} className="text-[11px] leading-snug">
                <span className="font-mono text-primary/80">{entry.table}</span>
                <span className="text-muted-foreground"> — {entry.holds}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
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
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Brought in by
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {resolved.map(({ route, rules }) => (
          <li key={route} className="leading-snug">
            <span className="font-mono text-[11px] text-primary/80">{route}</span>
            {rules.map((rule) => (
              <span key={rule.name} className="ml-1.5 text-[11px] text-muted-foreground">
                · {describeHours(rule.hours)} SGT <span className="font-mono opacity-70">{rule.utc}</span>
              </span>
            ))}
            {/* Only where its siblings DO carry one, so the odd one out is
                marked rather than the whole list being captioned twice. */}
            {!rules.length && anyProven ? (
              <span className="ml-1.5 text-[11px] italic text-muted-foreground/70">· schedule not mirrored</span>
            ) : null}
          </li>
        ))}
      </ul>
      {!anyProven ? (
        <p className="mt-1 text-[11px] italic leading-snug text-muted-foreground/70">
          schedule not mirrored in HALO — these are driven from the EventBridge console, and HALO only
          mirrors the rules that send a message
        </p>
      ) : null}
    </div>
  );
}

/**
 * A project code with the age of its newest reading under it.
 *
 * The whole point of the live query. A code alone says a project exists; a code
 * that last wrote nineteen hours ago says which project to look at, without
 * anyone needing to know to go looking.
 *
 * Coloured by age rather than by a threshold anyone has to remember: both
 * services write at least hourly when healthy, so an hour is normal, a few
 * hours is worth a glance, and a day is the answer.
 */
function ProjectChip({ code, health, expectation }: {
  code: string;
  health?: ProjectHealth;
  expectation: ReadingExpectation;
}) {
  const note = EXPECTATION_NOTE[expectation];

  /**
   * The verdict is the shared reader's; the one correction is dormancy.
   *
   * `assessIngestionHealth` judges a table purely on age, which is right for a
   * project something is asking readings of and wrong for one nothing is.
   * Noise scraping is demand-driven: with every cadence off, no demand is
   * created, the table is correctly stale forever, and the reader calls it
   * danger. Seven live noise projects are in that state.
   *
   * Measured at 18:29 on an ordinary working day, the shared budgets — warn at
   * one hour, critical at four — put 19 of 32 noise projects in danger, seven
   * of them dormant and the rest simply outside their cadence window. A column
   * that is mostly red is a column nobody reads, so this view says `idle` for
   * the ones nothing asks of, and leaves the rest exactly as the reader found
   * them.
   *
   * Deliberately a view-level overlay rather than a change to
   * `assessIngestionHealth`: the budgets are someone else's calibration to
   * revisit, and quietly rewriting them here would leave the board and this
   * page disagreeing about the same project.
   */
  const tone =
    expectation !== "demanded"
      ? "border-border opacity-60"
      : health?.tone === "danger"
        ? "border-danger/50 text-danger"
        : health?.tone === "warn"
          ? "border-warn/50 text-warn"
          : "border-border";

  return (
    <span
      className={`flex flex-col rounded border bg-muted/20 px-2 py-1 leading-tight ${tone}`}
      title={[dataHealthDetail(health), note].filter(Boolean).join(" · ")}
    >
      <span className="font-mono text-[13px]">{code}</span>
      <span className="text-[10px] opacity-80">{note ? "idle" : describeAge(health)}</span>
    </span>
  );
}

/** Age in the coarsest unit that is still true. */
function describeAge(health?: ProjectHealth): string {
  const at = health?.newestReceivedAt;
  if (!at) return health?.tone === "danger" ? "no data" : "—";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
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
function PerProjectTable({ service, rows, error, health }: {
  service: "noise" | "wbgt";
  rows: ProjectConfigRow[];
  error?: string;
  health: Map<string, ProjectHealth>;
}) {
  const expectation = new Map(
    rows.map((row) => [String(row.project_code ?? ""), readingExpectation(row)] as const),
  );
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
        <span className="text-xs font-normal text-muted-foreground">
          {rows.length} project{rows.length === 1 ? "" : "s"} · set by <code className="font-mono">source_type</code>
        </span>
      </h2>

      {error ? (
        <p className="mt-2 text-[13px] text-danger">Rows could not be read: {error}</p>
      ) : !rows.length ? (
        <p className="mt-2 text-[13px] text-muted-foreground">No projects configured.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="w-[300px] py-1.5 pr-4 font-medium">Source</th>
                <th className="whitespace-nowrap py-1.5 pr-4 font-medium">Sign in at</th>
                <th className="py-1.5 pr-3 font-medium">Credentials</th>
                <th className="py-1.5 font-medium">Projects</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([key, { codes, profile }]) => (
                <tr key={key} className="border-b border-border/50 align-top">
                  <td className="w-[300px] py-2 pr-4 align-top">
                    <div className="font-medium">{profile?.label ?? key}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">source_type = {key}</div>
                    {profile?.workerMode ? (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {profile.workerMode === "dedicated"
                          ? "scrapes alone"
                          : profile.workerMode === "single"
                            ? "one browser at a time"
                            : "shares the browser pool"}
                      </div>
                    ) : null}
                    {profile?.note ? (
                      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{profile.note}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 align-top">
                    {profile ? (
                      <a
                        href={profile.loginUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="whitespace-nowrap text-primary hover:underline"
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
                  <td className="py-2 pr-4 align-top">
                    {profile ? (
                      <div className="flex flex-col gap-0.5">
                        {profile.credentialEnv.map((name) => (
                          <span key={name} className="font-mono text-[11px] text-muted-foreground">
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {codes.sort().map((code) => (
                        <ProjectChip
                          key={code}
                          code={code}
                          health={health.get(healthKey(service, code))}
                          expectation={expectation.get(code) ?? "demanded"}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2.5 text-xs text-muted-foreground">
        Each code shows when its own readings table was last written to — the first thing to check when a
        message is missing, because the cadence jobs read the table, never the portal. A code marked{" "}
        <span className="opacity-60">idle</span> has no cadence switched on, so nothing asks it for readings.
        A gap of a few hours is normal outside a project&apos;s cadence window — scraping is demand-driven —
        so only a full day is marked. For the reason behind any gap, read{" "}
        <span className="font-mono">{SERVICE_STORAGE[service].supporting[0]?.table}</span>. Every profile
        above is offered in the {SERVICES[service].label} editor&apos;s{" "}
        <code className="font-mono">source_type</code> field. Changing it moves that project to a different
        portal and a different sign-in — it is not a label.
      </p>
    </section>
  );
}
