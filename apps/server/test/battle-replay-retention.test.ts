import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateBattleReplayExpiry,
  prunePlayerBattleReplaysForRetention,
  readBattleReplayRetentionPolicy
} from "../src/battle-replay-retention";
import type { PlayerBattleReplaySummary } from "@veil/shared/battle";

function createReplay(overrides: Partial<PlayerBattleReplaySummary> = {}): PlayerBattleReplaySummary {
  return {
    id: "replay-1",
    roomId: "room-1",
    playerId: "player-1",
    battleId: "battle-1",
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId: "hero-1",
    startedAt: "2026-03-01T00:00:00.000Z",
    completedAt: "2026-03-01T00:05:00.000Z",
    initialState: {
      id: "battle-1",
      round: 1,
      lanes: 3,
      activeUnitId: null,
      turnOrder: [],
      units: {},
      unitCooldowns: {},
      environment: [],
      log: [],
      rng: { seed: 1, cursor: 0 }
    },
    steps: [],
    result: "attacker_victory",
    ...overrides
  };
}

test("battle replay retention config uses defaults and allows disabling ttl, max bytes, and cleanup", () => {
  const defaultPolicy = readBattleReplayRetentionPolicy({});
  assert.equal(defaultPolicy.ttlDays, 90);
  assert.equal(defaultPolicy.maxBytes, 512 * 1024);
  assert.equal(defaultPolicy.cleanupIntervalMinutes, 24 * 60);
  assert.equal(defaultPolicy.cleanupBatchSize, 100);

  const disabledPolicy = readBattleReplayRetentionPolicy({
    VEIL_BATTLE_REPLAY_TTL_DAYS: "0",
    VEIL_BATTLE_REPLAY_MAX_BYTES: "-1",
    VEIL_BATTLE_REPLAY_CLEANUP_INTERVAL_MINUTES: "0",
    VEIL_BATTLE_REPLAY_CLEANUP_BATCH_SIZE: "25"
  });
  assert.equal(disabledPolicy.ttlDays, null);
  assert.equal(disabledPolicy.maxBytes, null);
  assert.equal(disabledPolicy.cleanupIntervalMinutes, null);
  assert.equal(disabledPolicy.cleanupBatchSize, 25);
});

test("calculateBattleReplayExpiry returns an ISO timestamp at the ttl boundary", () => {
  assert.equal(
    calculateBattleReplayExpiry("2026-03-01T00:05:00.000Z", 90),
    "2026-05-30T00:05:00.000Z"
  );
  assert.equal(calculateBattleReplayExpiry("2026-03-01T00:05:00.000Z", null), undefined);
});

test("battle replay retention pruning drops expired entries and backfills expiresAt for retained rows", () => {
  const policy = readBattleReplayRetentionPolicy({
    VEIL_BATTLE_REPLAY_TTL_DAYS: "90",
    VEIL_BATTLE_REPLAY_CLEANUP_BATCH_SIZE: "10"
  });

  const pruned = prunePlayerBattleReplaysForRetention(
    [
      createReplay({
        id: "expired",
        completedAt: "2025-11-01T00:05:00.000Z"
      }),
      createReplay({
        id: "retained",
        completedAt: "2026-03-01T00:05:00.000Z"
      }),
      createReplay({
        id: "explicit-expiry",
        expiresAt: "2026-03-15T00:00:00.000Z"
      })
    ],
    policy,
    new Date("2026-04-01T00:00:00.000Z")
  );

  assert.equal(pruned.removedCount, 1);
  assert.equal(pruned.updatedCount, 1);
  assert.deepEqual(pruned.replays.map((replay) => replay.id), ["retained"]);
  assert.equal(pruned.replays[0]?.expiresAt, "2026-05-30T00:05:00.000Z");
});
