import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

/**
 * Guards the deployment shape that is known to work on AWS Amplify, mirroring
 * the contract test in wenti-penta-ocean-safety-fe. If a dependency bump or a
 * stray file would break the Amplify build, this fails first.
 */

const repoFile = (path: string) => resolve(path);
const source = (path: string) => readFile(repoFile(path), "utf8");

async function fileExists(path: string) {
  try {
    await access(repoFile(path));
    return true;
  } catch {
    return false;
  }
}

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
};

test("deployment tracks the Next 16 version proven on the sibling Amplify apps", async () => {
  const packageJson = JSON.parse(await source("package.json")) as PackageJson;

  assert.match(packageJson.dependencies?.next ?? "", /^16\./);
  assert.match(packageJson.dependencies?.react ?? "", /^19\./);
  assert.match(packageJson.dependencies?.["react-dom"] ?? "", /^19\./);
  assert.match(packageJson.dependencies?.["@supabase/ssr"] ?? "", /^0\.12\./);
  // The shared auth project enforces CAPTCHA on sign-in.
  assert.match(packageJson.dependencies?.["@marsidev/react-turnstile"] ?? "", /^1\./);

  // Next 16 renames middleware to proxy; the working apps keep middleware.ts
  // and must not carry a root proxy.ts alongside it.
  assert.equal(await fileExists("middleware.ts"), true);
  assert.equal(await fileExists("proxy.ts"), false);
});

test("amplify.yml builds the Next app and publishes .next", async () => {
  const amplify = await source("amplify.yml");

  assert.match(amplify, /npm ci/, "preBuild installs from the lockfile");
  assert.match(amplify, /npm run build/);
  assert.match(amplify, /baseDirectory:\s*\.next/);
  assert.match(amplify, /node_modules/, "node_modules is cached between builds");
});

test("amplify.yml carries every runtime variable into .env.production", async () => {
  const amplify = await source("amplify.yml");

  // Amplify does not reliably hand console variables to the Next server, so a
  // variable missing from this grep is a variable the deployed app cannot read.
  for (const key of [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "LISTENER_SUPABASE_URL",
    "LISTENER_SUPABASE_ANON_KEY",
    "WHITELIST_EMAILS",
    "WHITELIST_DOMAINS",
    "EDITOR_EMAILS",
    "NEXT_PUBLIC_",
  ]) {
    assert.ok(amplify.includes(key), `amplify.yml must capture ${key}`);
  }
  assert.match(amplify, /\.env\.production/);
});

test("the lockfile is committed so npm ci can run", async () => {
  assert.equal(await fileExists("package-lock.json"), true);
});

test("Node is pinned to the Amplify runtime", async () => {
  const packageJson = JSON.parse(await source("package.json")) as PackageJson;
  assert.match(packageJson.engines?.node ?? "", /22/);
  assert.equal((await source(".nvmrc")).trim(), "22");
});

test("the privileged Supabase key is never exposed to the browser", async () => {
  const example = await source(".env.example");

  // A NEXT_PUBLIC_ prefix on the secret would ship it in the client bundle.
  assert.doesNotMatch(example, /NEXT_PUBLIC_SUPABASE_SECRET_KEY/);
  assert.match(example, /^SUPABASE_SECRET_KEY=/m);
  // Auth keys are publishable by design and must carry the prefix.
  assert.match(example, /NEXT_PUBLIC_AUTH_SUPABASE_URL/);
  assert.match(example, /NEXT_PUBLIC_AUTH_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(example, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/, "CAPTCHA site key is required in deployments");

  const repository = await source("lib/config-repository.ts");
  assert.match(repository, /^import "server-only";/m, "config reads/writes stay server-side");
});

test("production cannot be reached without an allow-list", async () => {
  const example = await source(".env.example");
  assert.match(example, /WHITELIST_EMAILS/);
  assert.match(example, /WHITELIST_DOMAINS/);

  // shouldBypassLocalAuth must refuse production regardless of other inputs.
  const policy = await source("lib/auth-policy.ts");
  assert.match(policy, /nodeEnv === "production"/);
});
