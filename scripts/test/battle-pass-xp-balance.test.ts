import assert from "node:assert/strict";
import test from "node:test";

import { buildBattlePassBalancePlan, formatBattlePassBalancePlan } from "../battle-pass-xp-balance";

test("buildBattlePassBalancePlan projects tier pacing from season assumptions", () => {
  const plan = buildBattlePassBalancePlan(
    {
      seasonXpPerWin: 100,
      seasonXpPerLoss: 40,
      seasonXpDailyLoginBonus: 20,
      tiers: [
        { tier: 1, xpRequired: 0, freeReward: {}, premiumReward: {} },
        { tier: 2, xpRequired: 500, freeReward: {}, premiumReward: {} },
        { tier: 3, xpRequired: 1000, freeReward: {}, premiumReward: {} },
        { tier: 4, xpRequired: 1500, freeReward: {}, premiumReward: {} }
      ]
    },
    {
      seasonDays: 10,
      matchesPerDay: 5,
      winRate: 0.6,
      dailyLoginDays: 10
    }
  );

  assert.equal(plan.dailyMatchXp, 380);
  assert.equal(plan.dailyLoginXp, 20);
  assert.equal(plan.expectedDailyXp, 400);
  assert.equal(plan.projectedSeasonXp, 4000);
  assert.equal(plan.projectedTier, 4);
  assert.equal(plan.finalTierTargetDay, 4);
  assert.deepEqual(plan.milestones.map((entry) => entry.estimatedDay), [0, 2, 3, 4]);
});

test("formatBattlePassBalancePlan renders operator-facing summary lines", () => {
  const output = formatBattlePassBalancePlan({
    assumptions: {
      seasonDays: 28,
      matchesPerDay: 8,
      winRate: 0.55,
      dailyLoginDays: 28
    },
    dailyMatchXp: 586,
    dailyLoginXp: 20,
    expectedDailyXp: 606,
    projectedSeasonXp: 16968,
    projectedTier: 30,
    finalTierTargetDay: 24,
    milestones: [
      { tier: 1, xpRequired: 0, estimatedDay: 0 },
      { tier: 5, xpRequired: 2000, estimatedDay: 4 },
      { tier: 10, xpRequired: 4500, estimatedDay: 8 }
    ]
  });

  assert.match(output, /projectedSeasonXp=16968 projectedTier=30 finalTierTarget=D24/);
  assert.match(output, /T5\t2000\tD4/);
  assert.match(output, /T10\t4500\tD8/);
});
