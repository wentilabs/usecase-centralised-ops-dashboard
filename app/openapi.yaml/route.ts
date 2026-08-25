import { stringify } from "yaml";

import { openapiDocument } from "@/lib/openapi";

export const dynamic = "force-static";

/**
 * The same document as `/openapi.json`, rendered for a human.
 *
 * Both come from `lib/openapi.ts`, so they cannot disagree. `lineWidth: 0`
 * disables YAML's line folding — a folded description reads badly in a diff and
 * some naive parsers rejoin it wrongly.
 */
export async function GET() {
  const body = stringify(openapiDocument, { lineWidth: 0 });
  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/yaml; charset=utf-8",
    },
  });
}
