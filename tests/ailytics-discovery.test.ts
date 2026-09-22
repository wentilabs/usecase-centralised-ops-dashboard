import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTelegramGroupDiscoveries } from "../lib/ailytics-discovery";

test("Telegram discovery normalizes bot identities without inventing a group", () => {
  assert.deepEqual(
    normalizeTelegramGroupDiscoveries({
      discoveries: [
        {
          telegram_chat_id: "-100123",
          chat_title: " Site A ",
          is_member: true,
          observed_bot_usernames: ["@AlertBot", "alertbot", ""],
          bot_observations: [{ bot_username: "@AnotherBot", last_message_id: 42 }],
        },
        { chat_title: "no id" },
      ],
    }),
    [
      {
        telegram_chat_id: "-100123",
        chat_title: "Site A",
        chat_type: null,
        bot_status: null,
        is_member: true,
        last_event_at: null,
        observed_bot_usernames: ["alertbot", "anotherbot"],
        bot_observations: [
          { bot_username: "anotherbot", first_seen_at: null, last_seen_at: null, last_message_id: 42 },
        ],
      },
    ],
  );
});

test("Telegram discovery accepts the deployed Lambda's top-level array response", () => {
  assert.deepEqual(
    normalizeTelegramGroupDiscoveries([
      {
        telegram_chat_id: "-5113169242",
        chat_title: "WH tech support",
        chat_type: "group",
        bot_status: "member",
        is_member: true,
        last_event_at: "2026-09-22T09:39:59+00:00",
        observed_bot_usernames: [],
        bot_observations: [],
      },
    ]),
    [
      {
        telegram_chat_id: "-5113169242",
        chat_title: "WH tech support",
        chat_type: "group",
        bot_status: "member",
        is_member: true,
        last_event_at: "2026-09-22T09:39:59+00:00",
        observed_bot_usernames: [],
        bot_observations: [],
      },
    ],
  );
});
