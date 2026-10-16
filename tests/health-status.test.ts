import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { classifyRunStatus, colourForStatus, isIdleStatus, worstColour } from "../lib/health-status";
import { contractHealthColour, contractHealthGranularity } from "../lib/service-contracts";
import { SERVICE_KEYS } from "../lib/services";

const source = (path: string) => readFile(resolve(path), "utf8");

/**
 * Every status the two covered services can write, taken from their code rather
 * than from a recent sample — a status that fires rarely is exactly the one a
 * sample misses and an operator meets at the worst moment.
 */
const NOISE = [
  "completed", "completed_with_errors", "completed_with_issues", "completed_with_meter_issues",
  "failed", "failed_config_validation", "failed_setup", "failed_sheet_setup", "running",
  "skipped", "skipped_google_sheet_not_configured", "skipped_no_scrape_demand",
  "skipped_not_daytime_band", "skipped_not_sunday", "skipped_outside_configured_window",
  "skipped_outside_project_cadence_window", "skipped_outside_sunday_daytime_window",
  "skipped_reserved_for_half_hourly_assessment", "skipped_sunday_notifications_disabled",
  "skipped_unconfigured_assessment_minute", "skipped_unsupported_invocation_minute",
  "suppressed_all_clear", "suppressed_all_clear_exceeded_meters_only",
  "suppressed_all_unavailable", "suppressed_all_unavailable_with_errors",
];
const WBGT = ["completed", "completed_with_issues", "failed", "failed_config_validation", "failed_setup", "running", "skipped", "skipped_cadence", "skipped_outside_site_hours"];

test("every status the services can write gets a colour", () => {
  // The point of a rule rather than a lookup: none of these may fall through.
  for (const status of [...NOISE, ...WBGT]) {
    const { colour } = classifyRunStatus(status);
    assert.ok(["green", "amber", "red"].includes(colour), `${status} -> ${colour}`);
  }
});

test("the convention carries the meaning, so a new status needs no change here", () => {
  // A service that follows the naming convention is coloured correctly without
  // HALO being told anything — which is the whole reason the column has no
  // CHECK and this is a rule.
  assert.equal(classifyRunStatus("completed").colour, "green");
  assert.equal(classifyRunStatus("skipped_outside_project_cadence_window").colour, "green");
  assert.equal(classifyRunStatus("suppressed_all_clear").colour, "green");
  assert.equal(classifyRunStatus("completed_with_issues").colour, "amber");
  assert.equal(classifyRunStatus("failed_config_validation").colour, "red");

  // Invented names no service writes today, to prove the rule and not a list:
  assert.equal(classifyRunStatus("failed_some_future_way").colour, "red");
  assert.equal(classifyRunStatus("completed_with_a_new_caveat").colour, "amber");
  assert.equal(classifyRunStatus("skipped_for_a_new_reason").colour, "green");
  for (const invented of ["failed_some_future_way", "completed_with_a_new_caveat"]) {
    assert.equal(classifyRunStatus(invented).basis, "prefix", `${invented} must be decided by the rule`);
  }
});

test("`completed_with_` beats `completed`, because the longer claim is the truer one", () => {
  // Order-dependent: a run that completed WITH issues is not a run that
  // completed, and checking the shorter prefix first would call it green.
  assert.equal(classifyRunStatus("completed_with_meter_issues").colour, "amber");
  assert.notEqual(classifyRunStatus("completed_with_meter_issues").colour, classifyRunStatus("completed").colour);
});

test("an unrecognised status is amber — not hidden, not alarming", () => {
  // Green would hide a status nobody has classified yet, which is where silence
  // is most likely to be wrong. Red would cry wolf on every addition upstream.
  for (const unknown of ["weird_new_thing", "aborted", "", "   ", null, undefined, 42]) {
    const result = classifyRunStatus(unknown as never);
    assert.equal(result.colour, "amber", JSON.stringify(unknown));
    assert.equal(result.basis, "unrecognised");
    assert.ok(result.because, "an unrecognised status must explain itself to the reader");
  }
  // And the raw text survives, so the interface can print what the service said.
  assert.equal(classifyRunStatus("Aborted").status, "aborted");
});

test("the four exceptions are the statuses whose name mispredicts them", async () => {
  // Each is a skip or a suppression that is really a missing value: the run WAS
  // due and could not proceed, which the prefix would have called expected.
  for (const status of [
    "skipped_google_sheet_not_configured",
    "skipped_unsupported_invocation_minute",
    "suppressed_all_unavailable",
    "suppressed_all_unavailable_with_errors",
  ]) {
    const result = classifyRunStatus(status);
    assert.equal(result.colour, "amber", status);
    assert.equal(result.basis, "exception", `${status} must be a named exception, not a prefix match`);
    assert.ok(result.because, `${status} must say why the prefix lies`);
  }

  // A long list means the convention is being ignored; the fix is then the name
  // in the service. Four is the current count and this holds the line.
  const model = await source("lib/health-status.ts");
  const declared = [...model.matchAll(/^  [a-z_]+: \{$/gm)].length;
  assert.ok(declared <= 6, `${declared} exceptions — rename statuses in the service rather than adding more`);
});

test("idle is told apart from succeeded, though both are green", () => {
  // Both are correct, but only one is evidence the pipeline works: a reader
  // needs to know whether a report went out or none was due.
  assert.equal(isIdleStatus("skipped_outside_project_cadence_window"), true);
  assert.equal(isIdleStatus("skipped_outside_site_hours"), true);
  assert.equal(isIdleStatus("completed"), false);
  assert.equal(isIdleStatus("suppressed_all_clear"), false, "a deliberate non-send still ran");
  // An exception is never idle: it looks like a skip and is really a fault.
  assert.equal(isIdleStatus("skipped_google_sheet_not_configured"), false);
});

test("a project's pill takes the worst of its cadences", () => {
  assert.equal(worstColour(["green", "green"]), "green");
  assert.equal(worstColour(["green", "amber"]), "amber");
  assert.equal(worstColour(["amber", "red", "green"]), "red");
  assert.equal(worstColour([]), "green", "nothing wrong is green");
});

test("the documentation and the rule say the same thing", async () => {
  // The doc is what a service author or an agent reads before adding a service;
  // if it drifts from the code it is worse than nothing.
  const doc = await source("docs/DATA_HEALTH.md");
  for (const prefix of ["completed_with_", "skipped", "suppressed", "failed", "running"]) {
    assert.ok(doc.includes(prefix), `the convention table must document "${prefix}"`);
  }
  assert.match(doc, /unrecognised status is amber, never green/i);
  // Every exception in the code appears in the doc's table, so a reader is
  // never surprised by a colour the convention does not explain.
  const model = await source("lib/health-status.ts");
  const exceptions = [...model.matchAll(/^  ([a-z_]+): \{$/gm)].map(([, name]) => name);
  assert.ok(exceptions.length >= 4, "the exception list should not have emptied out");
  for (const name of exceptions) {
    // The exact backticked token, not a substring: `suppressed_all_unavailable`
    // occurs inside `suppressed_all_unavailable_with_errors`, so a plain
    // `includes` passes even when its own row has been deleted. That is exactly
    // how this assertion was vacuous when first written.
    assert.ok(
      doc.includes(`\`${name}\``),
      `${name} is an exception in code but has no row of its own in the doc`,
    );
  }
});

// ---------------------------------------------------------------------------
// HALO owns the scale; each service owns the mapping onto it.
// ---------------------------------------------------------------------------

test("a service's own declaration outranks the naming convention", () => {
  // The point of the whole arrangement: `partial` means different things to
  // different services, so HALO must not decide it. Injected, because no
  // contract declares a health block yet and an assertion that cannot reach
  // the branch it describes proves nothing — this one passed against the
  // convention-only implementation before the seam existed.
  const declares = (_service: string, status: unknown) =>
    String(status) === "completed" ? ("red" as const) : null;

  // Convention alone calls `completed` green.
  assert.equal(classifyRunStatus("completed").colour, "green");
  // A service saying otherwise about its own word wins.
  const resolved = colourForStatus("noise", "completed", declares);
  assert.equal(resolved.colour, "red");
  assert.equal(resolved.basis, "declared");
  assert.match(resolved.because ?? "", /declares this status/);

  // And a status the service did NOT declare still falls to the convention.
  const fell = colourForStatus("noise", "failed_setup", declares);
  assert.equal(fell.colour, "red");
  assert.equal(fell.basis, "prefix");
});

test("no service declares a health block yet, and everything still works", () => {
  // All seven are undeclared at the time of writing. That is the case the
  // fallback exists for: HALO must be correct before any service adopts this,
  // and for one that never does.
  for (const service of SERVICE_KEYS) {
    assert.equal(contractHealthColour(service, "completed"), null, `${service} should declare nothing yet`);
    // And the resolver then falls through to the convention rather than failing.
    assert.equal(colourForStatus(service, "completed").colour, "green");
    assert.equal(colourForStatus(service, "failed_setup").colour, "red");
    assert.equal(colourForStatus(service, "nonesuch").colour, "amber");
    assert.equal(colourForStatus(service, "completed").basis, "prefix");
  }
});

test("an undeclared signal is not covered, never healthy", () => {
  // The one mistake this page cannot afford: a service that has not said it
  // reports a signal must not read as green.
  for (const service of SERVICE_KEYS) {
    for (const signal of ["ingestion", "run", "delivery"] as const) {
      assert.equal(contractHealthGranularity(service, signal), "none", `${service}.${signal}`);
    }
  }
});

test("a contract cannot smuggle a colour the UI does not have", () => {
  // Contracts are vendored from other repositories, so a typo or a fourth
  // colour is possible. It must not reach the UI as a class name; falling back
  // to the convention is the safe answer.
  const stray = contractHealthColour("noise", "completed");
  assert.equal(stray, null, "nothing is declared, so nothing is returned");
  // The declared path is only taken for exactly the three colours — asserted on
  // the reader's own source, since no contract exercises it yet.
  const reader = "lib/service-contracts.ts";
  return readFile(resolve(reader), "utf8").then((text) => {
    assert.match(text, /colour === "green" \|\| colour === "amber" \|\| colour === "red" \? colour : null/);
  });
});

test("the doc states the resolution order and the granularity rule", async () => {
  const doc = await source("docs/DATA_HEALTH.md");
  assert.match(doc, /HALO owns the scale/i);
  assert.match(doc, /fallback, not a replacement/i);
  assert.match(doc, /undeclared\*{0,2} signal is `?none`?, never `?project`?/i);
  // The block a service author copies must actually appear.
  assert.match(doc, /"granularity"/);
  assert.match(doc, /"statuses"/);
  // Amber, not orange: WBGT already ships check (status in ('green','amber','red')).
  assert.doesNotMatch(doc, /\borange\b/i, "the scale is green/amber/red, matching the live constraint");
});
