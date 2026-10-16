/**
 * One status vocabulary, three colours, and a rule rather than a list.
 *
 * Every service already records what each run did, in its own words:
 * `completed`, `skipped_outside_project_cadence_window`,
 * `failed_config_validation`, `suppressed_all_clear`, and two dozen more. The
 * column is plain `text` with no CHECK on any service, so HALO can never hold
 * the whole set — a new status appears the moment someone writes one, and a
 * lookup table would classify it as "missing" and show the project as having no
 * health at all.
 *
 * So the mapping is derived from the NAME, with a short list of exceptions
 * where the name lies. A service that follows the convention gets correct
 * colours without HALO being told anything:
 *
 *   completed…      the run did its job                        green
 *   skipped…        the run was not due                        green
 *   suppressed…     the run chose not to send, correctly       green
 *   completed_with… it ran and sent, but something was missing orange
 *   failed…         it did not do its job                      red
 *
 * The three colours are the ones an operator asked for, and they mean:
 *
 *   green   expected behaviour, including deliberately doing nothing
 *   orange  it worked, but a value was missing or something non-critical broke
 *   red     it did not run, did not send, or ended unsuccessfully
 *
 * **An unrecognised status is orange, never green.** Green would hide a status
 * nobody has classified yet, which is the one case where silence is most likely
 * to be wrong; red would cry wolf on every harmless addition upstream. Orange
 * says "look at this" without claiming to know what it is, and the UI names the
 * raw status so the reader can judge.
 */

export type HealthColour = "green" | "orange" | "red";

/**
 * Statuses whose name does not predict their colour.
 *
 * Each is here because the prefix rule would get it wrong, and each says why.
 * Keep it short: a long exception list means the convention is not being
 * followed, and the fix is in the service's naming, not here.
 */
const EXCEPTIONS: Record<string, { colour: HealthColour; because: string }> = {
  // `skipped…` normally means "not due", which is expected. These two are a
  // configuration gap wearing a skip's name: the run WAS due and could not
  // proceed, which is exactly the "missing value" case.
  skipped_google_sheet_not_configured: {
    colour: "orange",
    because: "the run was due and could not proceed — a sheet is missing, not a cadence",
  },
  skipped_unsupported_invocation_minute: {
    colour: "orange",
    because: "the scheduler invoked a minute the job does not handle, which is a wiring mistake rather than a quiet hour",
  },
  // `suppressed…` normally means a correct decision not to send. This one
  // suppressed because there was nothing to send, which is the data being
  // absent rather than the service deciding.
  suppressed_all_unavailable: {
    colour: "orange",
    because: "nothing was sent because no reading was available — absence of data, not a decision",
  },
  suppressed_all_unavailable_with_errors: {
    colour: "orange",
    because: "as above, and the run also recorded errors",
  },
};

/**
 * Prefix rules, in order. The first match decides.
 *
 * `completed_with_` is checked before `completed`, because the longer name is
 * the more specific claim: a run that completed WITH issues is not a run that
 * completed.
 */
const PREFIXES: { prefix: string; colour: HealthColour }[] = [
  { prefix: "completed_with_", colour: "orange" },
  { prefix: "completed", colour: "green" },
  { prefix: "skipped", colour: "green" },
  { prefix: "suppressed", colour: "green" },
  { prefix: "failed", colour: "red" },
  // In flight. Not a failure by itself — a run that has been `running` for
  // longer than its cadence is caught by staleness, which is a question about
  // time rather than about this word.
  { prefix: "running", colour: "green" },
];

export type Classification = {
  colour: HealthColour;
  /** The status as the service wrote it, never rewritten. */
  status: string;
  /** How the colour was decided, for the UI to explain itself. */
  basis: "exception" | "prefix" | "unrecognised";
  because?: string;
};

export function classifyRunStatus(status: unknown): Classification {
  const raw = String(status ?? "").trim().toLowerCase();
  if (!raw) {
    return {
      colour: "orange",
      status: "",
      basis: "unrecognised",
      because: "the run recorded no status at all",
    };
  }

  const exception = EXCEPTIONS[raw];
  if (exception) return { colour: exception.colour, status: raw, basis: "exception", because: exception.because };

  for (const { prefix, colour } of PREFIXES) {
    if (raw.startsWith(prefix)) return { colour, status: raw, basis: "prefix", because: `starts with "${prefix}"` };
  }

  return {
    colour: "orange",
    status: raw,
    basis: "unrecognised",
    because: "no rule covers this status yet — it is shown so it can be classified, not hidden",
  };
}

/** The worst of several colours, for rolling a project's cadences into one pill. */
export function worstColour(colours: HealthColour[]): HealthColour {
  if (colours.includes("red")) return "red";
  if (colours.includes("orange")) return "orange";
  return "green";
}

/**
 * Whether a run's own words say it was never meant to act.
 *
 * Separate from the colour, because "green" covers two different things that a
 * reader needs told apart: a report that went out, and an hour where none was
 * due. Both are correct; only one is evidence that the pipeline works.
 */
export function isIdleStatus(status: unknown): boolean {
  const raw = String(status ?? "").trim().toLowerCase();
  return raw.startsWith("skipped") && !EXCEPTIONS[raw];
}
