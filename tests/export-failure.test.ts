import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { LAMBDA_RESPONSE_LIMIT_BYTES, describeExportFailure, isAwsEnvelope } from "../lib/export-failure";
import { EXPORTS } from "../lib/jobs";

const noise = EXPORTS["noise-export"];

const classify = (status: number, body: string) =>
  describeExportFailure({
    status,
    parsed: (() => {
      try {
        return JSON.parse(body) as Record<string, unknown>;
      } catch {
        return null;
      }
    })(),
    text: body,
    definition: noise,
  });

/**
 * The bodies below are verbatim from the live noise deployment on 2026-09-24,
 * not invented — the whole point of this module is telling two real response
 * shapes apart, and a guessed shape would classify guessed traffic.
 */
const AWS_500 = '{"message":"Internal Server Error"}';
const AWS_503 = '{"message":"Service Unavailable"}';
const SERVICE_ERROR = '{"success":false,"error":"tab \\"Nope\\" is not a sheet of this workbook. Available: Overview"}';

test("AWS's envelope is told apart from the service's own reply", () => {
  // Every service reply carries `success`, and a failure carries `error`. The
  // gateway's carries neither — which is the test, rather than matching on the
  // text of `message`, which differs per failure and per gateway type.
  assert.equal(isAwsEnvelope(JSON.parse(AWS_500)), true);
  assert.equal(isAwsEnvelope(JSON.parse(AWS_503)), true);
  assert.equal(isAwsEnvelope(JSON.parse(SERVICE_ERROR)), false);
  // A service reply that happens to carry a `message` too is still the service.
  assert.equal(isAwsEnvelope({ success: false, error: "boom", message: "boom" }), false);
  assert.equal(isAwsEnvelope(null), false);
});

test("a 500 with no service reply is named as the size limit, not as a broken deployment", () => {
  const blocker = classify(500, AWS_500);
  assert.equal(blocker.code, "response_too_large");
  // The old text sent people to check the deployment and the Google
  // credentials. Both were verified fine while this exact body was coming back,
  // so saying it again would send them to look at the two things that work.
  assert.doesNotMatch(blocker.remedy, /credentials are set/);
  assert.match(blocker.remedy, /6 MB/);
  // And it must say what to do instead, or it is only a better-phrased dead end.
  assert.match(blocker.remedy, /single sheet|date window/);
  assert.equal(blocker.detail, AWS_500);
});

test("a gateway timeout is named as a timeout, and points at the faster format", () => {
  for (const status of [503, 504]) {
    const blocker = classify(status, AWS_503);
    assert.equal(blocker.code, "service_timeout");
    // PDF is what actually times out: the same workbooks that fail as PDF at
    // 30s succeed as xlsx in 8-11s.
    assert.match(blocker.remedy, /xlsx/);
  }
});

test("the service's own sentence is kept when the service is the one talking", () => {
  const blocker = classify(500, SERVICE_ERROR);
  assert.equal(blocker.code, "service_error");
  // Unchanged from before: when the service answered for itself, its message is
  // the useful one and the deployment advice is the right advice.
  assert.match(blocker.remedy, /credentials are set/);
  assert.match(blocker.detail ?? "", /is not a sheet of this workbook/);
});

test("an unparseable body still produces a blocker rather than throwing", () => {
  const blocker = describeExportFailure({
    status: 502,
    parsed: null,
    text: "<html>502 Bad Gateway</html>",
    definition: noise,
  });
  assert.equal(blocker.code, "service_error");
  assert.match(blocker.detail ?? "", /502 Bad Gateway/);
});

test("an unexpected gateway status is not silently read as a size problem", () => {
  // Only 500 means "finished, then could not reply". A 429 or a 403 from the
  // gateway is something else entirely, and claiming the workbook is too large
  // would be a confident wrong answer.
  const blocker = classify(429, '{"message":"Too Many Requests"}');
  assert.equal(blocker.code, "gateway_error");
  assert.match(blocker.remedy, /is deployed on the noise Lambda/);
});

test("the documented limit is the one AWS actually enforces", () => {
  assert.equal(LAMBDA_RESPONSE_LIMIT_BYTES, 6_291_456);
  // The largest observed success was TSC at 6,121,954 bytes — 97% of the cap
  // and still served. Anything claiming a materially lower ceiling would make
  // the remedy wrong for the projects that currently work.
  assert.ok(6_121_954 < LAMBDA_RESPONSE_LIMIT_BYTES, "TSC succeeded and must sit under the stated cap");
});

test("the route classifies rather than hard-coding one remedy", async () => {
  const route = await readFile(resolve("app/api/exports/[export]/route.ts"), "utf8");
  assert.match(route, /describeExportFailure\(\{ status: res\.status, parsed, text, definition \}\)/);
  // The old single remedy must not survive alongside it, or the two would
  // disagree about the same response.
  assert.doesNotMatch(route, /code: "service_error"/);
});
