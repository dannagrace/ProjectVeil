import assert from "node:assert/strict";
import test from "node:test";
import { buildBattlePanelViewModel } from "../assets/scripts/cocos-battle-panel-model";
import type { PlayerTileView, SessionUpdate, TerrainType } from "../assets/scripts/VeilCocosSession";

function createTile(position: { x: number; y: number }, terrain: TerrainType = "grass"): PlayerTileView {
  return {
    position,
    fog: "visible",
    terrain,
    walkable: true,
    resource: undefined,
    occupant: undefined,
    building: undefined
  };
}

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
        tiles: [createTile({ x: 0, y: 0 })]
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
            skillPoints: 0,
            battlesWon: 0,
            neutralBattlesWon: 0,
            pvpBattlesWon: 0
          },
          armyCount: 12,
          armyTemplateId: "hero_guard_basic",
          learnedSkills: []
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
    actionPending: false,
    feedback: null,
    presentationState: null
  });

  assert.equal(view.idle, true);
  assert.equal(view.stage, null);
  assert.equal(view.summaryLines[0], "当前没有战斗。");
  assert.equal(view.summaryLines.length, 1);
  assert.deepEqual(view.orderLines, []);
  assert.equal(view.enemyTargets.length, 0);
  assert.equal(view.actions.length, 0);
});

test("buildBattlePanelViewModel surfaces settlement and presentation layer summaries after battle exit", () => {
  const view = buildBattlePanelViewModel({
    update: createBaseUpdate(),
    timelineEntries: [],
    controlledCamp: null,
    selectedTargetId: null,
    actionPending: false,
    feedback: {
      title: "战斗胜利",
      detail: "PVE 遭遇已关闭 · 战线：我方剩余 1 队 / 对方剩余 0 队 · 战利品：金币 +12 · 准备返回世界地图",
      badge: "WIN",
      tone: "victory"
    },
    presentationState: {
      battleId: "battle-1",
      phase: "resolution",
      moment: "result_victory",
      label: "战斗胜利",
      detail: "PVE 遭遇已关闭 · 战线：我方剩余 1 队 / 对方剩余 0 队 · 战利品：金币 +12 · 准备返回世界地图",
      badge: "WIN",
      tone: "victory",
      result: "victory",
      summaryLines: [
        "反馈层：动画 胜利 / 音效 胜利 / 转场 结算",
        "播报：PVE 遭遇已关闭 · 战线：我方剩余 1 队 / 对方剩余 0 队 · 战利品：金币 +12 · 准备返回世界地图",
        "战利品：金币 +12"
      ],
      feedbackLayer: {
        animation: "victory",
        cue: "victory",
        transition: "exit",
        durationMs: 4200
      }
    }
  });

  assert.equal(view.idle, true);
  assert.equal(view.title, "战斗结算");
  assert.deepEqual(view.summaryLines, [
    "战斗胜利",
    "流程：进场确认 -> 指令下达 -> 受击反馈 -> 战果结算 · 当前 战果结算",
    "会话：battle-1 · WIN",
    "下一步：返回世界地图并继续推进当前回合",
    "反馈层：动画 胜利 / 音效 胜利 / 转场 结算",
    "播报：PVE 遭遇已关闭 · 战线：我方剩余 1 队 / 对方剩余 0 队 · 战利品：金币 +12 · 准备返回世界地图",
    "战利品：金币 +12"
  ]);
});

test("buildBattlePanelViewModel keeps neutral settlement in the battle result shell", () => {
  const view = buildBattlePanelViewModel({
    update: createBaseUpdate(),
    timelineEntries: [],
    controlledCamp: null,
    selectedTargetId: null,
    actionPending: false,
    feedback: {
      title: "战果回写中",
      detail: "PVE 遭遇已关闭 · 战线：我方剩余 1 队 / 对方剩余 1 队 · 等待世界地图确认奖励、占位与结算结果",
      badge: "SETTLE",
      tone: "neutral"
    },
    presentationState: {
      battleId: "battle-1",
      phase: "resolution",
      moment: "result_settlement",
      label: "结果回写中",
      detail: "PVE 遭遇已关闭 · 战线：我方剩余 1 队 / 对方剩余 1 队 · 等待世界地图确认奖励、占位与结算结果",
      badge: "SETTLE",
      tone: "neutral",
      result: null,
      summaryLines: [
        "反馈层：动画 待机",
        "播报：PVE 遭遇已关闭 · 战线：我方剩余 1 队 / 对方剩余 1 队 · 等待世界地图确认奖励、占位与结算结果"
      ],
      feedbackLayer: {
        animation: "idle",
        cue: null,
        transition: null,
        durationMs: 4200
      }
    }
  });

  assert.equal(view.idle, true);
  assert.equal(view.title, "战斗结算");
  assert.equal(view.summaryLines[0], "结果回写中");
  assert.equal(view.summaryLines[1], "流程：进场确认 -> 指令下达 -> 受击反馈 -> 战果结算 · 当前 战果结算");
  assert.equal(view.summaryLines[2], "会话：battle-1 · SETTLE");
  assert.equal(view.summaryLines[3], "下一步：等待世界地图确认奖励、占位与最终结算");
});

test("buildBattlePanelViewModel shows an explicit settlement recovery path while reconnecting", () => {
  const view = buildBattlePanelViewModel({
    update: createBaseUpdate(),
    timelineEntries: [],
    controlledCamp: null,
    selectedTargetId: null,
    actionPending: false,
    feedback: null,
    presentationState: {
      battleId: "battle-1",
      phase: "resolution",
      moment: "result_victory",
      label: "战斗胜利",
      detail: "PVE 遭遇已关闭 · 战利品已结算",
      badge: "WIN",
      tone: "victory",
      result: "victory",
      summaryLines: [
        "反馈层：动画 胜利 / 音效 胜利 / 转场 结算",
        "战利品：金币 +12"
      ],
      feedbackLayer: {
        animation: "victory",
        cue: "victory",
        transition: "exit",
        durationMs: 4200
      }
    },
    recovery: {
      title: "结算恢复中",
      detail: "已保留最近一次结算摘要，正在等待权威房间确认奖励与英雄同步；不会重复发放奖励。",
      badge: "RECOVER",
      tone: "neutral",
      summaryLines: [
        "最近结算：战斗胜利",
        "反馈层：动画 胜利 / 音效 胜利 / 转场 结算",
        "战利品：金币 +12"
      ]
    }
  });

  assert.equal(view.idle, true);
  assert.equal(view.title, "结算恢复");
  assert.equal(view.feedback?.title, "结算恢复中");
  assert.match(view.feedback?.detail ?? "", /不会重复发放奖励/);
  assert.deepEqual(view.summaryLines, [
    "最近结算：战斗胜利",
    "反馈层：动画 胜利 / 音效 胜利 / 转场 结算",
    "战利品：金币 +12"
  ]);
});

test("buildBattlePanelViewModel surfaces reviewer-facing session and next-step context during live battle impact", () => {
  const update = createBaseUpdate();
  update.world.meta.roomId = "room-battle";
  update.battle = {
    id: "battle-1",
    round: 2,
    lanes: 1,
    activeUnitId: "hero-1-stack",
    turnOrder: ["hero-1-stack", "neutral-1-stack"],
    units: {
      "hero-1-stack": {
        id: "hero-1-stack",
        templateId: "hero_guard_basic",
        camp: "attacker",
        lane: 0,
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
        defending: false,
        skills: [],
        statusEffects: []
      },
      "neutral-1-stack": {
        id: "neutral-1-stack",
        templateId: "orc_warrior",
        camp: "defender",
        lane: 0,
        stackName: "Orc",
        initiative: 5,
        attack: 3,
        defense: 3,
        minDamage: 1,
        maxDamage: 3,
        count: 5,
        currentHp: 4,
        maxHp: 9,
        hasRetaliated: true,
        defending: false,
        skills: [],
        statusEffects: []
      }
    },
    environment: [],
    log: ["Guard 对 Orc 造成 7 伤害"],
    rng: { seed: 1, cursor: 0 },
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1",
    encounterPosition: { x: 0, y: 0 }
  };

  const view = buildBattlePanelViewModel({
    update,
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: "neutral-1-stack",
    actionPending: false,
    feedback: {
      title: "Orc 受到打击",
      detail: "Guard 对 Orc 造成 7 伤害",
      badge: "HIT",
      tone: "hit"
    },
    presentationState: {
      battleId: "battle-1",
      phase: "impact",
      moment: "impact_hit",
      label: "命中反馈",
      detail: "Guard 对 Orc 造成 7 伤害",
      badge: "HIT",
      tone: "hit",
      result: null,
      summaryLines: ["反馈层：动画 受击 / 音效 受击"],
      feedbackLayer: {
        animation: "hit",
        cue: "hit",
        transition: null,
        durationMs: null
      }
    }
  });

  assert.equal(view.idle, false);
  assert.equal(view.title, "战斗反馈");
  assert.deepEqual(view.summaryLines.slice(0, 4), [
    "battle-1 · 第 2 回合",
    "流程：进场确认 -> 指令下达 -> 受击反馈 -> 战果结算 · 当前 受击反馈",
    "会话：room-battle/battle-1 · 中立遭遇",
    "表现：HIT · 命中反馈"
  ]);
  assert.equal(view.summaryLines[4], "下一步：确认受击结果后继续选择目标或技能");
});

test("buildBattlePanelViewModel enables attack actions on the player's turn", () => {
  const update = createBaseUpdate();
  update.battle = {
    id: "battle-hero-1-vs-neutral-1",
    round: 2,
    lanes: 1,
    activeUnitId: "hero-1-stack",
    turnOrder: ["hero-1-stack", "neutral-1-stack"],
    units: {
      "hero-1-stack": {
        id: "hero-1-stack",
        templateId: "hero_guard_basic",
        camp: "attacker",
        lane: 0,
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
        defending: false,
        skills: [
          {
            id: "power_shot",
            name: "投矛射击",
            description: "远程压制目标，伤害略低，但不会触发反击。",
            kind: "active",
            target: "enemy",
            delivery: "ranged",
            cooldown: 2,
            remainingCooldown: 0
          },
          {
            id: "armor_spell",
            name: "护甲术",
            description: "为自己附加护甲术，在后续回合提升防御。",
            kind: "active",
            target: "self",
            cooldown: 3,
            remainingCooldown: 0
          }
        ],
        statusEffects: []
      },
      "neutral-1-stack": {
        id: "neutral-1-stack",
        templateId: "orc_warrior",
        camp: "defender",
        lane: 0,
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
        defending: true,
        skills: [],
        statusEffects: []
      }
    },
    environment: [
      {
        id: "hazard-trap-0",
        kind: "trap",
        lane: 0,
        effect: "damage",
        name: "捕兽夹陷阱",
        description: "近身突进时会先被陷阱割伤并短暂削弱。",
        damage: 2,
        charges: 1,
        revealed: true,
        triggered: false,
        grantedStatusId: "weakened",
        triggeredByCamp: "both"
      }
    ],
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
    actionPending: false,
    feedback: null,
    presentationState: null
  });

  assert.equal(view.idle, false);
  assert.deepEqual(view.stage, {
    terrain: "grass",
    title: "草野战场 · 中立遭遇",
    subtitle: "坐标 (0,0) · 1 陷阱",
    badge: "PVE"
  });
  assert.equal(view.summaryLines[1], "流程：进场确认 -> 指令下达 -> 受击反馈 -> 战果结算 · 当前 现场回合");
  assert.equal(view.summaryLines[2], "会话：room-alpha/battle-hero-1-vs-neutral-1 · 中立遭遇");
  assert.equal(view.summaryLines[3], "表现：LIVE · 战斗进行中");
  assert.equal(view.summaryLines[4], "下一步：选择目标并下达指令");
  assert.equal(view.summaryLines[5], "阵营：我方先攻");
  assert.equal(view.summaryLines[6], "阶段：轮到我方");
  assert.equal(view.summaryLines[8], "技能1：投矛射击[敌/就绪] / 护甲术[自/就绪]");
  assert.equal(view.summaryLines[9], "状态：无异常");
  assert.equal(view.summaryLines[10], "环境1：1线 捕兽夹陷阱 · 2伤 · 1次");
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
  assert.match(view.friendlyLines[1]!, /\[RDY\] Guard x12 生命 10\/10 · 1线/);
  assert.deepEqual(view.friendlyItems[0], {
    id: "hero-1-stack",
    title: "Guard x12",
    meta: "1线 · 生命 10/10 · 技能 2",
    badge: "待命"
  });
  assert.match(view.enemyTargets[0]!.label, /^> Orc x8 生命 9\/9 · 1线/);
  assert.equal(view.enemyTargets[0]!.title, "Orc x8");
  assert.equal(view.enemyTargets[0]!.meta, "1线 · 生命 9/9 · 防御中 · 已反击");
  assert.equal(view.enemyTargets[0]!.badge, "已选中");
  assert.equal(view.actions[0]!.enabled, true);
  assert.equal(view.actions[0]!.subtitle, "目标：Orc · 1线 · 生命 9/9 · 防御中 · 已反击");
  assert.deepEqual(view.actions[0]!.action, {
    type: "battle.attack",
    attackerId: "hero-1-stack",
    defenderId: "neutral-1-stack"
  });
  assert.equal(view.actions[3]!.key, "skill-power_shot");
  assert.match(view.actions[3]!.subtitle, /^目标：Orc · 远程压制目标/);
  assert.deepEqual(view.actions[3]!.action, {
    type: "battle.skill",
    unitId: "hero-1-stack",
    skillId: "power_shot",
    targetId: "neutral-1-stack"
  });
  assert.equal(view.actions[4]!.key, "skill-armor_spell");
  assert.match(view.actions[4]!.subtitle, /^自身增益 · 为自己附加护甲术/);
});

test("buildBattlePanelViewModel disables commands during enemy turns", () => {
  const update = createBaseUpdate();
  update.battle = {
    id: "battle-hero-1-vs-hero-2",
    round: 1,
    lanes: 1,
    activeUnitId: "hero-2-stack",
    turnOrder: ["hero-2-stack", "hero-1-stack"],
    units: {
      "hero-1-stack": {
        id: "hero-1-stack",
        templateId: "hero_guard_basic",
        camp: "attacker",
        lane: 0,
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
        defending: false,
        skills: [],
        statusEffects: []
      },
      "hero-2-stack": {
        id: "hero-2-stack",
        templateId: "hero_guard_basic",
        camp: "defender",
        lane: 0,
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
        defending: false,
        skills: [],
        statusEffects: []
      }
    },
    environment: [],
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
    actionPending: false,
    feedback: null,
    presentationState: null
  });

  assert.deepEqual(view.stage, {
    terrain: "grass",
    title: "草野战场 · 英雄对决",
    subtitle: "坐标 (0,0) · 无额外障碍",
    badge: "PVP"
  });
  assert.equal(view.summaryLines[1], "流程：进场确认 -> 指令下达 -> 受击反馈 -> 战果结算 · 当前 现场回合");
  assert.equal(view.summaryLines[2], "会话：room-alpha/battle-hero-1-vs-hero-2 · 英雄对决");
  assert.equal(view.summaryLines[3], "表现：LIVE · 战斗进行中");
  assert.equal(view.summaryLines[4], "下一步：等待对方行动或权威同步");
  assert.equal(view.summaryLines[5], "阵营：我方先攻");
  assert.equal(view.summaryLines[6], "阶段：轮到对方");
  assert.equal(view.summaryLines[8], "技能：普通攻击");
  assert.equal(view.summaryLines[9], "状态：无异常");
  assert.equal(view.orderLines[1], "> Raider x11");
  assert.equal(view.orderItems[0]!.badge, "行动中");
  assert.equal(view.orderItems[1]!.badge, "2");
  assert.equal(view.actions.every((action) => action.enabled === false), true);
});

test("buildBattlePanelViewModel hides unrevealed traps and disables skills while silenced", () => {
  const update = createBaseUpdate();
  update.battle = {
    id: "battle-hero-1-vs-neutral-1",
    round: 3,
    lanes: 1,
    activeUnitId: "hero-1-stack",
    turnOrder: ["hero-1-stack", "neutral-1-stack"],
    units: {
      "hero-1-stack": {
        id: "hero-1-stack",
        templateId: "hero_guard_basic",
        camp: "attacker",
        lane: 0,
        stackName: "Guard",
        initiative: 7,
        attack: 4,
        defense: 4,
        minDamage: 1,
        maxDamage: 2,
        count: 9,
        currentHp: 8,
        maxHp: 10,
        hasRetaliated: false,
        defending: false,
        skills: [
          {
            id: "power_shot",
            name: "投矛射击",
            description: "远程压制目标，伤害略低，但不会触发反击。",
            kind: "active",
            target: "enemy",
            delivery: "ranged",
            cooldown: 2,
            remainingCooldown: 0
          }
        ],
        statusEffects: [
          {
            id: "silenced",
            name: "禁魔",
            description: "短时间内无法施放主动技能。",
            durationRemaining: 1,
            attackModifier: 0,
            defenseModifier: 0,
            damagePerTurn: 0,
            initiativeModifier: 0,
            blocksActiveSkills: true
          }
        ]
      },
      "neutral-1-stack": {
        id: "neutral-1-stack",
        templateId: "orc_warrior",
        camp: "defender",
        lane: 0,
        stackName: "Orc",
        initiative: 5,
        attack: 3,
        defense: 3,
        minDamage: 1,
        maxDamage: 3,
        count: 8,
        currentHp: 9,
        maxHp: 9,
        hasRetaliated: false,
        defending: false,
        skills: [],
        statusEffects: []
      }
    },
    environment: [
      {
        id: "hazard-hidden-0",
        kind: "trap",
        lane: 0,
        effect: "slow",
        name: "缠足泥沼",
        description: "踩中后会被拖慢，下一轮行动明显延后。",
        damage: 0,
        charges: 1,
        revealed: false,
        triggered: false,
        grantedStatusId: "slowed",
        triggeredByCamp: "both"
      },
      {
        id: "hazard-revealed-0",
        kind: "trap",
        lane: 0,
        effect: "silence",
        name: "封咒符印",
        description: "触发后短时间内无法施放主动技能。",
        damage: 0,
        charges: 0,
        revealed: true,
        triggered: true,
        grantedStatusId: "silenced",
        triggeredByCamp: "both"
      }
    ],
    log: [],
    rng: {
      seed: 5,
      cursor: 2
    },
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1"
  };

  const view = buildBattlePanelViewModel({
    update,
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: "neutral-1-stack",
    actionPending: false,
    feedback: null,
    presentationState: null
  });

  assert.equal(view.summaryLines.includes("环境：当前战场没有额外障碍或陷阱"), false);
  assert.equal(view.summaryLines.some((line) => line.includes("缠足泥沼")), false);
  assert.equal(view.summaryLines.some((line) => line.includes("封咒符印 · 禁魔 · 已触发")), true);
  assert.equal(view.actions[3]!.enabled, false);
  assert.equal(view.actions[3]!.subtitle, "已被禁魔，无法施法");
});

test("buildBattlePanelViewModel derives stage terrain from encounter position and only counts visible hazards", () => {
  const update = createBaseUpdate();
  update.world.map = {
    width: 3,
    height: 2,
    tiles: [createTile({ x: 0, y: 0 }), createTile({ x: 2, y: 1 }, "sand")]
  };
  update.battle = {
    id: "battle-hero-1-vs-neutral-2",
    round: 4,
    lanes: 2,
    activeUnitId: "hero-1-stack",
    turnOrder: ["hero-1-stack", "neutral-2-stack"],
    units: {
      "hero-1-stack": {
        id: "hero-1-stack",
        templateId: "hero_guard_basic",
        camp: "attacker",
        lane: 0,
        stackName: "Guard",
        initiative: 7,
        attack: 4,
        defense: 4,
        minDamage: 1,
        maxDamage: 2,
        count: 7,
        currentHp: 9,
        maxHp: 10,
        hasRetaliated: false,
        defending: false,
        skills: [],
        statusEffects: []
      },
      "neutral-2-stack": {
        id: "neutral-2-stack",
        templateId: "wolf_pack",
        camp: "defender",
        lane: 1,
        stackName: "Wolf",
        initiative: 6,
        attack: 3,
        defense: 2,
        minDamage: 1,
        maxDamage: 2,
        count: 5,
        currentHp: 6,
        maxHp: 6,
        hasRetaliated: false,
        defending: false,
        skills: [],
        statusEffects: []
      }
    },
    environment: [
      {
        id: "hazard-blocker-0",
        kind: "blocker",
        lane: 0,
        name: "沙丘裂脊",
        description: "高耸沙脊阻断冲锋路线。"
      },
      {
        id: "hazard-trap-0",
        kind: "trap",
        lane: 1,
        effect: "damage",
        name: "流沙陷坑",
        description: "暴露后的陷坑会吞噬贸然前冲的单位。",
        damage: 3,
        charges: 1,
        revealed: true,
        triggered: false,
        grantedStatusId: "slowed",
        triggeredByCamp: "both"
      },
      {
        id: "hazard-hidden-0",
        kind: "trap",
        lane: 1,
        effect: "slow",
        name: "埋沙绊索",
        description: "未暴露前不会出现在战场情报中。",
        damage: 0,
        charges: 1,
        revealed: false,
        triggered: false,
        grantedStatusId: "slowed",
        triggeredByCamp: "both"
      }
    ],
    log: [],
    rng: {
      seed: 7,
      cursor: 0
    },
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-2",
    encounterPosition: { x: 2, y: 1 }
  };

  const view = buildBattlePanelViewModel({
    update,
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: "neutral-2-stack",
    actionPending: false,
    feedback: null,
    presentationState: null
  });

  assert.deepEqual(view.stage, {
    terrain: "sand",
    title: "沙原战场 · 中立遭遇",
    subtitle: "坐标 (2,1) · 1 阻挡 / 1 陷阱",
    badge: "PVE"
  });
});
