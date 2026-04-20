import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveBattlePassConfig,
  resolveBattlePassTierForXp,
  toBattlePassRewardGrant,
  type BattlePassConfig
} from "@server/domain/economy/battle-pass";

function createStubBattlePassConfig(overrides?: Partial<BattlePassConfig>): BattlePassConfig {
  return {
    seasonXpPerWin: 100,
    seasonXpPerLoss: 40,
    seasonXpDailyLoginBonus: 20,
    tiers: [
      { tier: 1, xpRequired: 0, freeReward: { gold: 200 }, premiumReward: { gems: 20 } },
      { tier: 2, xpRequired: 500, freeReward: { gold: 275 }, premiumReward: { gems: 20 } },
      { tier: 3, xpRequired: 1000, freeReward: { gold: 350 }, premiumReward: { equipmentId: "sunforged_spear" } }
    ],
    ...overrides
  };
}

test("resolveBattlePassConfig: normalizes tiers, thresholds, and trimmed premium equipment ids", () => {
  const config = resolveBattlePassConfig({
    seasonXpPerWin: 100.9,
    seasonXpPerLoss: 40.1,
    seasonXpDailyLoginBonus: 20.8,
    tiers: [
      {
        tier: 1,
        xpRequired: 0.9,
        freeReward: { gold: 200.9, gems: 0 },
        premiumReward: { gems: 20.9, equipmentId: "   " }
      },
      {
        tier: 2,
        xpRequired: 500.9,
        freeReward: { gold: 275.9 },
        premiumReward: { equipmentId: " sunforged_spear " }
      }
    ]
  });

  assert.equal(config.seasonXpPerWin, 100);
  assert.equal(config.seasonXpPerLoss, 40);
  assert.equal(config.seasonXpDailyLoginBonus, 20);
  assert.deepEqual(config.tiers, [
    {
      tier: 1,
      xpRequired: 0,
      freeReward: { gold: 200 },
      premiumReward: { gems: 20 }
    },
    {
      tier: 2,
      xpRequired: 500,
      freeReward: { gold: 275 },
      premiumReward: { equipmentId: "sunforged_spear" }
    }
  ]);
});

test("resolveBattlePassConfig: rejects non-monotonic tier thresholds", () => {
  assert.throws(
    () =>
      resolveBattlePassConfig({
        seasonXpPerWin: 100,
        seasonXpPerLoss: 40,
        seasonXpDailyLoginBonus: 20,
        tiers: [
          { tier: 1, xpRequired: 0, freeReward: {}, premiumReward: {} },
          { tier: 2, xpRequired: 499, freeReward: {}, premiumReward: {} },
          { tier: 3, xpRequired: 400, freeReward: {}, premiumReward: {} }
        ]
      }),
    /xpRequired must be monotonic/
  );
});

test("resolveBattlePassTierForXp: unlocks tiers only when xp reaches each threshold", () => {
  const config = createStubBattlePassConfig();

  assert.equal(resolveBattlePassTierForXp(config, -100), 1);
  assert.equal(resolveBattlePassTierForXp(config, 499.9), 1);
  assert.equal(resolveBattlePassTierForXp(config, 500), 2);
  assert.equal(resolveBattlePassTierForXp(config, 999.9), 2);
  assert.equal(resolveBattlePassTierForXp(config, 1000), 3);
  assert.equal(resolveBattlePassTierForXp(config, 5000), 3);
});

test("toBattlePassRewardGrant: grants premium gems alongside the free reward path", () => {
  const grant = toBattlePassRewardGrant({ gold: 275 }, { gems: 20 });

  assert.equal(grant.gems, 20);
  assert.deepEqual(grant.resources, { gold: 275, wood: 0, ore: 0 });
  assert.deepEqual(grant.equipmentIds, []);
});

test("toBattlePassRewardGrant: grants premium equipment without polluting resource totals", () => {
  const grant = toBattlePassRewardGrant({ gold: 500 }, { equipmentId: "sunforged_spear" }, undefined);

  assert.equal(grant.gems, 0);
  assert.deepEqual(grant.resources, { gold: 500, wood: 0, ore: 0 });
  assert.deepEqual(grant.equipmentIds, ["sunforged_spear"]);
});
