import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  ENDPOINT_PREVIEWS,
  HELP_COLUMNS,
  NOT_A_MESSAGE,
  QUIET_KINDS,
  endpointPreviewsFor,
  projectsReceiving,
  receivesEndpoint,
  variantsOf,
} from "../lib/endpoint-previews";
import { ENDPOINT_SAMPLES } from "../lib/endpoint-samples.generated";
import { hasPreview, previewContext, previewsFor } from "../lib/message-previews";
import { SERVICE_CONTRACTS } from "../lib/service-contracts";
import { SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "../lib/services";

/**
 * Guards "what does this endpoint send?".
 *
 * The failure is silent in the same way the formatter previews' is: a service
 * ships a new route, nothing breaks, and the page simply never mentions it — so a
 * developer reading it concludes there is no such message. The inventory is checked
 * against the pinned contracts both ways, and a route that sends nothing must say
 * why rather than be absent.
 */
const keyOf = (service: string, path: string) => `${service}:${path}`;

test("every route that is not a diagnostic or a read has a preview or a recorded reason", () => {
  const known = new Set([...ENDPOINT_PREVIEWS.map((entry) => keyOf(entry.service, entry.path)), ...Object.keys(NOT_A_MESSAGE)]);
  const missing: string[] = [];
  for (const service of SERVICE_KEYS) {
    for (const route of SERVICE_CONTRACTS[service].routes) {
      if (QUIET_KINDS.has(route.kind)) continue;
      if (!known.has(keyOf(service, route.path))) missing.push(`${route.method} ${keyOf(service, route.path)} (${route.kind})`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `routes in a pinned contract with no preview and no entry in NOT_A_MESSAGE: ${missing.join(", ")}`,
  );
});

test("nothing in the registry names a route the contract does not have", () => {
  const stale: string[] = [];
  for (const key of [...ENDPOINT_PREVIEWS.map((entry) => keyOf(entry.service, entry.path)), ...Object.keys(NOT_A_MESSAGE)]) {
    const [service, path] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const route = SERVICE_CONTRACTS[service]?.routes.find((candidate) => candidate.path === path);
    if (!route) stale.push(`${key} is not in the ${service} contract`);
    else if (QUIET_KINDS.has(route.kind)) stale.push(`${key} is a ${route.kind} route, which needs no entry`);
  }
  assert.deepEqual(stale, []);
});

test("a route is either previewed or explained as not a message, never both, never twice", () => {
  const previewed = ENDPOINT_PREVIEWS.map((entry) => keyOf(entry.service, entry.path));
  assert.equal(new Set(previewed).size, previewed.length, "a route is listed twice");
  assert.deepEqual(previewed.filter((key) => key in NOT_A_MESSAGE), []);
});

test("every switch an entry names is a real column of that service", () => {
  const bad: string[] = [];
  for (const entry of ENDPOINT_PREVIEWS) {
    const fields = SERVICE_CONTRACTS[entry.service].configuration.fields;
    for (const rule of entry.enabledBy ?? []) if (!(rule.column in fields)) bad.push(`${entry.service}:${entry.path} switch ${rule.column}`);
    for (const source of entry.sources) if ("column" in source && !(source.column in fields)) bad.push(`${entry.service}:${entry.path} source ${source.column}`);
  }
  for (const [key, column] of Object.entries(HELP_COLUMNS)) {
    const service = key.slice(0, key.indexOf(":"));
    if (!(column in SERVICE_CONTRACTS[service].configuration.fields)) bad.push(`HELP_COLUMNS ${key} -> ${column}`);
  }
  assert.deepEqual(bad, []);
});

test("an entry has something to show or says why not, and every source resolves", () => {
  for (const entry of ENDPOINT_PREVIEWS) {
    const id = keyOf(entry.service, entry.path);
    if (entry.sources.length === 0) assert.ok(entry.gap, `${id} has neither a message nor a reason`);
    else assert.equal(entry.gap, undefined, `${id} has a message, so it needs no gap`);
    for (const source of entry.sources) {
      if ("sample" in source) assert.ok(ENDPOINT_SAMPLES[source.sample], `${id}: no generated sample ${source.sample}`);
      else assert.ok(hasPreview(entry.service, source.column), `${id}: ${source.column} has no formatter preview`);
    }
    assert.ok(variantsOf(entry).length >= (entry.sources.length ? 1 : 0), `${id} resolved to nothing`);
  }
});

test("every generated sample is used, so a stale one cannot linger", () => {
  const used = new Set<string>();
  for (const entry of ENDPOINT_PREVIEWS) for (const source of entry.sources) if ("sample" in source) used.add(source.sample);
  for (const id of Object.keys(ENDPOINT_SAMPLES)) {
    // The Subcon format samples are consumed by the formatter `?`, not by a route entry.
    if (id.startsWith("subcon.manpower-summary.")) continue;
    assert.ok(used.has(id), `${id} is generated but no endpoint shows it`);
  }
});

test("an endpoint's message is reachable from the `?` beside the switch that turns it on", () => {
  for (const [key, column] of Object.entries(HELP_COLUMNS)) {
    const service = key.slice(0, key.indexOf(":")) as ServiceKey;
    const path = key.slice(key.indexOf(":") + 1);
    const entry = ENDPOINT_PREVIEWS.find((candidate) => candidate.service === service && candidate.path === path);
    assert.ok(entry, `${key} is not a registry entry`);
    assert.ok(hasPreview(service, column), `${service}:${column} has no \`?\``);
    const [only] = previewsFor(service, column);
    assert.ok(only.bubbles.length > 0);
    assert.match(previewContext(service, column)?.intro ?? "", new RegExp(`POST ${path.replace(/[/-]/g, "\\$&")}`), "the panel says which endpoint sends it");
  }
});

test("Subcon's manpower format shows exactly what the setting changes", () => {
  const options = previewsFor("subcon", "manpower_summary_format");
  assert.deepEqual(options.map((option) => option.value), ["manpower+machine", "manpower-only"], "the default first");
  assert.equal(options[0].isFallback, true);
  const [withMachines, without] = options.map((option) => option.bubbles[0].text);
  assert.match(withMachines, /🚜 1 machines/);
  assert.doesNotMatch(without, /🚜|machines/);
  // Same fixture: stripping the machine counts leaves everything else identical.
  assert.equal(withMachines.replace(/ \| 🚜 \d+ machines| \| 🚜 \d+/g, ""), without);
});

test("who receives an endpoint follows the project's enabled flag and every switch", () => {
  const entry = ENDPOINT_PREVIEWS.find((candidate) => candidate.path === "/api/water-parade-reminder")!;
  const row = (over: Record<string, unknown>) => ({ project_code: "T", enabled: true, water_parade_enabled: true, water_parade_reminders_enabled: true, ...over }) as ProjectConfigRow;
  assert.equal(receivesEndpoint(entry, row({})), true);
  assert.equal(receivesEndpoint(entry, row({ enabled: false })), false, "a disabled project receives nothing");
  assert.equal(receivesEndpoint(entry, row({ water_parade_reminders_enabled: false })), false);
  assert.equal(receivesEndpoint(entry, row({ water_parade_enabled: "true" })), false, "only a real true counts");

  const health = ENDPOINT_PREVIEWS.find((candidate) => candidate.path === "/api/wbgt-data-health")!;
  const withGroups = (value: unknown) => ({ project_code: "T", enabled: true, data_health_group_ids: value }) as ProjectConfigRow;
  assert.equal(receivesEndpoint(health, withGroups("1@g.us")), true);
  assert.equal(receivesEndpoint(health, withGroups("  ")), false, "blank recipients receive nothing");
  assert.equal(receivesEndpoint(health, withGroups(null)), false);
  assert.equal(receivesEndpoint(health, withGroups(["1@g.us"])), true);

  // A route with no documented switch is never counted, rather than counted wrongly.
  const retry = ENDPOINT_PREVIEWS.find((candidate) => candidate.path === "/api/wbgt-telegram-retry")!;
  assert.equal(retry.enabledBy, null);
  assert.equal(receivesEndpoint(retry, row({})), false);

  assert.deepEqual(
    projectsReceiving(entry, [row({ project_code: "B" }), row({ project_code: "A" }), row({ project_code: "C", enabled: false })]),
    ["A", "B"],
  );
});

test("each service's page lists only its own routes", () => {
  for (const service of SERVICE_KEYS) {
    for (const entry of endpointPreviewsFor(service)) assert.equal(entry.service, service);
  }
});

/**
 * `endpoint-samples.generated.ts` is committed, so a change to a service's message
 * would leave it quietly stale. Regenerate into a temp file and compare — whenever
 * the sibling repositories are checked out, which they are not in CI.
 */
test("the generated samples match what the services' own origin/main produces", async () => {
  const siblings = resolve("..");
  const repos = [
    "usecase-wohhup-noise-meter-alerts", "usecase-wohhup-wbgt-alerts", "usecase-lightning-alerts",
    "usecase-haze-alerts", "usecase-subcon-manpower-activities", "mdw-lambda-ailytics",
  ];
  const ready = repos.every((repo) => {
    if (!existsSync(resolve(siblings, repo, ".git"))) return false;
    try {
      execFileSync("git", ["-C", resolve(siblings, repo), "rev-parse", "--verify", "origin/main"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  if (!ready) return;

  const out = resolve(tmpdir(), `endpoint-samples-${process.pid}.ts`);
  try {
    execFileSync(process.execPath, ["scripts/build-endpoint-previews.mjs"], {
      env: { ...process.env, ENDPOINT_PREVIEWS_OUT: out, SERVICE_REPOSITORY_ROOT: siblings },
      stdio: "pipe",
    });
    assert.equal(
      await readFile(out, "utf8"),
      await readFile(resolve("lib/endpoint-samples.generated.ts"), "utf8"),
      "lib/endpoint-samples.generated.ts is stale — run `node scripts/build-endpoint-previews.mjs` and commit the result",
    );
  } finally {
    rmSync(out, { force: true });
  }
});
