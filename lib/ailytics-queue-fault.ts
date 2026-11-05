const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** A stored exception is not a fresh listener lookup or proof of a failed send. */
export function ailyticsQueueFault(row: Record<string, unknown>, observedAt: string): string | null {
  const response = record(row.send_response);
  const latest = record(record(response.queueReconciliation).latest);
  if (row.delivery_status !== "unconfirmed" || latest.outcome !== "not_found") return null;
  const activity = record(row.activity);
  const config = record(activity.project_config);
  const queueId = String(latest.queueId ?? row.listener_queue_id ?? "unknown");
  const messageId = typeof row.outbound_whatsapp_message_id === "string"
    ? row.outbound_whatsapp_message_id.trim() : "";
  const historyWrite = record(response.historyWrite);
  const writtenAt = Date.parse(String(historyWrite.writtenAt ?? ""));
  const submittedAt = Date.parse(String(response.deliveredAt ?? ""));
  const historyProven = historyWrite.outcome === "written" && historyWrite.activityId === activity.id
    && Number.isInteger(historyWrite.rowNumber) && Number(historyWrite.rowNumber) >= 2
    && Number.isFinite(writtenAt) && Number.isFinite(submittedAt) && writtenAt <= submittedAt;
  const details = {
    observedAt,
    activityId: activity.id ?? row.activity_event_id ?? null,
    telegramMessageId: activity.telegram_message_id ?? null,
    classification: activity.classification ?? null,
    lifecycleStatus: activity.lifecycle_status ?? null,
    linkStatus: row.delivery_status,
    whatsappMessageId: messageId || null,
    submittedAt: response.deliveredAt ?? null,
    lastListenerCheckAt: latest.checkedAt ?? null,
    listenerLookupScope: latest.lookupScope ?? null,
    lastCheckExecution: latest.execution ?? null,
    automaticPolling: "stopped_while_unconfirmed",
    historyTab: config.activity_history_tab ?? null,
    recordedHistoryRow: activity.activity_history_row_number ?? null,
    currentSheetPresence: "not_verified",
    historyWriteBeforeSubmission: historyProven ? historyWrite : "not_recorded",
    submissionExecution: response.execution ?? null,
    // This is the listener's whole batch, which can span projects and groups.
    listenerNotFound: latest.notFound ?? null,
    listenerNotFoundScope: "lookup_batch_not_this_group_only",
    ...(latest.retentionDays == null ? {} : { retentionDays: latest.retentionDays }),
  };
  const headline = messageId ? "WhatsApp delivery record inconsistent" : "WhatsApp send outcome unconfirmed";
  return `${headline}: queue ID ${queueId} for ${row.whatsapp_group_id ?? "unknown group"}; `
    + `last listener lookup=notFound at ${latest.checkedAt ?? "time unavailable"}; `
    + `automatic polling=stopped while link is unconfirmed; `
    + `activity=${activity.classification ?? "unknown"} / ${activity.lifecycle_status ?? "unknown"}; `
    + `WhatsApp message ID=${messageId || "none stored"}; `
    + `history row pointer is not proof of current sheet presence; `
    + `send outcome is not established by notFound or retentionDays; evidence=${JSON.stringify(details)}`;
}
