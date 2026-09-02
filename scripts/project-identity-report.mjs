/**
 * Read-only review report: which project codes the identity rules believe are
 * the same site, and on what evidence. Writes JSON to stdout.
 *
 * Nothing here writes to Supabase. Run it, correct the result in
 * lib/project-identity-overrides.ts, run it again.
 *
 *   npx tsc -p tsconfig.test.json && node --env-file=.env scripts/project-identity-report.mjs
 */
import {
  absentFrom,
  clusterProjects,
  needingReview,
  singleServiceSites,
} from "../.test-dist/lib/project-identity.js";

const SERVICES = {
  wbgt: ["wbgts", "wbgt_project_configs"],
  noise: ["noise-meters", "noise_project_configs"],
  haze: ["haze", "haze_project_configs"],
  lightning: ["lightning", "lightning_project_configs"],
  ailytics: ["ailytics", "project_configs"],
  subcon: ["manpower_activity", "project_configs"],
  issueChaser: ["issue_chaser", "project_configs"],
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const rows = [];
for (const [service, [schema, table]] of Object.entries(SERVICES)) {
  const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "accept-profile": schema },
  });
  if (!response.ok) throw new Error(`${service}: HTTP ${response.status}`);
  for (const row of await response.json()) {
    rows.push({ service, projectCode: row.project_code, row });
  }
}

const clusters = clusterProjects(rows);
console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      rows: rows.length,
      distinctCodes: new Set(rows.map((r) => r.projectCode)).size,
      sites: clusters.length,
      needingReview: needingReview(clusters),
      singleServiceSites: singleServiceSites(clusters).map((c) => ({
        canonical: c.canonical,
        service: c.members[0].service,
      })),
      clusters,
      absent: Object.fromEntries(
        ["issueChaser", "subcon"].map((s) => [
          s,
          absentFrom(clusters, s).map((c) => ({ canonical: c.canonical, codes: c.codes, tier: c.tier })),
        ]),
      ),
    },
    null,
    2,
  ),
);
