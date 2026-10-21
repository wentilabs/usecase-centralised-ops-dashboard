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
  outsideHalo: [
    "Prepare the source target first: the insert is refused unless an enabled row in vibration_source_targets already has this project code in prepared_project_code (see supabase/checks/prepared-targets.sql in the vibration repo).",
    "Portal credentials and the Browserbase context are environment variables on the vibration Lambda, named by the target's credential_profile — HALO never sees them.",
    "Readings begin with the next scrape after the site exists. Run POST /api/vibration-scrape with {\"mode\":\"source-targets\",\"project_code\":\"<code>\"} or wait for the schedule, then check the table.",
    "The enabled switch does not pause scraping: the scraper writes every source target whose site row exists.",
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
