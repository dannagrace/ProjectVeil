import assert from "node:assert/strict";
import test from "node:test";
import { buildBattlePanelViewModel } from "../assets/scripts/cocos-battle-panel-model";
import type { SessionUpdate } from "../assets/scripts/VeilCocosSession";

function createBaseUpdate(): SessionUpdate {
  return {
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
      ownHeroes: [
        {
          id: "hero-1",
          playerId: "player-1",
          name: "Katherine",
          position: { x: 0, y: 0 },
          vision: 4,
          move: {
            total: 6,
            remaining: 6
          },
          stats: {
            attack: 2,
            defense: 2,
            power: 1,
            knowledge: 1,
            hp: 30,
            maxHp: 30
          },
          progression: {
            level: 1,
            experience: 0,
            battlesWon: 0,
            neutralBattlesWon: 0,
            pvpBattlesWon: 0
          },
          armyCount: 12,
          armyTemplateId: "hero_guard_basic"
        }
      ],
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
    reachableTiles: []
  };
}

test("buildBattlePanelViewModel keeps idle summary focused on battle state", () => {
  const view = buildBattlePanelViewModel({
    update: createBaseUpdate(),
    timelineEntries: ["事件：连接已恢复。", "事件：采集 木材 +5。"],
    controlledCamp: null,
    selectedTargetId: null,
    actionPending: false
  });

  assert.equal(view.idle, true);
  assert.equal(view.summaryLines[0], "当前没有战斗。");
  assert.equal(view.summaryLines.length, 1);
  assert.deepEqual(view.orderLines, []);
  assert.equal(view.enemyTargets.length, 0);
  assert.equal(view.actions.length, 0);
});

test("buildBattlePanelViewModel enables attack actions on the player's turn", () => {
  const update = createBaseUpdate();
  update.battle = {
    id: "battle-hero-1-vs-neutral-1",
    round: 2,
    activeUnitId: "hero-1-stack",
    turnOrder: ["hero-1-stack", "neutral-1-stack"],
    units: {
      "hero-1-stack": {
        id: "hero-1-stack",
        templateId: "hero_guard_basic",
        camp: "attacker",
        stackName: "Guard",
        initiative: 7,
        attack: 4,
        defense: 4,
        minDamage: 1,
        maxDamage: 2,
        count: 12,
        currentHp: 10,
        maxHp: 10,
        hasRetaliated: false,
        defending: false
      },
      "neutral-1-stack": {
        id: "neutral-1-stack",
        templateId: "orc_warrior",
        camp: "defender",
        stackName: "Orc",
        initiative: 5,
        attack: 3,
        defense: 3,
        minDamage: 1,
        maxDamage: 3,
        count: 8,
        currentHp: 9,
        maxHp: 9,
        hasRetaliated: true,
        defending: true
      }
    },
    log: [],
    rng: {
      seed: 1,
      cursor: 0
    },
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1"
  };

  const view = buildBattlePanelViewModel({
    update,
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: "neutral-1-stack",
    actionPending: false
  });

  assert.equal(view.idle, false);
  assert.equal(view.summaryLines[2], "阶段：轮到我方");
  assert.equal(view.orderLines[0], "行动顺序");
  assert.equal(view.orderLines[1], "> Guard x12");
  assert.equal(view.orderLines[2], "2. Orc x8 (DEF/RET)");
  assert.deepEqual(view.orderItems[0], {
    id: "hero-1-stack",
    title: "Guard x12",
    meta: "进攻方 · 准备中",
    badge: "行动中",
    active: true
  });
  assert.deepEqual(view.orderItems[1], {
    id: "neutral-1-stack",
    title: "Orc x8",
    meta: "防守方 · (DEF/RET)",
    badge: "2",
    active: false
  });
  assert.equal(view.friendlyLines[0], "我方单位");
  assert.match(view.friendlyLines[1]!, /\[RDY\] Guard x12 生命 10\/10/);
  assert.deepEqual(view.friendlyItems[0], {
    id: "hero-1-stack",
    title: "Guard x12",
    meta: "生命 10/10",
    badge: "待命"
  });
  assert.match(view.enemyTargets[0]!.label, /^> Orc x8 生命 9\/9/);
  assert.equal(view.enemyTargets[0]!.title, "Orc x8");
  assert.equal(view.enemyTargets[0]!.meta, "生命 9/9");
  assert.equal(view.enemyTargets[0]!.badge, "已选中");
  assert.equal(view.actions[0]!.enabled, true);
  assert.equal(view.actions[0]!.subtitle, "目标：Orc");
  assert.deepEqual(view.actions[0]!.action, {
    type: "battle.attack",
    attackerId: "hero-1-stack",
    defenderId: "neutral-1-stack"
  });
});

test("buildBattlePanelViewModel disables commands during enemy turns", () => {
  const update = createBaseUpdate();
  update.battle = {
    id: "battle-hero-1-vs-hero-2",
    round: 1,
    activeUnitId: "hero-2-stack",
    turnOrder: ["hero-2-stack", "hero-1-stack"],
    units: {
      "hero-1-stack": {
        id: "hero-1-stack",
        templateId: "hero_guard_basic",
        camp: "attacker",
        stackName: "Guard",
        initiative: 7,
        attack: 4,
        defense: 4,
        minDamage: 1,
        maxDamage: 2,
        count: 10,
        currentHp: 10,
        maxHp: 10,
        hasRetaliated: false,
        defending: false
      },
      "hero-2-stack": {
        id: "hero-2-stack",
        templateId: "hero_guard_basic",
        camp: "defender",
        stackName: "Raider",
        initiative: 8,
        attack: 5,
        defense: 3,
        minDamage: 1,
        maxDamage: 3,
        count: 11,
        currentHp: 10,
        maxHp: 10,
        hasRetaliated: false,
        defending: false
      }
    },
    log: [],
    rng: {
      seed: 2,
      cursor: 1
    },
    worldHeroId: "hero-1",
    defenderHeroId: "hero-2"
  };

  const view = buildBattlePanelViewModel({
    update,
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: "hero-2-stack",
    actionPending: false
  });

  assert.equal(view.summaryLines[2], "阶段：轮到对方");
  assert.equal(view.orderLines[1], "> Raider x11");
  assert.equal(view.orderItems[0]!.badge, "行动中");
  assert.equal(view.orderItems[1]!.badge, "2");
  assert.equal(view.actions.every((action) => action.enabled === false), true);
});
