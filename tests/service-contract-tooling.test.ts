import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
const script = readFileSync(`${root}/scripts/service-contracts.mjs`, "utf8");

test("service contracts have separate check and deliberately scoped refresh commands", () => {
  assert.equal(packageJson.scripts["contracts:check"], "node scripts/service-contracts.mjs");
  assert.equal(packageJson.scripts["contracts:refresh"], "node scripts/service-contracts.mjs --refresh");
  assert.match(script, /refresh requires one or more service keys/);
  assert.match(script, /contract has uncommitted changes/);
});

test("contract verification compares immutable git content rather than sibling working trees", () => {
  assert.match(script, /\["show", `\$\{entry\.commit\}:\$\{entry\.path\}`\]/);
  assert.match(script, /vendored !== upstream/);
  assert.match(script, /full commit SHA/);
  assert.match(script, /vendored migration plan differs from its pinned source revision/);
  assert.match(script, /migration schema .* differs from service contract/);
});
