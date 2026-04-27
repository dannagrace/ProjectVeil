import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildFriendLeaderboard,
  createGroupChallenge,
  encodeGroupChallengeToken,
  normalizeNotificationPreferences,
  validateGroupChallengeToken
} from "@server/adapters/wechat-social";

test("group challenge tokens round-trip and reject stale payloads", () => {
  const createdAt = new Date("2026-04-04T10:00:00.000Z");
  const challenge = createGroupChallenge(
    {
      creatorPlayerId: "player-7",
      creatorDisplayName: "雾林司灯",
      roomId: "room-social",
      challengeType: "victory",
      scoreTarget: 3
    },
    createdAt
  );
  const secret = "test-social-secret";
  const token = encodeGroupChallengeToken(challenge, secret);

  const valid = validateGroupChallengeToken(token, secret, new Date("2026-04-04T10:30:00.000Z"));
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.challenge.roomId, "room-social");
    assert.equal(valid.challenge.challengeType, "victory");
    assert.equal(valid.challenge.scoreTarget, 3);
  }

  const expired = validateGroupChallengeToken(token, secret, new Date("2026-04-05T10:00:00.001Z"));
  assert.deepEqual(expired, { ok: false, reason: "expired" });
});

test("group challenge token validation rejects malformed signatures without direct comparison", () => {
  const createdAt = new Date("2026-04-04T10:00:00.000Z");
  const challenge = createGroupChallenge(
    {
      creatorPlayerId: "player-7",
      creatorDisplayName: "雾林司灯",
      roomId: "room-social",
      challengeType: "victory"
    },
    createdAt
  );
  const secret = "test-social-secret";
  const token = encodeGroupChallengeToken(challenge, secret);
  const [payload] = token.split(".");

  assert.deepEqual(validateGroupChallengeToken(`${payload}.short`, secret), { ok: false, reason: "invalid" });

  const source = readFileSync(new URL("../src/adapters/wechat-social.ts", import.meta.url), "utf8");
  assert.match(source, /timingSafeEqual/);
  assert.doesNotMatch(source, /signature\s*!==\s*expectedSignature/);
});

test("friend leaderboard sorts by rating and marks the current player", () => {
  const rows = buildFriendLeaderboard("player-2", [
    { playerId: "player-1", displayName: "A", eloRating: 1280, globalResources: { gold: 0, wood: 0, ore: 0 }, achievements: [], recentEventLog: [] },
    { playerId: "player-2", displayName: "B", eloRating: 1405, globalResources: { gold: 0, wood: 0, ore: 0 }, achievements: [], recentEventLog: [] },
    { playerId: "player-3", displayName: "C", eloRating: 1190, globalResources: { gold: 0, wood: 0, ore: 0 }, achievements: [], recentEventLog: [] }
  ]);

  assert.deepEqual(
    rows.map((row) => [row.rank, row.playerId, row.isSelf ?? false]),
    [
      [1, "player-2", true],
      [2, "player-1", false],
      [3, "player-3", false]
    ]
  );
});

test("notification preferences default to enabled categories", () => {
  assert.deepEqual(normalizeNotificationPreferences({ turnReminder: false }, "2026-04-04T12:00:00.000Z"), {
    matchFound: true,
    turnReminder: false,
    groupChallenge: true,
    friendLeaderboard: true,
    reengagement: true,
    updatedAt: "2026-04-04T12:00:00.000Z"
  });
});
