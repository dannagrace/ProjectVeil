import assert from "node:assert/strict";
import test from "node:test";
import { GUILD_CHAT_MAX_MESSAGE_LENGTH, normalizeGuildChatMessageContent } from "../src/guild-chat";

test("normalizeGuildChatMessageContent trims valid messages", () => {
  assert.equal(normalizeGuildChatMessageContent("  Rally at dusk  "), "Rally at dusk");
});

test("normalizeGuildChatMessageContent rejects empty messages", () => {
  assert.throws(() => normalizeGuildChatMessageContent("   "), /guild_chat_message_required/);
});

test("normalizeGuildChatMessageContent rejects raw HTML", () => {
  assert.throws(() => normalizeGuildChatMessageContent("<b>attack now</b>"), /guild_chat_message_html_not_allowed/);
});

test("normalizeGuildChatMessageContent rejects messages longer than the limit", () => {
  assert.throws(
    () => normalizeGuildChatMessageContent("x".repeat(GUILD_CHAT_MAX_MESSAGE_LENGTH + 1)),
    /guild_chat_message_too_long/
  );
});
