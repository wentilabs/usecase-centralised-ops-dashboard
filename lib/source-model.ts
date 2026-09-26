import { CRONS, type CronRule } from "./load-model/crons";
import { healthTarget } from "./data-health";
import { SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "./services";

/**
 * Where each service's raw readings come from, and what stops when they stop.
 *
 * The question this answers is one a colleague actually asked: "where do the
 * raw readings come from — is it an API, Browserbase, etc.?" It is asked by
 * whoever is on call, at the moment a site has gone quiet, and the answer
 * currently lives in seven repositories they may not have open.
 *
 * **Mirrored, not re-documented.** Two of the services already encode the
 * answer — noise in `lib/noise-source-registry.js`, WBGT in
 * `scrapers/cloudlynx-wbgt/profile.js` — and the rest is visible in their
 * contracts. Writing a fresh document beside those would be stale within a
 * month; this is a mirror, and the tests check it against the pinned contracts
 * so an upstream change fails the build instead of quietly misdirecting
 * somebody at 2am.
 *
 * **No credentials, ever.** Each profile names the environment VARIABLE its
 * scraper reads, never a value. HALO does not hold these secrets and must not
 * start: the variable name is what tells you where to look, and the value
 * would only be one screenshot away from a shared channel.
 */

export type Transport =
  /** A real browser driven by Browserbase, because the upstream has no API. */
  | "browser"
  /** A plain HTTP API with a key. */
  | "api"
  /** Google Sheets, read with the service account. */
  | "sheets"
  /** Something else pushes to us; nothing is fetched on a schedule. */
  | "inbound";

export const TRANSPORT_LABEL: Record<Transport, string> = {
  browser: "Browserbase scrape",
  api: "HTTP API",
  sheets: "Sheets API",
  inbound: "Inbound webhook",
};

export type ServiceSource = {
  /** What the upstream is called, in the words its own login page uses. */
  upstream: string;
  transport: Transport;
  /** One sentence: how a reading physically arrives. */
  how: string;
  /**
   * The public sign-in page, where there is one.
   *
   * Taken from the service's own default — `process.env.X || "<this>"` — so it
   * is the URL the scraper itself would use if the variable were unset.
   */
  loginUrl?: string;
  /** Which environment variable the service reads for that URL, if any. */
  loginUrlEnv?: string;
  /** The routes that bring data IN, as `METHOD /path`. */
  inbound: string[];
  /** What a reader loses while this upstream is unavailable. */
  breaks: string;
  /** Whether this service's projects each choose their own upstream. */
  perProject?: "noise" | "wbgt";
  /**
   * The other ways readings reach this service.
   *
   * Naming only the main upstream makes a card read as though it were the only
   * one, and the secondary paths are exactly where an unfamiliar person gets
   * stuck: a WBGT project on manual photo ingestion is not affected by a
   * CloudLynx outage at all, and lightning's forwarded SMS arrives on a route
   * nothing else uses.
   */
  alsoFrom?: {
    label: string;
    how: string;
    /** Environment variable NAMES this path needs. Never values. */
    env?: string[];
    /** Where that variable lives, when it is not this service's own. */
    envRepo?: string;
    /** Config columns that switch this path on for a project. */
    columns?: string[];
    /** A warning worth reading before the path is configured. */
    critical?: string;
  }[];
};

/**
 * One per service.
 *
 * `breaks` is the half that matters on call: it is the difference between "no
 * messages went out, something is badly wrong" and "readings stopped arriving,
 * the messages that did go out were honest about having nothing to report".
 */
export const SERVICE_SOURCES: Record<ServiceKey, ServiceSource> = {
  noise: {
    upstream: "NoiseLynx · Geoscan · Trackmaster · AlphaLab",
    transport: "browser",
    how: "Browserbase signs in to the meter vendor's portal and reads the page. Vendor varies per project.",
    loginUrl: "https://www.noiselynx.com/noiselynx/Login.aspx",
    loginUrlEnv: "NOISELYNX_LOGIN_URL",
    // Noise has no scrape cron of its own: the cadence jobs declare what they
    // need and the scraper fetches it. That is why a project with every cadence
    // off is also a project nothing is scraped for.
    inbound: ["POST /api/noise-5min", "POST /api/noise-half-hourly", "POST /api/noise-hourly"],
    breaks: "Readings go stale, but cadences still send the last figures — reads as a quiet site, not an outage. Check the vendor portal, not the Lambda.",
    perProject: "noise",
  },
  wbgt: {
    upstream: "CloudLynx AMR",
    transport: "browser",
    how: "Browserbase scrape of CloudLynx. Some projects arrive by photo or Telegram instead and never scrape.",
    loginUrl: "https://www.noiselynx.com/cloudlynxamr/Login.aspx",
    loginUrlEnv: "WBGT_LOGIN_URL",
    inbound: [
      "POST /api/wbgt-scrape",
      "POST /api/wbgt-telegram",
      "POST /api/wbgt-telegram-external-channels",
      "POST /api/wbgt-whatsapp",
      "POST /api/water-parade-intake",
    ],
    breaks: "Readings go stale; the hourly report has nothing new. Manual-ingestion projects are unaffected — check the project's source first.",
    perProject: "wbgt",
    alsoFrom: [
      {
        label: "Telegram bot",
        how: "A site posts readings to the WBGT bot; the webhook stores them as a scrape would.",
        env: ["TELEGRAM_WBGT_BOT_TOKEN"],
        columns: ["telegram_chat_ids", "telegram_manual_sensor_label"],
      },
      {
        label: "Manual photos on WhatsApp",
        how: "A site photographs the meter display and the photo is read into a reading. These projects never scrape, so CloudLynx being down does not affect them.",
        env: ["WBGT_WHATSAPP_WEBHOOK_URL"],
        // The pointer that is easy to miss and expensive to miss: the variable
        // is not this service's. The listener repo that RECEIVES the photo has
        // to be told where to forward it, and this side cannot notice that it
        // never was — the photo simply never arrives.
        envRepo: "the WhatsApp listener repo, not this one",
        columns: ["whatsapp_wbgt_source_chat_ids", "whatsapp_manual_sensor_label"],
        critical:
          "A project on manual photos does nothing until the listener repo sets WBGT_WHATSAPP_WEBHOOK_URL to this service's /api/wbgt-whatsapp. Without it the photo is never forwarded, and nothing here errors — the readings simply never arrive.",
      },
      {
        label: "External Telegram channels",
        how: "Third-party channels post readings in. The only inbound route that is HMAC-signed.",
        columns: ["enable_external_telegram_alerts"],
      },
    ],
  },
  haze: {
    upstream: "data.gov.sg",
    transport: "api",
    how: "Public PSI feed, called hourly. No login, no browser, same source for every project.",
    loginUrl: "https://data.gov.sg/datasets?query=psi",
    loginUrlEnv: "DATA_GOV_SG_API_KEY",
    inbound: [],
    breaks: "No PSI band, so no advisory. Nothing goes stale — it fails for every project at once.",
  },
  lightning: {
    upstream: "NEA lightning",
    transport: "api",
    how: "Public NEA API, polled every minute against each project's trigger rings.",
    loginUrlEnv: "NEA_API_KEY",
    inbound: ["POST /api/lightning-tick", "POST /api/lightning-sms"],
    breaks: "No detections, so no warnings and no all-clears. The worst of the seven to miss: silence looks like good weather.",
    alsoFrom: [
      {
        label: "Forwarded SMS",
        how: "A vendor's SMS warning is forwarded in and relayed to its own group. Independent of the NEA feed — it arrives even when the tick finds nothing.",
        columns: ["enable_sms_lightning_alerts", "sms_whatsapp_group_id", "sms_lightning_format"],
      },
    ],
  },
  ailytics: {
    upstream: "Ailytics",
    transport: "inbound",
    how: "Ailytics pushes to us over Telegram and WhatsApp webhooks. Nothing is fetched.",
    inbound: ["POST /telegram-webhook", "POST /ailytics-safety/whatsapp-events"],
    breaks: "Events stop arriving and there is no failed request to find — the sender broke. Summaries still run on what was received.",
  },
  subcon: {
    upstream: "Google Sheets",
    transport: "sheets",
    how: "Sheets API on each project's workbook. Housekeeping photos are pushed in separately.",
    loginUrl: "https://docs.google.com/spreadsheets/",
    inbound: ["POST /housekeeping-intake"],
    breaks: "A renamed, moved or unshared workbook stops that one project only. The error names the sheet.",
  },
  issueChaser: {
    upstream: "Google Sheets · Safety workbook",
    transport: "sheets",
    how: "Sheets API on the Safety workbook. No other source — the workbook is the system of record.",
    loginUrl: "https://docs.google.com/spreadsheets/",
    inbound: [],
    breaks: "Chasing stops for that project alone; the run names the workbook. Usually a sharing change.",
  },
};

/**
 * A per-project upstream choice, as the service's own registry defines it.
 *
 * `credentialEnv` names variables; it never carries values. `workerMode` is
 * included because it explains a class of incident that otherwise looks
 * mysterious: a `dedicated` profile scrapes alone, so one slow vendor cannot
 * stall the others, while `pooled` projects share a browser and do queue
 * behind each other.
 */
export type SourceProfile = {
  /** The value stored in `source_type`. */
  profile: string;
  label: string;
  /** Which upstream this profile actually talks to. */
  upstream: string;
  loginUrl: string;
  /** Environment variable NAMES for the sign-in, never their values. */
  credentialEnv: string[];
  workerMode?: "pooled" | "single" | "dedicated";
  note?: string;
};

const NOISELYNX_LOGIN = "https://www.noiselynx.com/noiselynx/Login.aspx";

/**
 * Mirror of `lib/noise-source-registry.js` in the noise repo.
 *
 * Six profiles, four upstreams: three of them are NoiseLynx under different
 * sign-ins, and three are separate vendors entirely. That distinction is the
 * whole reason this table exists — "the noise scraper is broken" is a different
 * problem depending on which of the four a project sits on.
 */
export const NOISE_SOURCE_PROFILES: Record<string, SourceProfile> = {
  default: {
    profile: "default",
    label: "NoiseLynx (default sign-in)",
    upstream: "NoiseLynx",
    loginUrl: NOISELYNX_LOGIN,
    credentialEnv: ["NOISELYNX_USERNAME", "NOISELYNX_PASSWORD"],
    workerMode: "pooled",
    note: "Most of the estate. Shares one browser pool, so these queue behind each other.",
  },
  whgd: {
    profile: "whgd",
    label: "NoiseLynx (WHGD sign-in)",
    upstream: "NoiseLynx",
    loginUrl: NOISELYNX_LOGIN,
    credentialEnv: ["NOISELYNX_USERNAME_WHGD", "NOISELYNX_PASSWORD_WHGD"],
    workerMode: "single",
  },
  svs: {
    profile: "svs",
    label: "NoiseLynx (SVS sign-in)",
    upstream: "NoiseLynx",
    loginUrl: NOISELYNX_LOGIN,
    credentialEnv: ["NOISELYNX_USERNAME_SVS", "NOISELYNX_PASSWORD_SVS"],
    workerMode: "single",
  },
  geoscan: {
    profile: "geoscan",
    label: "Geoscan",
    upstream: "Geoscan",
    // scrapers/geoscan/scraper.js: BASE_URL + "/login".
    loginUrl: "https://realtime.geoscanrealtime.com/login",
    credentialEnv: ["GEOSCAN_USERNAME", "GEOSCAN_PASSWORD"],
    workerMode: "dedicated",
    note: "Different vendor, not a NoiseLynx sign-in. Reads figures out of a per-project PDF.",
  },
  trackmaster: {
    profile: "trackmaster",
    label: "Trackmaster",
    upstream: "Trackmaster",
    // scrapers/trackmaster/client.js. The browser signs in at qsis, then the
    // report itself is fetched from api1 with the session it obtained — so this
    // one is half browser, half API, and an api1 outage looks different from a
    // sign-in failure.
    loginUrl: "https://qsis.trackmaster.in/home/login",
    credentialEnv: ["TRACKMASTER_USERNAME", "TRACKMASTER_PASSWORD"],
    workerMode: "dedicated",
    note: "Browser sign-in at qsis.trackmaster.in, then the report from api1.trackmaster.in.",
  },
  alphalab: {
    profile: "alphalab",
    label: "AlphaLab",
    upstream: "AlphaLab",
    // scrapers/alphalab/scraper.js: BASE_URL + "/#/login". Its dashboard calls
    // alphalab.hantar.com, and the scraper reads those responses rather than
    // the rendered page.
    loginUrl: "https://www.alphalabonline.com/#/login",
    credentialEnv: ["ALPHALAB_USERNAME", "ALPHALAB_PASSWORD"],
    workerMode: "dedicated",
    note: "Signs in at alphalabonline.com, reads the dashboard's calls to alphalab.hantar.com.",
  },
};

/**
 * Mirror of `scrapers/cloudlynx-wbgt/profile.js`.
 *
 * All four are the same portal under different sign-ins — unlike noise, where
 * three of the six profiles are other companies. Each profile also gets its own
 * Browserbase context, so one sign-in's cookies cannot corrupt another's.
 */
const CLOUDLYNX_LOGIN = "https://www.noiselynx.com/cloudlynxamr/Login.aspx";

export const WBGT_SOURCE_PROFILES: Record<string, SourceProfile> = {
  default: {
    profile: "default",
    label: "CloudLynx (default sign-in)",
    upstream: "CloudLynx AMR",
    loginUrl: CLOUDLYNX_LOGIN,
    credentialEnv: ["NOISELYNX_USERNAME", "NOISELYNX_PASSWORD"],
  },
  whgd: {
    profile: "whgd",
    label: "CloudLynx (WHGD sign-in)",
    upstream: "CloudLynx AMR",
    loginUrl: CLOUDLYNX_LOGIN,
    credentialEnv: ["NOISELYNX_WHGD_USERNAME", "NOISELYNX_WHGD_PASSWORD"],
  },
  svs: {
    profile: "svs",
    label: "CloudLynx (SVS sign-in)",
    upstream: "CloudLynx AMR",
    loginUrl: CLOUDLYNX_LOGIN,
    credentialEnv: ["NOISELYNX_SVS_USERNAME", "NOISELYNX_SVS_PASSWORD"],
  },
  pentaocean: {
    profile: "pentaocean",
    label: "CloudLynx (PentaOcean sign-in)",
    upstream: "CloudLynx AMR",
    loginUrl: CLOUDLYNX_LOGIN,
    credentialEnv: ["NOISELYNX_PENTAOCEAN_USERNAME", "NOISELYNX_PENTAOCEAN_PASSWORD"],
  },
};

/**
 * Legacy stored values that both services fold into `default`.
 *
 * Live rows carry these: WBGT's TEST project stores `noiselynx`. Both repos
 * normalise it, so it is not a fault — but a table that showed it as an unknown
 * profile would send someone looking for a bug that does not exist.
 */
export const SOURCE_ALIASES: Record<string, string> = { noiselynx: "default" };

export function normalizeSourceType(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "default";
  return SOURCE_ALIASES[raw] ?? raw;
}

export function profilesFor(service: ServiceKey): Record<string, SourceProfile> | null {
  if (service === "noise") return NOISE_SOURCE_PROFILES;
  if (service === "wbgt") return WBGT_SOURCE_PROFILES;
  return null;
}

/** The profile a row runs on, or null when the stored value has no adapter. */
export function sourceProfileFor(service: ServiceKey, row: ProjectConfigRow): SourceProfile | null {
  const table = profilesFor(service);
  if (!table) return null;
  return table[normalizeSourceType(row.source_type)] ?? null;
}

/**
 * The EventBridge rules HALO can prove, for one route.
 *
 * Deliberately narrow. `load-model/crons.ts` holds only the rules read off the
 * AWS console, and only the ones that can produce a message — so the ingestion
 * routes mostly have nothing here. The service READMEs do list schedules, and
 * they are NOT used: WBGT's README gives `/api/wbgt-hourly` an expression that
 * contradicts the console, so repeating it would put a confident wrong answer
 * in front of someone debugging at speed. An empty result means "HALO cannot
 * prove this one", which the tab says in those words.
 */
export function rulesForRoute(service: ServiceKey, route: string): CronRule[] {
  const path = route.replace(/^[A-Z]+\s+/, "");
  const group = (CRONS as Record<string, Record<string, CronRule>>)[service] ?? {};
  return Object.values(group).filter((rule) => rule.route === path);
}

/** Every service, in the order the dashboard's tabs run. */
export function sourceRows(): { service: ServiceKey; source: ServiceSource }[] {
  return SERVICE_KEYS.map((service) => ({ service, source: SERVICE_SOURCES[service] }));
}

/**
 * Where a service's ground truth actually lives.
 *
 * The distinction this exists to make, and the one the page was missing: noise
 * and WBGT do NOT read their vendor at send time. A scrape writes into the
 * project's own table and the cadence jobs read that table — nothing in the
 * message path touches Browserbase. So a missing message is a question about
 * the table first, and the scraper only second.
 *
 * It is equally important that this is NOT true of the other five. Haze and
 * lightning compute from the API on each request and store no readings at all,
 * so "check the table" is advice with no table behind it; the sheet-backed
 * three read someone else's store. Telling all seven to check Supabase would
 * send five of them looking for something that does not exist.
 */
export type Storage = {
  /** The Postgres schema, as `Accept-Profile` takes it. */
  schema: string | null;
  /**
   * The per-project readings table, as a pattern with `<code>` standing in for
   * the normalised project code. Null when the service stores no readings.
   */
  readingsTable: string | null;
  /** Tables worth opening second, with what each answers. */
  supporting: { table: string; holds: string }[];
  /** The ordered questions to ask when a message did not arrive. */
  debugOrder: string[];
};

export const SERVICE_STORAGE: Record<ServiceKey, Storage> = {
  noise: {
    schema: "noise-meters",
    readingsTable: "<code>_noise_data_daily",
    supporting: [
      { table: "noise_job_runs", holds: "every run, with its errors and record count" },
      { table: "noise_limits", holds: "the per-meter limits an exceedance is judged against" },
      { table: "noise_project_configs", holds: "the row the editor writes" },
    ],
    debugOrder: [
      "Does the project's table hold rows for today? None means ingestion failed — the vendor portal or Browserbase, not the message job.",
      "Rows there but no message? Read noise_job_runs for that job_type and project; errors and details name the failure.",
      "Job clean but nothing arrived? Delivery: lambda_url, the group ids, instance_name.",
    ],
  },
  wbgt: {
    schema: "wbgts",
    readingsTable: "<code>_wbgt_data_hourly",
    supporting: [
      { table: "wbgt_job_runs", holds: "every run, with its errors and sensor counts" },
      { table: "wbgt_sensors", holds: "which sensors a project has, and their labels" },
      { table: "wbgt_sensor_alert_state", holds: "the last band each sensor alerted on" },
      { table: "wbgt_notification_outbox", holds: "messages queued for delivery" },
      { table: "water_parade_cycles", holds: "open and closed Water Parade cycles" },
    ],
    debugOrder: [
      "Does the project's table hold rows for the hour? None means no reading arrived — CloudLynx, Browserbase, or a project that ingests manually.",
      "Rows there but no message? Read wbgt_job_runs for that job_type and project, then wbgt_notification_outbox for anything stuck.",
      "Job clean but nothing arrived? Delivery: lambda_url, the group ids, instance_name.",
    ],
  },
  haze: {
    schema: "haze",
    readingsTable: null,
    supporting: [{ table: "haze_project_configs", holds: "the row the editor writes" }],
    debugOrder: [
      "Nothing is stored — the band is computed from the PSI feed on each run, so there is no table to inspect.",
      "A miss is the API call or the configuration: the four-hourly window, the site hours, the group ids.",
      "It fails for every project at once. One quiet project is configuration, not the feed.",
    ],
  },
  lightning: {
    schema: "lightning",
    readingsTable: null,
    supporting: [
      { table: "lightning_project_configs", holds: "the row the editor writes, including the trigger rings" },
    ],
    debugOrder: [
      "Detections are not stored as readings — the tick compares them against each project's rings and moves on.",
      "Use the ⚡ map on the Lightning tab: it replays real detections against the real rings at a chosen time.",
      "Silence is the dangerous case here. No warning looks exactly like no storm.",
    ],
  },
  ailytics: {
    schema: "ailytics",
    readingsTable: null,
    supporting: [{ table: "project_configs", holds: "the row the editor writes" }],
    debugOrder: [
      "Nothing is fetched, so there is no ingestion to check — events arrive or they do not.",
      "If they stopped, the sending side broke. There is no failed request on ours to find.",
    ],
  },
  subcon: {
    schema: "manpower_activity",
    readingsTable: null,
    supporting: [],
    debugOrder: [
      "The workbook is the store. Open the project's spreadsheet_id and check the rows are there.",
      "If the sheet is fine, check the service account still has access — a rename or a move breaks one project only.",
    ],
  },
  issueChaser: {
    schema: "issue_chaser",
    readingsTable: null,
    supporting: [],
    debugOrder: [
      "The Safety workbook is the store. Open safety_sheet_id and check the rows are there.",
      "Then run ◇ Diagnose project on the Issue Chaser tab — it checks a project against its workbook and names what it cannot read.",
    ],
  },
};

/**
 * The table this project's readings are written to, or null.
 *
 * Delegates to `healthTarget` rather than deriving the name again. Both were
 * mirrors of the same `lib/naming.js` — byte-identical in the noise and WBGT
 * repos — and two copies of a naming rule is one copy too many: the way they
 * fail is by drifting apart and pointing two parts of HALO at different tables.
 * `healthTarget` also refuses a stem it cannot vouch for, which is the right
 * answer for a code the services themselves would reject.
 */
export function readingsTableFor(service: ServiceKey, projectCode: string): string | null {
  if (!SERVICE_STORAGE[service].readingsTable) return null;
  return healthTarget(service, projectCode)?.table ?? null;
}

/** Which services keep their own copy of the readings they act on. */
export function storesReadings(service: ServiceKey): boolean {
  return SERVICE_STORAGE[service].readingsTable !== null;
}

/**
 * Whether anything is actually asking this project for readings.
 *
 * Without this the freshness column cries wolf. Noise scraping is
 * demand-driven: a cadence declares what it needs and the scraper fetches it,
 * so a project with every cadence off creates no demand and its table is
 * correctly, permanently stale. Four of the thirty-two noise projects are in
 * exactly that state — CPW, JCube, KCDE and PSR — and colouring them the same
 * as a live project that has stopped would train everyone to ignore the colour.
 *
 * The distinction is what makes the column worth reading: on the same screen,
 * one of those four sitting at 11 hours is fine, and HMD at 11 hours with its
 * hourly report on is the thing to go and look at.
 */
export type ReadingExpectation = "demanded" | "dormant" | "disabled";

export function readingExpectation(row: ProjectConfigRow): ReadingExpectation {
  if (row.enabled === false) return "disabled";
  // Any `enable_*` flag that is on. Deliberately generic rather than a list of
  // cadence names: a cadence added upstream should count the day it appears,
  // and the alternative is a list that silently stops covering one.
  const anyOn = Object.entries(row).some(([key, value]) => key.startsWith("enable_") && value === true);
  return anyOn ? "demanded" : "dormant";
}

export const EXPECTATION_NOTE: Record<ReadingExpectation, string | null> = {
  demanded: null,
  dormant: "no cadences on — nothing asks for readings",
  disabled: "project disabled",
};
