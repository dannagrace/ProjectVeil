import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTimelineEntriesFromUpdate,
  formatSystemTimelineEntry,
  pickRecentBattleTimeline
} from "../assets/scripts/cocos-ui-formatters";

test("buildTimelineEntriesFromUpdate formats world events and system rejection", () => {
  const entries = buildTimelineEntriesFromUpdate({
    world: {
      meta: {
        roomId: "room-alpha",
        seed: 1001,
        day: 1
      },
      map: {
        width: 1,
        height: 1,
        tiles: []
      },
      ownHeroes: [],
      visibleHeroes: [],
      resources: {
        gold: 0,
        wood: 0,
        ore: 0
      },
      playerId: "player-1"
    },
    battle: null,
    events: [
      {
        type: "hero.collected",
        heroId: "hero-1",
        resource: {
          kind: "gold",
          amount: 300
        }
      },
      {
        type: "battle.started",
        heroId: "hero-1",
        encounterKind: "neutral",
        neutralArmyId: "neutral-1",
        battleId: "battle-1",
        path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        moveCost: 1
      }
    ],
    movementPlan: {
      heroId: "hero-1",
      destination: { x: 1, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      travelPath: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      moveCost: 1,
      endsInEncounter: false,
      encounterKind: "none"
    },
    reachableTiles: [{ x: 1, y: 0 }],
    reason: "blocked"
  });

  assert.deepEqual(entries, [
    "系统：操作被拒绝，原因是 blocked",
    "事件：计划移动 1 格，前往 (1,0)。",
    "事件：采集 金币 +300。",
    "事件：遭遇中立守军 neutral-1。"
  ]);
});

test("buildTimelineEntriesFromUpdate keeps repeated move events readable by destination", () => {
  const entries = buildTimelineEntriesFromUpdate({
    world: {
      meta: {
        roomId: "room-alpha",
        seed: 1001,
        day: 1
      },
      map: {
        width: 2,
        height: 2,
        tiles: []
      },
      ownHeroes: [],
      visibleHeroes: [],
      resources: {
        gold: 0,
        wood: 0,
        ore: 0
      },
      playerId: "player-1"
    },
    battle: null,
    events: [
      {
        type: "hero.moved",
        heroId: "hero-1",
        path: [{ x: 1, y: 1 }, { x: 1, y: 0 }],
        moveCost: 1
      }
    ],
    movementPlan: {
      heroId: "hero-1",
      destination: { x: 1, y: 0 },
      path: [{ x: 1, y: 1 }, { x: 1, y: 0 }],
      travelPath: [{ x: 1, y: 1 }, { x: 1, y: 0 }],
      moveCost: 1,
      endsInEncounter: false,
      encounterKind: "none"
    },
    reachableTiles: [{ x: 1, y: 0 }],
    reason: undefined
  });

  assert.deepEqual(entries, [
    "事件：计划移动 1 格，前往 (1,0)。",
    "事件：移动了 1 步，到达 (1,0)。"
  ]);
});

test("formatSystemTimelineEntry and pickRecentBattleTimeline keep timeline presentation stable", () => {
  const entries = [
    formatSystemTimelineEntry("连接已恢复。"),
    "事件：战斗结束：进攻方获胜。",
    "事件：遭遇中立守军 neutral-1。",
    "事件：采集 木材 +5。"
  ];

  assert.equal(entries[0], "系统：连接已恢复。");
  assert.deepEqual(pickRecentBattleTimeline(entries), [
    "事件：战斗结束：进攻方获胜。",
    "事件：遭遇中立守军 neutral-1。"
  ]);
});
