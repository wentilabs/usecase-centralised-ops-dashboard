import assert from "node:assert/strict";
import test from "node:test";

import { describePostgrestError } from "../lib/postgrest-error";

test("a CHECK violation says which constraint, not just a number", () => {
  // The real one. It came back from an insert the plan had called "ready", and
  // the operator-visible text was a code and a row truncated mid-URL: nothing
  // in it names a column, a constraint, or anything to change.
  const raw = new Error(
    '400 {"code":"23514","details":"Failing row contains (TEST4, 1PnO9igrj0xDKZ-VVUGit24UmSbZvSdNN-7SggiwxFzo, ' +
      'https://3ibx8cveia.execute-api.ap-southeast-1.amazonaws.com/proxy/send-message, wohhup, wohhup, ' +
      '120363407867792488@g.us, f, t, t, f, Asia/Singapore).","hint":null,' +
      '"message":"new row for relation \\"project_configs\\" violates check constraint ' +
      '\\"issue_chaser_feature_requires_enabled_check\\""}',
  );
  const said = describePostgrestError(raw);
  assert.match(said, /issue_chaser_feature_requires_enabled_check/, "the constraint is the actionable part");
  assert.match(said, /violates check constraint/);
  assert.match(said, /\[23514\]/, "the code is kept, at the end where it belongs");
  // details is last and clipped, because it is the field that carries the
  // whole row and the one least likely to help.
  assert.ok(said.indexOf("Failing row") > said.indexOf("issue_chaser_feature"), "details comes after the message");
  assert.ok(said.includes("…"), "and is clipped");
});

test("a hint is passed through, because Postgres wrote it for the reader", () => {
  const said = describePostgrestError(
    '400 {"code":"42703","message":"column x does not exist","hint":"Perhaps you meant \\"y\\".","details":null}',
  );
  assert.match(said, /column x does not exist/);
  assert.match(said, /Perhaps you meant/);
  assert.doesNotMatch(said, /null/, "an absent field is absent, not the word null");
});

test("anything that is not a PostgREST body is returned unchanged", () => {
  // A network failure, an aborted request, a plain string. Rewriting one of
  // these would lose the only information there is.
  assert.equal(describePostgrestError(new Error("fetch failed")), "fetch failed");
  assert.equal(describePostgrestError("502 <html>Bad gateway</html>"), "502 <html>Bad gateway</html>");
  // Malformed JSON after the status: kept whole rather than half-parsed.
  assert.equal(describePostgrestError('400 {"code":'), '400 {"code":');
});
