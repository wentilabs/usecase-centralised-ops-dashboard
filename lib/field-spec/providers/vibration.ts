import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";

/**
 * Service-owned semantic overlay for a Vibration SITE row.
 *
 * The table also holds legacy WIRS target rows (`config_kind = 'legacy_target'`),
 * which HALO never lists; their selector columns are null on a site row and hidden
 * here. Scraping reads `vibration_source_targets`; site delivery settings serve
 * manual PPV reports and enabled PPV threshold alerts.
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
      label: "Project enabled",
      // Gates the scrape since the vibration repo's migrate_site_enabled_gates_scraping.sql:
      // the scraper reads source targets through a view that requires an enabled site.
      help: "Master switch for scraping this site. Off, the scraper skips the site's meters; the readings table and its rows stay. A new site is created off, so enable it before its first scrape. The manual PPV report can still preview stored readings. Each meter's source target must also be enabled.",
    },
    wa_group_ids: {
      label: "Report WhatsApp groups",
      widget: "groups",
      help: "Recipients for manual latest-PPV reports and automatic PPV threshold alerts when the Lambda alert switch is on. Blank prevents delivery.",
    },
    client_id: { label: "WhatsApp client ID", help: "Sending account used by reports and PPV alerts." },
    instance_name: { label: "WhatsApp instance", help: "Listener instance used by reports and PPV alerts; defaults to the client ID." },
    lambda_url: { label: "Send-message URL", help: "Listener endpoint used by reports and PPV alerts." },
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
    { title: "Status", fields: ["enabled", "company", "site_name", "timezone"] },
    { title: "WhatsApp delivery", fields: ["wa_group_ids", "client_id", "instance_name", "lambda_url"] },
  ],
};
