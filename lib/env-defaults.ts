import { SERVICE_KEYS, type ServiceKey } from "./services";

/**
 * Columns whose value is dictated by the deployment, not by the project.
 *
 * `lambda_url` and its two siblings are stored per row, which makes them look
 * like site facts. They are not. Across the live estate — 189 service rows and
 * 41 canonical projects — every non-blank value of each is the *same* string,
 * the one in the matching environment variable. There is one listener proxy,
 * and every project on it posts to the same three endpoints.
 *
 * So a blank one is never a decision someone made; it is a row whose onboarding
 * stopped early. Seven of them exist, all `enabled`, and the only reason none
 * is actively broken is that all seven also have no groups and no cadences
 * switched on.
 *
 * **This is a map of names, never of values.** Resolving a name against the
 * environment happens in the caller, because this module is reachable from
 * client components and a lib that reads `process.env` itself behaves
 * differently depending on which bundle it lands in — the same reason
 * `lib/onboarding/values.ts` and `canonicalDeliveryDefaults` take `env` as a
 * parameter.
 *
 * **What is deliberately absent.** `instance_name` and `client_id` sit next to
 * these columns, are equally unmemorable, and are equally tempting to default.
 * They must not be: they carry six distinct values across the estate, tracking
 * which WhatsApp instance a company is on (`wohhup` ×162, `wohhup-backup` ×7,
 * `pentaocean` ×4, `soilbuild` ×4, …). There is no deployment-wide answer to
 * default them to, and inventing one would route a project's messages through
 * another company's instance.
 */
export const ENV_DEFAULTS: Record<ServiceKey, Record<string, string>> = {
  // The document URL is optional on WBGT — the service derives it by swapping
  // `/send-message` for `/send-document` — but offering it costs nothing and
  // spares anyone the guess when they do need it set explicitly.
  wbgt: { lambda_url: "DEFAULT_LAMBDA_URL_SEND", lambda_url_document: "DEFAULT_LAMBDA_URL_IMAGE" },
  noise: { lambda_url: "DEFAULT_LAMBDA_URL_SEND" },
  haze: { lambda_url: "DEFAULT_LAMBDA_URL_SEND" },
  lightning: { lambda_url: "DEFAULT_LAMBDA_URL_SEND" },
  // The only service with all three: it replies to messages and posts images,
  // where the other six only send.
  ailytics: {
    lambda_url: "DEFAULT_LAMBDA_URL_SEND",
    reply_lambda_url: "DEFAULT_LAMBDA_URL_REPLY",
    lambda_url_image: "DEFAULT_LAMBDA_URL_IMAGE",
  },
  subcon: { lambda_url: "DEFAULT_LAMBDA_URL_SEND" },
  issueChaser: { lambda_url: "DEFAULT_LAMBDA_URL_SEND" },
};

/**
 * The same three, as the canonical registry names them.
 *
 * `canonicalDeliveryDefaults` already resolved these; this is that mapping
 * stated once so the registry and the per-service editors cannot drift into
 * disagreeing about which variable feeds which column.
 */
export const CANONICAL_ENV_DEFAULTS: Record<string, string> = {
  send_message_url: "DEFAULT_LAMBDA_URL_SEND",
  reply_message_url: "DEFAULT_LAMBDA_URL_REPLY",
  send_document_url: "DEFAULT_LAMBDA_URL_IMAGE",
};

/** Every variable name this file can ask for, for the deployment contract test. */
export const ENV_DEFAULT_NAMES: string[] = [
  ...new Set([
    ...SERVICE_KEYS.flatMap((service) => Object.values(ENV_DEFAULTS[service])),
    ...Object.values(CANONICAL_ENV_DEFAULTS),
  ]),
].sort();

/** The variable feeding this column, or null when it is a real per-project value. */
export function envDefaultName(service: ServiceKey | string, column: string): string | null {
  return ENV_DEFAULTS[service as ServiceKey]?.[column] ?? null;
}

/**
 * A default a person can see, or null.
 *
 * Both halves are returned: the value, because someone deciding whether to
 * accept it should read the URL rather than a variable name; and the name,
 * because when it turns out to be wrong, the name is the only part that says
 * where to go and change it.
 *
 * An unset variable resolves to null rather than to an empty default, so a
 * partly configured deployment offers nothing instead of offering "".
 */
export type EnvDefault = { name: string; value: string };

export function resolveEnvDefault(
  service: ServiceKey | string,
  column: string,
  env: Record<string, string | undefined>,
): EnvDefault | null {
  const name = envDefaultName(service, column);
  if (!name) return null;
  const value = String(env[name] ?? "").trim();
  return value ? { name, value } : null;
}

/** The canonical registry's three, resolved the same way. */
export function resolveCanonicalEnvDefaults(
  env: Record<string, string | undefined>,
): Record<string, EnvDefault> {
  const out: Record<string, EnvDefault> = {};
  for (const [column, name] of Object.entries(CANONICAL_ENV_DEFAULTS)) {
    const value = String(env[name] ?? "").trim();
    if (value) out[column] = { name, value };
  }
  return out;
}

/**
 * Whether a stored value counts as "nothing is set here".
 *
 * Not just `""`. One live row carries the literal `-` in `lambda_url` and in
 * `instance_name`, which is a person writing "none" in a text box rather than a
 * URL — it fails the `https://` rule in `row-rules` exactly as a blank does.
 * The canonical importer already treats `-`, `n/a`, `none` and `null` as
 * nothing, so this is that same judgement applied to the same columns.
 */
const BLANK_LIKE = new Set(["", "-", "—", "n/a", "na", "none", "null"]);

export function isBlankValue(value: unknown): boolean {
  return BLANK_LIKE.has(String(value ?? "").trim().toLowerCase());
}
