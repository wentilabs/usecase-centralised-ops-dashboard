import { COMPANIES } from "../../field-spec";
import type { OnboardDefinition } from "../types";

/**
 * Service-owned onboarding contract, from the vibration repo's
 * `docs/HALO_ONBOARDING.md`. One disabled `config_kind = 'site'` row; the insert
 * trigger creates `<code>_vibration_data_daily` in the same transaction, and
 * refuses the row unless an enabled source target is already prepared for the code.
 */
export const vibrationOnboarding: OnboardDefinition = {
  service: "vibration",
  codePattern: /^[A-Z][A-Z0-9-]{0,31}$/,
  codeHelp: "Uppercase letters, digits and hyphens, starting with a letter, at most 32 characters — the readings table is named from it and the database refuses anything else.",
  label: "＋ Add project",
  title: "Add a new Vibration site",
  description:
    "Creates one disabled site row in vibration.vibration_project_configs. The database then creates the site's readings table in the same transaction. HALO creates no meters and holds no portal credentials.",
  prerequisites: [
    {
      id: "source-target",
      met: "A source target is prepared and enabled for this code.",
      missing:
        "No enabled source target is prepared for this project code. The database refuses the site row without one — add it to vibration_source_targets (prepared_project_code, prepared_meter_code) in the vibration repo first.",
      schema: "vibration",
      table: "vibration_source_targets",
      filter: (code) => ({ prepared_project_code: `eq.${code}`, enabled: "eq.true" }),
    },
  ],
  outsideHalo: [
    "Prepare the source target first: the insert is refused unless an enabled row in vibration_source_targets already has this project code in prepared_project_code (see supabase/checks/prepared-targets.sql in the vibration repo).",
    "Portal credentials and the Browserbase context are environment variables on the vibration Lambda, named by the target's credential_profile — HALO never sees them.",
    "Readings begin with the next scrape after the site exists. After enabling, run POST /api/vibration-scrape with {\"mode\":\"source-targets\",\"project_code\":\"<code>\"} or wait for the schedule, then check the table.",
    "The site is created disabled, and the scraper skips disabled sites: enable it in HALO before its first scrape (needs the vibration repo's migrate_site_enabled_gates_scraping.sql applied).",
  ],
  fields: [
    {
      column: "project_code",
      label: "Project code",
      kind: "text",
      required: true,
      notNull: true,
      help: "Uppercase only. It names the readings table, so it cannot be renamed later.",
    },
    {
      column: "company",
      label: "Company",
      kind: "select",
      required: false,
      notNull: false,
      options: ["", ...COMPANIES],
      help: "Identity only; scraping does not read it. Sets the card's background mark and makes the project findable by company.",
    },
    {
      column: "site_name",
      label: "Site name",
      kind: "text",
      required: true,
      notNull: true,
      help: "How the site is named to operators, e.g. Seletar West Road-3.",
    },
    {
      column: "timezone",
      label: "Timezone",
      kind: "text",
      hidden: true,
      required: false,
      notNull: true,
      fallback: "Asia/Singapore",
      help: "IANA timezone used to read the site's timestamps.",
    },
  ],
};
