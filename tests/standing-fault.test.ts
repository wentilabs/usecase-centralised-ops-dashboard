import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { faultEntries, summarise } from "../lib/health-board";
import { healthKey } from "../lib/data-health";
import { bySeverity, severityOf, withFault } from "../lib/health-timeline";
import { FAULT_SERVICES, readProjectFaults } from "../lib/process-log";

const source = (path: string) => readFile(resolve(path), "utf8");

/**
 * SGK is the reason this exists. Lightning rejects its configuration on every
 * tick — "manpower-sheet POC mentions require manpower_sheet_id" — and has never
 * once evaluated it, so SGK has no deliveries, no runs and no events of any kind.
 * Its strip is a hundred calm grey columns, which reads as "nothing to report"
 * for a site with no lightning protection at all. A strip draws things that
 * happened; this is something a project is stuck IN.
 */
const SGK = "failed_config_validation: manpower-sheet POC mentions require manpower_sheet_id";

test("a standing fault is read as state, from the column the service writes it to", async () => {
  let path = "";
  const faults = await readProjectFaults(
    "lightning",
    async (requested) => {
      path = requested;
      return { ok: true, body: [{ project_code: "SGK", last_error: SGK }] };
    },
  );

  assert.match(path, /^lightning_project_runtime\?/, "the per-project runtime table");
  assert.match(path, /last_error=not\.is\.null/, "only projects that actually have one");
  assert.deepEqual(faults, [{ projectCode: "SGK", message: SGK }], "in the service's own words, unrewritten");
  assert.deepEqual(FAULT_SERVICES, ["lightning"]);
});

test("a service with no fault source asks nothing, and an unreadable table reports nothing", async () => {
  let asked = false;
  assert.deepEqual(
    await readProjectFaults("haze", async () => { asked = true; return { ok: true, body: [] }; }),
    [],
  );
  assert.equal(asked, false, "no query against a table that does not exist");

  // The body must be a well-formed row behind a failed status, or the array
  // check catches the case and the status check is never exercised.
  assert.deepEqual(
    await readProjectFaults("lightning", async () => ({
      ok: false,
      body: [{ project_code: "SGK", last_error: SGK }],
    })),
    [],
    "a failed read must not be painted as a fault from a stale body",
  );

  assert.deepEqual(
    await readProjectFaults("lightning", async () => ({
      ok: true,
      body: [{ project_code: "", last_error: SGK }, { project_code: "SGK", last_error: "  " }],
    })),
    [],
    "a row with no project, or no message, is not a fault",
  );
});

test("a fault is a red board entry of its own kind, in the service's own words", () => {
  const entries = faultEntries({ [healthKey("lightning", "SGK")]: SGK });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].colour, "red", "a project that cannot be evaluated is not covered at all");
  // Neither a stale reading (the vendor) nor a failed send (the listener): a
  // rejected configuration is whoever last edited the project.
  assert.equal(entries[0].signal, "config");
  assert.equal(entries[0].label, SGK);
  assert.equal(entries[0].detail, null, "there is no instant to report — the state is current");

  assert.deepEqual(faultEntries({ "not-json": SGK, '["lightning"]': SGK, [healthKey("lightning", "X")]: "" }), []);

  // It reaches the estate board as an incident, so it cannot be missed there.
  const summary = summarise(entries);
  assert.equal(summary.red, 1);
  assert.equal(summary.incidents[0].label, SGK);
});

test("a project with a fault sorts above one that is merely degraded", () => {
  // SGK has no processes, so its strip is empty and its severity would be zero —
  // sorting it among the healthy. One red puts it above every project that is
  // only degraded, which is where a project with no coverage belongs.
  const empty = severityOf([]);
  assert.deepEqual(withFault(empty, SGK), { red: 1, amber: 0, stale: 0, green: 0 });
  assert.deepEqual(withFault(empty, undefined), empty, "no fault changes nothing");

  const degraded = { red: 0, amber: 99, stale: 0, green: 1 };
  assert.ok(bySeverity(withFault(empty, SGK), degraded) < 0, "one fault leads 99 ambers");
  assert.ok(bySeverity({ red: 2, amber: 0, stale: 0, green: 0 }, withFault(empty, SGK)) < 0, "but two reds still lead it");
});

test("the card shows the fault above the strip, and the API carries it", async () => {
  const [row, route, shell] = await Promise.all([
    source("components/DataHealthRow.tsx"),
    source("app/api/project-strips/route.ts"),
    source("components/DashboardShell.tsx"),
  ]);
  const code = row.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // Both branches — a project with a health reading and one without — because
  // SGK is exactly the one with none.
  assert.equal((code.match(/<StandingFault message=\{fault\} \/>/g) ?? []).length, 2);
  assert.ok(
    code.indexOf("<StandingFault") < code.indexOf("<HealthBars"),
    "above the strip, which cannot carry a state with no instant",
  );
  assert.match(code, /role="alert"/, "announced, not merely coloured");

  // Placement alone proves nothing: a component that always returned null would
  // pass the checks above. These read the component itself — a guard that only
  // hides it when there is NO message, and the message actually rendered. (A
  // source check, not a render: components are outside this test build.)
  assert.match(
    code,
    /function StandingFault\([^)]*\)[^{]*\{\s*if \(!message\) return null;[\s\S]*>\s*\{message\}\s*<\/p>/,
    "rendered when there is a message, and only then",
  );

  assert.match(route, /listProjectFaults\(\)\.catch\(\(\) => \(\{\}\)\)/, "a failing fault read must not take the strips down");
  assert.match(route, /NextResponse\.json\(\{ strips, faults, notices \}\)/);
  assert.match(shell, /setProjectFaults\(\(body\.faults as Record<string, string>\) \?\? \{\}\)/);
});
