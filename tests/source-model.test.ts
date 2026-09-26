import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  NOISE_SOURCE_PROFILES,
  SERVICE_SOURCES,
  SOURCE_ALIASES,
  WBGT_SOURCE_PROFILES,
  normalizeSourceType,
  profilesFor,
  rulesForRoute,
  sourceProfileFor,
} from "../lib/source-model";
import { SERVICE_CONTRACTS } from "../lib/service-contracts";
import { SERVICE_KEYS, type ProjectConfigRow } from "../lib/services";

const source = (path: string) => readFile(resolve(path), "utf8");

/**
 * The guard that makes this page a mirror rather than a document.
 *
 * `source_type`'s options are declared in each service's contract. A profile
 * offered there and missing here would leave a project's card saying "no
 * adapter for this value" when the service is perfectly happy, which is the
 * exact wrong answer to give someone mid-incident.
 */
test("every source_type a service offers has a profile described here", () => {
  for (const service of ["noise", "wbgt"] as const) {
    const declared = SERVICE_CONTRACTS[service]!.configuration.fields.source_type?.options ?? [];
    assert.ok(declared.length, `${service} should declare source_type options`);
    const described = profilesFor(service)!;
    for (const option of declared) {
      assert.ok(described[option], `${service} offers source_type=${option} with nothing describing it`);
    }
  }
});

test("no profile is described that its service does not offer", () => {
  // The other direction: an invented profile would put a login link in front of
  // someone for a portal no project actually uses.
  for (const service of ["noise", "wbgt"] as const) {
    const declared = new Set(SERVICE_CONTRACTS[service]!.configuration.fields.source_type?.options ?? []);
    for (const profile of Object.keys(profilesFor(service)!)) {
      assert.ok(declared.has(profile), `${service} describes ${profile}, which its contract does not offer`);
    }
  }
});

test("noise keeps its four upstreams apart, and WBGT is one portal with four sign-ins", () => {
  // The distinction the whole table exists for. Three of noise's six profiles
  // are NoiseLynx under different logins; the other three are other companies,
  // and "the noise scraper is down" means something different for each.
  const noiseUpstreams = new Set(Object.values(NOISE_SOURCE_PROFILES).map((entry) => entry.upstream));
  assert.deepEqual([...noiseUpstreams].sort(), ["AlphaLab", "Geoscan", "NoiseLynx", "Trackmaster"]);

  const wbgtUpstreams = new Set(Object.values(WBGT_SOURCE_PROFILES).map((entry) => entry.upstream));
  assert.deepEqual([...wbgtUpstreams], ["CloudLynx AMR"]);
});

test("a profile names the variables that hold its sign-in, never a value", () => {
  const all = [...Object.values(NOISE_SOURCE_PROFILES), ...Object.values(WBGT_SOURCE_PROFILES)];
  for (const profile of all) {
    assert.ok(profile.credentialEnv.length >= 2, `${profile.profile} should name a user and a password variable`);
    for (const name of profile.credentialEnv) {
      // SCREAMING_SNAKE only. Anything else here is a value, and a value here
      // is a password in a web page.
      assert.match(name, /^[A-Z][A-Z0-9_]*$/, `${profile.profile} credential entry "${name}" is not a variable name`);
    }
    assert.match(profile.loginUrl, /^https:\/\//, `${profile.profile} needs a real sign-in URL`);
  }
});

test("nothing in the source model looks like a secret", async () => {
  // A blunt guard on purpose. The page is open to read-only accounts, so the
  // cost of one pasted value is high and the cost of this check is nothing.
  const text = await source("lib/source-model.ts");
  const stripped = text.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
  for (const pattern of [
    /password\s*[:=]\s*["'][^"']+["']/i,
    /(username|user)\s*[:=]\s*["'][^"']+["']/i,
    /api[_-]?key\s*[:=]\s*["'][^"']+["']/i,
    /["'][A-Za-z0-9_-]{32,}["']/,
  ]) {
    assert.doesNotMatch(stripped, pattern, `source-model.ts contains something shaped like a credential`);
  }
});

test("every service says where its readings come from and what breaks", () => {
  for (const service of SERVICE_KEYS) {
    const entry = SERVICE_SOURCES[service];
    assert.ok(entry, `${service} has no source described`);
    assert.ok(entry.upstream.length > 2, `${service} needs a named upstream`);
    // The half a README never carries, and the half that is useful at 2am.
    assert.ok(entry.breaks.length > 40, `${service} must say what a reader loses when this is down`);
    assert.ok(entry.how.length > 40, `${service} must say how a reading physically arrives`);
  }
  // Only the two that genuinely differ per project claim to.
  assert.deepEqual(
    SERVICE_KEYS.filter((service) => SERVICE_SOURCES[service].perProject),
    ["wbgt", "noise"],
  );
});

test("an inbound route named here is a route its contract declares", () => {
  // Same mirror rule as field-routes: a renamed endpoint upstream fails the
  // build instead of pointing an on-call reader at a path that no longer exists.
  for (const service of SERVICE_KEYS) {
    const declared = new Set(SERVICE_CONTRACTS[service]!.routes.map((route) => `${route.method} ${route.path}`));
    for (const route of SERVICE_SOURCES[service].inbound) {
      assert.ok(declared.has(route), `${service} names ${route} as inbound, which its contract does not declare`);
    }
  }
});

test("the legacy stored value resolves instead of reading as a fault", () => {
  // WBGT's TEST project stores source_type='noiselynx'. Both services normalise
  // it to default, so a table showing it as unknown would send someone hunting
  // a bug that does not exist.
  assert.equal(SOURCE_ALIASES.noiselynx, "default");
  assert.equal(normalizeSourceType("noiselynx"), "default");
  assert.equal(normalizeSourceType("NoiseLynx"), "default");
  // Blank and absent are default too — the column is nullable on both services.
  assert.equal(normalizeSourceType(""), "default");
  assert.equal(normalizeSourceType(null), "default");
  assert.equal(normalizeSourceType(undefined), "default");
  // An unknown value stays unknown rather than being folded into default: the
  // service throws on it, and the page says so.
  assert.equal(normalizeSourceType("nonesuch"), "nonesuch");

  const row = { project_code: "TEST", source_type: "noiselynx" } as unknown as ProjectConfigRow;
  assert.equal(sourceProfileFor("wbgt", row)?.profile, "default");
  assert.equal(sourceProfileFor("wbgt", { source_type: "nonesuch" } as unknown as ProjectConfigRow), null);
  // A service with no per-project source has no profile to resolve.
  assert.equal(sourceProfileFor("haze", row), null);
  assert.equal(profilesFor("haze"), null);
});

test("a schedule is shown only where HALO can prove one", async () => {
  // Proven: read off the AWS console into load-model/crons.ts.
  const hourly = rulesForRoute("noise", "POST /api/noise-hourly");
  assert.equal(hourly.length, 1);
  assert.match(hourly[0].utc, /^cron\(/);

  // Unproven: the ingestion routes are not in that file, because it holds only
  // rules that can send a message. The page says so rather than repeating a
  // README — WBGT's contradicts the console about its own hourly rule.
  assert.deepEqual(rulesForRoute("wbgt", "POST /api/wbgt-scrape"), []);
  assert.deepEqual(rulesForRoute("ailytics", "POST /telegram-webhook"), []);

  const guide = await source("components/DeveloperGuide.tsx");
  assert.match(guide, /schedule not mirrored in HALO/);
});

test("the page is open to anyone who can open the dashboard", async () => {
  const page = await source("app/developer/page.tsx");
  // The same gate the dashboard and the identity matrix use — allowed, not
  // canEdit. It writes nothing, and the people covering are exactly the ones
  // most likely to hold a read-only account.
  assert.match(page, /if \(!session\.allowed\) redirect\("\/unauthorized"\)/);
  assert.doesNotMatch(page, /canEdit/, "this page has nothing to gate on write access");
  // One unreachable schema must not blank the page.
  assert.match(page, /Promise\.allSettled/);
});

test("the tab is reachable from the dashboard", async () => {
  const shell = await source("components/DashboardShell.tsx");
  assert.match(shell, /href="\/developer"/);
});
