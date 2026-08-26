/**
 * Which model the smart chat talks to, and how.
 *
 * Split out of the route so the interesting parts — provider selection, request
 * shaping, and getting the text back out of two different response shapes — are
 * testable without a network or a key.
 *
 * Chosen by which key is present rather than a setting, because that is the fact
 * the deployment actually has. Neither vendor is a dead end: set the OpenAI key
 * and it uses OpenAI, set the Anthropic one and it uses Anthropic, set both and
 * OpenAI wins because it is the one named first here.
 */

export type Provider = "openai" | "anthropic";

export const DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-5.6-terra",
  anthropic: "claude-sonnet-5",
};

export type ProviderChoice =
  | { provider: Provider; apiKey: string; model: string }
  | { provider: null; reason: string };

export function chooseProvider(env: Record<string, string | undefined>): ProviderChoice {
  const override = env.HALO_CHAT_MODEL?.trim();
  if (env.OPENAI_API_KEY?.trim()) {
    return {
      provider: "openai",
      apiKey: env.OPENAI_API_KEY.trim(),
      model: override || DEFAULT_MODEL.openai,
    };
  }
  if (env.ANTHROPIC_API_KEY?.trim()) {
    return {
      provider: "anthropic",
      apiKey: env.ANTHROPIC_API_KEY.trim(),
      model: override || DEFAULT_MODEL.anthropic,
    };
  }
  return {
    provider: null,
    reason: "Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set on the server",
  };
}

export type ProviderRequest = { url: string; headers: Record<string, string>; body: unknown };

/**
 * The request for one turn.
 *
 * OpenAI gets the Responses API, which is where the current models live; a model
 * that only answers on Chat Completions is handled by `fallbackRequest` rather
 * than by making the caller know which is which.
 *
 * No `response_format` / JSON-mode parameter on either. The instruction already
 * asks for JSON and `parseModelJson` is lenient about prose around it — whereas a
 * parameter an unfamiliar model rejects fails the whole call, and the model id
 * here is deliberately configurable.
 */
export function buildRequest(
  choice: Extract<ProviderChoice, { provider: Provider }>,
  { system, user }: { system: string; user: string },
): ProviderRequest {
  if (choice.provider === "openai") {
    return {
      url: "https://api.openai.com/v1/responses",
      headers: { "content-type": "application/json", authorization: `Bearer ${choice.apiKey}` },
      body: {
        model: choice.model,
        instructions: system,
        input: user,
        max_output_tokens: 1024,
      },
    };
  }
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "x-api-key": choice.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: choice.model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    },
  };
}

/**
 * The Chat Completions form of the same turn.
 *
 * Only used when the Responses API rejects the model — some ids are served by one
 * endpoint and not the other, and which is which is not knowable from the name.
 * Trying the second is cheaper than making whoever sets `HALO_CHAT_MODEL` find out
 * by reading an error.
 */
export function fallbackRequest(
  choice: Extract<ProviderChoice, { provider: Provider }>,
  { system, user }: { system: string; user: string },
): ProviderRequest | null {
  if (choice.provider !== "openai") return null;
  return {
    url: "https://api.openai.com/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: `Bearer ${choice.apiKey}` },
    body: {
      model: choice.model,
      max_completion_tokens: 1024,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
  };
}

/** Whether a failed response is worth retrying on the other endpoint. */
export function shouldFallBack(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false;
  return /not supported|unsupported|unknown|does not exist|use v1\/chat\/completions|invalid_request/i.test(body);
}

/**
 * The assistant's text, out of whichever shape it arrived in.
 *
 * Three shapes, because the Responses API offers a flattened `output_text` and
 * also the structured `output` array, and Chat Completions offers neither.
 * Anthropic is a fourth. All of them are tried rather than assumed, so a response
 * shape changing under us degrades to "could not read the answer" instead of a
 * crash.
 */
export function extractText(payload: unknown): string {
  const body = payload as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return "";

  // OpenAI Responses, flattened.
  if (typeof body.output_text === "string") return body.output_text;

  // OpenAI Responses, structured.
  if (Array.isArray(body.output)) {
    const text = body.output
      .flatMap((item) => {
        const content = (item as { content?: unknown }).content;
        return Array.isArray(content) ? content : [];
      })
      .map((part) => (part as { text?: unknown }).text)
      .filter((value): value is string => typeof value === "string")
      .join("");
    if (text) return text;
  }

  // OpenAI Chat Completions.
  if (Array.isArray(body.choices)) {
    const text = body.choices
      .map((choice) => (choice as { message?: { content?: unknown } }).message?.content)
      .filter((value): value is string => typeof value === "string")
      .join("");
    if (text) return text;
  }

  // Anthropic Messages.
  if (Array.isArray(body.content)) {
    return body.content
      .filter((part) => (part as { type?: string }).type === "text")
      .map((part) => (part as { text?: unknown }).text)
      .filter((value): value is string => typeof value === "string")
      .join("");
  }

  return "";
}
