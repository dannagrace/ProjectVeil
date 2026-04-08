import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosDailyQuestPanelView } from "../assets/scripts/cocos-daily-quest-panel.ts";

test("buildCocosDailyQuestPanelView renders progress, claimable, and claimed quest lines", () => {
  const view = buildCocosDailyQuestPanelView({
    pendingQuestId: null,
    board: {
      enabled: true,
      cycleKey: "2026-04-08",
      resetAt: "2026-04-08T23:59:59.999Z",
      availableClaims: 1,
      pendingRewards: {
        gems: 12,
        gold: 50
      },
      quests: [
        {
          id: "move-1",
          title: "巡视边境",
          description: "移动英雄 3 次。",
          target: 3,
          current: 1,
          completed: false,
          claimed: false,
          reward: {
            gems: 4,
            gold: 0
          }
        },
        {
          id: "collect-1",
          title: "补给征收",
          description: "收集资源 2 次。",
          target: 2,
          current: 2,
          completed: true,
          claimed: false,
          reward: {
            gems: 8,
            gold: 50
          }
        },
        {
          id: "battle-1",
          title: "压制前线",
          description: "赢得 1 场战斗。",
          target: 1,
          current: 1,
          completed: true,
          claimed: true,
          reward: {
            gems: 5,
            gold: 20
          }
        }
      ]
    }
  });

  assert.equal(view.title, "每日任务板");
  assert.equal(view.subtitle, "轮换 2026-04-08");
  assert.equal(view.claimableCountLabel, "可领取 1");
  assert.equal(view.pendingRewardsLabel, "待领取奖励 宝石 x12 · 金币 x50");
  assert.equal(view.resetLabel, "重置 23:59 UTC");
  assert.equal(view.emptyLabel, null);
  assert.deepEqual(view.quests, [
    {
      questId: "move-1",
      title: "巡视边境",
      detail: "移动英雄 3 次。",
      progressLabel: "1/3",
      rewardLabel: "宝石 x4",
      stateLabel: "进行中",
      action: null
    },
    {
      questId: "collect-1",
      title: "补给征收",
      detail: "收集资源 2 次。",
      progressLabel: "2/2",
      rewardLabel: "宝石 x8 · 金币 x50",
      stateLabel: "可领取",
      action: {
        questId: "collect-1",
        label: "领取奖励",
        enabled: true
      }
    },
    {
      questId: "battle-1",
      title: "压制前线",
      detail: "赢得 1 场战斗。",
      progressLabel: "1/1",
      rewardLabel: "宝石 x5 · 金币 x20",
      stateLabel: "已领取",
      action: null
    }
  ]);
});

test("buildCocosDailyQuestPanelView disables the action for a pending claim", () => {
  const view = buildCocosDailyQuestPanelView({
    pendingQuestId: "collect-1",
    board: {
      enabled: true,
      cycleKey: "2026-04-08",
      resetAt: "2026-04-08T23:59:59.999Z",
      availableClaims: 1,
      pendingRewards: {
        gems: 8,
        gold: 50
      },
      quests: [
        {
          id: "collect-1",
          title: "补给征收",
          description: "收集资源 2 次。",
          target: 2,
          current: 2,
          completed: true,
          claimed: false,
          reward: {
            gems: 8,
            gold: 50
          }
        }
      ]
    }
  });

  assert.deepEqual(view.quests[0]?.action, {
    questId: "collect-1",
    label: "领取中...",
    enabled: false
  });
  assert.equal(view.quests[0]?.stateLabel, "领取中...");
});

test("buildCocosDailyQuestPanelView reports the empty state when no quests are available", () => {
  const view = buildCocosDailyQuestPanelView({
    pendingQuestId: null,
    board: {
      enabled: true,
      cycleKey: "2026-04-08",
      resetAt: "2026-04-08T23:59:59.999Z",
      availableClaims: 0,
      pendingRewards: {
        gems: 0,
        gold: 0
      },
      quests: []
    }
  });

  assert.equal(view.claimableCountLabel, "可领取 0");
  assert.equal(view.pendingRewardsLabel, "待领取奖励 0");
  assert.equal(view.emptyLabel, "今日任务暂未开放或尚未下发。");
  assert.deepEqual(view.quests, []);
});
