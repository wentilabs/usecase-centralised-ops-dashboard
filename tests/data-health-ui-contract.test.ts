import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const source = (path: string) => readFile(resolve(path), "utf8");

test("the dashboard composes server health into the matching source card below its links", async () => {
  const [page, shell, card] = await Promise.all([
    source("app/page.tsx"),
    source("components/DashboardShell.tsx"),
    source("components/ProjectCard.tsx"),
  ]);

  // The readings-age health is NOT awaited by the page. On 20 Oct it was 3.6 s of a 3.7 s render — one
  // newest-row query for each of 63 active projects — against about 120 ms for everything else on the
  // page together. It loads after first paint instead, so this asserts the absence as firmly as the old
  // test asserted the presence: a page that reads it again brings the wait back with it.
  assert.doesNotMatch(page, /listProjectHealth|listEstateHealth/, "the server page must not wait for health");
  assert.doesNotMatch(page, /projectHealth=\{/, "and so has nothing to pass");
  assert.match(shell, /fetch\(path\)/, "the shell loads health after paint");
  assert.match(shell, /fetchedPage\("\/api\/data-health"/, "from its own route");
  assert.match(shell, /useState<ProjectHealth\[\]>\(\[\]\)/, "and starts with neutral cards rather than none");
  assert.match(shell, /healthKey\(/, "the shell must resolve health with service plus project code");
  assert.match(shell, /health=\{/, "the shell must supply the card's health result");
  assert.match(card, /health\?: ProjectHealth/, "the card must accept its own health result");
  assert.match(card, /<DataHealthRow[\s\S]{0,80}health=\{health\}/, "the card must render the supplied result");
  // The strip needs the code to title its modal, which is the only place a
  // reader sees which project a list of failures belongs to.
  assert.match(card, /<DataHealthRow projectCode=/, "and must name the project it belongs to");
  assert.ok(card.indexOf("<DataHealthRow") > card.indexOf("{links.length"), "health stays below sheet/action links");

});

test("Data Health is automatic, anchored to the card's base, and offers no policy setup", async () => {
  const [row, board, card] = await Promise.all([
    source("components/DataHealthRow.tsx"),
    source("components/DataHealthBoard.tsx"),
    source("components/ProjectCard.tsx"),
  ]);

  // Anchored to the bottom of the card, so every strip in a row sits at the
  // same height and the set reads as one picture instead of being hunted for at
  // a different height on each card. The free space has to be claimed HERE, not
  // by the footer: with `mt-auto` on the footer the gap opened between the two
  // and the strips floated up with whatever content each card happened to carry.
  assert.match(row, /mt-auto border-t/, "the health section claims the card's free space");
  assert.doesNotMatch(card, /<footer className="mt-auto/, "so the footer must not claim it too");

  // The intent this test was written for — Data Health is automatic, and the
  // board offers no policy setup — is asserted below and still holds. The
  // original form of it pinned `dataHealthDetail(health)`, an explainer line
  // printed under every pill; that was removed when the card was redesigned to
  // be readable 196 times, and the sentence it printed said the same thing on
  // every card in the estate.
  // Comments stripped first: this file's own doc comment quotes the removed
  // pill while explaining why it went, and an assertion that reads prose as
  // code fails on the explanation rather than on the behaviour.
  const rowCode = row.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(rowCode, /not monitored/i, "a pill that says nothing on every card trains people to ignore the section");
  assert.doesNotMatch(rowCode, /DeliveryOutcome|healthBadge/, "the delivery badge returns when there is an outcome to put in it");
  assert.match(board, /checked automatically/i, "the board must label covered signals as automatic");
  assert.match(board, /Copy all red and orange Data Health process errors/, "the board provides one pasteable report action");
  assert.match(board, /formatHealthErrorReport\(strips\)/, "the copied report uses the process history already shown in HALO");
  assert.doesNotMatch(board, /Set up policy|database migration required/i, "the board must not offer the retired policy flow");
});

test("a covered project shows its receipt, and never a receipt plus an explanation", async () => {
  const row = await source("components/DataHealthRow.tsx");

  // The original intent, preserved: a latest receipt REPLACES the explanation
  // rather than following it. The card now prints the receipt and no prose at
  // all, so the two can never appear together.
  assert.match(row, /formatSgt\(health\.newestReceivedAt\)/, "a receipt is shown when there is one");
  assert.doesNotMatch(row, /dataHealthDetail/, "and no explanatory sentence is printed beside it");

  // Green stays short; amber and red carry the service's own words. That is
  // what makes an abnormal pill longer and heavier on the page, so a problem is
  // findable by presence rather than only by hue — on 196 cards, hue alone is
  // wallpaper.
  assert.match(row, /health\.label\.replace\(\/\^Data:\\s\*\/i, ""\)/, "the label drops the prefix the section already states");
  assert.match(row, /colourOfTone\(health\.tone\)/, "the colour comes from the shared mapping, not a second one here");

  // A project with no reading is not a healthy project and must not be dressed
  // as one — these are the services declaring `none` for every signal.
  // Wording follows the semantics: coverage is about what HALO can READ, not
  // what the service declares — all seven declare delivery, and nothing reads it.
  // "Nothing reads this service yet" is gone. A hundred grey columns says the
  // same thing more precisely — nothing happened for this project in 48 hours —
  // and says it in the same shape as every other card, so the absence can be
  // compared against its neighbours instead of being prose that has to be read.
  // Comments stripped first: the component's own doc comment quotes the removed
  // sentence while explaining why it went, and an assertion that reads prose as
  // code fails on the explanation rather than on the behaviour. This is the
  // second time that has caught me in this file.
  const code = row.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /nothing reads this service yet/i, "an empty strip states this better");
  assert.match(row, /Data health\{bars\.length \? " — delivery" : ""\}/,
    "a project with delivery history but no ingestion says which question it answers");
});

test("WBGT and Noise expose a dedicated ungated Data Health group picker", async () => {
  const [wbgt, noise, groups] = await Promise.all([
    source("lib/field-spec/providers/wbgt.ts"),
    source("lib/field-spec/providers/noise.ts"),
    source("lib/card-summary/groups.ts"),
  ]);

  for (const provider of [wbgt, noise]) {
    assert.match(provider, /data_health_group_ids:\s*\{[\s\S]*?label:\s*"Data Health groups"[\s\S]*?widget:\s*"groups"[\s\S]*?internal operations/i);
  }
  assert.match(groups, /wbgt:[\s\S]*?data_health_group_ids/, "WBGT recipient ids must resolve to group names");
  assert.match(groups, /noise:[\s\S]*?data_health_group_ids/, "Noise recipient ids must resolve to group names");
});

test("WBGT and Noise expose an ungated Data Health message template", async () => {
  for (const path of ["lib/field-spec/providers/wbgt.ts", "lib/field-spec/providers/noise.ts"]) {
    const provider = await source(path);
    assert.match(provider, /data_health_message_template:\s*\{[\s\S]*?label:\s*"Data Health message template"[\s\S]*?project_code[\s\S]*?latest_receipt/i);
    assert.doesNotMatch(provider.match(/data_health_message_template:\s*\{[\s\S]*?\n\s*\},/)?.[0] ?? "", /showIf/);
  }
});
