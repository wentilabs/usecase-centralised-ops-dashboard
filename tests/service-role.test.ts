import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { expectedCodeFor, serviceRoleFor } from "../lib/service-role";
import type { CanonicalProject } from "../lib/canonical-projects";
import type { ProjectConfigRow } from "../lib/services";

/**
 * Shaped from the live CCCC registry row on 2026-09-25, which is the project
 * that exposed this: two service aliases recorded, five blank, and real enabled
 * rows sitting behind two of the blanks.
 */
const CCCC = {
  id: "95d7296c-1475-49a9-8b1d-97f421d67eca",
  primary_alias: "CCCC",
  alternate_aliases: [],
  service_aliases: { wbgt: "CCCC", noise: "CCCC" },
} as unknown as CanonicalProject;

const row = (over: Partial<ProjectConfigRow>): ProjectConfigRow =>
  ({ project_code: "CCCC", enabled: true, ...over }) as ProjectConfigRow;

test("a service with no alias still finds the row filed under the primary alias", () => {
  // The bug, exactly as it happened: haze was onboarded from the project page,
  // the row was written with project_code CCCC, the registry never recorded a
  // haze alias, and the card reported the service absent while it was enabled
  // and delivering.
  const role = serviceRoleFor("haze", CCCC, [row({})]);
  assert.equal(role.status, "Enabled");
  assert.equal(role.row?.project_code, "CCCC");
  // The explicit alias is still reported as absent — the card's own subtitle
  // distinguishes "no override set" from "override set", and conflating them
  // would just move the lie somewhere else.
  assert.equal(role.alias, null);
});

test("a disabled row reads as Disabled, not as missing", () => {
  // Onboarding always creates the row disabled, so this is the state every
  // newly added service is in for the minute before someone enables it. If it
  // reported "Not onboarded", pressing Add service again would look like the
  // only option — and would try to insert a duplicate.
  const role = serviceRoleFor("lightning", CCCC, [row({ enabled: false })]);
  assert.equal(role.status, "Disabled");
  assert.equal(role.row?.enabled, false);
});

test("an explicit alias still wins over the primary one", () => {
  // The override exists for services whose live project code genuinely differs.
  // A row under the primary alias must NOT satisfy an explicit alias, or the
  // card would claim a row that belongs to a different site.
  const project = {
    ...CCCC,
    service_aliases: { ...CCCC.service_aliases, subcon: "CCCC-SUB" },
  } as unknown as CanonicalProject;
  assert.equal(expectedCodeFor("subcon", project), "CCCC-SUB");

  const role = serviceRoleFor("subcon", project, [row({ project_code: "CCCC" })]);
  assert.equal(role.status, "Alias not found");
  assert.equal(role.row, null);
});

test("a service that genuinely has no row still says Not onboarded", () => {
  // The fix must not turn every empty service into a broken link. With no
  // override and no row, nothing was ever claimed and nothing is missing.
  const role = serviceRoleFor("ailytics", CCCC, []);
  assert.equal(role.status, "Not onboarded");
  assert.equal(role.row, null);

  // And rows belonging to other projects are not adopted.
  const other = serviceRoleFor("ailytics", CCCC, [row({ project_code: "ZRA" })]);
  assert.equal(other.status, "Not onboarded");
});

test("two rows under one code stay ambiguous rather than picking one", () => {
  const role = serviceRoleFor("haze", CCCC, [row({}), row({})]);
  assert.equal(role.status, "Ambiguous alias");
  assert.equal(role.row, null, "an ambiguous match must not open an editor on a guess");
});

test("a read failure outranks every other verdict", () => {
  // Rows come back empty when the service's table could not be read, and an
  // empty list is indistinguishable from "no row" — so the error has to win, or
  // an outage would be reported as a project that runs nothing.
  const role = serviceRoleFor("haze", CCCC, [], "PostgREST 503");
  assert.equal(role.status, "Could not read");
});

test("whitespace in either half does not hide a row", () => {
  const padded = { ...CCCC, primary_alias: " CCCC " } as unknown as CanonicalProject;
  assert.equal(serviceRoleFor("haze", padded, [row({ project_code: "CCCC " })]).status, "Enabled");
  // An alias of only spaces is a blank, not a code to search for.
  const blankish = {
    ...CCCC,
    service_aliases: { ...CCCC.service_aliases, haze: "   " },
  } as unknown as CanonicalProject;
  assert.equal(expectedCodeFor("haze", blankish), "CCCC");
});

test("the board reads the shared matcher rather than keeping its own copy", async () => {
  const board = await readFile(resolve("components/ProjectServiceBoard.tsx"), "utf8");
  assert.match(board, /serviceRoleFor\(service, project, live\[service\] \?\? \[\], errors\[service\]\)/);
  // The old local copy must be gone, or the tested rule and the rendered rule
  // would be two different rules.
  assert.doesNotMatch(board, /function roleFor\(/);
  assert.doesNotMatch(
    board,
    /alias \? rows\.filter/,
    "matching on the explicit alias alone is the bug this replaced",
  );
});

test("the editor's promise about a blank alias is the rule the board implements", async () => {
  // These two sentences have to agree, and they did not: the editor told people
  // a blank alias means the primary one while the board treated it as no row.
  const editor = await readFile(resolve("components/CanonicalProjectEditor.tsx"), "utf8");
  assert.match(editor, /Blank means this service uses the primary alias/);
  assert.equal(expectedCodeFor("issueChaser", CCCC), CCCC.primary_alias);
});
