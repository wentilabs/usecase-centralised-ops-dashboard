import type { ProjectConfigRow, ServiceKey } from "./services";
import { MERGES, SPLITS } from "./project-identity-overrides";

/**
 * Which project codes across the seven services are the same physical site.
 *
 * There is no canonical project code in this estate. The same site is `CFC` in
 * WBGT, haze and lightning but `Clifford Centre` in noise; `CR 106`, `CR106`
 * and `CR106-LOY` are one site under three spellings. Nothing in the schema
 * says so — each service's `project_code` is its own unique key, and no column
 * points at a sibling service.
 *
 * That matters because any cross-service bulk operation has to answer "which
 * projects are there" first. Onboarding every Wohhup code into issue-chaser
 * would create 44 rows for roughly 36 sites, and the duplicates would be
 * permanent rows in a live service rather than an error anyone sees.
 *
 * This module derives the mapping from evidence and separates what it can prove
 * from what it is guessing:
 *
 * - **confirmed** — a shared WhatsApp chat id, or codes identical once case and
 *   punctuation are folded away. On the estate as it stands, chat-id evidence
 *   linked five of the nine alias groups with no link that a human reading the
 *   names would reject.
 * - **suggested** — one folded code is a prefix of another. Clean on today's
 *   data (eight pairs, all genuine) but a rule that will eventually pair two
 *   unrelated sites, so it never merges without review.
 *
 * Some sites no signal can reach: `CFC` and `Clifford Centre` share no chat id,
 * no sheet and no name fragment. Those need a human, which is what
 * `project-identity-overrides` is for. Derivation gets you most of the way;
 * it is not a substitute for the answer being written down.
 */

/** Every column across the seven services that holds one or more chat ids. */
const GROUP_COLUMNS = [
  "whatsapp_group_id",
  "whatsapp_group_ids",
  "wa_group_ids",
  "poc_alert_wa_groups",
  "exceedance_half_hourly_wa_groups",
  "water_parade_outbound_group_id",
  "whatsapp_wbgt_source_chat_ids",
  "safety_group_ids",
  "manpower_activity_outbound_group_id",
] as const;

/**
 * A chat id shared by more than this many codes is a shared ops group, not a
 * site. One real group in this estate carries six unrelated projects; treating
 * it as identity would collapse them into a single site. Three is the observed
 * ceiling for a genuine alias set (`CR 106` / `CR106` / `CR106-LOY`).
 */
export const MAX_SHARED_CHAT_FANOUT = 3;

/** Placeholder values that appear in id columns and mean "nothing set". */
const PLACEHOLDERS = new Set(["", "-", "n/a", "na", "none", "null"]);

export type ServiceRow = { service: ServiceKey; projectCode: string; row: ProjectConfigRow };

export type Evidence =
  | { kind: "shared-chat"; chatId: string; codes: string[] }
  | { kind: "identical-code"; folded: string }
  | { kind: "code-prefix"; shorter: string; longer: string }
  | { kind: "code-abbreviation"; shorter: string; longer: string }
  | { kind: "override"; note: string };

export type Cluster = {
  /** The code this site is filed under: the shortest, cleanest spelling. */
  canonical: string;
  members: { service: ServiceKey; projectCode: string }[];
  codes: string[];
  evidence: Evidence[];
  /** `suggested` means a human has to agree before anything is written. */
  tier: "confirmed" | "suggested";
};

/**
 * Is `short` an abbreviation of `long` — its letters in order, with gaps?
 * `CFC` inside `Clifford Centre`, which is the shape that defeats every other
 * rule here: no shared chat, no shared prefix, no shared sheet.
 *
 * Deliberately loose, because it only ever produces a suggestion a human rules
 * on. The ratio cap is the one guard: an abbreviation that compresses a name
 * more than fivefold is matching on coincidence, not on meaning.
 */
export function isAbbreviationOf(short: string, long: string): boolean {
  if (short.length < 3 || long.length <= short.length) return false;
  if (long.length > short.length * 5) return false;
  let at = 0;
  for (const ch of long) if (ch === short[at]) at += 1;
  return at === short.length;
}

/** Case, spaces and punctuation carry no meaning in a project code here. */
export function fold(code: string): string {
  return String(code).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function chatIdsIn(row: ProjectConfigRow): string[] {
  const found = new Set<string>();
  for (const column of GROUP_COLUMNS) {
    const raw = (row as Record<string, unknown>)[column];
    if (!raw) continue;
    for (const part of String(raw).split(",")) {
      const id = part.trim();
      if (id && !PLACEHOLDERS.has(id.toLowerCase())) found.add(id);
    }
  }
  return [...found];
}

/**
 * Canonical spelling: the shortest folded form wins, because the long variants
 * are consistently the decorated ones (`CR106-LOY`, `FJX-Newport Plaza`). Ties
 * go to the code with the least punctuation, then alphabetically, so the choice
 * is stable rather than dependent on row order.
 */
function pickCanonical(codes: string[]): string {
  return [...codes].sort((a, b) => {
    const byLength = fold(a).length - fold(b).length;
    if (byLength !== 0) return byLength;
    const punctuation = (s: string) => s.length - fold(s).length;
    const byPunctuation = punctuation(a) - punctuation(b);
    if (byPunctuation !== 0) return byPunctuation;
    return a.localeCompare(b);
  })[0];
}

class Union {
  private parent = new Map<string, string>();
  find(x: string): string {
    const seen = this.parent.get(x);
    if (seen === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (seen === x) return x;
    const root = this.find(seen);
    this.parent.set(x, root);
    return root;
  }
  join(a: string, b: string): void {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export type Overrides = {
  merges: { codes: string[]; note: string; canonical?: string }[];
  splits: [string, string][];
};

/**
 * Group the estate's rows into sites.
 *
 * Overrides are injectable so the rules can be tested without editing the
 * checked-in human layer; they default to it. Splits win over every derived
 * signal, because the only way to correct a wrong merge is to be able to
 * override it.
 */
export function clusterProjects(
  rows: ServiceRow[],
  overrides: Overrides = { merges: MERGES, splits: SPLITS },
): Cluster[] {
  const codes = [...new Set(rows.map((r) => r.projectCode))];
  const union = new Union();
  const evidence = new Map<string, Evidence[]>();
  const keep = (code: string, item: Evidence) => {
    evidence.set(code, [...(evidence.get(code) ?? []), item]);
  };
  const splitPairs = new Set(overrides.splits.map(([a, b]) => [fold(a), fold(b)].sort().join("|")));
  const isSplit = (a: string, b: string) => splitPairs.has([fold(a), fold(b)].sort().join("|"));
  const link = (a: string, b: string, item: Evidence) => {
    if (a === b || isSplit(a, b)) return;
    union.join(a, b);
    keep(a, item);
    keep(b, item);
  };

  // Confirmed: identical once folded.
  const byFolded = new Map<string, string[]>();
  for (const code of codes) {
    const key = fold(code);
    byFolded.set(key, [...(byFolded.get(key) ?? []), code]);
  }
  for (const [folded, group] of byFolded) {
    for (const other of group.slice(1)) link(group[0], other, { kind: "identical-code", folded });
  }

  // Confirmed: a chat id shared by a believable number of codes.
  const chatOwners = new Map<string, Set<string>>();
  for (const { projectCode, row } of rows) {
    for (const chatId of chatIdsIn(row)) {
      chatOwners.set(chatId, (chatOwners.get(chatId) ?? new Set()).add(projectCode));
    }
  }
  for (const [chatId, owners] of chatOwners) {
    if (owners.size < 2 || owners.size > MAX_SHARED_CHAT_FANOUT) continue;
    const group = [...owners];
    for (const other of group.slice(1)) {
      link(group[0], other, { kind: "shared-chat", chatId, codes: [...group].sort() });
    }
  }

  // Suggested: one folded code is a prefix of another. Three characters is the
  // floor — below it, initials collide with unrelated sites.
  const suggested = new Set<string>();
  for (const a of codes) {
    for (const b of codes) {
      const [fa, fb] = [fold(a), fold(b)];
      if (fa === fb || fa.length < 3 || !fb.startsWith(fa)) continue;
      if (isSplit(a, b)) continue;
      suggested.add(a);
      suggested.add(b);
      link(a, b, { kind: "code-prefix", shorter: a, longer: b });
    }
  }

  // Suggested: one code reads as an abbreviation of the other. This is the only
  // rule that reaches `CFC` / `Clifford Centre`, and it is a reading of the
  // names rather than evidence, so it never confirms on its own.
  for (const a of codes) {
    for (const b of codes) {
      const [fa, fb] = [fold(a), fold(b)];
      if (fa === fb || fb.startsWith(fa) || !isAbbreviationOf(fa, fb)) continue;
      if (isSplit(a, b)) continue;
      link(a, b, { kind: "code-abbreviation", shorter: a, longer: b });
    }
  }

  // The human layer, last and strongest.
  const pinned = new Map<string, string>();
  for (const merge of overrides.merges) {
    if (merge.canonical) for (const code of merge.codes) pinned.set(code, merge.canonical);
    const [first, ...rest] = merge.codes;
    for (const other of rest) {
      union.join(first, other);
      keep(first, { kind: "override", note: merge.note });
      keep(other, { kind: "override", note: merge.note });
    }
  }

  const grouped = new Map<string, string[]>();
  for (const code of codes) {
    const root = union.find(code);
    grouped.set(root, [...(grouped.get(root) ?? []), code]);
  }

  return [...grouped.values()]
    .map((group) => {
      const items = group.flatMap((code) => evidence.get(code) ?? []);
      const unique = [...new Map(items.map((e) => [JSON.stringify(e), e])).values()];
      const overridden = unique.some((e) => e.kind === "override");
      // A cluster held together only by a prefix guess is never confirmed —
      // that is the whole point of the tier.
      const onlyGuessed =
        group.length > 1 &&
        unique.length > 0 &&
        unique.every((e) => e.kind === "code-prefix" || e.kind === "code-abbreviation") &&
        !overridden;
      return {
        // A pinned canonical wins: `IR2` and `MBS` both fold to three
        // characters, and only a person knows which one the site is called.
        canonical: group.map((c) => pinned.get(c)).find(Boolean) ?? pickCanonical(group),
        codes: [...group].sort(),
        members: rows
          .filter((r) => group.includes(r.projectCode))
          .map(({ service, projectCode }) => ({ service, projectCode }))
          .sort((a, b) => a.service.localeCompare(b.service) || a.projectCode.localeCompare(b.projectCode)),
        evidence: unique,
        tier: onlyGuessed ? ("suggested" as const) : ("confirmed" as const),
      };
    })
    .sort((a, b) => b.codes.length - a.codes.length || a.canonical.localeCompare(b.canonical));
}

/**
 * Sites known to exactly one service.
 *
 * Not a defect — plenty of projects genuinely run one service. But every alias
 * the rules failed to catch looks like this, because the unrecognised spelling
 * lives alone in whichever service uses it. `Clifford Centre` sits here while
 * its twin `CFC` is in three services, and no rule reaches across. This is the
 * list a human should read when deciding what to write into the overrides.
 */
export function singleServiceSites(clusters: Cluster[]): Cluster[] {
  return clusters.filter((c) => new Set(c.members.map((m) => m.service)).size === 1);
}

/** Clusters a human still has to rule on. */
export function needingReview(clusters: Cluster[]): Cluster[] {
  return clusters.filter((c) => c.tier === "suggested");
}

/** Which sites are missing from a service — the input to any bulk onboarding. */
export function absentFrom(clusters: Cluster[], service: ServiceKey): Cluster[] {
  return clusters.filter((c) => !c.members.some((m) => m.service === service));
}
