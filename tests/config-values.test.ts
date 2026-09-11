import assert from "node:assert/strict";
import test from "node:test";

import { coerceValue } from "../lib/config-values";
import type { FieldSpec } from "../lib/field-spec";

test("a pasted column of numbers becomes a comma list", () => {
  // What arrives from a spreadsheet or a WhatsApp message, verbatim:
  //   "8335 6391,\n8257 0972,\n8497 2870,\n9247 1931"
  // Stored that way the service reads four entries with embedded newlines and
  // spaces and matches none of them. Nothing complained — a text column takes
  // anything — so the failure was silent until someone noticed no alerts.
  const csv = { name: "poc_phone_numbers", widget: "csv", type: "string" } as FieldSpec;
  assert.equal(
    coerceValue(csv, "8335 6391,\n8257 0972,\n8497 2870,\n9247 1931"),
    "83356391,82570972,84972870,92471931",
  );
  // A pasted column has no commas at all, which is why splitting on newlines
  // matters as much as trimming.
  assert.equal(coerceValue(csv, "6583356391\n6582570972\n"), "6583356391,6582570972");
  // Semicolons too, and duplicates and blanks go.
  assert.equal(coerceValue(csv, "65a; 65b ,,65a"), "65a,65b");
  // Nothing left means nothing set, the same as an empty box.
  assert.equal(coerceValue(csv, "  ,\n , "), null);
  assert.equal(coerceValue(csv, ""), null);
});

test("group and meter lists are normalised the same way", () => {
  // A chat id and a NoiseLynx RecID never contain whitespace either, so the
  // same rule is safe — and a group pasted out of a message often arrives
  // wrapped across lines.
  const groups = { name: "poc_alert_wa_groups", widget: "groups", type: "string" } as FieldSpec;
  assert.equal(
    coerceValue(groups, "120363410971872748@g.us,\n 120363407867792488@g.us"),
    "120363410971872748@g.us,120363407867792488@g.us",
  );
  const meters = { name: "noise_meters_included", widget: "meters", type: "string" } as FieldSpec;
  assert.equal(coerceValue(meters, " NM01 , NM02 "), "NM01,NM02");
});

test("a real array column is left to the array path", () => {
  // `multi` is a Postgres text[] whose members come from a fixed option list.
  // Routing it through the comma-list normaliser would turn it into a string
  // and PostgREST would reject the row.
  const multi = { name: "red_detection_types", widget: "multi", type: "array", options: ["G", "C"] } as FieldSpec;
  assert.deepEqual(coerceValue(multi, "G, C"), ["G", "C"]);
});
