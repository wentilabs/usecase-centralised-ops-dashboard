import assert from "node:assert/strict";
import test from "node:test";

import {
  BULK_SYSTEM_PROMPT,
  applyToAll,
  companyIn,
  matchesConditions,
  serviceKeyFor,
  targetsForOverride,
  defaultsFor,
  describeScope,
  parseBulkOp,
  matchGroupNames,
  removeGroupsFrom,
  resolveScope,
  saysAllProjects,
} from "../lib/chat-scope";
import { COMPANIES } from "../lib/field-spec";
import type { ProjectConfigRow, ServiceKey } from "../lib/services";

/** A slice of the real estate: codes, companies and group lists as they are stored. */
const ROWS: Partial<Record<ServiceKey, ProjectConfigRow[]>> = {
  wbgt: [
    { project_code: "CFC", company: "Wohhup", whatsapp_group_id: "g1@g.us, g2@g.us" },
    { project_code: "ZRA", company: "Wohhup", whatsapp_group_id: "g3@g.us", water_parade_outbound_group_id: "g2@g.us" },
    { project_code: "MBS", company: "PentaOcean", whatsapp_group_id: "g4@g.us" },
  ],
  noise: [
    { project_code: "ZRA", company: "Wohhup", whatsapp_group_id: "g2@g.us, g5@g.us" },
    { project_code: "C9177", company: "Obayashi", whatsapp_group_id: "g6@g.us" },
  ],
  lightning: [{ project_code: "TRI", company: "Wohhup", whatsapp_group_id: "g1@g.us" }],
};
const idColumn = () => "project_code";
const codesOf = (scope: { targets?: { service: ServiceKey; projectCode: string }[] }) =>
  (scope.targets ?? []).map((t) => `${t.service}:${t.projectCode}`).sort();

test("every company alias resolves to a company the schema actually allows", () => {
  // A typo here would silently match nothing, because the scope filter compares
  // against the stored value.
  for (const phrase of ["wohhup", "Woh Hup", "WH", "obayashi", "PentaOcean", "penta ocean", "Penta"]) {
    const company = companyIn(`change something for ${phrase} projects`);
    assert.ok(company, `${phrase} matched no company`);
    assert.ok((COMPANIES as readonly string[]).includes(company!), `${company} is not a real company`);
  }
  // Longest alias wins, or "penta ocean" would resolve through "penta" alone —
  // harmless here because both mean PentaOcean, but the ordering is the point.
  assert.equal(companyIn("all penta ocean sites"), "PentaOcean");
  assert.equal(companyIn("nothing about a company here"), null);
  // Not a substring match: "wharf" must not read as Woh Hup.
  assert.equal(companyIn("the wharf project"), null);
});

test("only an explicit all-projects phrase opens a bulk scope", () => {
  for (const yes of [
    "mute Sundays on all projects",
    "every project should skip lunch",
    "all the projects",
    "each site",
    "estate-wide change",
    "estate wide change",
    "across the estate",
  ]) {
    assert.equal(saysAllProjects(yes), true, `${yes} should be a bulk phrase`);
  }
  for (const no of ["mute Sundays on CFC", "the noise projects", "all of it", "call the project owner"]) {
    assert.equal(saysAllProjects(no), false, `${no} should not be a bulk phrase`);
  }
});

test("an explicit project code wins over every other signal", () => {
  // The existing single-project path, unchanged: naming CFC means CFC even in a
  // sentence that also says a company and "all projects".
  const scope = resolveScope("for all Wohhup projects, change CFC's wbgt hourly", ROWS, idColumn);
  assert.equal(scope.kind, "projects");
  assert.deepEqual(codesOf(scope as never), ["wbgt:CFC"]);

  // A code in two services, narrowed by the service that was named.
  const narrowed = resolveScope("ZRA noise should mute Sundays", ROWS, idColumn);
  assert.equal(narrowed.kind, "projects");
  assert.deepEqual(codesOf(narrowed as never), ["noise:ZRA"]);

  // And unnarrowed when no service is named — the caller then asks which.
  const both = resolveScope("ZRA should mute Sundays", ROWS, idColumn);
  assert.deepEqual(codesOf(both as never), ["noise:ZRA", "wbgt:ZRA"]);
});

test("a company scope covers that company only, narrowed by a named service", () => {
  const all = resolveScope("mute Sundays for all Wohhup projects", ROWS, idColumn);
  assert.equal(all.kind, "company");
  assert.equal((all as { company: string }).company, "Wohhup");
  // Every Wohhup row across all three services; not MBS (PentaOcean) or C9177 (Obayashi).
  assert.deepEqual(codesOf(all as never), ["lightning:TRI", "noise:ZRA", "wbgt:CFC", "wbgt:ZRA"]);

  const scoped = resolveScope("mute Sundays for Wohhup wbgt projects", ROWS, idColumn);
  assert.equal(scoped.kind, "company");
  assert.deepEqual(codesOf(scoped as never), ["wbgt:CFC", "wbgt:ZRA"]);

  // A company with nothing on the named service is a sentence, not an empty edit.
  const empty = resolveScope("change Obayashi lightning projects", ROWS, idColumn);
  assert.equal(empty.kind, "none");
  assert.match((empty as { why: string }).why, /No Obayashi projects on that service/);
});

test("a service name alone is refused; the word 'all' is what opens it", () => {
  // The safety rule. "noise projects should mute Sundays" reads as bulk to a
  // person and as unfinished to a machine — guessing writes to every noise site.
  const vague = resolveScope("noise projects should mute Sundays", ROWS, idColumn);
  assert.equal(vague.kind, "none");
  assert.match((vague as { why: string }).why, /Name the project code, or say/);
  assert.deepEqual((vague as { hinted: ServiceKey[] }).hinted, ["noise"]);

  const explicit = resolveScope("all noise projects should mute Sundays", ROWS, idColumn);
  assert.equal(explicit.kind, "service");
  assert.deepEqual(codesOf(explicit as never), ["noise:C9177", "noise:ZRA"]);
});

test("all projects with no service named is the whole estate", () => {
  const scope = resolveScope("remove that group from all projects", ROWS, idColumn);
  assert.equal(scope.kind, "estate");
  assert.equal((scope as { targets: unknown[] }).targets.length, 6, "every row in every service");
});

test("a group is matched by its name, with WL and Wentilabs reaching each other", () => {
  const names = {
    "g1@g.us": "AST x WL Coordination",
    "g2@g.us": "C991 x WL coordination",
    "g3@g.us": "Wentilabs - WH trial platform",
    "g4@g.us": "Wenti Labs Dev Temp - Piling Progress",
    "g5@g.us": "Daily's WBGT 8am 11am 2pm 5pm",
    "g6@g.us": "CR106 HIROSE Safety issue.",
  };

  // The request in the words it was asked in. Case and the trailing plural on
  // "coordinations" must not matter.
  const wl = matchGroupNames("X WL coordinations", names).map((m) => m.chatId);
  assert.ok(wl.includes("g1@g.us") && wl.includes("g2@g.us"), "the two x-WL coordination groups");
  assert.ok(!wl.includes("g5@g.us") && !wl.includes("g6@g.us"), "and nothing unrelated");

  // The synonym, in both directions — and tested with a SINGLE-token phrase on
  // purpose. "Wentilabs coordination" matches an x-WL group even with no synonym
  // table at all, because "coordination" alone clears the threshold; asserting
  // that would have been a test of the threshold wearing the synonym's name.
  // With one token there is nothing else to carry the match.
  const byLong = matchGroupNames("Wentilabs", names).map((m) => m.chatId);
  assert.ok(byLong.includes("g1@g.us"), "Wentilabs alone must reach an x-WL group");
  assert.ok(byLong.includes("g2@g.us"));
  const byShort = matchGroupNames("WL", names).map((m) => m.chatId);
  assert.ok(byShort.includes("g3@g.us"), "WL alone must reach a Wentilabs-named group");
  assert.ok(byShort.includes("g4@g.us"), "and the two-word spelling of it");

  // An exact phrase hit outscores a partial one, so the review list leads with
  // the group the operator actually described.
  const ranked = matchGroupNames("C991 x WL coordination", names);
  assert.equal(ranked[0].chatId, "g2@g.us");
  assert.equal(ranked[0].score, 1);

  // An id with no alias can still be named directly.
  assert.deepEqual(
    matchGroupNames("g9@g.us", { "g9@g.us": "" }).map((m) => m.chatId),
    ["g9@g.us"],
  );

  // An empty phrase matches nothing rather than everything — the difference
  // between a no-op and clearing every delivery list in the estate.
  assert.deepEqual(matchGroupNames("", names), []);
  assert.deepEqual(matchGroupNames("   the and of  ", names), [], "stopwords alone are not a phrase");
});

test("removing groups edits only the rows that hold them, across every group column", () => {
  const rowFor = ({ service, projectCode }: { service: ServiceKey; projectCode: string }) =>
    (ROWS[service] ?? []).find((r) => r.project_code === projectCode);
  const targets = [
    { service: "wbgt" as ServiceKey, projectCode: "CFC", rowId: "CFC" },
    { service: "wbgt" as ServiceKey, projectCode: "ZRA", rowId: "ZRA" },
    { service: "wbgt" as ServiceKey, projectCode: "MBS", rowId: "MBS" },
    { service: "noise" as ServiceKey, projectCode: "ZRA", rowId: "ZRA" },
  ];
  const edits = removeGroupsFrom(targets, rowFor, ["g2@g.us"], (id) => `name(${id})`);

  // MBS never held g2, so it yields no edit at all — not an edit to its own
  // value. Thirty no-op PATCHes would each write an audit row saying nothing.
  assert.deepEqual(
    edits.map((e) => `${e.service}:${e.projectCode}`),
    ["wbgt:CFC", "wbgt:ZRA", "noise:ZRA"],
  );

  // The remaining ids are written back comma-joined, in order.
  assert.deepEqual(edits[0].changes, { whatsapp_group_id: "g1@g.us" });
  assert.deepEqual(edits[2].changes, { whatsapp_group_id: "g5@g.us" });

  // A `single` column counts too: ZRA's water parade column held g2 alone, and
  // emptying it must be null rather than "" — "no groups left", not "blank".
  assert.deepEqual(edits[1].changes, { water_parade_outbound_group_id: null });
  assert.equal(edits[1].changes.water_parade_outbound_group_id, null);

  // The detail line names what came out, so the review list is readable without
  // decoding ids.
  assert.match(edits[0].detail ?? "", /name\(g2@g\.us\)/);

  // Removing an id nobody holds changes nothing anywhere.
  assert.deepEqual(removeGroupsFrom(targets, rowFor, ["nope@g.us"], String), []);
});

test("a bulk column change skips rows already holding the value", () => {
  const rowFor = ({ service, projectCode }: { service: ServiceKey; projectCode: string }) =>
    (ROWS[service] ?? []).find((r) => r.project_code === projectCode);
  const targets = [
    { service: "wbgt" as ServiceKey, projectCode: "CFC", rowId: "CFC" },
    { service: "wbgt" as ServiceKey, projectCode: "ZRA", rowId: "ZRA" },
  ];

  // Neither row has the column set, so both change.
  const both = applyToAll(targets, rowFor, { remove_sunday_notifications: true });
  assert.equal(both.length, 2);

  // A row already at the value is not in the list, so the count the operator is
  // shown is the number of rows that will actually change.
  const already = applyToAll(targets, rowFor, { whatsapp_group_id: "g1@g.us, g2@g.us" });
  assert.deepEqual(
    already.map((e) => e.projectCode),
    ["ZRA"],
  );

  // Every column already matching means no edit — and so nothing to confirm.
  assert.deepEqual(applyToAll(targets, rowFor, { company: "Wohhup" }), []);
});

test("the phrasings this feature was asked for resolve the way they read", () => {
  // Verbatim from the request, because these are the sentences that have to work
  // and each one exercises a different rule.
  const cases: [string, string][] = [
    // Estate-wide group removal — the headline example.
    ["remove all X WL coordinations chat groups from the available outbound whatsapp group ids from all projects", "estate"],
    // A column change for one company.
    ["mute public holidays for all Wohhup projects", "company"],
    // A column change across one service.
    ["set all noise projects back to the default hourly format", "service"],
    // A single project, which must still take the original path.
    ["put CFC back to defaults", "projects"],
  ];
  for (const [prompt, expected] of cases) {
    assert.equal(resolveScope(prompt, ROWS, idColumn).kind, expected, prompt);
  }

  // "all X WL coordination chat groups" contains "all" but not "all projects";
  // the bulk scope in that sentence comes from the trailing "from all projects",
  // and a sentence with only the first clause is not bulk.
  assert.equal(saysAllProjects("remove all X WL coordination chat groups"), false);
});

test("resetting to defaults leaves anything whose default is blank alone", () => {
  const fields = {
    project_code: { name: "project_code", default: null, readonly: true },
    enable_hourly: { name: "enable_hourly", default: true },
    hourly_formatter: { name: "hourly_formatter", default: "wohhup_full" },
    // The dangerous ones: a null default means blank-by-nature, not "should be
    // blank". Applying it would empty a live site's delivery list.
    whatsapp_group_id: { name: "whatsapp_group_id", default: null },
    monthly_sheet_id: { name: "monthly_sheet_id", default: null },
    latitude: { name: "latitude" },
    internal: { name: "internal", default: false, hidden: true },
  };
  const row = {
    project_code: "CFC",
    enable_hourly: false,
    hourly_formatter: "pentaocean_full",
    whatsapp_group_id: "g1@g.us, g2@g.us",
    monthly_sheet_id: "sheet-1",
    latitude: 1.3,
  };

  const changes = defaultsFor(fields, row);
  assert.deepEqual(changes, { enable_hourly: true, hourly_formatter: "wohhup_full" });
  // Stated as its own assertion because this is the whole point of the rule.
  assert.ok(!("whatsapp_group_id" in changes), "a reset must never empty a delivery list");
  assert.ok(!("monthly_sheet_id" in changes), "nor clear a sheet id");
  assert.ok(!("project_code" in changes), "nor touch identity");
  assert.ok(!("internal" in changes), "nor a column the dashboard hides");
  assert.ok(!("latitude" in changes), "a column with no declared default has nothing to reset to");

  // A row already at its defaults yields nothing, so "back to defaults" on a
  // clean project is a sentence rather than a confirmation dialog.
  assert.deepEqual(defaultsFor(fields, { ...row, enable_hourly: true, hourly_formatter: "wohhup_full" }), {});
});

test("the bulk parser accepts only shapes it can execute, and never takes chat ids", () => {
  assert.deepEqual(parseBulkOp({ op: "set", changes: { enable_hourly: true }, summary: "s" }), {
    kind: "set",
    changes: { enable_hourly: true },
    summary: "s",
    where: [],
    scope: null,
  });
  assert.deepEqual(parseBulkOp({ op: "defaults", summary: "s" }), {
    kind: "defaults",
    summary: "s",
    where: [],
    scope: null,
  });
  assert.deepEqual(parseBulkOp({ question: "which service?" }), {
    kind: "question",
    question: "which service?",
  });

  // The load-bearing one: a group removal carries a PHRASE, and the phrase is
  // all it carries. Any chat ids the model volunteers are ignored, because which
  // groups a phrase means is decided by matchGroupNames over the real alias
  // store — a hallucinated id would otherwise reach a live site's delivery list.
  const removal = parseBulkOp({
    op: "remove-groups",
    phrase: "X WL coordination",
    chatIds: ["definitely@g.us", "made-up@g.us"],
    summary: "s",
  });
  assert.deepEqual(removal, {
    kind: "remove-groups",
    phrase: "X WL coordination",
    summary: "s",
    where: [],
    scope: null,
  });
  assert.ok(removal && !("chatIds" in removal), "chat ids from the model are not carried through");

  // A removal with no phrase has nothing to match and is refused rather than
  // matching everything.
  assert.equal(parseBulkOp({ op: "remove-groups", phrase: "  ", summary: "s" }), null);

  // An unrecognised op is refused rather than falling back to `set`, which is
  // the one that writes.
  assert.equal(parseBulkOp({ op: "delete-project", summary: "s" }), null);
  assert.equal(parseBulkOp({ op: "", changes: { a: 1 } }), null);
  assert.equal(parseBulkOp({ op: "set", changes: "not an object" }), null);
  assert.equal(parseBulkOp({ op: "set", changes: ["array"] }), null);
  assert.equal(parseBulkOp(null), null);

  // A question wins over an op, so a model that hedges does not also write.
  assert.equal(parseBulkOp({ question: "are you sure?", op: "set", changes: { a: 1 } })?.kind, "question");
});

test("a scope describes itself in a line the operator can check", () => {
  const label = (s: ServiceKey) => ({ wbgt: "WBGT", noise: "Noise", lightning: "Lightning" } as Record<string, string>)[s] ?? s;
  assert.equal(
    describeScope(resolveScope("mute Sundays for all Wohhup projects", ROWS, idColumn), label as never),
    "all 4 Wohhup projects across every service",
  );
  assert.equal(
    describeScope(resolveScope("mute Sundays for all Wohhup wbgt projects", ROWS, idColumn), label as never),
    "all 2 Wohhup projects on WBGT",
  );
  assert.equal(
    describeScope(resolveScope("all noise projects mute Sundays", ROWS, idColumn), label as never),
    "all 2 Noise projects",
  );
  assert.equal(
    describeScope(resolveScope("remove it from all projects", ROWS, idColumn), label as never),
    "all 6 projects, every service",
  );
  // A count of one still reads correctly rather than "1 projects".
  assert.match(
    describeScope(resolveScope("change CFC", ROWS, idColumn), label as never),
    /^CFC \(WBGT\)$/,
  );
});

test("all of the phrase must appear, and the real spelling variants still match", () => {
  // Every name here is a real group from the estate's alias store. The four
  // "should" names are the ones fuzzy matching exists for; the "must not" names
  // are what a looser matcher actually swept up — at a half-token threshold this
  // phrase matched 92 groups, including the last three.
  const names = {
    a: "AST x WL Coordination",
    b: "TJR - Wentilabs Coordination",
    c: "WH WSHE - Wenti Labs Coordination",
    d: "ZRB x WentiLab coordination",
    e: "AE - Site Coordination All Vendors",
    f: "[Wen] Meeting Notes Internal",
    g: "Aik San x Wenti Labs Demo",
  };
  const hit = new Set(matchGroupNames("X WL coordinations", names).map((m) => m.chatId));

  assert.ok(hit.has("a"), "the plain x-WL form");
  assert.ok(hit.has("b"), "the long spelling, Wentilabs");
  assert.ok(hit.has("c"), "the two-word spelling — no single token of the name matches WL");
  assert.ok(hit.has("d"), "and the singular, WentiLab");

  assert.ok(!hit.has("e"), "the word coordination alone is not this group");
  assert.ok(!hit.has("f"), "a three-letter prefix of Wentilabs is not Wentilabs");
  assert.ok(!hit.has("g"), "a Wentilabs group that is not a coordination group");

  // Asking for the other half is symmetric: a coordination group is not every
  // Wentilabs group.
  const demo = new Set(matchGroupNames("Wenti Labs demo", names).map((m) => m.chatId));
  assert.ok(demo.has("g"), "the demo group");
  assert.ok(!demo.has("a"), "not the coordination groups");
});

test("a request can say WHICH of the rows in scope it means", () => {
  // The gap this closes. `resolveScope` answers "which projects is this sentence
  // about" from codes, a company, a service or the estate — none of which can
  // express "the ones whose scheduled reports are off". Without a `where`, the
  // model could only ask whether to change all of them, which is a question the
  // operator had already answered.
  const parsed = parseBulkOp({
    op: "set",
    changes: { company: "Wohhup" },
    where: [{ column: "enabled", op: "is", value: false }],
    summary: "s",
  });
  assert.deepEqual(parsed, {
    kind: "set",
    changes: { company: "Wohhup" },
    summary: "s",
    where: [{ column: "enabled", op: "is", value: false }],
    scope: null,
  });

  // Conditions are AND-ed, and an empty list matches everything.
  const off = { project_code: "A", enabled: false, safety_group_ids: "" };
  const on = { project_code: "B", enabled: true, safety_group_ids: "g@g.us" };
  assert.equal(matchesConditions(off, [{ column: "enabled", op: "is", value: false }]), true);
  assert.equal(matchesConditions(on, [{ column: "enabled", op: "is", value: false }]), false);
  assert.equal(matchesConditions(on, []), true, "no condition means every row");
  assert.equal(
    matchesConditions(off, [
      { column: "enabled", op: "is", value: false },
      { column: "safety_group_ids", op: "empty" },
    ]),
    true,
  );
  assert.equal(
    matchesConditions(on, [
      { column: "enabled", op: "is", value: false },
      { column: "safety_group_ids", op: "empty" },
    ]),
    false,
  );

  // A boolean arrives as `false` from Postgres and often as "false" from the
  // model. Treating those as different would change nothing and look broken.
  assert.equal(matchesConditions(off, [{ column: "enabled", op: "is", value: "false" }]), true);
  // And NULL is "off" to everyone but the schema.
  assert.equal(matchesConditions({ project_code: "C" }, [{ column: "enabled", op: "is", value: false }]), true);

  // The other operators.
  assert.equal(matchesConditions(on, [{ column: "safety_group_ids", op: "not-empty" }]), true);
  assert.equal(matchesConditions(on, [{ column: "project_code", op: "contains", value: "b" }]), true);
  assert.equal(matchesConditions(on, [{ column: "enabled", op: "is-not", value: false }]), true);

  // A condition the model malformed is dropped rather than guessed at.
  const junk = parseBulkOp({ op: "defaults", summary: "s", where: [{ op: "is", value: 1 }, { column: "x", op: "??" }] });
  assert.deepEqual(junk && "where" in junk ? junk.where : null, []);
});

test("the bulk prompt tells the model that `where` exists", () => {
  // Same drift that bit the onboarding prompt: a field the parser reads and the
  // prompt never mentions is a field the model will never send.
  assert.match(BULK_SYSTEM_PROMPT, /"where"/);
  assert.match(BULK_SYSTEM_PROMPT, /is-not/);
  assert.match(BULK_SYSTEM_PROMPT, /not-empty/);
  assert.match(BULK_SYSTEM_PROMPT, /instead of asking/i, "it must prefer a where over a clarifying question");
});

test("the model may replace the scope, and may name a service either way", () => {
  // The failure this closes, end to end. "ALL projects whose scheduled reports
  // are disabled in subcon activities, set company to wohhup" — keywords read
  // "wohhup" as a filter when it is the VALUE being written, narrowing 30
  // projects to the 3 that already had that company. The model can see the
  // difference, so its reading of the set wins.
  const parsed = parseBulkOp({
    op: "set",
    changes: { company: "Wohhup" },
    where: [{ column: "enabled", op: "is", value: false }],
    scope: { services: ["Subcon Activities"] },
    summary: "s",
  });
  if (!parsed || parsed.kind !== "set") return assert.fail("expected a set");
  // The LABEL is accepted, not just the key. The scope line shows the model
  // labels, so it answers with one; accepting only keys dropped the whole
  // correction and silently left the wrong scope in place.
  assert.deepEqual(parsed.scope, { services: ["subcon"] });

  assert.equal(serviceKeyFor("subcon"), "subcon");
  assert.equal(serviceKeyFor("Subcon Activities"), "subcon");
  assert.equal(serviceKeyFor("issue chaser"), "issueChaser");
  assert.equal(serviceKeyFor("nothing real"), null);

  // Resolved against the real rows, so a code the model invents selects nothing.
  const rows = {
    subcon: [
      { project_code: "A", company: "Wohhup", id: "1" },
      { project_code: "B", company: null, id: "2" },
    ],
    noise: [{ project_code: "C", company: "Wohhup", id: "3" }],
  } as never;
  const idColumn = () => "project_code";
  assert.deepEqual(
    targetsForOverride({ services: ["subcon"] }, rows, idColumn).map((t) => t.projectCode),
    ["A", "B"],
  );
  assert.deepEqual(
    targetsForOverride({ codes: ["B", "GHOST"] }, rows, idColumn).map((t) => t.projectCode),
    ["B"],
    "an invented code selects nothing",
  );
  assert.deepEqual(
    targetsForOverride({ company: "Wohhup" }, rows, idColumn).map((t) => t.projectCode).sort(),
    ["A", "C"],
  );
});

test("the bulk prompt hands the model the decision, not a fixed scope", () => {
  // It used to say the scope "has ALREADY been decided ... you cannot change
  // it", which is what made the model ask whether a filtered request should
  // really cover everything.
  assert.doesNotMatch(BULK_SYSTEM_PROMPT, /cannot change it/i);
  assert.match(BULK_SYSTEM_PROMPT, /may be wrong|CAN BE WRONG/, "the scope must be offered as a guess");
  assert.match(BULK_SYSTEM_PROMPT, /current values/, "the model must be told it has the row data");
  assert.match(BULK_SYSTEM_PROMPT, /Nothing you return is written/, "and that a preview follows");
});

test("nothing in the bulk prompt refuses a change spanning services", () => {
  // It used to bail with "the columns differ between them. Name one service."
  // They only differ per column — `company` means the same thing everywhere —
  // so each service takes the part it has and the rest is reported.
  assert.match(BULK_SYSTEM_PROMPT, /may span services/i);
  assert.doesNotMatch(BULK_SYSTEM_PROMPT, /Name one service/i);
  assert.doesNotMatch(BULK_SYSTEM_PROMPT, /`set` is not available/i);
});

test("the bulk model can say a request is a creation, not a change", () => {
  // The keyword read used to be the ONLY way into the onboarding path, so a
  // phrasing it did not recognise was answered as a change to projects that do
  // not exist. The model sees the request and the rows, so it is better placed
  // to know that than a word list is.
  assert.deepEqual(parseBulkOp({ op: "onboard", summary: "create them" }), {
    kind: "onboard",
    summary: "create them",
  });
  assert.match(BULK_SYSTEM_PROMPT, /"op":"onboard"/, "and the prompt must offer it");
  assert.match(BULK_SYSTEM_PROMPT, /do not exist yet/i);
});
