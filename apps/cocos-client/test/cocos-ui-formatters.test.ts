import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTimelineEntriesFromUpdate,
  describeMoveAttemptFeedback,
  describeSessionActionOutcome,
  formatSessionActionReason,
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
        type: "hero.recruited",
        heroId: "hero-1",
        buildingId: "recruit-post-1",
        buildingKind: "recruitment_post",
        unitTemplateId: "hero_guard_basic",
        count: 4,
        cost: {
          gold: 240,
          wood: 0,
          ore: 0
        }
      },
      {
        type: "hero.visited",
        heroId: "hero-1",
        buildingId: "shrine-1",
        buildingKind: "attribute_shrine",
        bonus: {
          attack: 1,
          defense: 0,
          power: 0,
          knowledge: 0
        }
      },
      {
        type: "hero.claimedMine",
        heroId: "hero-1",
        buildingId: "mine-1",
        buildingKind: "resource_mine",
        resourceKind: "wood",
        income: 2,
        ownerPlayerId: "player-1"
      },
      {
        type: "resource.produced",
        playerId: "player-1",
        buildingId: "mine-1",
        buildingKind: "resource_mine",
        resource: {
          kind: "wood",
          amount: 2
        }
      },
      {
        type: "neutral.moved",
        neutralArmyId: "neutral-1",
        from: { x: 3, y: 2 },
        to: { x: 2, y: 2 },
        reason: "chase",
        targetHeroId: "hero-1"
      },
      {
        type: "battle.started",
        heroId: "hero-1",
        encounterKind: "neutral",
        neutralArmyId: "neutral-1",
        initiator: "neutral",
        battleId: "battle-1",
        path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        moveCost: 1
      },
      {
        type: "hero.equipmentChanged",
        heroId: "hero-1",
        slot: "weapon",
        equippedItemId: "vanguard_blade",
        unequippedItemId: "militia_pike"
      },
      {
        type: "hero.equipmentFound",
        heroId: "hero-1",
        battleId: "battle-1",
        battleKind: "neutral",
        equipmentId: "tower_shield_mail",
        equipmentName: "塔盾链甲",
        rarity: "common"
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
    "事件：在招募所补充 hero_guard_basic x4。",
    "事件：访问属性建筑，获得 攻击 +1。",
    "事件：采集矿场，获得 木材 +2。",
    "事件：资源矿场结算 木材 +2。",
    "事件：中立守军 neutral-1 主动追击，移动到 (2,2)。",
    "事件：中立守军 neutral-1 主动发起战斗。",
    "事件：武器槽位已装备 先锋战刃，卸下 民兵长枪。",
    "事件：战斗缴获 塔盾链甲。"
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

test("buildTimelineEntriesFromUpdate translates known rejection reasons for the timeline", () => {
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
    events: [],
    movementPlan: null,
    reachableTiles: [],
    reason: "friendly_fire_blocked"
  });

  assert.deepEqual(entries, ["系统：操作被拒绝，原因是 不能攻击友军"]);
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

test("formatSessionActionReason translates shared rejection reasons into player-facing copy", () => {
  assert.equal(formatSessionActionReason("building_on_cooldown"), "这个建筑今天已经结算过了");
  assert.equal(formatSessionActionReason("not_enough_skill_points"), "技能点不足");
  assert.equal(formatSessionActionReason("equipment_not_in_inventory"), "背包里没有这件装备");
  assert.equal(formatSessionActionReason("friendly_fire_blocked"), "不能攻击友军");
  assert.equal(formatSessionActionReason("skill_on_cooldown"), "这个技能还在冷却中");
  assert.equal(formatSessionActionReason("unit_not_active"), "当前还没轮到这个单位行动");
  assert.equal(formatSessionActionReason("custom_reason"), "custom_reason");
});

test("describeSessionActionOutcome distinguishes accepted and rejected session updates", () => {
  assert.deepEqual(
    describeSessionActionOutcome(
      { reason: undefined },
      {
        successMessage: "神殿访问已结算。",
        rejectedLabel: "神殿访问"
      }
    ),
    {
      accepted: true,
      message: "神殿访问已结算。"
    }
  );

  assert.deepEqual(
    describeSessionActionOutcome(
      { reason: "building_on_cooldown" },
      {
        successMessage: "神殿访问已结算。",
        rejectedLabel: "神殿访问"
      }
    ),
    {
      accepted: false,
      message: "神殿访问被拒绝：这个建筑今天已经结算过了"
    }
  );

  assert.deepEqual(
    describeSessionActionOutcome(
      { reason: "friendly_fire_blocked" },
      {
        successMessage: "战斗指令已结算。",
        rejectedLabel: "战斗指令"
      }
    ),
    {
      accepted: false,
      message: "战斗指令被拒绝：不能攻击友军"
    }
  );
});

test("describeMoveAttemptFeedback distinguishes move-point failures from blocked tiles", () => {
  assert.deepEqual(describeMoveAttemptFeedback({ x: 3, y: 2 }, "not_enough_move_points"), {
    message: "移动被拒绝：移动力不足",
    tileFeedback: "不足"
  });

  assert.deepEqual(describeMoveAttemptFeedback({ x: 4, y: 1 }, "destination_occupied"), {
    message: "地块 (4, 1) 已被友军占据。",
    tileFeedback: "占用"
  });

  assert.deepEqual(describeMoveAttemptFeedback({ x: 6, y: 5 }, "path_not_found"), {
    message: "地块 (6, 5) 当前不可达。",
    tileFeedback: "不可达"
  });
});
