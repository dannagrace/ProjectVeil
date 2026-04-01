import assert from "node:assert/strict";
import test from "node:test";
import {
  createCocosBattlePresentationController,
  type CocosBattlePresentationState
} from "../assets/scripts/cocos-battle-presentation-controller.ts";
import type { BattleState, SessionUpdate } from "../assets/scripts/VeilCocosSession.ts";

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
    rng: { seed: 1, cursor: 0 },
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1",
    encounterPosition: { x: 1, y: 1 }
  };
}

function createUpdate(battle: BattleState | null, events: SessionUpdate["events"] = []): SessionUpdate {
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
        tiles: [
          {
            position: { x: 1, y: 1 },
            fog: "visible",
            terrain: "grass",
            walkable: true,
            resource: undefined,
            occupant: undefined,
            building: undefined
          }
        ]
      },
      ownHeroes: [
        {
          id: "hero-1",
          playerId: "player-1",
          name: "Katherine",
          position: { x: 1, y: 1 },
          vision: 4,
          move: { total: 6, remaining: 6 },
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
          loadout: {
            learnedSkills: [],
            equipment: {
              trinketIds: []
            },
            inventory: []
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
    battle,
    events,
    movementPlan: null,
    reachableTiles: []
  };
}

function assertState(state: CocosBattlePresentationState, expected: Partial<CocosBattlePresentationState>): void {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(state[key as keyof CocosBattlePresentationState], value);
  }
}

test("battle presentation controller formalizes command, casualty, and result flow", () => {
  const controller = createCocosBattlePresentationController();
  const battle = createBattleState();

  controller.applyUpdate(
    null,
    createUpdate(battle, [
      {
        type: "battle.started",
        heroId: "hero-1",
        encounterKind: "neutral",
        neutralArmyId: "neutral-1",
        initiator: "hero",
        battleId: "battle-1",
        path: [{ x: 1, y: 1 }],
        moveCost: 1
      }
    ]),
    "hero-1"
  );
  assertState(controller.getState(), {
    phase: "enter",
    moment: "battle_enter",
    label: "战斗展开",
    badge: "ENGAGE"
  });
  assert.equal(controller.getState().summaryLines[0], "反馈层：动画 攻击 / 转场 开战");

  controller.previewAction(
    {
      type: "battle.skill",
      unitId: "hero-1-stack",
      skillId: "power_shot",
      targetId: "neutral-1-stack"
    },
    battle
  );
  assertState(controller.getState(), {
    phase: "command",
    moment: "command_skill",
    tone: "skill",
    badge: "SKILL"
  });
  assert.equal(controller.getState().feedbackLayer.cue, "skill");

  controller.applyUpdate(
    battle,
    createUpdate({
      ...battle,
      units: {
        ...battle.units,
        "neutral-1-stack": {
          ...battle.units["neutral-1-stack"]!,
          count: 0,
          currentHp: 0
        }
      },
      log: battle.log.concat("Guard 施放 投矛射击，Orc 被击倒")
    }),
    "hero-1"
  );
  assertState(controller.getState(), {
    phase: "impact",
    moment: "impact_death",
    label: "单位击倒",
    tone: "hit"
  });
  assert.match(controller.getState().detail, /Orc/);

  controller.applyUpdate(
    battle,
    createUpdate(null, [
      {
        type: "battle.resolved",
        battleId: "battle-1",
        battleKind: "neutral",
        heroId: "hero-1",
        result: "attacker_victory",
        resourcesGained: {
          gold: 0,
          wood: 0,
          ore: 0
        },
        experienceGained: 10,
        skillPointsAwarded: 0
      }
    ]),
    "hero-1"
  );
  assertState(controller.getState(), {
    phase: "resolution",
    moment: "result_victory",
    label: "战斗胜利",
    tone: "victory",
    result: "victory"
  });
  assert.equal(controller.getState().feedbackLayer.transition, "exit");
  assert.match(controller.getState().summaryLines[1] ?? "", /战线：我方剩余 1 队 \/ 对方剩余 0 队/);

  controller.applyUpdate(battle, createUpdate(null, []), "hero-1");
  assertState(controller.getState(), {
    phase: "resolution",
    moment: "result_settlement",
    label: "战斗收束",
    tone: "neutral",
    result: null
  });
  assert.equal(controller.getState().badge, "SETTLE");
  assert.equal(controller.getState().feedbackLayer.transition, null);
});
