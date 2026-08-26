import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MODEL,
  buildRequest,
  chooseProvider,
  extractText,
  fallbackRequest,
  shouldFallBack,
} from "../lib/chat-provider";
import { parseModelJson } from "../lib/chat-intent";

test("the provider is whichever key is present, and the model is overridable", () => {
  assert.deepEqual(chooseProvider({ OPENAI_API_KEY: "sk-x" }), {
    provider: "openai",
    apiKey: "sk-x",
    model: "gpt-5.6-terra",
  });
  assert.deepEqual(chooseProvider({ ANTHROPIC_API_KEY: "sk-a" }), {
    provider: "anthropic",
    apiKey: "sk-a",
    model: "claude-sonnet-5",
  });

  // Both set: OpenAI wins, and the choice is stated here rather than left to
  // whichever branch happens to run first.
  assert.equal(chooseProvider({ OPENAI_API_KEY: "sk-x", ANTHROPIC_API_KEY: "sk-a" }).provider, "openai");

  // The override applies whichever vendor is in play.
  const modelOf = (env: Record<string, string | undefined>) => {
    const choice = chooseProvider(env);
    return choice.provider ? choice.model : null;
  };
  assert.equal(modelOf({ OPENAI_API_KEY: "sk-x", HALO_CHAT_MODEL: "gpt-4.1" }), "gpt-4.1");
  assert.equal(modelOf({ ANTHROPIC_API_KEY: "sk-a", HALO_CHAT_MODEL: "claude-opus-5" }), "claude-opus-5");

  // Whitespace is not a key, and an empty override is not a model name.
  assert.equal(chooseProvider({ OPENAI_API_KEY: "   " }).provider, null);
  assert.equal(modelOf({ OPENAI_API_KEY: "sk-x", HALO_CHAT_MODEL: "  " }), DEFAULT_MODEL.openai);

  const none = chooseProvider({});
  assert.equal(none.provider, null);
  assert.match(none.provider === null ? none.reason : "", /OPENAI_API_KEY.*ANTHROPIC_API_KEY/);
});

test("each request goes to that vendor's endpoint, with the instruction in the right place", () => {
  const turn = { system: "be careful", user: "CFC on Sundays" };

  const openai = buildRequest({ provider: "openai", apiKey: "sk-x", model: "gpt-5.6-terra" }, turn);
  assert.equal(openai.url, "https://api.openai.com/v1/responses");
  assert.equal(openai.headers.authorization, "Bearer sk-x");
  assert.deepEqual(openai.body, {
    model: "gpt-5.6-terra",
    instructions: "be careful",
    input: "CFC on Sundays",
    max_output_tokens: 1024,
  });

  const anthropic = buildRequest({ provider: "anthropic", apiKey: "sk-a", model: "claude-sonnet-5" }, turn);
  assert.equal(anthropic.url, "https://api.anthropic.com/v1/messages");
  assert.equal(anthropic.headers["x-api-key"], "sk-a");
  assert.equal(anthropic.headers.authorization, undefined, "Anthropic authenticates by header name, not bearer");
  assert.match(JSON.stringify(anthropic.body), /"system":"be careful"/);

  // No JSON-mode parameter on either: a parameter an unfamiliar model rejects
  // fails the whole call, and the model id is deliberately configurable.
  for (const request of [openai, anthropic]) {
    assert.doesNotMatch(JSON.stringify(request.body), /response_format|json_object/);
  }
});

test("an OpenAI model served by the other endpoint is retried, not surfaced as an error", () => {
  const choice = { provider: "openai" as const, apiKey: "sk-x", model: "gpt-5.6-terra" };
  const second = fallbackRequest(choice, { system: "s", user: "u" })!;
  assert.equal(second.url, "https://api.openai.com/v1/chat/completions");
  // Chat Completions takes messages, and the newer models take
  // max_completion_tokens rather than max_tokens.
  assert.match(JSON.stringify(second.body), /"role":"system"/);
  assert.match(JSON.stringify(second.body), /max_completion_tokens/);

  // Anthropic has one endpoint, so there is nothing to fall back to.
  assert.equal(fallbackRequest({ provider: "anthropic", apiKey: "k", model: "m" }, { system: "s", user: "u" }), null);

  // Only the failures that mean "wrong endpoint for this model" are retried.
  assert.ok(shouldFallBack(404, "this model does not exist on /v1/responses"));
  assert.ok(shouldFallBack(400, '{"error":{"type":"invalid_request_error"}}'));
  assert.equal(shouldFallBack(401, "incorrect api key"), false, "a bad key is not an endpoint problem");
  assert.equal(shouldFallBack(429, "rate limit"), false);
  assert.equal(shouldFallBack(500, "server error"), false);
  assert.equal(shouldFallBack(400, "your prompt was too long"), false, "a real 400 must not loop");
});

test("the answer is read out of any of the four shapes it can arrive in", () => {
  // OpenAI Responses, flattened.
  assert.equal(extractText({ output_text: '{"changes":{}}' }), '{"changes":{}}');
  // OpenAI Responses, structured.
  assert.equal(
    extractText({ output: [{ content: [{ type: "output_text", text: "a" }, { type: "output_text", text: "b" }] }] }),
    "ab",
  );
  // OpenAI Chat Completions.
  assert.equal(extractText({ choices: [{ message: { content: "hello" } }] }), "hello");
  // Anthropic Messages, with a non-text block mixed in.
  assert.equal(
    extractText({ content: [{ type: "thinking", text: "hmm" }, { type: "text", text: "answer" }] }),
    "answer",
  );

  // A shape changing under us degrades to nothing rather than throwing.
  for (const junk of [null, undefined, {}, { output: "not an array" }, { choices: [{}] }, 42, "text"]) {
    assert.equal(extractText(junk), "");
  }
});

test("JSON is recovered even when the model wraps it in prose", () => {
  const wanted = { changes: { remove_sunday_notifications: true }, summary: "Stops Sunday sends." };

  assert.deepEqual(parseModelJson(JSON.stringify(wanted)), wanted);
  assert.deepEqual(parseModelJson("```json\n" + JSON.stringify(wanted) + "\n```"), wanted);
  assert.deepEqual(parseModelJson("```\n" + JSON.stringify(wanted) + "\n```"), wanted);
  assert.deepEqual(
    parseModelJson(`Sure — here is the change:\n${JSON.stringify(wanted)}\nLet me know if that helps.`),
    wanted,
  );
  // A question comes back the same way.
  assert.deepEqual(parseModelJson('{"question":"Which service?"}'), { question: "Which service?" });

  // And unparseable stays unparseable rather than half-read.
  for (const junk of ["no json here", "{ not: valid }", "", "{{{"]) {
    assert.equal(parseModelJson(junk), null, junk);
  }
});
