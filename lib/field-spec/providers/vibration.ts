import type { ServiceFieldProvider } from "../types";
import { COMPANIES } from "../types";

/**
 * Service-owned semantic overlay for a Vibration SITE row.
 *
 * The table also holds legacy WIRS target rows (`config_kind = 'legacy_target'`),
 * which HALO never lists; their selector columns are null on a site row and hidden
 * here. Scraping is driven by `vibration_source_targets`, not by this row, so nothing
 * on it changes what the service does.
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
      // Said plainly because the word means "off stops it" everywhere else on this page.
      // Verified against the vibration repo: site rows are read by HALO and by the
      // insert trigger only. The scraper reads vibration_source_targets, and the test
      // notification reads legacy WIRS rows, so nothing consults this switch.
      help: "Recorded, but the vibration service does not read it for a site: turning it off does NOT stop scraping or any message. Scraping follows each meter's source target (`enabled` on vibration_source_targets, in the vibration repo). Shown so the site reads like every other project, and so it can start to mean something if the service is changed to honour it.",
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
