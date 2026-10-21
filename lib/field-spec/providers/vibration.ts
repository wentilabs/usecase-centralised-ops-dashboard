import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";

/**
 * Service-owned semantic overlay for a Vibration SITE row.
 *
 * The table also holds legacy WIRS target rows (`config_kind = 'legacy_target'`),
 * which HALO never lists; their selector columns are null on a site row and hidden
 * here. Scraping is driven by `vibration_source_targets`, not by this row, so almost
 * nothing on it changes what the service does.
 */
export const vibrationFieldProvider: ServiceFieldProvider = {
  readonlyFields: ["project_code", "config_kind", "created_at", "updated_at"],
  checkEnums: { company: [...COMPANIES] },
  fields: {
    company: {
      label: "Company",
      help: "Labelling only — nothing reads it.",
    },
    site_name: {
      label: "Site name",
      help: "How the site is named to operators.",
    },
    timezone: {
      label: "Timezone",
      help: "IANA timezone used to read the site's timestamps, e.g. Asia/Singapore.",
    },
    enabled: {
      label: "Diagnostic notification",
      // The word "enabled" means "paused" everywhere else on this page. Here it
      // does not, and that is the mistake worth preventing.
      help: "Does NOT pause scraping: the scraper writes every source target whose site row exists, enabled or not. This only decides whether the operator-run test notification includes the project. To stop a site's readings, disable its source target in vibration_source_targets.",
    },
    wa_group_ids: {
      label: "Notification groups",
      widget: "groups",
      help: "Used only by the operator-run test notification. Scraping never messages a group.",
    },
    instance_name: { label: "WhatsApp instance", help: "Listener instance for the test notification." },
    client_id: { label: "Client ID", help: "Sending-account identifier for the test notification." },
    lambda_url: { label: "Send-message URL", help: "Listener text endpoint for the test notification." },

    project_code: { hidden: true },
    config_kind: { hidden: true },
    meter_label: { hidden: true },
    wirs_project: { hidden: true },
    wirs_zone: { hidden: true },
    wirs_instrument_type: { hidden: true },
    wirs_instrument: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },
  groups: [
    { title: "Site", fields: ["company", "site_name", "timezone"] },
    { title: "Diagnostic notification", fields: ["enabled", "wa_group_ids", "instance_name", "client_id", "lambda_url"] },
  ],
};
