import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAchievementUiItems,
  calculateAchievementProgressFraction,
  groupAchievementUiItems,
  resolveAchievementUiCategory
} from "../src/achievement-ui.ts";

test("achievement ui helpers map achievements into stable categories", () => {
  assert.deepEqual(resolveAchievementUiCategory("first_battle"), { id: "combat", label: "战斗" });
  assert.deepEqual(resolveAchievementUiCategory("world_explorer"), { id: "exploration", label: "探索" });
  assert.deepEqual(resolveAchievementUiCategory("skill_scholar"), { id: "progression", label: "养成" });
});

test("achievement ui helpers clamp progress fractions and expose display labels", () => {
  assert.equal(calculateAchievementProgressFraction({ current: 2, target: 4 }), 0.5);
  assert.equal(calculateAchievementProgressFraction({ current: 9, target: 3 }), 1);
  assert.equal(calculateAchievementProgressFraction({ current: 1, target: 0 }), 0);

  const items = buildAchievementUiItems([
    {
      id: "enemy_slayer",
      title: "猎敌者",
      description: "击败 3 名敌人或中立守军。",
      metric: "battles_won",
      current: 2,
      target: 3,
      unlocked: false,
      progressUpdatedAt: "2026-03-28T12:03:00.000Z"
    },
    {
      id: "first_battle",
      title: "初次交锋",
      description: "首次进入战斗。",
      metric: "battles_started",
      current: 1,
      target: 1,
      unlocked: true,
      unlockedAt: "2026-03-28T12:05:00.000Z"
    }
  ]);

  assert.equal(items[0]?.id, "first_battle");
  assert.equal(items[0]?.statusLabel, "已解锁");
  assert.equal(items[0]?.progressPercent, 100);
  assert.equal(items[1]?.statusLabel, "进行中");
  assert.equal(items[1]?.progressPercent, 67);
  assert.equal(items[1]?.footnote, "最近推进 2026-03-28 12:03 · 还差 1 点进度");

  const groups = groupAchievementUiItems(items);
  assert.deepEqual(groups.map((group) => group.category.id), ["combat", "exploration", "progression", "equipment"]);
  assert.deepEqual(groups[0]?.items.map((item) => item.id), ["first_battle", "enemy_slayer"]);
});
