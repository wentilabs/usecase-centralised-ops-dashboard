import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const familyRoot = path.resolve(process.env.SERVICE_REPOSITORY_ROOT || path.dirname(dashboardRoot));
const lockPath = path.join(dashboardRoot, "contracts", "service-contract.lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const allowedKinds = new Set(["scheduled", "operator", "webhook", "read", "diagnostic"]);
const allowedAuth = new Set(["none", "optional-service-key", "required-service-key", "sms-hmac", "required-hmac"]);

function fail(message) {
  throw new Error(`[service-contracts] ${message}`);
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
}

function repositoryPath(entry) {
  const directory = entry.repository.split("/").at(-1);
  const repo = path.join(familyRoot, directory);
  if (!existsSync(repo)) fail(`missing sibling checkout ${repo}`);
  return repo;
}

function validateContract(key, raw) {
  let contract;
  try { contract = JSON.parse(raw); } catch (error) { fail(`${key} is not valid JSON: ${error.message}`); }
  if (contract.schemaVersion !== 1 || contract.service?.key !== key) fail(`${key} has the wrong contract identity`);
  if (!contract.configuration?.fields || !Array.isArray(contract.routes)) fail(`${key} has an incomplete contract`);
  for (const route of contract.routes) {
    if (!route.method || !route.path?.startsWith("/") || !allowedKinds.has(route.kind) || !allowedAuth.has(route.authentication)) {
      fail(`${key} has invalid route metadata for ${route.path || "<unknown>"}`);
    }
  }
  for (const [fieldName, field] of Object.entries(contract.configuration.fields)) {
    if (!field.label || !field.group || !field.help || typeof field.mutable !== "boolean" || !field.role) {
      fail(`${key}.${fieldName} lacks HALO semantics`);
    }
  }
  return contract;
}

function validateMigrationPlan(key, raw, contract) {
  let plan;
  try { plan = JSON.parse(raw); } catch (error) { fail(`${key} migration plan is not valid JSON: ${error.message}`); }
  if (plan.schemaVersion !== 1) fail(`${key} migration plan has an unsupported schemaVersion`);
  if (plan.schema !== contract.configuration.schema) {
    fail(`${key} migration schema ${plan.schema || "<missing>"} differs from service contract ${contract.configuration.schema}`);
  }
  if (!plan.freshInstall || !Array.isArray(plan.upgrades)) fail(`${key} migration plan is incomplete`);
  const lifecycleEntries = [
    plan.freshInstall,
    ...plan.upgrades,
    ...(plan.dataMigrations || []),
    ...(plan.operationalUtilities || []),
    ...(plan.destructiveUtilities || []),
  ];
  const files = lifecycleEntries.map((entry) => typeof entry === "string" ? entry : entry.file);
  if (files.some((file) => !file) || new Set(files).size !== files.length) fail(`${key} migration files are missing or classified more than once`);
  const seen = new Set();
  for (const upgrade of plan.upgrades) {
    if (!upgrade.id || !upgrade.file || seen.has(upgrade.id)) fail(`${key} has an invalid or duplicate migration id`);
    for (const dependency of upgrade.requires || []) {
      if (!seen.has(dependency)) fail(`${key}.${upgrade.id} depends on a migration that is not earlier in its plan`);
    }
    seen.add(upgrade.id);
  }
  return plan;
}

function refresh(keys) {
  if (!keys.length) fail("refresh requires one or more service keys; broad updates must be explicit");
  for (const key of keys) {
    const entry = lock.services[key];
    if (!entry) fail(`unknown service key ${key}`);
    const repo = repositoryPath(entry);
    const branch = git(repo, ["branch", "--show-current"]);
    if (branch !== entry.branch) fail(`${key} is on ${branch || "detached HEAD"}, expected ${entry.branch}`);
    try {
      execFileSync("git", ["-C", repo, "diff", "--quiet", "--", entry.path, entry.sqlPath]);
      execFileSync("git", ["-C", repo, "diff", "--cached", "--quiet", "--", entry.path, entry.sqlPath]);
    } catch (_) {
      fail(`${key} contract has uncommitted changes; commit and verify it before refreshing HALO`);
    }
    const commit = git(repo, ["rev-parse", "HEAD"]);
    const raw = git(repo, ["show", `${commit}:${entry.path}`]) + "\n";
    const contract = validateContract(key, raw);
    const rawSql = git(repo, ["show", `${commit}:${entry.sqlPath}`]) + "\n";
    validateMigrationPlan(key, rawSql, contract);
    writeFileSync(path.join(dashboardRoot, entry.vendoredPath), raw);
    writeFileSync(path.join(dashboardRoot, entry.vendoredSqlPath), rawSql);
    entry.commit = commit;
    process.stdout.write(`refreshed ${key} from ${commit}\n`);
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

function check() {
  for (const [key, entry] of Object.entries(lock.services)) {
    if (!/^[0-9a-f]{40}$/.test(entry.commit)) fail(`${key} lock does not contain a full commit SHA`);
    const repo = repositoryPath(entry);
    let upstream;
    let upstreamSql;
    try {
      upstream = git(repo, ["show", `${entry.commit}:${entry.path}`]) + "\n";
      upstreamSql = git(repo, ["show", `${entry.commit}:${entry.sqlPath}`]) + "\n";
    }
    catch (_) { fail(`${key} pinned contract ${entry.commit}:${entry.path} is unavailable locally`); }
    const vendoredPath = path.join(dashboardRoot, entry.vendoredPath);
    if (!existsSync(vendoredPath)) fail(`${key} vendored contract is missing`);
    const vendored = readFileSync(vendoredPath, "utf8");
    const contract = validateContract(key, vendored);
    if (vendored !== upstream) fail(`${key} vendored contract differs from its pinned source revision`);
    const vendoredSqlPath = path.join(dashboardRoot, entry.vendoredSqlPath);
    if (!existsSync(vendoredSqlPath)) fail(`${key} vendored migration plan is missing`);
    const vendoredSql = readFileSync(vendoredSqlPath, "utf8");
    validateMigrationPlan(key, vendoredSql, contract);
    if (vendoredSql !== upstreamSql) fail(`${key} vendored migration plan differs from its pinned source revision`);
    process.stdout.write(`verified ${key} @ ${entry.commit}\n`);
  }
}

const args = process.argv.slice(2);
if (args[0] === "--refresh") refresh(args.slice(1));
else if (args.length) fail(`unknown arguments: ${args.join(" ")}`);
check();
