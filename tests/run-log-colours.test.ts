import assert from "node:assert/strict";
import test from "node:test";

import { colourForStatus, type HealthColour } from "../lib/health-status";

/**
 * Does what each service WRITES convert to the colour a person would expect?
 *
 * This is the check that was missing. A service whose run log speaks its own
 * dialect does not fail loudly — HALO treats a status it does not recognise as
 * amber, by design — it paints normal operation as a problem. Haze's first run
 * log did exactly that: `processed`, `outside_working_hours`,
 * `below_alert_threshold` and the two calendar mutes all came out amber, so every
 * quiet evening would have been an amber bar. Its own tests asserted the status
 * STRINGS and never the colour they produce, so nothing noticed.
 *
 * The table below is HALO's statement of what each service logs, read through
 * the real colour rule and the pinned vendored contracts. It is a mirror, so it
 * can drift — each service asserts the same conformance in its own repo, and the
 * contract lock fails when a service changes its declared statuses. What this
 * test adds is the one thing neither of those can: the colour a reader sees.
 */
const LOGGED: Record<string, Array<[string, HealthColour]>> = {
  subcon: [
    ["completed", "green"],
    ["completed_with_errors", "amber"],
    // A hard-rule skip is the service doing its job. Amber here would put a
    // bar on every quiet afternoon and train people to ignore the colour.
    ["skipped_project_disabled", "green"],
    ["skipped_housekeeping_off", "green"],
    ["skipped_activity_summary_off", "green"],
    ["skipped_manpower_summary_off", "green"],
    ["skipped_unchanged_since_previous_delivery", "green"],
    ["suppressed_sunday", "green"],
    ["suppressed_public_holiday", "green"],
    ["failed_unhandled_error", "red"],
    ["failed_unknown_job_type", "red"],
  ],
  haze: [
    ["completed", "green"],
    ["completed_with_errors", "amber"],
    ["skipped_project_disabled", "green"],
    ["skipped_outside_working_hours", "green"],
    ["skipped_below_alert_threshold", "green"],
    ["suppressed_sunday", "green"],
    ["suppressed_public_holiday", "green"],
    // Deliberately NOT green: a stale reading is a real fault of the upstream
    // feed. Haze's contract already declares SUPPRESSED_STALE amber for its
    // delivery ledger, and matching is case-insensitive, so the run log reuses
    // the word rather than inventing a second one for the same fact.
    ["suppressed_stale", "amber"],
    // Red because a project that is switched on and due to send with no region
    // to read is misconfigured, and nothing downstream will ever fix it.
    ["failed_config_validation", "red"],
    ["failed", "red"],
  ],
  ailytics: [
    ["completed", "green"],
    ["completed_with_unconfirmed", "amber"],
    ["completed_with_errors", "amber"],
    ["skipped_project_disabled", "green"],
    ["skipped_status_summary_off", "green"],
    ["skipped_yesterday_summary_off", "green"],
    // Hourly, so most of these are `not due`: green, or every quiet hour is an
    // amber bar and the colour stops meaning anything.
    ["skipped_not_due", "green"],
    ["failed", "red"],
    ["failed_unhandled_error", "red"],
  ],
  issueChaser: [
    ["completed", "green"],
    ["completed_with_errors", "amber"],
    ["completed_with_unconfirmed", "amber"],
    ["skipped_project_disabled", "green"],
    ["skipped_feature_disabled", "green"],
    ["skipped_not_due", "green"],
    ["skipped_schedule_intent_required", "green"],
    ["suppressed_sunday", "green"],
    ["suppressed_public_holiday", "green"],
    // Red: a project due to run whose schedule or configuration is invalid will
    // never be fixed by anything downstream.
    ["failed_config_validation", "red"],
    // A summary in which EVERY send failed: nobody was told.
    ["failed", "red"],
    ["failed_unhandled_error", "red"],
  ],
};

for (const [service, cases] of Object.entries(LOGGED)) {
  test(`${service}'s run log converts to the right colour`, () => {
    for (const [status, expected] of cases) {
      const got = colourForStatus(service, status);
      assert.equal(got.colour, expected, `${service} logs "${status}" — expected ${expected}, HALO draws ${got.colour} (${got.basis})`);
    }
  });
}

test("a service's old dialect is exactly what this guard exists to catch", () => {
  // The words haze's hourly job returns over HTTP, and which its first run log
  // wrote verbatim. Every one is amber, because none is recognised — so a
  // service that logs them un-translated paints normal operation as a problem.
  for (const status of ["processed", "outside_working_hours", "below_alert_threshold", "sunday_no_send", "public_holiday_no_send"]) {
    const got = colourForStatus("haze", status);
    assert.equal(got.colour, "amber", status);
    assert.equal(got.basis, "unrecognised", `${status} reaches the fallback, which is the tell`);
  }
});
