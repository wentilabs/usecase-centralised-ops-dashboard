import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { MESSAGE_PREVIEWS, fallbackValue, hasPreview, previewsFor } from "../lib/message-previews";
import type { ServiceKey } from "../lib/services";

/**
 * Guards the formatter previews.
 *
 * The requirement is "every formatter", and the failure mode is silent: a new
 * formatter value ships in a service repo, the dropdown picks it up from the
 * live schema automatically, and the `?` panel simply does not list it. Nothing
 * breaks — someone just picks a formatter they could not see. So the inventory
 * is asserted explicitly rather than derived, and a value added on either side
 * fails here until the preview is written.
 */

/** Every formatter value the six services accept, as of the schema behind this build. */
const EXPECTED: Record<string, string[]> = {
  "noise:five_min_formatter": [
    "exceedance_only",
    "loc_name_exceedance_only",
    "summary_with_limits",
    "summary_without_limits",
    "summary_and_exceedance",
  ],
  "noise:half_hourly_formatter": ["estimated_Leq1hr", "all_5mins_list_Leq1hr"],
  "noise:hourly_formatter": [
    "12h_complete_list",
    "complete_list",
    "date_loc_name_complete_list",
    "date_loc_name_12h_complete_list",
    "estimated_Leq12hr",
  ],
  "noise:three_hour_formatter": ["leq1hr_triplet_with_12hr"],
  "noise:morning_formatter": ["overnight_leq1hr_summary_with_12hr"],
  "noise:enable_7am_7pm_leq12hr_table": ["true"],
  "wbgt:five_min_alert_formatter": ["short", "full"],
  "wbgt:intermittent_reports_formatter": ["red15", "red30"],
  "haze:advisory_format": ["default", "wohhup"],
};

/** The value a blank column resolves to, from each service's own fallback table. */
const BLANK_RESOLVES_TO: Record<string, string> = {
  "noise:five_min_formatter": "exceedance_only",
  "noise:half_hourly_formatter": "estimated_Leq1hr",
  "noise:hourly_formatter": "date_loc_name_12h_complete_list",
  "noise:three_hour_formatter": "leq1hr_triplet_with_12hr",
  "noise:morning_formatter": "overnight_leq1hr_summary_with_12hr",
  "wbgt:five_min_alert_formatter": "short",
  "wbgt:intermittent_reports_formatter": "red15",
  "haze:advisory_format": "default",
};

const split = (key: string) => {
  const [service, column] = key.split(":");
  return { service: service as ServiceKey, column };
};

test("every documented formatter value has a preview, and no preview is invented", () => {
  for (const [key, values] of Object.entries(EXPECTED)) {
    const { service, column } = split(key);
    const found = previewsFor(service, column).map((preview) => preview.value);
    assert.deepEqual([...found].sort(), [...values].sort(), `${key} preview values`);
  }

  // The reverse direction: nothing in the data refers to a column not listed above.
  for (const preview of MESSAGE_PREVIEWS) {
    const key = `${preview.service}:${preview.column}`;
    assert.ok(EXPECTED[key], `${key} has previews but is not in the expected inventory`);
  }
});

test("the blank-column default is marked, and marked exactly once per column", () => {
  for (const [key, expected] of Object.entries(BLANK_RESOLVES_TO)) {
    const { service, column } = split(key);
    const flagged = previewsFor(service, column).filter((preview) => preview.isFallback);
    assert.equal(flagged.length, 1, `${key} must have exactly one default`);
    assert.equal(fallbackValue(service, column), expected, `${key} default`);
  }
});

test("the default option is listed first, so an unset column opens on what it resolves to", () => {
  for (const key of Object.keys(BLANK_RESOLVES_TO)) {
    const { service, column } = split(key);
    assert.equal(previewsFor(service, column)[0]?.isFallback, true, `${key} ordering`);
  }
});

test("every preview carries a summary, a source, and something to show", () => {
  for (const preview of MESSAGE_PREVIEWS) {
    const id = `${preview.service}:${preview.column}=${preview.value}`;
    assert.ok(preview.summary.length > 20, `${id} needs a real summary`);
    assert.ok(preview.source.length > 5, `${id} needs a source`);

    if (preview.kind === "message") {
      assert.ok(preview.bubbles.length >= 1, `${id} is a message formatter with no example`);
      for (const bubble of preview.bubbles) {
        assert.ok(bubble.text.trim().length > 0, `${id} has an empty bubble`);
      }
    } else {
      // A cadence option's text is identical to its siblings'; the timing table
      // is the whole difference, so it is the thing that must be present.
      assert.ok(preview.cadence?.length, `${id} is a cadence formatter with no timing table`);
    }
  }
});

test("no run-time placeholder survived into a bubble", () => {
  // The generator fills these in. If one leaks through, the preview shows
  // `HH:MM (PROJECT_CODE)` and reads as unfinished rather than as a message.
  const placeholders = [/PROJECT_CODE/, /\bHH:MM\b/, /\bXX\d\d\b/, /\bDD-MMM-YYYY\b/];
  for (const preview of MESSAGE_PREVIEWS) {
    for (const bubble of preview.bubbles) {
      for (const placeholder of placeholders) {
        assert.doesNotMatch(
          bubble.text,
          placeholder,
          `${preview.column}=${preview.value} still contains ${placeholder}`,
        );
      }
    }
  }
});

test("WhatsApp markup in every bubble is balanced", () => {
  // The renderer only pairs `*bold*` and `_italic_` within a line. An odd
  // delimiter would render as a stray asterisk in the preview.
  for (const preview of MESSAGE_PREVIEWS) {
    for (const bubble of preview.bubbles) {
      for (const line of bubble.text.split("\n")) {
        const asterisks = (line.match(/\*/g) ?? []).length;
        assert.equal(asterisks % 2, 0, `unbalanced * in ${preview.value}: ${line}`);
      }
    }
  }
});

test("noise previews are lifted from the noise repo, not retyped", async () => {
  const generated = await readFile(resolve("lib/message-previews.generated.ts"), "utf8");
  assert.match(generated, /GENERATED FILE — do not edit by hand/);
  assert.match(generated, /scripts\/build-message-previews\.mjs/);
  for (const preview of MESSAGE_PREVIEWS.filter((entry) => entry.service === "noise")) {
    assert.match(preview.source, /MESSAGE_SHAPES\.md §\d+/, `${preview.value} source`);
  }
});

test("hasPreview only claims columns that have one", () => {
  assert.equal(hasPreview("noise", "hourly_formatter"), true);
  assert.equal(hasPreview("wbgt", "hourly_formatter"), false);
  assert.equal(hasPreview("noise", "whatsapp_group_id"), false);
});
