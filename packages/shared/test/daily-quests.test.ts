import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyQuestBoard } from "../src/index.ts";

test("daily quest board derives progress and pending rewards from event history", () => {
  const board = buildDailyQuestBoard(
    [
      {
        id: "event-move-1",
        worldEventType: "hero.moved",
        description: "侦察移动"
      },
      {
        id: "event-move-2",
        worldEventType: "hero.moved",
        description: "侦察移动"
      },
      {
        id: "event-move-3",
        worldEventType: "hero.moved",
        description: "侦察移动"
      },
      {
        id: "event-battle-win",
        worldEventType: "battle.resolved",
        description: "战斗结果为 胜利。"
      },
      {
        id: "player-1:2026-04-04T12:10:00.000Z:daily-quest-claim:1:daily_explore_frontier",
        worldEventType: undefined,
        description: "领取每日任务：侦察前线"
      }
    ],
    {
      enabled: true,
      cycleKey: "2026-04-04",
      resetAt: "2026-04-04T23:59:59.999Z"
    }
  );

  assert.equal(board.enabled, true);
  assert.equal(board.availableClaims, 1);
  assert.deepEqual(board.pendingRewards, {
    gems: 5,
    gold: 60
  });
  assert.deepEqual(
    board.quests.map((quest) => ({ id: quest.id, current: quest.current, completed: quest.completed, claimed: quest.claimed })),
    [
      { id: "daily_explore_frontier", current: 3, completed: true, claimed: true },
      { id: "daily_battle_victory", current: 1, completed: true, claimed: false },
      { id: "daily_resource_run", current: 0, completed: false, claimed: false }
    ]
  );
});

test("daily quest board marks claims by deterministic claim event id", () => {
  const board = buildDailyQuestBoard(
    [
      {
        id: "player-1:2026-04-04T12:00:00.000Z:hero.collected:1",
        worldEventType: "hero.collected",
        description: "完成资源收集"
      },
      {
        id: "player-1:2026-04-04T12:05:00.000Z:hero.collected:2",
        worldEventType: "hero.collected",
        description: "完成资源收集"
      },
      {
        id: "player-1:2026-04-04T12:06:00.000Z:daily-quest-claim:1:daily_resource_run",
        worldEventType: undefined,
        description: "领取每日任务：补给回收"
      }
    ],
    { enabled: true }
  );

  const resourceQuest = board.quests.find((quest) => quest.id === "daily_resource_run");
  assert.equal(resourceQuest?.completed, true);
  assert.equal(resourceQuest?.claimed, true);
  assert.deepEqual(board.pendingRewards, { gems: 0, gold: 0 });
});
