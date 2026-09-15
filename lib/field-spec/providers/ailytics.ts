import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";

/** Service-owned semantic overlay; live introspection still owns physical columns. */
export const ailyticsFieldProvider: ServiceFieldProvider = {
  readonlyFields: ["id", "project_code", "created_at", "updated_at"],
  checkEnums: { company: [...COMPANIES] },
  fields: {
    company: {
      label: "Company",
      help: "Identity only — no code reads it. Backfilled from instance_name; blank means instance_name did not imply one.",
    },
    enabled: {
      label: "Project enabled",
      help: "Telegram intake switch: off stops new alerts and activity rows. Existing issues can still be closed from WhatsApp while this is off (INV-AIL-15), so this is not a full project freeze.",
    },
    timezone: { label: "Timezone" },

    telegram_chat_id: { label: "Telegram chat ID", help: "Chat the Ailytics CCTV bot posts into." },
    upstream_bot_username: { label: "Upstream bot username", row: "tg_identity" },
    expected_chat_title: {
      label: "Expected chat title",
      row: "tg_identity",
      help: "Human note only. Intake does not read it and it does not guard against a renamed or wrong chat.",
    },

    spreadsheet_id: { label: "Spreadsheet ID", widget: "sheet" },
    safety_sheet_tab: { label: "Safety sheet tab", row: "tabs" },
    activity_history_tab: { label: "Activity history tab", row: "tabs" },

    whatsapp_group_ids: { label: "WhatsApp group IDs", widget: "groups", help: "Comma-separated; one message per group." },
    forward_pending_to_whatsapp: {
      label: "Forward PENDING alerts",
      help: "Outbound attempt only (INV-AIL-14/19): every matching alert is captured either way. A pending alert starts as PENDING_DELIVERY and becomes client-facing PENDING only after at least one retained-image delivery is confirmed.",
    },
    // Added by supabase/migrate_status_summary.sql in the ailytics repo.
    status_summary_enabled: {
      label: "Daily status summary",
      help: "Lets POST /ailytics-safety/status-summary read this project's sheets and send its own Pending/open counts to the WhatsApp groups above. Project-local — it never aggregates across projects, and a disabled project is not sent one.",
    },
    instance_name: { label: "WhatsApp instance", row: "wa_identity" },
    client_id: { label: "Client ID", row: "wa_identity" },
    lambda_url: { label: "Send-message proxy URL" },
    reply_lambda_url: { label: "Reply proxy URL" },
    lambda_url_image: { label: "Image proxy URL" },

    id: { hidden: true },
    project_code: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },
  groups: [
    { title: "Status", fields: ["enabled", "company", "timezone"] },
    { title: "Telegram source", fields: ["telegram_chat_id", "upstream_bot_username", "expected_chat_title"] },
    { title: "Google Sheet", fields: ["spreadsheet_id", "safety_sheet_tab", "activity_history_tab"] },
    // What this project SENDS, separated from the plumbing it sends through.
    // Both switches were filed among four proxy URLs, where a decision about
    // behaviour reads as one more piece of wiring.
    {
      title: "What gets sent",
      fields: ["forward_pending_to_whatsapp", "status_summary_enabled", "whatsapp_group_ids"],
    },
    {
      title: "Delivery",
      fields: [
        "instance_name",
        "client_id",
        "lambda_url",
        "reply_lambda_url",
        "lambda_url_image",
      ],
    },
  ],
};
