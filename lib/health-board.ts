import { isIdleStatus, worstColour, type HealthColour } from "./health-status";
import { contractHealthGranularity } from "./service-contracts";
import { healthKey, type ProjectHealth } from "./data-health";
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
  colour: HealthColour;
  /** Short for green, the service's own words for amber and red. */
  label: string;
  /** The raw status or receipt line, for the row's second column. */
  detail: string | null;
  /** Expected behaviour, but nothing ran — shown quietly, never as a success. */
  idle: boolean;
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

/** `ProjectHealth`'s four tones, onto the three colours the UI has. */
export function colourOfTone(tone: ProjectHealth["tone"]): HealthColour {
  if (tone === "danger") return "red";
  if (tone === "warn") return "amber";
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
        colour,
        label,
        detail: found.newestReceivedAt,
        idle: /idle/i.test(found.label) || isIdleStatus(found.label),
      });
    }
  }
  return entries;
}

export type BoardSummary = {
  red: number;
  amber: number;
  green: number;
  idle: number;
  /** Services declaring no signal at all — reported, never coloured green. */
  uncovered: ServiceKey[];
  /** Only what needs acting on, worst first. */
  exceptions: BoardEntry[];
};

export function summarise(entries: BoardEntry[]): BoardSummary {
  const exceptions = entries
    .filter((entry) => entry.colour !== "green")
    // Red before amber, then by service and code so the order is stable between
    // renders — a list that reshuffles is a list nobody trusts.
    .sort((a, b) => {
      if (a.colour !== b.colour) return a.colour === "red" ? -1 : 1;
      return `${a.service}${a.projectCode}`.localeCompare(`${b.service}${b.projectCode}`);
    });

  return {
    red: entries.filter((entry) => entry.colour === "red").length,
    amber: entries.filter((entry) => entry.colour === "amber").length,
    green: entries.filter((entry) => entry.colour === "green" && !entry.idle).length,
    idle: entries.filter((entry) => entry.idle).length,
    // Services HALO produced no reading for at all. Literal rather than
    // inferred: a service with no entry is one nothing has measured, whatever
    // its contract declares it would report.
    uncovered: SERVICE_KEYS.filter((service) => !entries.some((entry) => entry.service === service)),
    exceptions,
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
  return summary.green ? "nothing to action" : "idle";
}
