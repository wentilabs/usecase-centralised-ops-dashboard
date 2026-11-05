import assert from "node:assert/strict";
import test from "node:test";
import { ailyticsQueueFault } from "../lib/ailytics-queue-fault";

const checkAt = "2026-10-28T13:03:49.246Z";
const observedAt = "2026-11-05T10:00:00.000Z";
function link(classification: string = "COMPLIANT") {
  return {
    id: "link-1", delivery_status: "unconfirmed", listener_queue_id: "98403",
    whatsapp_group_id: "zra@g.us", outbound_whatsapp_message_id: null as string | null,
    activity: { id: "activity-1", classification, lifecycle_status: "compliant",
      telegram_message_id: "21813", activity_history_row_number: 1007,
      project_config: { project_code: "ZRA", activity_history_tab: "(ZRA) CCTV History" } },
    send_response: { queueReconciliation: { latest: {
      outcome: "not_found", checkedAt: checkAt, retentionDays: 7,
      notFound: { queueIds: [98360, 98403], idempotencyKeys: [] },
    } } } as Record<string, unknown>,
  };
}

test("old notFound remains a historical observation even after a terminal Telegram classification", () => {
  const message = ailyticsQueueFault(link(), observedAt)!;
  assert.match(message, /send outcome unconfirmed/);
  const facts = JSON.parse(message.split("evidence=")[1]);
  assert.equal(facts.observedAt, observedAt);
  assert.equal(facts.lastListenerCheckAt, checkAt);
  assert.equal(facts.classification, "COMPLIANT");
  assert.equal(facts.whatsappMessageId, null);
  assert.equal(facts.telegramMessageId, "21813");
  assert.equal(facts.currentSheetPresence, "not_verified");
  assert.equal(facts.recordedHistoryRow, 1007);
  assert.equal(facts.historyWriteBeforeSubmission, "not_recorded");
  assert.equal(facts.submissionExecution, null);
  assert.equal(facts.listenerNotFoundScope, "lookup_batch_not_this_group_only");
  assert.equal(facts.automaticPolling, "stopped_while_unconfirmed");
});

test("stored IDs and successful pre-submission write evidence are reported explicitly", () => {
  const row = link("PENDING");
  row.outbound_whatsapp_message_id = "true_zra@g.us_ABC";
  row.send_response.historyWrite = { outcome: "written", activityId: "activity-1", rowNumber: 1007, writtenAt: "2026-10-28T11:00:00.000Z" };
  row.send_response.deliveredAt = "2026-10-28T11:00:10.000Z";
  row.send_response.execution = { route: "/telegram-webhook", awsRequestId: "invoke-1" };
  const message = ailyticsQueueFault(row, observedAt)!;
  assert.match(message, /delivery record inconsistent/);
  const facts = JSON.parse(message.split("evidence=")[1]);
  assert.equal(facts.whatsappMessageId, "true_zra@g.us_ABC");
  assert.equal(facts.historyWriteBeforeSubmission.outcome, "written");
  assert.equal(facts.submissionExecution.awsRequestId, "invoke-1");
});

test("only current unconfirmed links with explicit notFound generate this exception", () => {
  for (const status of ["sent", "queued", "failed", ""]) {
    const row = link(); row.delivery_status = status;
    assert.equal(ailyticsQueueFault(row, observedAt), null);
  }
  assert.equal(ailyticsQueueFault({ delivery_status: "unconfirmed", send_response: null }, observedAt), null);
});

test("malformed legacy relations and receipts do not invent sheet evidence", () => {
  const row = link();
  row.send_response.historyWrite = { outcome: "written", activityId: "other-activity", rowNumber: 1007, writtenAt: checkAt };
  assert.match(ailyticsQueueFault(row, observedAt)!, /"historyWriteBeforeSubmission":"not_recorded"/);
  row.send_response.historyWrite = { outcome: "written", activityId: "activity-1", rowNumber: 1007, writtenAt: "invalid date" };
  assert.match(ailyticsQueueFault(row, observedAt)!, /"historyWriteBeforeSubmission":"not_recorded"/);
  assert.match(ailyticsQueueFault({ ...row, activity: null }, observedAt)!, /activity=unknown \/ unknown/);
});
