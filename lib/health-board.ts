import { isIdleStatus, worstColour, type HealthColour } from "./health-status";
import { contractHealthGranularity } from "./service-contracts";
import { healthKey, type ProjectHealth } from "./data-health";
import type { Bar } from "./health-timeline";
import { SERVICE_KEYS, type ServiceKey } from "./services";

/**
 * What the estate looks like right now, for a reader who has not chosen a tab.
 *
 * The dashboard carries 196 project cards across seven tabs, and before this
 * every one of them wore a green pill. Nearly two hundred green pills is
 * wallpaper: the eye has nothing to catch on, and the single red one has the
 * same visual weight as its thirty healthy neighbours. Worse, a problem in
 * Subcon was invisible while looking at Noise, because nothing in the interface
 * spoke for more than one service at a time.
 *
 * So the unit here is the EXCEPTION. Healthy and idle are counted and then
 * collapsed; what is listed is what somebody has to do something about.
 */

export type BoardEntry = {
  service: ServiceKey;
  projectCode: string;
  /**
   * Which question this entry answers.
   *
   * Kept apart rather than merged into one verdict per project, because they
   * fail differently and point at different people: a stale readings table is
   * the vendor or the scraper, a failed send is the listener or the group. A
   * project may appear once for each, which is honest — they are two problems.
   */
  signal: "ingestion" | "delivery" | "run" | "config";
  colour: HealthColour;
  /** Short for green, the service's own words for amber and red. */
  label: string;
  /** The raw status or receipt line, for the row's second column. */
  detail: string | null;
  /** Expected behaviour, but nothing ran — shown quietly, never as a success. */
  idle: boolean;
  /**
   * `service` when this is about the whole service and not one project: the Lightning tick or the NEA
   * feed. The code is then a name, not a project, so it must not offer to open an editor.
   */
  scope?: "service";
};

/**
 * Whether HALO can currently say anything about this service.
 *
 * Deliberately about what HALO can READ, not only what the service declares.
 * Every service now declares `delivery: project` in its contract, so asking the
 * contract alone returns true for all seven — while HALO has no delivery reader
 * yet and can in fact speak for only the two that store readings. Answering
 * from the declaration would make the "not covered" note never fire, which is
 * the more flattering answer and the wrong one.
 *
 * `signalsFor` keeps the contract's own words for the EXPLANATION, so the note
 * can say which signals a service reports once something reads them.
 */
export function signalsFor(service: ServiceKey): string[] {
  return (["ingestion", "run", "delivery"] as const).filter(
    (signal) => contractHealthGranularity(service, signal) !== "none",
  );
}

/** `ProjectHealth`'s five tones, onto the four colours the UI has. */
export function colourOfTone(tone: ProjectHealth["tone"]): HealthColour {
  if (tone === "danger") return "red";
  if (tone === "warn") return "amber";
  if (tone === "stale") return "stale";
  // `neutral` covers idle and "no receipt timestamp" — expected, not a fault.
  return "green";
}

/**
 * One entry per project that HALO can say anything about.
 *
 * A project with no health reading at all is omitted rather than invented: the
 * strip counts what is wrong, and a project nobody measured is neither wrong
 * nor right. Coverage is reported separately, so "not covered" is visible as
 * its own fact instead of hiding inside a green count.
 */
export function boardEntries(
  rowsByService: Partial<Record<ServiceKey, { project_code?: unknown }[]>>,
  health: Map<string, ProjectHealth>,
): BoardEntry[] {
  const entries: BoardEntry[] = [];
  for (const service of SERVICE_KEYS) {
    for (const row of rowsByService[service] ?? []) {
      const projectCode = String(row.project_code ?? "").trim();
      if (!projectCode) continue;
      // `healthKey`, never a hand-built string: it is JSON.stringify([service,
      // code]), and a `service:code` guess missed every lookup silently — the
      // strip read "idle" for a healthy estate rather than failing.
      const found = health.get(healthKey(service, projectCode));
      if (!found) continue;

      const colour = colourOfTone(found.tone);
      // The label strips the "Data: " prefix the reader does not need twice —
      // the section already says what it is about.
      const label = found.label.replace(/^Data:\s*/i, "");
      entries.push({
        service,
        projectCode,
        signal: "ingestion",
        colour,
        label,
        detail: found.newestReceivedAt,
        idle: /idle/i.test(found.label) || isIdleStatus(found.label),
      });
    }
  }
  return entries;
}

/**
 * The board's delivery entries, taken from the strips already on the page.
 *
 * There used to be a second reader for this — one query per ledger for the
 * newest row per project, run on the server for every page load, beside the
 * query that built the strips from the same tables. The newest bar of a strip
 * IS the newest verdict, so the second read was the same answer fetched twice:
 * a blocking round trip per service, and two surfaces that could disagree with
 * each other about the same project.
 *
 * Only the DELIVERY services. Noise and WBGT contribute run bars, and their
 * ingestion is already reported from the readings-age check in `boardEntries` —
 * taking their newest run bar as well would count the same project twice and
 * label a run as a delivery.
 */
export function deliveryEntries(
  strips: Record<string, Bar[]>,
  /** Which signal a service's newest bar reports under, or null to keep it off the board. */
  signalFor: (service: ServiceKey) => "delivery" | "run" | null,
): BoardEntry[] {
  const entries: BoardEntry[] = [];
  for (const [key, bars] of Object.entries(strips)) {
    if (!bars.length) continue;
    const [service, projectCode] = parseHealthKey(key);
    const signal = service ? signalFor(service) : null;
    if (!service || !projectCode || !signal) continue;

    const newest = bars[bars.length - 1];
    entries.push({
      service,
      projectCode,
      signal,
      colour: newest.colour,
      // The service's own word. A reader's next move is to search the logs for
      // this exact string, so rewording it would cost them the search.
      label: newest.status,
      detail: newest.at || null,
      // A delivery that was not due is a skip the service already named; nothing
      // here is inferred to be idle.
      idle: false,
    });
  }
  return entries;
}

/**
 * `healthKey`'s inverse. Parsed rather than split on a separator, because the
 * key is `JSON.stringify([service, code])` and a project code may contain
 * anything — a hand-rolled `service:code` split has already cost one silent
 * lookup failure in this file's history.
 */
function parseHealthKey(key: string): [ServiceKey | null, string] {
  try {
    const parsed = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 2) return [null, ""];
    return [String(parsed[0]) as ServiceKey, String(parsed[1])];
  } catch {
    return [null, ""];
  }
}

/**
 * Standing faults, as board entries.
 *
 * Always red. A standing fault is current state, not an event to age out of a
 * strip. Its own words are the label, so the reader can grep for them. The
 * signal follows the source: a rejected Lightning configuration is `config`,
 * while an Ailytics listener queue fault is `delivery`.
 */
export function faultEntries(faults: Record<string, string>): BoardEntry[] {
  const entries: BoardEntry[] = [];
  for (const [key, message] of Object.entries(faults)) {
    const [service, projectCode] = parseHealthKey(key);
    if (!service || !projectCode || !message) continue;
    entries.push({
      service,
      projectCode,
      signal: service === "ailytics" ? "delivery" : "config",
      colour: "red",
      label: message,
      // No instant to report: the state is current, not an event.
      detail: null,
      idle: false,
    });
  }
  return entries;
}

/**
 * Whole-service findings as board entries.
 *
 * The Lightning tick and the NEA feed are not any one project's, so they carry a name where a project
 * code would be and `scope: "service"`. `signal` says which question they answer: the tick is "did it
 * run", the feed is ingestion.
 */
export function noticeEntries(notices: { id: "tick" | "feed"; colour: HealthColour; label: string; detail: string | null }[]): BoardEntry[] {
  return notices.map((notice) => ({
    service: "lightning" as const,
    projectCode: notice.id === "tick" ? "tick" : "NEA feed",
    signal: notice.id === "tick" ? ("run" as const) : ("ingestion" as const),
    colour: notice.colour,
    label: notice.label,
    detail: notice.detail,
    idle: false,
    scope: "service" as const,
  }));
}

export type BoardSummary = {
  red: number;
  amber: number;
  /**
   * Late readings: the sensor or its feed, with the service working. Counted and
   * listed, but never part of `exceptions` or `incidents`, which are what needs
   * acting on — a late reading is worth knowing and not worth interrupting for.
   */
  stale: number;
  green: number;
  idle: number;
  /** Services declaring no signal at all — reported, never coloured green. */
  uncovered: ServiceKey[];
  /** Only what needs acting on, worst first. */
  exceptions: BoardEntry[];
  /** The same exceptions, with one row per distinct failure. */
  incidents: Incident[];
  /** The late readings, grouped the same way, for the calm section of the board. */
  late: Incident[];
};

export function summarise(entries: BoardEntry[]): BoardSummary {
  const actionable = entries.filter((entry) => entry.colour === "red" || entry.colour === "amber");
  const exceptions = actionable
    // Red before amber, then by service and code so the order is stable between
    // renders — a list that reshuffles is a list nobody trusts.
    .sort((a, b) => {
      if (a.colour !== b.colour) return a.colour === "red" ? -1 : 1;
      return `${a.service}${a.projectCode}${a.signal}`.localeCompare(`${b.service}${b.projectCode}${b.signal}`);
    });

  return {
    red: entries.filter((entry) => entry.colour === "red").length,
    amber: entries.filter((entry) => entry.colour === "amber").length,
    stale: entries.filter((entry) => entry.colour === "stale").length,
    green: entries.filter((entry) => entry.colour === "green" && !entry.idle).length,
    idle: entries.filter((entry) => entry.idle).length,
    // Services HALO produced no reading for at all. Literal rather than
    // inferred: a service with no entry is one nothing has measured, whatever
    // its contract declares it would report.
    uncovered: SERVICE_KEYS.filter((service) => !entries.some((entry) => entry.service === service)),
    exceptions,
    incidents: incidentsFrom(actionable),
    late: incidentsFrom(entries.filter((entry) => entry.colour === "stale")),
  };
}

/** The one line the strip shows when there is nothing to act on. */
export function summaryLine(summary: BoardSummary): string {
  if (summary.red || summary.amber) {
    return [summary.red ? `${summary.red} red` : null, summary.amber ? `${summary.amber} amber` : null]
      .filter(Boolean)
      .join(" · ");
  }
  // Deliberately not "all healthy": most of the estate is idle for most of the
  // day, and claiming health for a project nothing asked of would be the same
  // overstatement the colours were fixed to avoid.
  // A late reading is a covered project doing its job with a slow sensor, so a board
  // holding only those still has "nothing to action" — not "idle", which would say
  // nothing was running.
  return summary.green || summary.stale ? "nothing to action" : "idle";
}

export type Incident = {
  service: ServiceKey;
  /** Set when every entry in the group is about the whole service, not a project. */
  scope?: "service";
  signal: BoardEntry["signal"];
  colour: HealthColour;
  /** The service's own status word, shared by every project in the group. */
  label: string;
  projects: string[];
  /** Oldest and newest timestamps in the group, for "since when". */
  from: string | null;
  to: string | null;
};

/**
 * The same failure across many projects is one incident, not many problems.
 *
 * Haze posts hourly to every project through one listener. When that listener
 * stopped confirming recipients, the ledger recorded UNCONFIRMED for all 64
 * rows of the 10:00 run — and the board listed thirty-odd identical rows, each
 * saying the same word at the same minute. That is the alarm fatigue this view
 * exists to avoid, reintroduced one layer up: a reader scrolling thirty copies
 * of one sentence learns less than one that says "thirty projects, since 10:00".
 *
 * Grouped on service, signal and the status text, because those three are what
 * make two rows the same event. Time is reported as a range rather than a key,
 * so a run that spans two hours stays one incident instead of splitting.
 */
export function incidentsFrom(entries: BoardEntry[]): Incident[] {
  const groups = new Map<string, Incident>();
  for (const entry of entries) {
    // A project is only ever in a group because something is worth saying about it.
    if (entry.colour === "green") continue;
    const key = `${entry.service}|${entry.signal}|${entry.label}`;
    const existing = groups.get(key);
    if (existing) {
      existing.projects.push(entry.projectCode);
      if (entry.detail) {
        if (!existing.from || entry.detail < existing.from) existing.from = entry.detail;
        if (!existing.to || entry.detail > existing.to) existing.to = entry.detail;
      }
      continue;
    }
    groups.set(key, {
      service: entry.service,
      signal: entry.signal,
      colour: entry.colour,
      label: entry.label,
      projects: [entry.projectCode],
      from: entry.detail,
      to: entry.detail,
      ...(entry.scope ? { scope: entry.scope } : {}),
    });
  }

  return [...groups.values()]
    .map((incident) => ({ ...incident, projects: incident.projects.sort() }))
    // Red first, then the widest blast radius: thirty projects failing one way
    // is more urgent than one project failing another.
    .sort((a, b) => {
      if (a.colour !== b.colour) return a.colour === "red" ? -1 : 1;
      if (a.projects.length !== b.projects.length) return b.projects.length - a.projects.length;
      return `${a.service}${a.signal}`.localeCompare(`${b.service}${b.signal}`);
    });
}
