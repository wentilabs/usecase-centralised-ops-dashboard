import { CRONS, type CronRule } from "./load-model/crons";
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
  browser: "Headless browser (Browserbase)",
  api: "HTTP API",
  sheets: "Google Sheets API",
  inbound: "Pushed to us (webhook)",
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
    upstream: "NoiseLynx, Geoscan, Trackmaster or AlphaLab",
    transport: "browser",
    how: "A real browser signs in to the meter vendor's portal and reads the readings off the page. Which vendor depends on the project — see the table below.",
    loginUrl: "https://www.noiselynx.com/noiselynx/Login.aspx",
    loginUrlEnv: "NOISELYNX_LOGIN_URL",
    // Noise has no scrape cron of its own: the cadence jobs declare what they
    // need and the scraper fetches it. That is why a project with every cadence
    // off is also a project nothing is scraped for.
    inbound: ["POST /api/noise-5min", "POST /api/noise-half-hourly", "POST /api/noise-hourly"],
    breaks:
      "Readings stop updating. The cadence jobs still run and still send, reporting the last figures they have — so a stale portal looks like a quiet site rather than an outage. Check the vendor portal first, not the Lambda.",
    perProject: "noise",
  },
  wbgt: {
    upstream: "CloudLynx AMR",
    transport: "browser",
    how: "A real browser signs in to CloudLynx and reads each sensor's latest WBGT. Some projects instead receive readings as photos or Telegram messages and have no scraping at all.",
    loginUrl: "https://www.noiselynx.com/cloudlynxamr/Login.aspx",
    loginUrlEnv: "WBGT_LOGIN_URL",
    inbound: [
      "POST /api/wbgt-scrape",
      "POST /api/wbgt-telegram",
      "POST /api/wbgt-telegram-external-channels",
      "POST /api/wbgt-whatsapp",
      "POST /api/water-parade-intake",
    ],
    breaks:
      "Readings stop updating and the hourly report has nothing new to say. A project on manual ingestion is unaffected by a CloudLynx outage — check its source before assuming the portal is the problem.",
    perProject: "wbgt",
  },
  haze: {
    upstream: "data.gov.sg",
    transport: "api",
    how: "The hourly job calls Singapore's open PSI feed directly. No login, no browser, no per-project source.",
    loginUrl: "https://data.gov.sg/datasets?query=psi",
    loginUrlEnv: "DATA_GOV_SG_API_KEY",
    inbound: [],
    breaks:
      "No PSI band can be computed, so no advisory is sent. Nothing is stored stale — the job simply has nothing to report, for every project at once.",
  },
  lightning: {
    upstream: "NEA lightning feed",
    transport: "api",
    how: "The minutely tick polls NEA for strike detections and compares them against each project's trigger rings. No login and no browser.",
    loginUrlEnv: "NEA_API_KEY",
    inbound: ["POST /api/lightning-tick"],
    breaks:
      "No strikes are detected, so no warnings and no all-clears are sent. This is the most dangerous of the seven to miss: silence looks exactly like good weather.",
  },
  ailytics: {
    upstream: "Ailytics",
    transport: "inbound",
    how: "Ailytics pushes events to us — nothing is fetched. Telegram and WhatsApp webhooks deliver them as they happen.",
    inbound: ["POST /telegram-webhook", "POST /ailytics-safety/whatsapp-events"],
    breaks:
      "Events simply stop arriving, and there is no failed request to find — the sending side is the one that broke. The summaries still run and report on whatever was received.",
  },
  subcon: {
    upstream: "Google Sheets, plus a housekeeping webhook",
    transport: "sheets",
    how: "The manpower and activity numbers are read from each project's workbook with the service account. Housekeeping photos arrive separately, pushed in.",
    loginUrl: "https://docs.google.com/spreadsheets/",
    inbound: ["POST /housekeeping-intake"],
    breaks:
      "A workbook that is renamed, moved, or unshared from the service account stops that ONE project — the others are unaffected. The error names the sheet.",
  },
  issueChaser: {
    upstream: "Google Sheets (the Safety workbook)",
    transport: "sheets",
    how: "Every run reads the project's Safety workbook with the service account. There is no other source: the workbook is the system of record.",
    loginUrl: "https://docs.google.com/spreadsheets/",
    inbound: [],
    breaks:
      "Chasing stops for that project alone, and the run reports which workbook it could not read. Sharing is the usual cause — check the service account still has access.",
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
    note: "Most of the estate. Shares one browser pool, so these projects queue behind each other.",
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
    note: "A different vendor, not a different NoiseLynx sign-in. Scrapes alone, and reads its figures out of a per-project PDF.",
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
    note: "Signs in through the browser at qsis.trackmaster.in, then pulls the report from api1.trackmaster.in with that session.",
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
    note: "Signs in at alphalabonline.com and reads the dashboard's own calls to alphalab.hantar.com.",
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
