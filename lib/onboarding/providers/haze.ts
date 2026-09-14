import { COMPANIES } from "../../field-spec";
import type { OnboardDefinition } from "../types";
import { deriveNeaRegion } from "../../derive";

/** Service-owned onboarding contract. Generic code validates and executes it. */
export const hazeOnboarding: OnboardDefinition = {
    service: "haze",
    codePattern: /^[A-Z0-9][A-Z0-9-]{0,47}$/,
    codeHelp: "Uppercase letters, digits and hyphens only — the column CHECK rejects lowercase and underscores.",
    label: "＋ Add project",
    title: "Add a new Haze project",
    description:
      "Creates one disabled row in haze.haze_project_configs. Readings are shared per region, so there is nothing else to create.",
    outsideHalo: [
      "Confirm the derived NEA region against NEA's own regional map. HALO infers it from the coordinates, and the service then trusts the stored value forever — correcting the coordinates later will NOT move the project.",
      "Delivery cannot be half-configured: haze_enabled_delivery_check refuses enabled = true unless lambda_url, instance_name, client_id and the group list are all set, so fill them in before enabling.",
    ],
    fields: [
      {
        column: "project_code",
        label: "Project code",
        kind: "text",
        required: true,
        notNull: true,
        help: "Uppercase. Enforced by a CHECK on the column.",
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
        column: "latitude",
        label: "Latitude",
        kind: "number",
        required: true,
        notNull: true,
        range: { min: 1.1, max: 1.5 },
        help: "Singapore only. Use the address lookup if you do not have coordinates.",
      },
      {
        column: "longitude",
        label: "Longitude",
        kind: "number",
        required: true,
        notNull: true,
        range: { min: 103.55, max: 104.15 },
      },
      {
        column: "site_address",
        label: "Site address",
        kind: "text",
        required: false,
        notNull: false,
        help: "Optional. Filled in by the address lookup.",
      },
      {
        column: "nea_region",
        label: "NEA region",
        kind: "text",
        required: true,
        notNull: true,
        help: "Derived from the coordinates as you type. Editable — an explicit value is trusted outright.",
        autofill: (draft) => {
          const derived = deriveNeaRegion(Number(draft.latitude), Number(draft.longitude));
          if (!derived) return null;
          return { value: derived.region, note: derived.note, review: derived.requiresManualReview };
        },
      },
      // Cadence and wording, offered here rather than left to the editor: these
      // are the questions asked when a site is onboarded, and every one of them
      // has a default that is a real decision.
      {
        column: "four_hourly",
        label: "Four-hourly override (now every 2 hours)",
        kind: "toggle",
        required: false,
        notNull: true,
        fallback: "false",
        help: "Guarantees a send every two hours — 08, 10, 12, 14, 16, 18 and 20 SGT — on top of the hourly advisory, ignoring both the floor below and the working-hours window. Seven slots despite the column name, which was left alone when the interim widening landed. Every other hour follows the ordinary rules.",
      },
      {
        column: "alert_only_when_at_least",
        label: "Alert only when at least",
        kind: "select",
        required: false,
        notNull: false,
        // Blank is the historical default and means every band sends. `good` is
        // the lowest band, so choosing it is the same thing said louder.
        options: ["", "good", "moderate", "unhealthy", "very_unhealthy", "hazardous"],
        help: "Suppresses the hourly advisory below this band. Unset sends every hour; `good` is the lowest band, so it is identical to unset.",
      },
      {
        column: "advisory_format",
        label: "Advisory format",
        kind: "select",
        required: false,
        notNull: true,
        fallback: "default",
        options: ["default", "wohhup"],
        help: "`wohhup` renders the house wording. An unrecognised value throws at run time rather than falling back, which is why this is a fixed list.",
      },
      {
        column: "working_hours_start_hhmm",
        label: "Working hours start",
        kind: "hhmm",
        hidden: true,
        required: false,
        notNull: false,
        fallback: "0800",
        help: "HHMM, e.g. 0800. Both ends or neither — one alone means no window at all.",
      },
      {
        column: "working_hours_end_hhmm",
        label: "Working hours end",
        kind: "hhmm",
        hidden: true,
        required: false,
        notNull: false,
        fallback: "1900",
        help: "Exclusive. An end at or before the start is an overnight window, not an empty one.",
      },
      {
        column: "remove_sunday_notifications",
        label: "Mute Sundays",
        kind: "toggle",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "true",
        help: "Outbound only — ingestion and evaluation continue. On by default for a new project; turn it off in the editor for a site that works Sundays.",
      },
      {
        column: "remove_ph_notifications",
        label: "Mute public holidays",
        kind: "toggle",
        hidden: true,
        required: false,
        notNull: true,
        fallback: "true",
        help: "Same, for the hard-coded Singapore holiday list, which currently ends on 2027-12-25.",
      },
      // Mentions. Three columns that only work together, which is exactly why
      // they belong on one screen rather than being found one at a time in the
      // editor: the flag alone tags nobody, and an empty group list is
      // fail-closed however well the rest is filled in.
      {
        column: "enable_poc_mentions",
        label: "POC mentions",
        kind: "toggle",
        required: false,
        notNull: true,
        fallback: "false",
        help: "Tags the numbers below once the band is high enough. Needs a group list as well — empty means nobody is mentioned anywhere.",
      },
      {
        column: "poc_mentions_at_least",
        label: "Mention from band",
        kind: "select",
        required: false,
        notNull: false,
        options: ["", "good", "moderate", "unhealthy", "very_unhealthy", "hazardous"],
        help: "Lowest band that triggers a mention. Checked independently of the alert floor above, so a mention floor below it can never fire — the message it would ride on is not sent.",
      },
      {
        column: "poc_phone_numbers",
        label: "POC phone numbers",
        kind: "text",
        required: false,
        notNull: false,
        help: "Digits only, comma-separated, international without the +. e.g. 6591234567.",
      },
      {
        column: "poc_alert_wa_groups",
        label: "POC mention groups",
        kind: "groups",
        required: false,
        notNull: false,
        help: "Which groups get the mentions. Fail-closed: empty means none of them do, even with the flag on and numbers stored.",
      },
      {
        column: "wa_group_ids",
        label: "WhatsApp group IDs",
        kind: "groups",
        required: false,
        notNull: false,
        help: "Comma-separated; one message per group.",
      },
      {
        column: "instance_name",
        label: "WhatsApp instance",
        kind: "text",
        required: false,
        notNull: false,
      },
      {
        column: "client_id",
        label: "Client ID",
        kind: "text",
        required: false,
        notNull: false,
      },
      {
        column: "lambda_url",
        label: "Send-message URL",
        kind: "text",
        required: false,
        notNull: false,
        envDefault: "DEFAULT_LAMBDA_URL_SEND",
      },
    ],
  };
