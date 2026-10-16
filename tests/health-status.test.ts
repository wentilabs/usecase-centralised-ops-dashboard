import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { classifyRunStatus, colourForStatus, isIdleStatus, worstColour } from "../lib/health-status";
import { SERVICE_CONTRACTS, contractHealthColour, contractHealthGranularity } from "../lib/service-contracts";
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

test("every service declares its own colours, and only the three", () => {
  // This test previously asserted that NONE of them declared a block — true
  // when the mechanism landed, false since each service committed its own. It
  // now pins the state that matters: every service answers for itself, and no
  // contract can introduce a fourth colour.
  for (const service of SERVICE_KEYS) {
    const declared = SERVICE_CONTRACTS[service]?.health;
    assert.ok(declared, `${service} should declare a health block`);
    assert.ok(Object.keys(declared.statuses ?? {}).length > 0, `${service} declares no statuses`);
    for (const [status, colour] of Object.entries(declared.statuses ?? {})) {
      assert.ok(["green", "amber", "red"].includes(colour), `${service}.${status} is "${colour}"`);
      // And the reader agrees with the file, case-insensitively — Haze and
      // Lightning write theirs upper case, the rest lower.
      assert.equal(contractHealthColour(service, status), colour, `${service}.${status}`);
      assert.equal(contractHealthColour(service, status.toUpperCase()), colour, `${service}.${status} upper`);
    }
    // The four shared delivery outcomes are the ones every service agreed on.
    const lower = Object.fromEntries(
      Object.entries(declared.statuses ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    assert.equal(lower.queued, "green", `${service}: a listener that accepted the message is not a fault`);
    assert.equal(lower.sent, "green", service);
    assert.equal(lower.unconfirmed, "amber", `${service}: ambiguous is worth reading, not alarming`);
    assert.equal(lower.failed, "red", service);
  }
});

test("a status no service declared still falls to the convention", () => {
  // The fallback has to survive adoption: a status added tomorrow by someone
  // who never opened the contract must still be read, not dropped.
  for (const service of SERVICE_KEYS) {
    assert.equal(contractHealthColour(service, "completed_with_meter_issues"), null, service);
    assert.equal(colourForStatus(service, "completed_with_meter_issues").colour, "amber");
    assert.equal(colourForStatus(service, "completed_with_meter_issues").basis, "prefix");
    assert.equal(colourForStatus(service, "nonesuch").colour, "amber");
    assert.equal(colourForStatus(service, "nonesuch").basis, "unrecognised");
  }
});

test("granularity is declared per signal, and an undeclared one is not covered", () => {
  // Ingestion, run and delivery do not share a granularity, so each is
  // declared separately. Delivery is the one every service can answer.
  for (const service of SERVICE_KEYS) {
    assert.equal(contractHealthGranularity(service, "delivery"), "project", `${service} delivery`);
  }
  // Haze and Lightning fetch one public feed, so ingestion has no per-project
  // answer; Lightning records it estate-wide, Haze records nothing at all.
  assert.equal(contractHealthGranularity("lightning", "ingestion"), "service");
  assert.equal(contractHealthGranularity("haze", "ingestion"), "none");
  // Only the two that keep their own readings answer ingestion per project.
  assert.deepEqual(
    SERVICE_KEYS.filter((s) => contractHealthGranularity(s, "ingestion") === "project"),
    ["wbgt", "noise"],
  );
  // The rule itself: anything undeclared is "not covered", never "project".
  // A service with no contract at all is the clearest case.
  for (const signal of ["ingestion", "run", "delivery"] as const) {
    assert.equal(contractHealthGranularity("nosuchservice", signal), "none", signal);
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
