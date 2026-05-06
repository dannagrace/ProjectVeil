import assert from "node:assert/strict";
import test from "node:test";

import {
  isPlayerMailboxMessageExpired,
  normalizePlayerAccountReadModel,
  summarizePlayerMailbox
} from "../src/player-account.ts";

// --- Null/undefined defaults ---

test("normalizePlayerAccountReadModel(null) → playerId='' and displayName falls back to 'player'", () => {
  const result = normalizePlayerAccountReadModel(null);
  assert.equal(result.playerId, "");
  // displayName defaults to playerId or "player" when both are empty
  assert.equal(result.displayName, "player");
});

test("normalizePlayerAccountReadModel(undefined) → globalResources defaults to {gold:0,wood:0,ore:0}", () => {
  const result = normalizePlayerAccountReadModel(undefined);
  assert.deepEqual(result.globalResources, { gold: 0, wood: 0, ore: 0 });
});

test("normalizePlayerAccountReadModel(null) seeds default achievements and keeps recentEventLog=[]", () => {
  const result = normalizePlayerAccountReadModel(null);
  assert.equal(result.achievements.length > 0, true);
  assert.equal(result.achievements.every((achievement) => achievement.unlocked === false), true);
  assert.deepEqual(result.recentEventLog, []);
});

test("normalizePlayerAccountReadModel(null) → seasonPassTier omitted (defaults to 1, omitted since <= 1)", () => {
  const result = normalizePlayerAccountReadModel(null);
  // seasonPassTier is omitted from output when it equals 1 (the minimum)
  assert.equal(result.seasonPassTier, undefined);
});

// --- String normalization ---

test("playerId with surrounding whitespace is trimmed", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "  hello  " });
  assert.equal(result.playerId, "hello");
});

test("displayName with surrounding whitespace is trimmed", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", displayName: "  World  " });
  assert.equal(result.displayName, "World");
});

test("loginId is lowercased and trimmed", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", loginId: "  UPPER@test.com  " });
  assert.equal(result.loginId, "upper@test.com");
});

// --- Numeric clamping ---

test("dailyPlayMinutes=-5 is clamped to 0 (omitted from output)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", dailyPlayMinutes: -5 });
  assert.equal(result.dailyPlayMinutes, undefined);
});

test("dailyPlayMinutes=3.7 is floored to 3", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", dailyPlayMinutes: 3.7 });
  assert.equal(result.dailyPlayMinutes, 3);
});

test("loginStreak=-1 is clamped to 0 (omitted from output)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", loginStreak: -1 });
  assert.equal(result.loginStreak, undefined);
});

test("seasonPassTier=0 is raised to minimum of 1 (omitted since equals 1)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassTier: 0 });
  assert.equal(result.seasonPassTier, undefined);
});

test("seasonPassTier=0.5 is floored then clamped to 1 (omitted since equals 1)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassTier: 0.5 });
  assert.equal(result.seasonPassTier, undefined);
});

test("seasonPassTier=3 is preserved in output", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassTier: 3 });
  assert.equal(result.seasonPassTier, 3);
});

test("seasonXp=-100 is clamped to 0 (omitted from output)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonXp: -100 });
  assert.equal(result.seasonXp, undefined);
});

// --- Boolean normalization ---

test("seasonPassPremium=true is kept as true", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassPremium: true });
  assert.equal(result.seasonPassPremium, true);
});

test("seasonPassPremium='true' (string) is rejected → not present in output", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassPremium: "true" as unknown as boolean });
  assert.equal(result.seasonPassPremium, undefined);
});

test("ageVerified=true is kept as true", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", ageVerified: true });
  assert.equal(result.ageVerified, true);
});

test("isMinor=1 (number) is rejected → not present in output", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", isMinor: 1 as unknown as boolean });
  assert.equal(result.isMinor, undefined);
});

// --- banStatus ---

test("banStatus='permanent' is preserved", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", banStatus: "permanent" });
  assert.equal(result.banStatus, "permanent");
});

test("banStatus='temporary' is preserved", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", banStatus: "temporary" });
  assert.equal(result.banStatus, "temporary");
});

test("banStatus='hacked_value' is rejected → omitted (treated as none)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", banStatus: "hacked_value" as "temporary" });
  assert.equal(result.banStatus, undefined);
});

test("banStatus=undefined → omitted from output", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1" });
  assert.equal(result.banStatus, undefined);
});

// --- lastPlayDate ---

test("lastPlayDate='2026-04-10' (valid format) is kept", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", lastPlayDate: "2026-04-10" });
  assert.equal(result.lastPlayDate, "2026-04-10");
});

test("lastPlayDate='April 10 2026' (invalid format) is rejected → omitted", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", lastPlayDate: "April 10 2026" });
  assert.equal(result.lastPlayDate, undefined);
});

test("lastPlayDate='2026-4-1' (non-zero-padded) is rejected → omitted", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", lastPlayDate: "2026-4-1" });
  assert.equal(result.lastPlayDate, undefined);
});

// --- seasonPassClaimedTiers ---

test("seasonPassClaimedTiers=[3,1,2,2,1] → deduped and sorted ascending to [1,2,3]", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassClaimedTiers: [3, 1, 2, 2, 1] });
  assert.deepEqual(result.seasonPassClaimedTiers, [1, 2, 3]);
});

test("seasonPassClaimedTiers=[0,-1,1] → non-positive removed, result is [1]", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassClaimedTiers: [0, -1, 1] });
  assert.deepEqual(result.seasonPassClaimedTiers, [1]);
});

test("account normalization preserves moderation, campaign, dungeon, seasonal, and mailbox state", () => {
  const result = normalizePlayerAccountReadModel({
    playerId: "p1",
    notificationPreferences: {
      matchFound: false,
      turnReminder: true,
      groupChallenge: false,
      friendLeaderboard: true,
      reengagement: false,
      updatedAt: " 2026-05-06T01:00:00.000Z "
    },
    leaderboardAbuseState: {
      currentDay: "2026-05-06",
      dailyEloGain: 7.9,
      dailyEloLoss: -3,
      status: "flagged",
      lastAlertAt: " 2026-05-06T02:00:00.000Z ",
      lastAlertReasons: [" boost-ring ", "", "boost-ring", "win-trade"],
      opponentStats: [
        {
          opponentPlayerId: " rival-b ",
          matchCount: 4.8,
          eloGain: 16.2,
          eloLoss: 1.9,
          lastPlayedAt: "2026-05-06T02:30:00.000Z"
        },
        {
          opponentPlayerId: "rival-a",
          matchCount: -1,
          eloGain: -2,
          eloLoss: 3.3,
          lastPlayedAt: "2026-05-06T01:30:00.000Z"
        }
      ]
    },
    leaderboardModerationState: {
      frozenAt: " 2026-05-06T03:00:00.000Z ",
      frozenByPlayerId: " moderator-1 ",
      freezeReason: " suspicious ladder cluster ",
      hiddenAt: " 2026-05-06T04:00:00.000Z ",
      hiddenByPlayerId: " moderator-2 ",
      hiddenReason: " manual review "
    },
    campaignProgress: {
      missions: [
        {
          missionId: " mission-b ",
          attempts: 2.7,
          completedAt: "2026-05-06T05:00:00.000Z",
          acknowledgedDialogueLineIds: [" outro-2 ", "intro-1", "", "intro-1"]
        },
        {
          missionId: "mission-a",
          attempts: -1
        }
      ]
    },
    dailyDungeonState: {
      dateKey: "2026-05-06",
      attemptsUsed: 0,
      claimedRunIds: [" run-2 ", "", "run-1", "run-2"],
      runs: [
        {
          runId: " run-b ",
          dungeonId: " dungeon-b ",
          floor: 3.9,
          startedAt: "2026-05-06T06:00:00.000Z"
        },
        {
          runId: "run-a",
          dungeonId: "dungeon-a",
          floor: 0,
          startedAt: "2026-05-06T07:00:00.000Z",
          rewardClaimedAt: "2026-05-06T08:00:00.000Z"
        }
      ]
    },
    seasonalEventStates: [
      {
        eventId: " event-b ",
        points: 12.8,
        claimedRewardIds: [" reward-2 ", "", "reward-1", "reward-2"],
        appliedActionIds: [" action-2 ", "action-1", "action-1"],
        lastUpdatedAt: "2026-05-06T09:00:00.000Z"
      },
      {
        eventId: "event-a",
        points: -4,
        claimedRewardIds: [],
        appliedActionIds: [],
        lastUpdatedAt: "2026-05-06T10:00:00.000Z"
      }
    ],
    mailbox: [
      {
        id: " expired ",
        kind: "compensation",
        title: " Expired Grant ",
        body: " Old reward ",
        sentAt: "2026-05-05T01:00:00.000Z",
        expiresAt: "2000-01-01T00:00:00.000Z",
        grant: { gems: 5.2 }
      },
      {
        id: " claimable ",
        kind: "announcement",
        title: " Launch Pack ",
        body: " Claim this pack ",
        sentAt: "2026-05-06T01:00:00.000Z",
        expiresAt: "2999-01-01T00:00:00.000Z",
        grant: {
          resources: { gold: 2.9, wood: -1, ore: 4.2 },
          equipmentIds: [" sword-1 ", "", "sword-1"],
          cosmeticIds: [" banner-1 ", "banner-1"],
          seasonBadges: [" beta ", "", "beta"],
          seasonPassPremium: true
        }
      },
      {
        id: " read ",
        kind: "system",
        title: " Seen ",
        body: " Already read ",
        sentAt: "2026-05-04T01:00:00.000Z",
        readAt: "2026-05-04T02:00:00.000Z"
      },
      {
        id: "",
        kind: "system",
        title: "Ignored",
        body: "Missing id",
        sentAt: "2026-05-06T01:00:00.000Z"
      }
    ]
  });

  assert.deepEqual(result.notificationPreferences, {
    matchFound: false,
    turnReminder: true,
    groupChallenge: false,
    friendLeaderboard: true,
    reengagement: false,
    updatedAt: "2026-05-06T01:00:00.000Z"
  });
  assert.deepEqual(result.leaderboardAbuseState, {
    currentDay: "2026-05-06",
    dailyEloGain: 7,
    dailyEloLoss: 0,
    opponentStats: [
      {
        opponentPlayerId: "rival-b",
        matchCount: 4,
        eloGain: 16,
        eloLoss: 1,
        lastPlayedAt: "2026-05-06T02:30:00.000Z"
      },
      {
        opponentPlayerId: "rival-a",
        matchCount: 0,
        eloGain: 0,
        eloLoss: 3,
        lastPlayedAt: "2026-05-06T01:30:00.000Z"
      }
    ],
    status: "flagged",
    lastAlertAt: "2026-05-06T02:00:00.000Z",
    lastAlertReasons: ["boost-ring", "win-trade"]
  });
  assert.deepEqual(result.leaderboardModerationState, {
    frozenAt: "2026-05-06T03:00:00.000Z",
    frozenByPlayerId: "moderator-1",
    freezeReason: "suspicious ladder cluster",
    hiddenAt: "2026-05-06T04:00:00.000Z",
    hiddenByPlayerId: "moderator-2",
    hiddenReason: "manual review"
  });
  assert.deepEqual(result.campaignProgress, {
    missions: [
      { missionId: "mission-a", attempts: 0 },
      {
        missionId: "mission-b",
        attempts: 2,
        acknowledgedDialogueLineIds: ["intro-1", "outro-2"],
        completedAt: "2026-05-06T05:00:00.000Z"
      }
    ]
  });
  assert.deepEqual(result.dailyDungeonState, {
    dateKey: "2026-05-06",
    attemptsUsed: 2,
    claimedRunIds: ["run-1", "run-2"],
    runs: [
      {
        runId: "run-a",
        dungeonId: "dungeon-a",
        floor: 1,
        startedAt: "2026-05-06T07:00:00.000Z",
        rewardClaimedAt: "2026-05-06T08:00:00.000Z"
      },
      {
        runId: "run-b",
        dungeonId: "dungeon-b",
        floor: 3,
        startedAt: "2026-05-06T06:00:00.000Z"
      }
    ]
  });
  assert.deepEqual(result.seasonalEventStates, [
    {
      eventId: "event-a",
      points: 0,
      claimedRewardIds: [],
      appliedActionIds: [],
      lastUpdatedAt: "2026-05-06T10:00:00.000Z"
    },
    {
      eventId: "event-b",
      points: 12,
      claimedRewardIds: ["reward-1", "reward-2"],
      appliedActionIds: ["action-1", "action-2"],
      lastUpdatedAt: "2026-05-06T09:00:00.000Z"
    }
  ]);
  assert.deepEqual(result.mailboxSummary, {
    totalCount: 3,
    unreadCount: 1,
    claimableCount: 1,
    expiredCount: 1
  });
  assert.equal(result.mailbox?.[0]?.id, "claimable");
  assert.deepEqual(result.mailbox?.[0]?.grant, {
    resources: { gold: 2, wood: 0, ore: 4 },
    equipmentIds: ["sword-1"],
    cosmeticIds: ["banner-1"],
    seasonBadges: ["beta"],
    seasonPassPremium: true
  });
});

test("mailbox helpers summarize expiry, unread, and claimable counts at a deterministic time", () => {
  const mailbox = [
    {
      id: "active-grant",
      kind: "system" as const,
      title: "Active",
      body: "Claimable",
      sentAt: "2026-05-06T01:00:00.000Z",
      expiresAt: "2026-05-07T01:00:00.000Z",
      grant: { gems: 1 }
    },
    {
      id: "expired-grant",
      kind: "compensation" as const,
      title: "Expired",
      body: "Expired",
      sentAt: "2026-05-05T01:00:00.000Z",
      expiresAt: "2026-05-05T12:00:00.000Z",
      grant: { gems: 1 }
    },
    {
      id: "claimed",
      kind: "announcement" as const,
      title: "Claimed",
      body: "Already claimed",
      sentAt: "2026-05-04T01:00:00.000Z",
      claimedAt: "2026-05-04T02:00:00.000Z",
      grant: { gems: 1 }
    }
  ];

  assert.equal(isPlayerMailboxMessageExpired({ expiresAt: "2026-05-05T12:00:00.000Z" }, new Date("2026-05-06T00:00:00.000Z")), true);
  assert.equal(isPlayerMailboxMessageExpired({}, new Date("2026-05-06T00:00:00.000Z")), false);
  assert.deepEqual(summarizePlayerMailbox(mailbox, new Date("2026-05-06T00:00:00.000Z")), {
    totalCount: 3,
    unreadCount: 1,
    claimableCount: 1,
    expiredCount: 1
  });
});
