import { NextResponse } from "next/server";

import { openapiDocument } from "@/lib/openapi";

export const dynamic = "force-static";

/**
 * The machine-readable contract.
 *
 * Deliberately unauthenticated: a spec describes the shape of the API, not its
 * data, and an agent needs to read it before it has a credential to try. It
 * contains no secrets — server URLs and operation names only.
 */
export async function GET() {
  return NextResponse.json(openapiDocument, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
