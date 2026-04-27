import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import {
  consumeActionSubmissionRateLimit,
  hasVerifiedDailyDungeonClaim,
  resetActionSubmissionRateLimitState
} from "@server/domain/battle/event-engine";
import { __playerAccountRouteInternals } from "@server/domain/account/player-accounts";
import type { PlayerAccountSnapshot } from "@server/persistence";
import { createFakeRedisRateLimitClient } from "./fake-redis-rate-limit.ts";

function createRequestWithTestNow(value: string): IncomingMessage {
  return {
    headers: {
      "x-veil-test-now": value
    }
  } as unknown as IncomingMessage;
}

test("daily dungeon test-now override is only honored in test mode", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousOverride = process.env.VEIL_ENABLE_TEST_TIME_OVERRIDE;

  try {
    process.env.NODE_ENV = "production";
    delete process.env.VEIL_ENABLE_TEST_TIME_OVERRIDE;
    assert.equal(__playerAccountRouteInternals.readDailyDungeonNowOverride(createRequestWithTestNow("2026-04-07T12:00:00.000Z")), null);

    process.env.NODE_ENV = "test";
    assert.equal(
      __playerAccountRouteInternals.readDailyDungeonNowOverride(createRequestWithTestNow("2026-04-07T12:00:00.000Z"))?.toISOString(),
      "2026-04-07T12:00:00.000Z"
    );
  } finally {
    if (previousNodeEnv === undefined) {
      process.env.NODE_ENV = "test";
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousOverride === undefined) {
      delete process.env.VEIL_ENABLE_TEST_TIME_OVERRIDE;
    } else {
      process.env.VEIL_ENABLE_TEST_TIME_OVERRIDE = previousOverride;
    }
  }
});

test("action submission bursts are rate-limited for five seconds", async () => {
  resetActionSubmissionRateLimitState();

  const first = await consumeActionSubmissionRateLimit("player-1:campaign");
  const second = await consumeActionSubmissionRateLimit("player-1:campaign");
  const third = await consumeActionSubmissionRateLimit("player-1:campaign", Date.now() + 5_001);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.retryAfterSeconds != null, true);
  assert.equal(third.allowed, true);
});

test("action submission rate limits are shared through Redis across route instances", async () => {
  resetActionSubmissionRateLimitState();
  let now = Date.parse("2026-04-04T12:00:00.000Z");
  const redis = createFakeRedisRateLimitClient(() => now);
  const key = "player-1:campaign";

  const first = await consumeActionSubmissionRateLimit(key, {
    redisClient: redis as never,
    nowMs: now
  } as never);
  resetActionSubmissionRateLimitState();
  now += 100;
  const second = await consumeActionSubmissionRateLimit(key, {
    redisClient: redis as never,
    nowMs: now
  } as never);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.retryAfterSeconds, 5);
});

test("verified action checks require server-owned state", () => {
  const account: Pick<PlayerAccountSnapshot, "dailyDungeonState" | "recentBattleReplays"> = {
    dailyDungeonState: {
      dateKey: "2026-04-07",
      attemptsUsed: 1,
      claimedRunIds: ["run-claimed"],
      runs: [
        {
          runId: "run-claimed",
          dungeonId: "shadow-archives",
          floor: 2,
          startedAt: "2026-04-07T11:55:00.000Z",
          rewardClaimedAt: "2026-04-07T12:00:00.000Z"
        }
      ]
    },
    recentBattleReplays: [
      {
        id: "amber-fields:chapter1-ember-watch-battle:player-1",
        roomId: "amber-fields",
        playerId: "player-1",
        battleId: "chapter1-ember-watch-battle",
        battleKind: "hero",
        playerCamp: "attacker",
        heroId: "hero-1",
        startedAt: "2026-04-07T11:30:00.000Z",
        completedAt: "2026-04-07T11:45:00.000Z",
        initialState: {
          id: "chapter1-ember-watch-battle",
          round: 1,
          lanes: 1,
          activeUnitId: "unit-1",
          turnOrder: ["unit-1"],
          units: {},
          environment: [],
          log: [],
          rng: { seed: 1, cursor: 0 }
        },
        steps: [],
        result: "attacker_victory"
      } as PlayerAccountSnapshot["recentBattleReplays"][number]
    ]
  };

  assert.equal(hasVerifiedDailyDungeonClaim(account, "run-claimed", "shadow-archives"), true);
  assert.equal(hasVerifiedDailyDungeonClaim(account, "run-claimed", "other-dungeon"), false);
  assert.equal(
    __playerAccountRouteInternals.hasVerifiedCampaignMissionCompletion(account, {
      mapId: "amber-fields"
    }),
    true
  );
  assert.equal(
    __playerAccountRouteInternals.hasVerifiedCampaignMissionCompletion(account, {
      mapId: "other-map"
    }),
    false
  );
});
