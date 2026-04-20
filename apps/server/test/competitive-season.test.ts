import assert from "node:assert/strict";
import test from "node:test";
import { resolveCompetitiveProgression } from "@server/domain/social/competitive-season";
import type { PlayerAccountSnapshot } from "@server/persistence";

function createAccount(overrides: Partial<PlayerAccountSnapshot> = {}): PlayerAccountSnapshot {
  return {
    playerId: overrides.playerId ?? "player-1",
    displayName: overrides.displayName ?? "player-1",
    globalResources: overrides.globalResources ?? { gold: 0, wood: 0, ore: 0 },
    achievements: overrides.achievements ?? [],
    recentEventLog: overrides.recentEventLog ?? [],
    recentBattleReplays: overrides.recentBattleReplays ?? [],
    eloRating: overrides.eloRating ?? 1000,
    rankDivision: overrides.rankDivision ?? "bronze_i",
    peakRankDivision: overrides.peakRankDivision ?? (overrides.rankDivision ?? "bronze_i"),
    ...(overrides.promotionSeries ? { promotionSeries: overrides.promotionSeries } : {}),
    ...(overrides.demotionShield ? { demotionShield: overrides.demotionShield } : {}),
    ...(overrides.rankedWeeklyProgress ? { rankedWeeklyProgress: overrides.rankedWeeklyProgress } : {})
  };
}

test("competitive progression starts a promotion series at the next division cutoff", () => {
  const result = resolveCompetitiveProgression(
    createAccount({
      eloRating: 340,
      rankDivision: "bronze_i",
      peakRankDivision: "bronze_i"
    }),
    { eloRating: 350 },
    [],
    350,
    new Date("2026-04-06T12:00:00.000Z")
  );

  assert.equal(result.rankDivision, "bronze_i");
  assert.deepEqual(result.promotionSeries, {
    targetDivision: "bronze_ii",
    wins: 0,
    losses: 0,
    winsRequired: 3,
    lossesAllowed: 2
  });
});

test("competitive progression applies one-step weekly decay after an inactive week", () => {
  const result = resolveCompetitiveProgression(
    createAccount({
      eloRating: 1180,
      rankDivision: "silver_ii",
      peakRankDivision: "silver_iii",
      rankedWeeklyProgress: {
        currentWeekStartsAt: "2026-03-30T00:00:00.000Z",
        currentWeekBattles: 0,
        currentWeekWins: 0
      }
    }),
    {},
    [],
    1180,
    new Date("2026-04-06T12:00:00.000Z")
  );

  assert.equal(result.rankDivision, "silver_i");
  assert.equal(result.peakRankDivision, "silver_iii");
  assert.deepEqual(result.rankedWeeklyProgress, {
    currentWeekStartsAt: "2026-04-06T00:00:00.000Z",
    currentWeekBattles: 0,
    currentWeekWins: 0,
    previousWeekStartsAt: "2026-03-30T00:00:00.000Z"
  });
});

test("competitive progression counts losses as activity for weekly decay immunity", () => {
  const result = resolveCompetitiveProgression(
    createAccount({
      eloRating: 1180,
      rankDivision: "silver_ii",
      peakRankDivision: "silver_ii",
      rankedWeeklyProgress: {
        currentWeekStartsAt: "2026-03-30T00:00:00.000Z",
        currentWeekBattles: 1,
        currentWeekWins: 0
      }
    }),
    {},
    [],
    1180,
    new Date("2026-04-06T12:00:00.000Z")
  );

  assert.equal(result.rankDivision, "silver_ii");
});
