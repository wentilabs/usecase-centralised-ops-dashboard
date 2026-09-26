import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  EXPECTATION_NOTE,
  NOISE_SOURCE_PROFILES,
  SERVICE_STORAGE,
  readingExpectation,
  readingsTableFor,
  storesReadings,
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

// ---------------------------------------------------------------------------
// Storage: the half that says a message job reads a table, not a vendor.
// ---------------------------------------------------------------------------

test("the table name is the services' own rule, not an approximation", () => {
  // lib/naming.js, byte-identical in the noise and WBGT repos. Getting this
  // wrong points someone at a table that does not exist.
  assert.equal(readingsTableFor("noise", "ZRA"), "zra_noise_data_daily");
  assert.equal(readingsTableFor("wbgt", "TJR"), "tjr_wbgt_data_hourly");
  // Real codes carry spaces and punctuation, and all three of these exist live.
  assert.equal(readingsTableFor("noise", "FJX-Newport Plaza"), "fjx_newport_plaza_noise_data_daily");
  assert.equal(readingsTableFor("noise", "MBS IR2"), "mbs_ir2_noise_data_daily");
  assert.equal(readingsTableFor("wbgt", "CR 106"), "cr_106_wbgt_data_hourly");

  // A code the services would refuse has no table, and saying so beats guessing
  // a name: normalizeProjectCode throws there rather than returning something.
  assert.equal(readingsTableFor("noise", "  "), null);
  // The naming rule lives in one place now — data-health's healthTarget — and
  // this delegates to it rather than deriving the name a second time.

  // Services that store nothing have no table at any code.
  for (const service of ["haze", "lightning", "ailytics", "subcon", "issueChaser"] as const) {
    assert.equal(readingsTableFor(service, "ZRA"), null, `${service} stores no readings`);
  }
});

test("only the two services that keep their own readings say they do", () => {
  // The point the page exists to make, and the one it must not overstate:
  // "check the table first" is right for two services and meaningless for five.
  assert.deepEqual(SERVICE_KEYS.filter(storesReadings), ["wbgt", "noise"]);

  for (const service of SERVICE_KEYS) {
    const storage = SERVICE_STORAGE[service];
    assert.ok(storage.debugOrder.length >= 2, `${service} needs an ordered check`);
    // Order is the content. A service that stores readings must send the reader
    // to the table before anything else — checking the scraper first is exactly
    // the mistake this page was built to prevent.
    if (storesReadings(service)) {
      assert.match(storage.debugOrder[0], /table/i, `${service} must send you to the table first`);
      assert.ok(storage.supporting.some((entry) => entry.table.endsWith("_job_runs")), `${service} needs job runs`);
    } else {
      assert.doesNotMatch(
        storage.debugOrder[0],
        /check the .*table|rows in the/i,
        `${service} stores nothing, so it must not send anyone looking for a table`,
      );
    }
  }
});

test("a project nothing asks for is not reported as stale", () => {
  // Noise scraping is demand-driven: with every cadence off, nothing asks and
  // the table is correctly stale forever. Four live projects are in that state,
  // and colouring them like a failure would train everyone to ignore the colour.
  const dormant = { project_code: "KCDE", enabled: true } as unknown as ProjectConfigRow;
  assert.equal(readingExpectation(dormant), "dormant");
  assert.ok(EXPECTATION_NOTE.dormant);

  const off = { project_code: "X", enabled: false, enable_hourly: true } as unknown as ProjectConfigRow;
  assert.equal(readingExpectation(off), "disabled", "a disabled project outranks its cadences");

  const live = { project_code: "HMD", enabled: true, enable_hourly: true } as unknown as ProjectConfigRow;
  assert.equal(readingExpectation(live), "demanded");
  assert.equal(EXPECTATION_NOTE.demanded, null, "a live project carries no excuse for being stale");

  // Generic over `enable_*` rather than a list of cadence names, so a cadence
  // added upstream counts the day it appears.
  const future = { project_code: "Y", enabled: true, enable_something_new: true } as unknown as ProjectConfigRow;
  assert.equal(readingExpectation(future), "demanded");
  // A flag that is off, or a non-boolean, is not demand.
  assert.equal(
    readingExpectation({ project_code: "Z", enabled: true, enable_hourly: false } as unknown as ProjectConfigRow),
    "dormant",
  );
});

test("the freshness verdict is the shared reader's, with dormancy the one correction", async () => {
  const guide = await source("components/DeveloperGuide.tsx");

  // The tone comes from data-health's assessIngestionHealth, not from a second
  // set of thresholds here. Two judgements of the same table would drift into
  // the board and this page disagreeing about whether a site is healthy.
  assert.match(guide, /health\?\.tone === "danger"/);
  assert.match(guide, /health\?\.tone === "warn"/);
  assert.doesNotMatch(guide, /hours >= \d+/, "no second threshold may live in the view");

  // The one thing this view adds: a project nothing asks readings of is never
  // coloured as though it had stopped. Measured at 18:29 on an ordinary working
  // day, the shared budgets put 19 of 32 noise projects in danger, seven of
  // them dormant — and a column that is mostly red is a column nobody reads.
  assert.match(guide, /expectation !== "demanded"\s*\n?\s*\? "border-border opacity-60"/);
});

test("there is one reader of the readings tables, not two", async () => {
  const page = await source("app/developer/page.tsx");
  // The shared reader already queries each project's table and already owns the
  // verdict. It scopes itself to wbgt and noise, so this page does not repeat
  // that either.
  assert.match(page, /listProjectHealth\(rows\)/);
  assert.doesNotMatch(page, /readingsFreshness/, "the duplicate reader is gone");

  const repo = await source("lib/config-repository.ts");
  assert.doesNotMatch(repo, /readingsFreshness/, "and it is not left behind in the repository");

  // The table name is derived in one place too. Both were mirrors of the same
  // lib/naming.js, and two copies of a naming rule drift into pointing two
  // parts of HALO at different tables.
  const model = await source("lib/source-model.ts");
  assert.match(model, /healthTarget\(service, projectCode\)\?\.table/);
  assert.doesNotMatch(model, /replace\(\/\[\^a-z0-9\]\+\/g/, "the second copy of the naming rule is gone");
});

test("the secondary sources are named, with the variables they need", () => {
  // Naming only the main upstream makes a card read as though it were the only
  // one, and these are where someone unfamiliar gets stuck.
  const wbgt = SERVICE_SOURCES.wbgt.alsoFrom ?? [];
  assert.deepEqual(
    wbgt.map((entry) => entry.label),
    ["Telegram bot", "Manual photos on WhatsApp", "External Telegram channels"],
  );
  assert.deepEqual(SERVICE_SOURCES.lightning.alsoFrom?.map((entry) => entry.label), ["Forwarded SMS"]);

  // Every column named is one the service's contract declares, same mirror rule
  // as everywhere else — a renamed column must fail the build, not misdirect.
  for (const service of SERVICE_KEYS) {
    const fields = new Set(Object.keys(SERVICE_CONTRACTS[service]!.configuration.fields));
    for (const entry of SERVICE_SOURCES[service].alsoFrom ?? []) {
      for (const column of entry.columns ?? []) {
        assert.ok(fields.has(column), `${service}.${column} is named as a source switch but is not in the contract`);
      }
      // Variable NAMES only, here as everywhere.
      for (const name of entry.env ?? []) {
        assert.match(name, /^[A-Z][A-Z0-9_]*$/, `${entry.label} env entry "${name}" is not a variable name`);
      }
    }
  }
});

test("the manual-photo path warns that its variable lives in another repo", () => {
  const manual = SERVICE_SOURCES.wbgt.alsoFrom?.find((entry) => entry.label === "Manual photos on WhatsApp");
  assert.ok(manual, "manual photo ingestion must be described");

  // The pointer that is easy to miss and expensive to miss. The listener repo
  // that RECEIVES the photo has to be told where to forward it, and this
  // service cannot notice that it never was — the photo simply never arrives,
  // and nothing here errors.
  assert.deepEqual(manual.env, ["WBGT_WHATSAPP_WEBHOOK_URL"]);
  assert.match(manual.envRepo ?? "", /not this one/, "it must say the variable is not this service's");
  assert.ok(manual.critical, "a silent failure needs a warning, not a note");
  assert.match(manual.critical, /WBGT_WHATSAPP_WEBHOOK_URL/);
  assert.match(manual.critical, /\/api\/wbgt-whatsapp/, "it must name the route to point at");
  assert.match(manual.critical, /never/, "it must say the failure is silent");

  // And it is the only path that carries one, so the warning styling stays rare
  // enough to mean something.
  const warned = SERVICE_KEYS.flatMap((service) =>
    (SERVICE_SOURCES[service].alsoFrom ?? []).filter((entry) => entry.critical),
  );
  assert.equal(warned.length, 1);
});

test("lightning's SMS route is a real inbound route, not just prose", () => {
  // It arrives even when the NEA tick finds nothing, so it is a second source
  // rather than a variation on the first — and the route must be contracted.
  assert.ok(SERVICE_SOURCES.lightning.inbound.includes("POST /api/lightning-sms"));
  const declared = new Set(SERVICE_CONTRACTS.lightning!.routes.map((route) => `${route.method} ${route.path}`));
  assert.ok(declared.has("POST /api/lightning-sms"));
});
