import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBattleActionFeedback,
  buildBattleProgressFeedback,
  buildBattleTransitionFeedback
} from "../assets/scripts/cocos-battle-feedback";
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

test("battle feedback summarizes action, progress, and outcome", () => {
  const battle = createBattleState();

  const actionFeedback = buildBattleActionFeedback(
    {
      type: "battle.skill",
      unitId: "hero-1-stack",
      skillId: "power_shot",
      targetId: "neutral-1-stack"
    },
    battle
  );
  assert.equal(actionFeedback?.badge, "SKILL");
  assert.match(actionFeedback?.title ?? "", /Guard 施放 投矛射击/);

  const nextBattle: BattleState = {
    ...battle,
    units: {
      ...battle.units,
      "neutral-1-stack": {
        ...battle.units["neutral-1-stack"]!,
        count: 0,
        currentHp: 0
      }
    },
    log: battle.log.concat("投矛射击 造成 12 伤害")
  };
  const progressFeedback = buildBattleProgressFeedback(battle, nextBattle);
  assert.equal(progressFeedback?.badge, "K.O.");
  assert.equal(progressFeedback?.tone, "hit");
  assert.match(progressFeedback?.title ?? "", /Orc 已被击倒/);

  const skillImpactBattle: BattleState = {
    ...battle,
    units: {
      ...battle.units,
      "neutral-1-stack": {
        ...battle.units["neutral-1-stack"]!,
        count: 6,
        currentHp: 4
      }
    },
    log: battle.log.concat("Guard 施放 投矛射击，Orc 受到 5 点伤害")
  };
  const skillImpactFeedback = buildBattleProgressFeedback(battle, skillImpactBattle);
  assert.equal(skillImpactFeedback?.badge, "SKILL");
  assert.match(skillImpactFeedback?.title ?? "", /投矛射击 命中，Orc 受到打击/);

  const victoryFeedback = buildBattleTransitionFeedback(createResolvedUpdate("attacker_victory"), "hero-1", battle);
  assert.equal(victoryFeedback?.tone, "victory");
  assert.equal(victoryFeedback?.badge, "WIN");
  assert.match(victoryFeedback?.detail ?? "", /战线：我方剩余 1 队 \/ 对方剩余 0 队/);
  assert.match(victoryFeedback?.detail ?? "", /准备返回世界地图/);

  const defeatFeedback = buildBattleTransitionFeedback(createResolvedUpdate("defender_victory"), "hero-1", battle);
  assert.equal(defeatFeedback?.tone, "defeat");
  assert.equal(defeatFeedback?.badge, "LOSE");
  assert.match(defeatFeedback?.detail ?? "", /战线：我方剩余 0 队 \/ 对方剩余 1 队/);

  const unsettledFeedback = buildBattleTransitionFeedback(
    {
      ...createResolvedUpdate("attacker_victory"),
      events: []
    },
    "hero-1",
    battle
  );
  assert.equal(unsettledFeedback?.tone, "neutral");
  assert.equal(unsettledFeedback?.badge, "SETTLE");
  assert.equal(unsettledFeedback?.title, "战果回写中");
  assert.match(unsettledFeedback?.detail ?? "", /等待世界地图确认奖励、占位与结算结果/);
});

test("battle feedback calls out pvp encounter identity and settlement state", () => {
  const pvpBattle: BattleState = {
    ...createBattleState(),
    id: "battle-pvp",
    defenderHeroId: "hero-9",
    neutralArmyId: undefined
  };

  const pvpEnter = buildBattleTransitionFeedback(
    {
      ...createResolvedUpdate("attacker_victory"),
      battle: pvpBattle,
      events: [
        {
          type: "battle.started",
          heroId: "hero-1",
          encounterKind: "hero",
          defenderHeroId: "hero-9",
          initiator: "hero",
          battleId: "battle-pvp",
          path: [{ x: 0, y: 0 }],
          moveCost: 1
        }
      ]
    },
    "hero-1"
  );
  assert.equal(pvpEnter?.title, "PVP 对抗已展开");
  assert.match(pvpEnter?.detail ?? "", /room-alpha\/battle-pvp/);

  const pvpSettlement = buildBattleTransitionFeedback(
    {
      ...createResolvedUpdate("attacker_victory"),
      events: []
    },
    "hero-1",
    pvpBattle
  );
  assert.equal(pvpSettlement?.title, "PVP 结果回写中");
  assert.match(pvpSettlement?.detail ?? "", /PVP 结算：对手 hero-9/);
  assert.match(pvpSettlement?.detail ?? "", /等待房间确认胜负并回写 PVP 世界态/);
});

test("battle transition feedback summarizes settlement rewards and field state", () => {
  const battle = createBattleState();
  const update: SessionUpdate = {
    ...createResolvedUpdate("attacker_victory"),
    events: [
      {
        type: "battle.resolved",
        battleId: "battle-1",
        battleKind: "neutral",
        heroId: "hero-1",
        result: "attacker_victory",
        resourcesGained: {
          gold: 12,
          wood: 0,
          ore: 3
        },
        experienceGained: 25,
        skillPointsAwarded: 1
      },
      {
        type: "hero.equipmentFound",
        heroId: "hero-1",
        battleId: "battle-1",
        battleKind: "neutral",
        equipmentId: "iron_spear",
        equipmentName: "铁枪",
        rarity: "common"
      }
    ]
  };

  const feedback = buildBattleTransitionFeedback(update, "hero-1", battle);
  assert.equal(feedback?.badge, "WIN");
  assert.match(feedback?.detail ?? "", /战线：我方剩余 1 队 \/ 对方剩余 0 队/);
  assert.match(feedback?.detail ?? "", /战利品：金币 \+12 \/ 矿石 \+3/);
  assert.match(feedback?.detail ?? "", /成长：XP \+25 \/ 技能点 \+1/);
  assert.match(feedback?.detail ?? "", /掉落：铁枪/);
});
