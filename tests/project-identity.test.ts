import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SHARED_CHAT_FANOUT,
  FIXTURE_CODES,
  absentFrom,
  clusterProjects,
  fold,
  isAbbreviationOf,
  needingReview,
  singleServiceSites,
  type Overrides,
  type ServiceRow,
} from "../lib/project-identity";
import { MERGES, SPLITS } from "../lib/project-identity-overrides";
import type { ProjectConfigRow, ServiceKey } from "../lib/services";

const NONE: Overrides = { merges: [], splits: [] };

function row(service: ServiceKey, projectCode: string, extra: Record<string, unknown> = {}): ServiceRow {
  return { service, projectCode, row: { project_code: projectCode, ...extra } as ProjectConfigRow };
}
const clusterFor = (clusters: ReturnType<typeof clusterProjects>, code: string) =>
  clusters.find((c) => c.codes.includes(code));

test("codes differing only in case and punctuation are one site", () => {
  const clusters = clusterProjects([row("wbgt", "CR 106"), row("noise", "CR106")], NONE);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].codes, ["CR 106", "CR106"]);
  assert.equal(clusters[0].tier, "confirmed");
  // The canonical spelling is the clean one, not whichever row came first.
  assert.equal(clusters[0].canonical, "CR106");
});

test("a shared chat id is confirmation, not a guess", () => {
  const clusters = clusterProjects(
    [
      row("wbgt", "MBS", { whatsapp_group_id: "120@g.us" }),
      row("haze", "IR2", { wa_group_ids: "120@g.us" }),
      row("lightning", "ZRB", { whatsapp_group_id: "999@g.us" }),
    ],
    NONE,
  );
  const mbs = clusterFor(clusters, "MBS")!;
  assert.deepEqual(mbs.codes, ["IR2", "MBS"]);
  assert.equal(mbs.tier, "confirmed");
  assert.ok(mbs.evidence.some((e) => e.kind === "shared-chat" && e.chatId === "120@g.us"));
  // An unrelated project is not dragged in.
  assert.deepEqual(clusterFor(clusters, "ZRB")!.codes, ["ZRB"]);
});

test("a shared ops group does not collapse the projects that use it", () => {
  // The failure this guard exists for: one real group in this estate carries
  // six unrelated projects. Treating it as identity would merge them all.
  const ops = "ops@g.us";
  const many = ["CTM", "JKK", "PENTA", "TBS", "TRI"].map((code) =>
    row("wbgt", code, { poc_alert_wa_groups: ops }),
  );
  assert.ok(many.length > MAX_SHARED_CHAT_FANOUT, "fixture must exceed the fanout cap");
  const clusters = clusterProjects(many, NONE);
  assert.equal(clusters.length, many.length, "each project must stay its own site");
});

test("a prefix match is suggested, never confirmed", () => {
  const clusters = clusterProjects([row("haze", "TBC"), row("noise", "TBCA")], NONE);
  const cluster = clusterFor(clusters, "TBC")!;
  assert.deepEqual(cluster.codes, ["TBC", "TBCA"]);
  assert.equal(cluster.tier, "suggested");
  assert.deepEqual(needingReview(clusters).map((c) => c.canonical), ["TBC"]);
});

test("a prefix match corroborated by a chat id is confirmed", () => {
  const clusters = clusterProjects(
    [
      row("wbgt", "FJX", { whatsapp_group_id: "77@g.us" }),
      row("noise", "FJX-Newport Plaza", { whatsapp_group_id: "77@g.us" }),
    ],
    NONE,
  );
  assert.equal(clusterFor(clusters, "FJX")!.tier, "confirmed");
});

test("short codes do not prefix-match, or every initialism would collide", () => {
  const clusters = clusterProjects([row("wbgt", "CR"), row("noise", "CRANE")], NONE);
  assert.equal(clusters.length, 2);
});

test("placeholder ids never link two sites", () => {
  const clusters = clusterProjects(
    [row("wbgt", "AAA", { whatsapp_group_id: "-" }), row("noise", "BBB", { whatsapp_group_id: "-" })],
    NONE,
  );
  assert.equal(clusters.length, 2);
});

test("a split beats every derived signal", () => {
  const rows = [
    row("wbgt", "TWIN", { whatsapp_group_id: "5@g.us" }),
    row("noise", "TWIN-B", { whatsapp_group_id: "5@g.us" }),
  ];
  assert.equal(clusterProjects(rows, NONE).length, 1, "they merge without the split");
  const split = clusterProjects(rows, { merges: [], splits: [["TWIN", "TWIN-B"]] });
  assert.equal(split.length, 2, "the split must win");
});

test("a merge reaches sites no rule can, and turns a guess into a fact", () => {
  // Names that share nothing — not a chat id, not a prefix, not an
  // abbreviation. Only a person knows.
  const unrelated = [row("wbgt", "ZRB"), row("noise", "Marina One")];
  assert.equal(clusterProjects(unrelated, NONE).length, 2, "nothing derivable links them");
  const merged = clusterProjects(unrelated, {
    merges: [{ codes: ["ZRB", "Marina One"], note: "same site, confirmed by ops", canonical: "ZRB" }],
    splits: [],
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].canonical, "ZRB");
  assert.equal(merged[0].tier, "confirmed");

  // And a merge promotes a suggestion: CFC / Clifford Centre is only a reading
  // of the names until someone signs it off.
  const guessed = [row("wbgt", "CFC"), row("noise", "Clifford Centre")];
  assert.equal(clusterProjects(guessed, NONE)[0].tier, "suggested");
  const signed = clusterProjects(guessed, {
    merges: [{ codes: ["CFC", "Clifford Centre"], note: "confirmed by ops" }],
    splits: [],
  });
  assert.equal(signed[0].tier, "confirmed");
  assert.ok(signed[0].evidence.some((e) => e.kind === "override"));
});

test("absentFrom names the sites a service is missing, once per site", () => {
  // The point of the whole module: 'CR 106' and 'CR106' must count as ONE
  // missing site, or bulk onboarding creates the duplicate it exists to prevent.
  const clusters = clusterProjects(
    [row("wbgt", "CR 106"), row("noise", "CR106"), row("wbgt", "ZRB"), row("issueChaser", "ZRB")],
    NONE,
  );
  const missing = absentFrom(clusters, "issueChaser");
  assert.deepEqual(missing.map((c) => c.canonical), ["CR106"]);
  assert.equal(missing[0].codes.length, 2);
});

test("fold ignores exactly case, spaces and punctuation", () => {
  assert.equal(fold("CR 106"), "cr106");
  assert.equal(fold("CR-106"), "cr106");
  assert.notEqual(fold("CR106"), fold("CR1066"));
});

test("a pinned canonical beats the derived spelling", () => {
  // IR2 and MBS both fold to three characters, so the tie-break picks IR2
  // alphabetically. Only a person knows the site is called MBS.
  const rows = [
    row("wbgt", "MBS", { whatsapp_group_id: "9@g.us" }),
    row("haze", "IR2", { wa_group_ids: "9@g.us" }),
  ];
  assert.equal(clusterProjects(rows, NONE)[0].canonical, "IR2");
  const pinned = clusterProjects(rows, {
    merges: [{ codes: ["MBS", "IR2"], note: "Marina Bay Sands IR2", canonical: "MBS" }],
    splits: [],
  });
  assert.equal(pinned[0].canonical, "MBS");
});

test("single-service sites are surfaced as the alias-review list", () => {
  // The shape of every alias the rules miss: the odd spelling sits alone in
  // whichever service uses it, while its twin is known to several.
  const clusters = clusterProjects(
    [
      row("wbgt", "OBAYA"),
      row("noise", "ZRB"),
      row("wbgt", "ZRB"),
      row("haze", "ZRB"),
    ],
    NONE,
  );
  assert.deepEqual(
    singleServiceSites(clusters).map((c) => c.canonical),
    ["OBAYA"],
    "a code known to one service only is the review candidate",
  );

  // Distinct services, not row count. A site with two spellings that both live
  // in the same service is still known to only one service, and is still the
  // review candidate — counting members would silently miss it.
  const twoCodesOneService = clusterProjects(
    [row("noise", "WLD"), row("noise", "WLD-East"), row("wbgt", "ZRB"), row("noise", "ZRB")],
    NONE,
  );
  assert.deepEqual(
    singleServiceSites(twoCodesOneService).map((c) => c.canonical),
    ["WLD"],
  );
});

test("an abbreviation is suggested — the one shape no evidence reaches", () => {
  // CFC / Clifford Centre share no chat id, no sheet, no prefix. Reading the
  // names is all that is left, so it suggests and never confirms.
  const clusters = clusterProjects([row("wbgt", "CFC"), row("noise", "Clifford Centre")], NONE);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].tier, "suggested");
  assert.ok(clusters[0].evidence.some((e) => e.kind === "code-abbreviation"));
});

test("the abbreviation rule refuses coincidental matches", () => {
  assert.equal(isAbbreviationOf("cfc", "cliffordcentre"), true);
  assert.equal(isAbbreviationOf("tjr", "tanjongrhu"), true);
  // Too short to mean anything.
  assert.equal(isAbbreviationOf("ab", "aardvarkbureau"), false);
  // Compressing more than fivefold is coincidence, not abbreviation.
  assert.equal(isAbbreviationOf("abc", "aardvarkbureauconstructioncompanyx"), false);
  // Out of order is not an abbreviation.
  assert.equal(isAbbreviationOf("cba", "cliffordcentre"), false);
});

test("the checked-in overrides are well formed", () => {
  // These are hand-edited, and a malformed entry fails silently: a one-code
  // merge does nothing, and a code in two merges quietly chains two sites
  // together. Cheap to assert, and the mistake is invisible otherwise.
  const seen = new Map<string, string[]>();
  for (const merge of MERGES) {
    assert.ok(merge.codes.length >= 2, `merge needs 2+ codes: ${JSON.stringify(merge.codes)}`);
    assert.ok(merge.note.trim().length > 0, `merge needs a note: ${merge.codes.join("/")}`);
    assert.equal(new Set(merge.codes).size, merge.codes.length, `duplicate code in ${merge.codes.join("/")}`);
    if (merge.canonical) {
      assert.ok(merge.codes.includes(merge.canonical), `canonical "${merge.canonical}" must be one of its own codes`);
    }
    for (const code of merge.codes) {
      const already = seen.get(code);
      assert.equal(already, undefined, `"${code}" is in two merges (${already?.join("/")} and ${merge.codes.join("/")})`);
      seen.set(code, merge.codes);
    }
  }
  // A pair cannot be both merged and kept apart; the split would win silently.
  const merged = new Set(
    MERGES.flatMap((m) => m.codes.flatMap((a) => m.codes.map((b) => [fold(a), fold(b)].sort().join("|")))),
  );
  for (const [a, b] of SPLITS) {
    assert.ok(!merged.has([fold(a), fold(b)].sort().join("|")), `["${a}","${b}"] is both merged and split`);
  }
});

test("a fixture never merges with a real site, however strong the evidence", () => {
  // What actually happened on 2 Sep 2026: subcon's TEST row was pointed at
  // ZRA's real WhatsApp group, and the shared-chat rule merged them on a
  // fanout of exactly two. TEST exists in subcon and issue-chaser, so the
  // merge made ZRA look already-onboarded in both — a bulk onboarding reading
  // this map would have skipped the one site it should have created.
  const rows = [
    row("wbgt", "ZRA", { whatsapp_group_id: "120363410971872748@g.us" }),
    row("noise", "ZRA", { whatsapp_group_id: "120363410971872748@g.us" }),
    row("subcon", "TEST", { safety_group_ids: "120363410971872748@g.us" }),
  ];
  const clusters = clusterProjects(rows, NONE);
  const zra = clusters.find((c) => c.codes.includes("ZRA"))!;
  assert.deepEqual(zra.codes, ["ZRA"], "ZRA must not absorb the fixture");

  // The fixture stays visible as its own row rather than disappearing — it is
  // real configuration someone may need to find.
  const test = clusters.find((c) => c.codes.includes("TEST"));
  assert.ok(test, "TEST must still appear");
  assert.deepEqual(test!.members.map((m) => m.service), ["subcon"]);

  // And the consequence that matters: ZRA still reads as absent from subcon.
  assert.ok(
    absentFrom(clusters, "subcon").some((c) => c.codes.includes("ZRA")),
    "ZRA must still count as missing from subcon",
  );
});

test("an override cannot smuggle a fixture into a real site either", () => {
  const rows = [row("wbgt", "ZRA"), row("subcon", "TEST")];
  const clusters = clusterProjects(rows, {
    merges: [{ codes: ["ZRA", "TEST"], note: "mistaken sign-off" }],
    splits: [],
  });
  assert.equal(clusters.length, 2, "the fixture rule outranks a hand-written merge");
});

test("fixture matching ignores case and padding", () => {
  assert.ok(FIXTURE_CODES.has("TEST"), "the fixture list is what upstream INV-NOISE-11 names");
  const clusters = clusterProjects(
    [row("wbgt", "ZRB", { whatsapp_group_id: "5@g.us" }), row("noise", " test ", { whatsapp_group_id: "5@g.us" })],
    NONE,
  );
  assert.equal(clusters.length, 2);
});
