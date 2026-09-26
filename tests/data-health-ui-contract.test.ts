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
  assert.match(shell, /health=\{/, "the shell must supply the card's health result");
  assert.match(card, /health\?: ProjectHealth/, "the card must accept its own health result");
  assert.match(card, /<DataHealthRow health=\{health\}/, "the card must render the supplied result");
  assert.ok(card.indexOf("<DataHealthRow") > card.indexOf("{links.length"), "health stays below sheet/action links");
});

test("Data Health is automatic and the estate board offers no policy setup action", async () => {
  const [row, board] = await Promise.all([
    source("components/DataHealthRow.tsx"),
    source("components/DataHealthBoard.tsx"),
  ]);

  assert.match(row, /Monitoring is automatic/, "the card must explain there is no project setup step");
  assert.match(board, /automatically monitored/i, "the board must label the pilot as automatic");
  assert.doesNotMatch(board, /Set up policy|database migration required/i, "the board must not offer the retired policy flow");
});
