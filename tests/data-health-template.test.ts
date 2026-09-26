import assert from "node:assert/strict";
import test from "node:test";

import { validateDataHealthTemplate } from "../lib/data-health-template";

test("Data Health templates allow only the approved placeholders", () => {
  assert.deepEqual(validateDataHealthTemplate("{{project_code}} {{status}}"), { valid: true });
  assert.equal(validateDataHealthTemplate("{{unknown}}").valid, false);
  assert.equal(validateDataHealthTemplate("hello {{status").valid, false);
  assert.deepEqual(validateDataHealthTemplate("  "), { valid: true });
});
