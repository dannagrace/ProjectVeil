import assert from "node:assert/strict";
import test from "node:test";
import { renderAchievementProgress, renderRecentAccountEvents } from "../src/account-history";
import type { PlayerAccountProfile } from "../src/player-account";

function createProfile(): PlayerAccountProfile {
  return {
    playerId: "player-1",
    displayName: "暮火侦骑",
    globalResources: {
      gold: 12,
      wood: 4,
      ore: 2
    },
    achievements: [
      {
        id: "first_battle",
        title: "初次交锋",
        description: "首次进入战斗。",
        metric: "battles_started",
        current: 1,
        target: 1,
        unlocked: true,
        unlockedAt: "2026-03-27T12:00:00.000Z"
      },
      {
        id: "enemy_slayer",
        title: "猎敌者",
        description: "击败 3 名敌人或中立守军。",
        metric: "battles_won",
        current: 2,
        target: 3,
        unlocked: false,
        progressUpdatedAt: "2026-03-27T12:02:00.000Z"
      }
    ],
    recentEventLog: [
      {
        id: "event-2",
        timestamp: "2026-03-27T12:03:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "achievement",
        description: "解锁成就：初次交锋",
        achievementId: "first_battle",
        rewards: [{ type: "badge", label: "初次交锋" }]
      },
      {
        id: "event-1",
        timestamp: "2026-03-27T12:00:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "combat",
        description: "暮火侦骑 与敌方英雄交战。",
        heroId: "hero-1",
        worldEventType: "battle.started",
        rewards: [{ type: "experience", label: "经验", amount: 40 }]
      }
    ],
    lastRoomId: "room-alpha",
    source: "remote"
  };
}

test("account history renderer shows unlocked achievement state and footnotes", () => {
  const html = renderAchievementProgress(createProfile());

  assert.match(html, /成就 1\/2 已解锁/);
  assert.match(html, /最近推进 猎敌者 2\/3/);
  assert.match(html, /已解锁/);
  assert.match(html, /解锁于/);
  assert.match(html, /还差 1 点进度/);
});

test("account history renderer shows full event history metadata and reward chips", () => {
  const html = renderRecentAccountEvents(createProfile());

  assert.match(html, /最近 2 条关键事件/);
  assert.match(html, /最新/);
  assert.match(html, /英雄 hero-1/);
  assert.match(html, /事件 battle\.started/);
  assert.match(html, /成就 first_battle/);
  assert.match(html, /经验 \+40/);
  assert.match(html, /初次交锋/);
});
