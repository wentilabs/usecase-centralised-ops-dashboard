/**
 * Public, operator-safe shape returned by HALO's server-side discovery proxy.
 * The Lambda secret and raw upstream response never cross this boundary.
 */
export type TelegramBotObservation = {
  bot_username: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_message_id: number | null;
};

export type TelegramGroupDiscovery = {
  telegram_chat_id: string;
  chat_title: string | null;
  chat_type: string | null;
  bot_status: string | null;
  is_member: boolean;
  last_event_at: string | null;
  observed_bot_usernames: string[];
  bot_observations: TelegramBotObservation[];
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function username(value: unknown): string | null {
  const candidate = text(value)?.replace(/^@+/, "").toLowerCase();
  return candidate || null;
}

/** Treat the Lambda as an untrusted boundary: malformed records are omitted. */
export function normalizeTelegramGroupDiscoveries(value: unknown): TelegramGroupDiscovery[] {
  // The deployed Lambda currently returns the discovery rows as a top-level
  // array. Keep accepting the envelope used by the HALO contract as well so
  // the proxy remains compatible with either deployed response shape.
  const records = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { discoveries?: unknown }).discoveries)
      ? (value as { discoveries: unknown[] }).discoveries
      : [];

  return records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const raw = record as Record<string, unknown>;
    const telegramChatId = text(raw.telegram_chat_id);
    if (!telegramChatId) return [];

    const observations = Array.isArray(raw.bot_observations)
      ? raw.bot_observations.flatMap((observation) => {
          if (!observation || typeof observation !== "object") return [];
          const item = observation as Record<string, unknown>;
          const botUsername = username(item.bot_username);
          if (!botUsername) return [];
          return [{
            bot_username: botUsername,
            first_seen_at: text(item.first_seen_at),
            last_seen_at: text(item.last_seen_at),
            last_message_id: typeof item.last_message_id === "number" ? item.last_message_id : null,
          }];
        })
      : [];
    const names = [
      ...(Array.isArray(raw.observed_bot_usernames) ? raw.observed_bot_usernames.map(username) : []),
      ...observations.map((observation) => observation.bot_username),
    ].filter((name): name is string => Boolean(name));

    return [{
      telegram_chat_id: telegramChatId,
      chat_title: text(raw.chat_title),
      chat_type: text(raw.chat_type),
      bot_status: text(raw.bot_status),
      is_member: raw.is_member === true,
      last_event_at: text(raw.last_event_at),
      observed_bot_usernames: [...new Set(names)],
      bot_observations: observations,
    }];
  });
}
