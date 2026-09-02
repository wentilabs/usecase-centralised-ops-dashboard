import { companyIn } from "./chat-scope";
import { serviceHintsIn } from "./chat-intent";
import {
  onboardingFor,
  prefillDefaults,
  validateDraft,
  type OnboardDefinition,
  type OnboardDraft,
} from "./onboarding";
import { absentFrom, type Cluster } from "./project-identity";
import { SERVICES, type ProjectConfigRow, type ServiceKey } from "./services";

/**
 * Turn "onboard every Wohhup project into issue chaser" into a reviewable list
 * of rows to create.
 *
 * No model is involved, deliberately. Every part of the request is decidable in
 * code: the company from `companyIn`, the target services from
 * `serviceHintsIn`, and which sites are missing from the identity map — so
 * there is no path by which a model could invent a project code that then gets
 * created in a live service. That is the same line `chat-scope` draws for bulk
 * edits, and it matters more here, because an edit to the wrong row is
 * correctable and a created row is a new project someone has to find and delete.
 *
 * The identity map is what makes this safe to offer at all. Asking for "every
 * Wohhup project" by code would create 44 rows for 37 sites, because the estate
 * spells nine of them differently per service — `CFC` in three services and
 * `Clifford Centre` in a fourth. Counting sites rather than codes is the whole
 * difference between this and a duplicate factory.
 *
 * What it will not do is invent the one thing it cannot know. Both target
 * services require a workbook id that exists in no other service, so most rows
 * come back `blocked` with that named. Blocked rows are shown, not hidden: "34
 * of 36 need a Safety workbook id" is the answer to the request, and quietly
 * creating the two that happen to be complete would be worse than saying so.
 */

/** Onboarding words, as against the edit vocabulary the other paths handle. */
const ONBOARD = /\b(onboard(?:ed|ing)?|create|set\s+up|register)\b/i;
const PROJECT_NOUN = /\b(project|projects|site|sites)\b/i;

/**
 * Whether a sentence is asking for projects to be created.
 *
 * "add" is deliberately absent. It is the verb for both "add a project" and
 * "add this group to CFC", and the second is far more common — reading it as
 * onboarding would send ordinary edits down this path. "onboard", "create",
 * "set up" and "register" do not carry that ambiguity.
 */
export function saysOnboard(prompt: string): boolean {
  if (!ONBOARD.test(prompt)) return false;
  // `create` alone is not enough: "create a new group list" is an edit.
  if (/\bonboard(?:ed|ing)?\b/i.test(prompt)) return true;
  return PROJECT_NOUN.test(prompt);
}

export type OnboardRow = {
  /** The canonical site code from the identity map — what gets created. */
  projectCode: string;
  /** Values the plan can supply without asking anyone. */
  values: Record<string, string>;
  /** What this site is already called elsewhere, so the reviewer can tell. */
  knownAs: { service: ServiceKey; projectCode: string }[];
  /**
   * Why this row cannot be created as it stands, in `validateDraft`'s own
   * words — the same validator the onboarding dialog and the insert route use,
   * so the reviewer sees exactly what a save would have said.
   */
  problems: string[];
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
  | { kind: "plan"; company: string | null; summary: string; services: ServicePlan[] }
  | { kind: "question"; question: string };

/** The fields a plan can fill without a human: identity plus env-backed defaults. */
function draftFor(
  definition: OnboardDefinition,
  projectCode: string,
  company: string | null,
  env: Record<string, string | undefined>,
): OnboardDraft {
  const draft: OnboardDraft = { ...prefillDefaults(definition, env), project_code: projectCode };
  // Carried across because it is the one field that means the same thing in
  // every service — "same key-values for similar fields" reaches exactly this
  // far, and pretending otherwise is how a workbook id gets guessed.
  if (company && definition.fields.some((field) => field.column === "company")) {
    draft.company = company;
  }
  return draft;
}

export function planOnboarding({
  prompt,
  clusters,
  existingFor,
  env,
}: {
  prompt: string;
  clusters: Cluster[];
  existingFor: (service: ServiceKey) => ProjectConfigRow[];
  env: Record<string, string | undefined>;
}): OnboardPlan {
  const targets = serviceHintsIn(prompt);
  if (!targets.length) {
    return {
      kind: "question",
      question:
        "Which service should these be onboarded into? Name it — WBGT, noise, haze, lightning, Ailytics, subcon or issue chaser.",
    };
  }

  const company = companyIn(prompt);
  const services: ServicePlan[] = [];

  for (const service of targets) {
    const definition = onboardingFor(service);
    if (!definition) {
      return {
        kind: "question",
        question: `${SERVICES[service].label} has no onboarding flow, so projects cannot be created in it from here.`,
      };
    }

    // Sites, not codes. `absentFrom` counts a site as present if ANY of its
    // aliases is in the service, which is what stops a second row being made
    // for a project that is already there under a different spelling.
    const missingSites = absentFrom(clusters, service).filter(
      (cluster) => !company || clusterCompany(cluster, existingFor) === company,
    );

    const ready: OnboardRow[] = [];
    const blocked: OnboardRow[] = [];
    for (const cluster of missingSites) {
      const draft = draftFor(definition, cluster.canonical, company, env);
      const problems = validateDraft(definition, draft, existingFor(service), env);
      const row: OnboardRow = {
        projectCode: cluster.canonical,
        values: draft,
        knownAs: cluster.members,
        problems,
      };
      (problems.length ? blocked : ready).push(row);
    }

    const alreadyThere = clusters
      .filter((cluster) => cluster.members.some((member) => member.service === service))
      .filter((cluster) => !company || clusterCompany(cluster, existingFor) === company)
      .map((cluster) => ({
        projectCode: cluster.canonical,
        existingAs: cluster.members.find((member) => member.service === service)!.projectCode,
      }));

    services.push({ service, label: SERVICES[service].label, ready, blocked, alreadyThere });
  }

  const totalReady = services.reduce((sum, plan) => sum + plan.ready.length, 0);
  const totalBlocked = services.reduce((sum, plan) => sum + plan.blocked.length, 0);
  if (!totalReady && !totalBlocked) {
    return {
      kind: "question",
      question: `Every ${company ?? ""} site is already onboarded in ${services
        .map((plan) => plan.label)
        .join(" and ")}. Nothing to create.`.replace(/\s+/g, " "),
    };
  }

  return {
    kind: "plan",
    company,
    summary:
      `${company ? `${company} sites` : "Sites"} missing from ` +
      `${services.map((plan) => plan.label).join(" and ")}: ` +
      `${totalReady} ready to create, ${totalBlocked} short a required field.`,
    services,
  };
}

/**
 * The company a site belongs to, read off whichever existing row carries one.
 *
 * A site is one row per service and `company` is set per row, so they can
 * disagree; the first non-blank wins rather than the request failing over a
 * field nothing reads. Sites with no company anywhere are excluded when a
 * company was asked for, because including them would be a guess.
 */
function clusterCompany(
  cluster: Cluster,
  existingFor: (service: ServiceKey) => ProjectConfigRow[],
): string | null {
  for (const member of cluster.members) {
    const row = existingFor(member.service).find(
      (candidate) => String(candidate.project_code ?? "").trim() === member.projectCode,
    );
    const company = String(row?.company ?? "").trim();
    if (company) return company;
  }
  return null;
}
