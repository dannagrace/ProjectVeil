import assert from "node:assert/strict";
import test from "node:test";
import { buildBattleActionPresentation, buildBattlePresentationPlan } from "../assets/scripts/cocos-battle-presentation";
import type { BattleState, SessionUpdate } from "../assets/scripts/VeilCocosSession";

function createBattleState(): BattleState {
  return {
    id: "battle-1",
    round: 1,
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
            description: "远程压制",
            kind: "active",
            target: "enemy",
            delivery: "ranged",
            cooldown: 2,
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
        hasRetaliated: false,
        defending: false,
        skills: [],
        statusEffects: []
      }
    },
    environment: [],
    log: ["战斗开始"],
    rng: {
      seed: 1,
      cursor: 0
    },
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1"
  };
}

function createResolvedUpdate(result: "attacker_victory" | "defender_victory"): SessionUpdate {
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
    events: [
      {
        type: "battle.resolved",
        battleId: "battle-1",
        battleKind: "neutral",
        heroId: "hero-1",
        result,
        resourcesGained: {
          gold: 0,
          wood: 0,
          ore: 0
        },
        experienceGained: 0,
        skillPointsAwarded: 0
      }
    ],
    movementPlan: null,
    reachableTiles: []
  };
}

test("battle presentation plan formalizes command, enter, impact, and resolution phases", () => {
  const battle = createBattleState();
  const actionPlan = buildBattleActionPresentation(
    {
      type: "battle.attack",
      attackerId: "hero-1-stack",
      defenderId: "neutral-1-stack"
    },
    battle
  );
  assert.equal(actionPlan.phase, "command");
  assert.equal(actionPlan.cue, "attack");
  assert.equal(actionPlan.animation, "attack");
  assert.equal(actionPlan.feedback?.badge, "ATTACK");

  const enterUpdate: SessionUpdate = {
    ...createResolvedUpdate("attacker_victory"),
    battle,
    events: [
      {
        type: "battle.started",
        heroId: "hero-1",
        encounterKind: "neutral",
        neutralArmyId: "neutral-1",
        initiator: "hero",
        battleId: "battle-1",
        path: [{ x: 0, y: 0 }],
        moveCost: 1
      }
    ]
  };
  const enterPlan = buildBattlePresentationPlan(null, enterUpdate, "hero-1");
  assert.equal(enterPlan.phase, "enter");
  assert.equal(enterPlan.animation, "attack");
  assert.equal(enterPlan.transition?.kind, "enter");
  assert.equal(enterPlan.feedback?.badge, "ENGAGE");

  const nextBattle: BattleState = {
    ...battle,
    units: {
      ...battle.units,
      "neutral-1-stack": {
        ...battle.units["neutral-1-stack"]!,
        count: 5,
        currentHp: 4
      }
    },
    log: battle.log.concat("Guard 对 Orc 造成 7 伤害")
  };
  const impactPlan = buildBattlePresentationPlan(
    battle,
    {
      ...enterUpdate,
      battle: nextBattle,
      events: []
    },
    "hero-1"
  );
  assert.equal(impactPlan.phase, "impact");
  assert.equal(impactPlan.cue, "hit");
  assert.equal(impactPlan.animation, "hit");
  assert.equal(impactPlan.feedback?.badge, "HIT");

  const skillPlan = buildBattlePresentationPlan(
    battle,
    {
      ...enterUpdate,
      battle: {
        ...battle,
        units: {
          ...battle.units,
          "neutral-1-stack": {
            ...battle.units["neutral-1-stack"]!,
            currentHp: 9
          }
        },
        log: battle.log.concat("Guard 施放 投矛射击，对 Orc 造成 4 伤害")
      },
      events: []
    },
    "hero-1"
  );
  assert.equal(skillPlan.phase, "active");
  assert.equal(skillPlan.cue, "skill");
  assert.equal(skillPlan.animation, "attack");
  assert.equal(skillPlan.moment, "active_skill");

  const defeatPlan = buildBattlePresentationPlan(
    battle,
    {
      ...enterUpdate,
      battle: {
        ...battle,
        units: {
          ...battle.units,
          "neutral-1-stack": {
            ...battle.units["neutral-1-stack"]!,
            count: 0,
            currentHp: 0
          }
        }
      },
      events: []
    },
    "hero-1"
  );
  assert.equal(defeatPlan.phase, "impact");
  assert.equal(defeatPlan.cue, "hit");
  assert.equal(defeatPlan.animation, "defeat");
  assert.equal(defeatPlan.moment, "impact_death");

  const resolutionPlan = buildBattlePresentationPlan(battle, createResolvedUpdate("attacker_victory"), "hero-1");
  assert.equal(resolutionPlan.phase, "resolution");
  assert.equal(resolutionPlan.cue, "victory");
  assert.equal(resolutionPlan.animation, "victory");
  assert.equal(resolutionPlan.feedbackDurationMs, 4200);
  assert.equal(resolutionPlan.transition?.kind, "exit");
  assert.equal(resolutionPlan.transition?.copy.badge, "VICTORY");
  assert.deepEqual(resolutionPlan.state.summaryLines.slice(0, 2), [
    "反馈层：动画 胜利 / 音效 胜利 / 转场 结算",
    "播报：PVE 遭遇已关闭 · 结果：胜利 · 战线：我方剩余 1 队 / 对方剩余 0 队 · 下一步：返回世界地图继续推进当前回合"
  ]);

  const unsettledResolutionPlan = buildBattlePresentationPlan(
    battle,
    {
      ...createResolvedUpdate("attacker_victory"),
      events: []
    },
    "hero-1"
  );
  assert.equal(unsettledResolutionPlan.phase, "resolution");
  assert.equal(unsettledResolutionPlan.moment, "result_settlement");
  assert.equal(unsettledResolutionPlan.state.label, "结果回写中");
  assert.equal(unsettledResolutionPlan.cue, null);
  assert.equal(unsettledResolutionPlan.animation, "idle");
  assert.equal(unsettledResolutionPlan.transition, null);
  assert.equal(unsettledResolutionPlan.feedback?.badge, "SETTLE");
  assert.equal(unsettledResolutionPlan.feedback?.title, "战果回写中");
});
