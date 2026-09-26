import type { ExportBlocker, ExportDefinition } from "./jobs";

/**
 * Why an export came back wrong, told apart by who actually answered.
 *
 * The alert services wrap every route in `createPostJsonHandler`, which catches
 * its own errors and replies `{ success: false, error: "<what went wrong>" }`.
 * So a body carrying `error` is the service speaking, and its sentence is worth
 * repeating verbatim.
 *
 * `{"message":"Internal Server Error"}` is not that shape. It is the AWS
 * envelope — API Gateway's own reply when the function never returned a usable
 * response — and it means the service's error handling never ran. Telling
 * someone to check that the route is deployed and its Google credentials are
 * set, which is what HALO used to say for every failure, is then actively
 * misleading: both can be perfectly fine.
 *
 * Measured against the live noise deployment on 2026-09-24:
 *
 *   TSC        6,121,954 bytes  97% of the cap   200 OK
 *   WCP        5,880,130        93%              200 OK
 *   MVR / P105 / TEST           —                500 in 8–11s
 *
 * The three that fail return the AWS envelope after finishing quickly, and the
 * same MVR workbook exports fine one tab at a time (65 KB). The export returns
 * the file inline as base64 inside the JSON, and Lambda caps a synchronous
 * response at 6 MB, so a workbook past that is discarded after the work is
 * done. Nothing about the sheet, the credentials or the deployment is wrong.
 */

/** Lambda's synchronous invocation response limit; the binding one here. */
export const LAMBDA_RESPONSE_LIMIT_BYTES = 6 * 1024 * 1024;

/**
 * Whether this body is AWS talking rather than the service.
 *
 * API Gateway replies `{ "message": "..." }` and nothing else. Every service
 * reply carries `success`, and a failure carries `error` — so requiring the
 * absence of both is what separates them, rather than matching on the text of
 * `message`, which differs per failure and per gateway type.
 */
export function isAwsEnvelope(parsed: Record<string, unknown> | null): boolean {
  if (!parsed) return false;
  return (
    typeof parsed.message === "string" &&
    parsed.error === undefined &&
    parsed.success === undefined
  );
}

/**
 * The blocker to show, given what came back.
 *
 * `scopeHint` is the way out, and it differs per service: the caller knows
 * which narrower scopes its own dialog can offer.
 */
export function describeExportFailure({
  status,
  parsed,
  text,
  definition,
}: {
  status: number;
  parsed: Record<string, unknown> | null;
  text: string;
  definition: Pick<ExportDefinition, "service" | "path">;
}): ExportBlocker {
  const detail = String(parsed?.error ?? text.slice(0, 500));

  if (isAwsEnvelope(parsed)) {
    // Finished, then could not reply. The work succeeded and the file was too
    // big to hand back inline.
    if (status === 500) {
      return {
        code: "response_too_large",
        summary: "The workbook is too large to return in one piece",
        remedy:
          `This is not a problem with the sheet or with ${definition.service}'s credentials — the export ran and ` +
          `then could not be handed back. The file travels inline inside the service's reply, and AWS Lambda caps ` +
          `that reply at 6 MB, so a workbook past roughly that size is discarded after the work is done. Export a ` +
          `single sheet, or a narrower date window, rather than the whole workbook.`,
        detail,
      };
    }
    // Never finished. A 74-tab workbook rendered to PDF is the usual cause.
    if (status === 503 || status === 504) {
      return {
        code: "service_timeout",
        summary: `The ${definition.service} service did not finish in time`,
        remedy:
          `AWS cut the request off at its gateway timeout, so the service never got to reply. Rendering a large ` +
          `workbook — especially to PDF, which is slower than xlsx — can take longer than that. Try xlsx, or ` +
          `export a single sheet or a narrower date window.`,
        detail,
      };
    }
    return {
      code: "gateway_error",
      summary: `AWS returned ${status} before the ${definition.service} service could reply`,
      remedy:
        `The body below is AWS's, not the service's — its own error handling never ran, so the route itself may ` +
        `not be reachable. Check that ${definition.path} is deployed on the ${definition.service} Lambda.`,
      detail,
    };
  }

  // The service answered for itself. Its sentence is the useful one.
  return {
    code: "service_error",
    summary: `The ${definition.service} service returned ${status}`,
    remedy:
      `Check that ${definition.path} is deployed on the ${definition.service} Lambda and that its Google ` +
      `credentials are set. The service's own message is below.`,
    detail,
  };
}
