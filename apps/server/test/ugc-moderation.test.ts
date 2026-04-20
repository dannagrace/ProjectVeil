import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { normalizeGuildState } from "@veil/shared/social";
import { createMemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import { appendUgcCandidateKeyword, buildUgcReviewQueue, resolveUgcReviewEntry, scoreUgcContent } from "@server/domain/social/ugc-moderation";

async function withKeywordConfig(t: { after(fn: () => void | Promise<void>): void }, payload: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "veil-ugc-review-"));
  const filePath = path.join(dir, "ugc-banned-keywords.json");
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const previous = process.env.VEIL_UGC_BANNED_KEYWORDS_PATH;
  process.env.VEIL_UGC_BANNED_KEYWORDS_PATH = filePath;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.VEIL_UGC_BANNED_KEYWORDS_PATH;
    } else {
      process.env.VEIL_UGC_BANNED_KEYWORDS_PATH = previous;
    }
  });
  return filePath;
}

test("scoreUgcContent flags gray-zone contact terms without hard rejection", () => {
  const result = scoreUgcContent("加我vx12345拿礼包", {
    schemaVersion: 1,
    reviewThreshold: 40,
    approvedTerms: [],
    candidateTerms: ["vx"]
  });
  assert.equal(result.score >= 40, true);
  assert.match(result.reasons.join(" "), /联系方式|候选敏感词/);
});

test("UGC review queue covers display name, guild name, and guild chat rejection flows", async (t) => {
  await withKeywordConfig(t, {
    schemaVersion: 1,
    reviewThreshold: 40,
    approvedTerms: [],
    candidateTerms: ["vx", "discord"]
  });

  const store = createMemoryRoomSnapshotStore();
  t.after(async () => {
    await store.close();
  });

  await store.ensurePlayerAccount({ playerId: "ugc-player", displayName: "vx礼包77777" });
  await store.ensurePlayerAccount({ playerId: "guild-owner", displayName: "GuildOwner" });
  await store.saveGuild(
    normalizeGuildState({
      id: "ugc-guild",
      name: "Discord互助会",
      tag: "UGC",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
      memberLimit: 20,
      level: 1,
      xp: 0,
      members: [{ playerId: "guild-owner", displayName: "GuildOwner", role: "owner", joinedAt: "2026-04-17T00:00:00.000Z" }],
      joinRequests: [],
      invites: []
    })
  );
  await store.createGuildChatMessage?.({
    guildId: "ugc-guild",
    authorPlayerId: "guild-owner",
    authorDisplayName: "GuildOwner",
    content: "欢迎加 discord12345 一起玩",
    expiresAt: "2026-05-17T00:00:00.000Z",
    createdAt: "2026-04-17T01:00:00.000Z"
  });

  const queue = await buildUgcReviewQueue(store);
  assert.equal(queue.some((entry) => entry.kind === "display_name"), true);
  assert.equal(queue.some((entry) => entry.kind === "guild_name"), true);
  assert.equal(queue.some((entry) => entry.kind === "guild_chat_message"), true);

  const displayNameEntry = queue.find((entry) => entry.kind === "display_name");
  assert.ok(displayNameEntry);
  const displayResult = await resolveUgcReviewEntry(store, {
    itemId: displayNameEntry.itemId,
    action: "reject",
    reason: "疑似导流昵称",
    actorPlayerId: "support-moderator:ugc",
    actorRole: "support-moderator"
  });
  assert.equal(displayResult.entry.reviewStatus, "rejected");
  const reviewedAccount = await store.loadPlayerAccount("ugc-player");
  assert.equal(reviewedAccount?.displayName.startsWith("旅人"), true);
  assert.equal((reviewedAccount?.mailbox?.length ?? 0) > 0, true);

  const guildEntry = queue.find((entry) => entry.kind === "guild_name");
  assert.ok(guildEntry);
  const guildResult = await resolveUgcReviewEntry(store, {
    itemId: guildEntry.itemId,
    action: "reject",
    reason: "疑似导流公会名",
    actorPlayerId: "support-moderator:ugc",
    actorRole: "support-moderator"
  });
  assert.equal(guildResult.entry.reviewStatus, "rejected");
  const reviewedGuild = await store.loadGuild?.("ugc-guild");
  assert.equal(reviewedGuild?.moderation?.isHidden, true);

  const chatEntry = queue.find((entry) => entry.kind === "guild_chat_message");
  assert.ok(chatEntry);
  const chatResult = await resolveUgcReviewEntry(store, {
    itemId: chatEntry.itemId,
    action: "reject",
    reason: "疑似导流聊天",
    actorPlayerId: "support-moderator:ugc",
    actorRole: "support-moderator",
    candidateKeyword: "discord"
  });
  assert.equal(chatResult.entry.reviewStatus, "rejected");
  const remainingMessages = await store.listGuildChatMessages?.({ guildId: "ugc-guild", limit: 20 });
  assert.equal(remainingMessages?.length ?? 0, 0);

  const configJson = JSON.parse(await readFile(process.env.VEIL_UGC_BANNED_KEYWORDS_PATH!, "utf8")) as { candidateTerms: string[] };
  assert.equal(configJson.candidateTerms.includes("discord"), true);
});

test("appendUgcCandidateKeyword appends unique normalized terms", async (t) => {
  const filePath = await withKeywordConfig(t, {
    schemaVersion: 1,
    reviewThreshold: 40,
    approvedTerms: [],
    candidateTerms: ["vx"]
  });
  const config = appendUgcCandidateKeyword("Discord-123", filePath);
  assert.equal(config.candidateTerms.includes("discord123"), true);
});
