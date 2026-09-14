import { COMPANIES } from "../../field-spec";
import type { OnboardDefinition } from "../types";

/** Service-owned onboarding contract. Generic code validates and executes it. */
export const ailyticsOnboarding: OnboardDefinition = {
    service: "ailytics",
    // No constraint on the column; this is HALO's own rule, kept conservative
    // because the code also names two Google Sheet tabs.
    codePattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/,
    codeHelp: "Letters, digits, hyphen and underscore.",
    label: "＋ Add project",
    title: "Add a new Ailytics project",
    description:
      "Creates one disabled row in ailytics.project_configs. Validate it, then enable it in the editor.",
    outsideHalo: [
      "Share the Google Sheet with the service account as Editor — it creates the tabs itself, and sets column widths, which Viewer cannot do.",
      "Add the thin WhatsApp forwarding adapter to the project's own Lambda (docs/AILYTICS_BASE_REPO_IMPLEMENTATION_GUIDE.md).",
    ],
    uniqueTogether: ["telegram_chat_id", "upstream_bot_username"],
    fields: [
      {
        column: "project_code",
        label: "Project code",
        kind: "text",
        required: true,
        notNull: true,
        help: "Unique. Also used to name both sheet tabs.",
      },
      {
        column: "company",
        label: "Company",
        kind: "select",
        required: false,
        notNull: false,
        // Identity only — nothing reads it — but it drives the card watermark and
        // the search box, so it is worth setting while someone knows the answer.
        // Blank stays legal: a new operating company arrives before this list does.
        options: ["", ...COMPANIES],
        help: "Identity only; no code reads it. Sets the card's background mark and makes the project findable by company.",
      },
      {
        column: "timezone",
        label: "Timezone",
        kind: "text",
        required: true,
        notNull: true,
        fallback: "Asia/Singapore",
      },
      {
        column: "spreadsheet_id",
        label: "Spreadsheet ID",
        kind: "sheet",
        required: true,
        notNull: true,
        help: "The workbook must already exist and be shared with the service account.",
      },
      {
        column: "activity_history_tab",
        computed: true,
        label: "Activity history tab",
        kind: "text",
        required: true,
        notNull: true,
        derive: (_draft, code) => `(${code}) CCTV History`,
        help: "Created automatically on first write if missing.",
      },
      {
        column: "safety_sheet_tab",
        computed: true,
        label: "Safety sheet tab",
        kind: "text",
        required: true,
        notNull: true,
        derive: (_draft, code) => `(${code}) CCTV Safety Sheet`,
      },
      {
        column: "telegram_chat_id",
        label: "Telegram chat ID",
        kind: "text",
        required: false,
        notNull: true,
        help: "Leave blank if unknown. Only one draft may be blank at a time — it is half of a unique key.",
      },
      {
        column: "upstream_bot_username",
        label: "Upstream bot username",
        kind: "text",
        required: false,
        notNull: true,
        help: "Leave blank if unknown. The other half of that unique key.",
      },
      {
        column: "expected_chat_title",
        label: "Expected chat title",
        kind: "text",
        required: false,
        notNull: false,
        help: "Informational only — matching uses the chat ID and bot username.",
      },
      {
        column: "instance_name",
        label: "WhatsApp instance",
        kind: "text",
        required: false,
        notNull: true,
      },
      {
        column: "client_id",
        label: "Client ID",
        kind: "text",
        required: false,
        notNull: true,
      },
      {
        column: "whatsapp_group_ids",
        label: "WhatsApp group IDs",
        kind: "groups",
        required: false,
        notNull: true,
        help: "Comma-separated.",
      },
      {
        column: "lambda_url",
        label: "Send-message URL",
        kind: "text",
        required: true,
        notNull: true,
        envDefault: "DEFAULT_LAMBDA_URL_SEND",
      },
      {
        column: "reply_lambda_url",
        label: "Reply-message URL",
        kind: "text",
        required: false,
        notNull: false,
        envDefault: "DEFAULT_LAMBDA_URL_REPLY",
      },
      {
        column: "lambda_url_image",
        label: "Send-document URL",
        kind: "text",
        required: false,
        notNull: false,
        envDefault: "DEFAULT_LAMBDA_URL_IMAGE",
        help: "Left blank, the service derives /send-document from the send-message URL.",
      },
    ],
  };
