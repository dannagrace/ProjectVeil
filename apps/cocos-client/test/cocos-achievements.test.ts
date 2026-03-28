import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCocosAchievementPanelItems,
  buildCocosAchievementUnlockNotice,
  collectAchievementUnlockEventIds,
  shouldRefreshGameplayAccountProfileForEvents
} from "../assets/scripts/cocos-achievements.ts";

test("buildCocosAchievementPanelItems sorts unlocked entries first and formats progress metadata", () => {
  const items = buildCocosAchievementPanelItems([
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

  assert.deepEqual(items.map((item) => item.id), ["first_battle", "enemy_slayer"]);
  assert.equal(items[0]?.statusLabel, "已解锁");
  assert.equal(items[0]?.progressLabel, "1/1");
  assert.equal(items[0]?.footnote, "解锁于 2026-03-28 12:05");
  assert.equal(items[1]?.statusLabel, "未解锁");
  assert.equal(items[1]?.footnote, "最近推进 2026-03-28 12:03 · 还差 1 点进度");
});

test("buildCocosAchievementUnlockNotice emits the newest unseen unlock toast", () => {
  const recentEventLog = [
    {
      id: "event-new",
      timestamp: "2026-03-28T12:05:00.000Z",
      roomId: "room-alpha",
      playerId: "player-1",
      category: "achievement" as const,
      description: "解锁成就：初次交锋",
      achievementId: "first_battle" as const,
      rewards: [{ type: "badge" as const, label: "初次交锋" }]
    },
    {
      id: "event-old",
      timestamp: "2026-03-28T12:03:00.000Z",
      roomId: "room-alpha",
      playerId: "player-1",
      category: "achievement" as const,
      description: "成就进度推进：猎敌者 (2/3)",
      achievementId: "enemy_slayer" as const,
      rewards: []
    }
  ];

  assert.deepEqual(collectAchievementUnlockEventIds(recentEventLog), ["event-new"]);
  assert.deepEqual(buildCocosAchievementUnlockNotice(recentEventLog, new Set(["already-seen"])), {
    eventId: "event-new",
    title: "成就解锁",
    detail: "初次交锋"
  });
  assert.equal(buildCocosAchievementUnlockNotice(recentEventLog, new Set(["event-new"])), null);
});

test("shouldRefreshGameplayAccountProfileForEvents covers achievement-driving world events", () => {
  assert.equal(shouldRefreshGameplayAccountProfileForEvents(["hero.moved"]), true);
  assert.equal(shouldRefreshGameplayAccountProfileForEvents(["hero.equipmentChanged"]), true);
  assert.equal(shouldRefreshGameplayAccountProfileForEvents(["turn.advanced"]), false);
});
