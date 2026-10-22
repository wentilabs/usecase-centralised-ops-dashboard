import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";

/**
 * Service-owned semantic overlay for a Vibration SITE row.
 *
 * The table also holds legacy WIRS target rows (`config_kind = 'legacy_target'`),
 * which HALO never lists; their selector columns are null on a site row and hidden
 * here. Scraping reads `vibration_source_targets`, and a site row contributes exactly one
 * thing to it: whether the site is enabled.
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
      // Still worth saying what it does NOT touch, because nothing here sends a message.
      help: "Master switch for scraping this site. Off, the scraper skips the site's meters; the readings table and its rows stay. A new site is created off, so enable it before its first scrape. It gates scraping only: a site sends no WhatsApp message either way. Each meter's own source target also has to be enabled (vibration_source_targets, in the vibration repo). Needs vibration's migrate_site_enabled_gates_scraping.sql applied.",
    },
    project_code: { hidden: true },
    config_kind: { hidden: true },
    meter_label: { hidden: true },
    // Read by the legacy-target test notification only; a site row never sends one.
    wa_group_ids: { hidden: true },
    instance_name: { hidden: true },
    client_id: { hidden: true },
    lambda_url: { hidden: true },
    wirs_project: { hidden: true },
    wirs_zone: { hidden: true },
    wirs_instrument_type: { hidden: true },
    wirs_instrument: { hidden: true },
    created_at: { hidden: true },
    updated_at: { hidden: true },
  },
  groups: [
    { title: "Status", fields: ["enabled", "company", "site_name", "timezone"] },
  ],
};
