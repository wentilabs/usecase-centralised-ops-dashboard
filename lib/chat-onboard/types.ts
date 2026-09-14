import type { RowCondition } from "../chat-scope";
import type { ServiceKey } from "../services";

export type OnboardIntent = {
  /** Services to create rows IN. */
  targets: ServiceKey[];
  /**
   * Which sites, as composable filters rather than three fixed shapes.
   *
   * `include` is AND-ed and `exclude` wins. "All Wohhup sites that are also
   * already in Noise" is an intersection, and it was the first thing anyone
   * asked for — an OR-only list could not express it at all, and the model
   * correctly refused rather than quietly widening the request.
   *
   * A union is still available, explicitly: `{kind:"any", of:[...]}`. An empty
   * `include` means every site.
   *
   * `codes` is where a NEW project comes from. A code matched against the
   * estate SELECTS that site; a code that matches nothing is a site nobody has
   * configured yet, and an include filter naming one asks for it to be created.
   * That is the only way the model can name a code that becomes a row, and it
   * is deliberate — the alternative was a dashboard that could onboard a site
   * into its second service but never its first.
   *
   * An invented code therefore proposes an invented project. It cannot write
   * one: the plan is a review list, every new code is marked as new, and the
   * service's own `codePattern` and uniqueness check run before the insert.
   */
  scope: { include: SiteFilter[]; exclude: SiteFilter[] };
  /** Column → value, for switches the target offers at creation. */
  switches: Record<string, boolean>;
  /**
   * Literal values for any column the target's onboarding flow carries.
   *
   * The general case the switch map could not express: "set the outbound group
   * to X", "timezone Asia/Singapore". An explicit value beats a carried one,
   * because an instruction is more specific than an equivalence.
   */
  values: Record<string, string>;
  /**
   * Values used ONLY where the column is still empty after everything else.
   *
   * "If no applicable WBGT manpower workbook is configured, use X" is this, and
   * it is a different thing from `values`: it must not overwrite the workbook
   * that was carried for the seventeen sites that have one.
   */
  fallbacks: Record<string, string>;
  /**
   * Columns to fill from another service's row for the same site.
   *
   * Any pair the model asks for is honoured, not only the ones this file
   * declares. `declared` says which — an undeclared copy is shown in the
   * review list as unverified rather than refused, because the operator knows
   * the sites and the preview is where a wrong document gets caught. Refusing
   * it outright only meant the request silently did less than it said.
   */
  carry: { column: string; from: ServiceKey; fromColumn: string; declared: boolean }[];
  /**
   * An existing row to start every draft from — "the same configuration as X".
   *
   * `carry` copies one column from the same SITE in another service, which
   * cannot say this: the sentence names a different site, usually in the same
   * service, and means all of its columns rather than one. Both exist because
   * they answer different questions — "where does this site's workbook id
   * live" and "what does a project of this kind look like".
   *
   * Every creatable column is copied and every copy is listed in the review,
   * because a template carries chat ids and sheet ids, and pointing a new
   * project at another project's WhatsApp group is exactly the mistake the
   * review list is there to catch. `values` and `switches` still win over it:
   * an instruction is more specific than a template.
   */
  template?: { service: ServiceKey; projectCode: string } | null;
  /**
   * A site's street address, to be looked up rather than typed.
   *
   * Haze and lightning both require latitude and longitude, and haze requires
   * an NEA region derived from them. A request that supplies the address —
   * which is what an operator has — used to produce nothing but a list of
   * required fields, because the model has no field for an address and cannot
   * geocode. It went in `notes` and the plan created zero rows.
   *
   * So the model names the address and code resolves it: OneMap for the
   * coordinates, the haze repo's own rule for the region. The resolved address
   * and every value it produced appear in the review list, which is where a
   * wrong match is caught — a plausible-looking address in the wrong country
   * is exactly what a service-area check is for.
   */
  addresses?: { code: string; address: string }[];
  /** Groups looked up by name, `<site>` standing for any of the site's codes. */
  groupPatterns: { column: string; pattern: string }[];
  /** Anything recognised in the sentence that this shape cannot express. */
  notes: string[];
};

export type SiteFilter =
  | { kind: "company"; company: string }
  | { kind: "in-service"; service: ServiceKey }
  | { kind: "codes"; codes: string[] }
  /**
   * A condition on the site's row in one service — "whose noise config is
   * disabled", "with no delivery group in WBGT".
   *
   * The bulk path could already select on a row's values and this could not,
   * which was an asymmetry with no reason behind it: the same question is
   * asked of the same rows, and only the verb differed.
   */
  | {
      kind: "where";
      service: ServiceKey;
      column: string;
      op: RowCondition["op"];
      value?: unknown;
    }
  /** Matches when ANY of its members match. Nests, so filters compose freely. */
  | { kind: "any"; of: SiteFilter[] };

export type OnboardRow = {
  /** The canonical site code from the identity map — what gets created. */
  projectCode: string;
  /** Values the plan can supply without asking anyone. */
  values: Record<string, string>;
  /** What this site is already called elsewhere, so the reviewer can tell. */
  knownAs: { service: ServiceKey; projectCode: string }[];
  /**
   * This code is in no service at all — the request is creating the site, not
   * extending it. Shown, because it is the difference between onboarding a
   * known site and acting on a typo, and only a human can tell which.
   */
  isNew?: boolean;
  /**
   * Why this row cannot be created as it stands, in `validateDraft`'s own
   * words — the same validator the onboarding dialog and the insert route use,
   * so the reviewer sees exactly what a save would have said.
   */
  problems: string[];
  /**
   * Values taken from another service's row for the same site, and why. Shown
   * in the review list: a derived workbook id is the one value an operator
   * most needs to check before it is written.
   */
  derived: { column: string; from: string; value: string; why: string }[];
};

export type ServicePlan = {
  service: ServiceKey;
  label: string;
  /** Rows that can be created as they stand. */
  ready: OnboardRow[];
  /** Rows short a required field. Listed, never silently dropped. */
  blocked: OnboardRow[];
  /** Sites already present under some code, and which one. */
  alreadyThere: { projectCode: string; existingAs: string }[];
};

export type OnboardPlan =
  | {
      kind: "plan";
      company: string | null;
      summary: string;
      services: ServicePlan[];
      /**
       * Parts of the request that were recognised but not applied. Shown, never
       * swallowed: silently defaulting a switch that starts or silences a daily
       * message to a site is not a reasonable thing to do quietly.
       */
      unread: string[];
    }
  | { kind: "question"; question: string };

