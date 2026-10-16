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

  assert.match(page, /listProjectHealth/, "the server page must read automatic health");
  assert.match(page, /projectHealth=\{/, "the page must pass health to the client shell");
  assert.match(shell, /healthKey\(/, "the shell must resolve health with service plus project code");
  assert.match(shell, /projectHealth\s*=\s*\[\]/, "the shell must preserve neutral cards when a stale client render lacks health");
  assert.match(shell, /health=\{/, "the shell must supply the card's health result");
  assert.match(card, /health\?: ProjectHealth/, "the card must accept its own health result");
  assert.match(card, /<DataHealthRow[\s\S]{0,80}health=\{health\}/, "the card must render the supplied result");
  // The strip needs the code to title its modal, which is the only place a
  // reader sees which project a list of failures belongs to.
  assert.match(card, /<DataHealthRow projectCode=/, "and must name the project it belongs to");
  assert.ok(card.indexOf("<DataHealthRow") > card.indexOf("{links.length"), "health stays below sheet/action links");
});

test("Data Health is automatic and the estate board offers no policy setup action", async () => {
  const [row, board] = await Promise.all([
    source("components/DataHealthRow.tsx"),
    source("components/DataHealthBoard.tsx"),
  ]);

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
  assert.match(board, /automatically monitored/i, "the board must label the pilot as automatic");
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
  assert.match(row, /nothing reads this service yet/i);
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
