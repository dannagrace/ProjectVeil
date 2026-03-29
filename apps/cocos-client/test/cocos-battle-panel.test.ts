import assert from "node:assert/strict";
import test from "node:test";
import { buildBattlePanelSections } from "../assets/scripts/cocos-battle-panel-model";
import { resolveBattlePanelUnitVisual } from "../assets/scripts/cocos-battle-unit-visuals";
import type { SessionUpdate, TerrainType } from "../assets/scripts/VeilCocosSession";

function createTile(position: { x: number; y: number }, terrain: TerrainType = "grass") {
  return {
    position,
    fog: "visible" as const,
    terrain,
    walkable: true,
    resource: undefined,
    occupant: undefined,
    building: undefined
  };
}

function createBattleUpdate(): SessionUpdate {
  return {
    world: {
      meta: {
        roomId: "room-alpha",
        seed: 1001,
        day: 1
      },
      map: {
        width: 2,
        height: 2,
        tiles: [createTile({ x: 0, y: 0 }, "grass"), createTile({ x: 1, y: 1 }, "sand")]
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
    battle: {
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
          count: 8,
          currentHp: 9,
          maxHp: 9,
          hasRetaliated: true,
          defending: false,
          skills: [],
          statusEffects: []
        }
      },
      environment: [],
      log: [],
      rng: { seed: 1, cursor: 0 },
      worldHeroId: "hero-1",
      neutralArmyId: "neutral-1"
    },
    events: [],
    movementPlan: null,
    reachableTiles: []
  };
}

test("buildBattlePanelSections groups ally, enemy and queue rows from a battle state", () => {
  const sections = buildBattlePanelSections({
    update: createBattleUpdate(),
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: "neutral-1-stack",
    actionPending: false,
    feedback: null,
    presentationState: null
  });

  assert.equal(sections.idle, false);
  assert.equal(sections.orderItems.length, 2);
  assert.equal(sections.friendlyItems[0]?.title, "Guard x12");
  assert.equal(sections.enemyTargets[0]?.title, "Orc x8");
  assert.equal(sections.enemyTargets[0]?.selected, true);
});

test("battle panel stage banner derives the PVE terrain title from the encounter position", () => {
  const sections = buildBattlePanelSections({
    update: createBattleUpdate(),
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: null,
    actionPending: false,
    feedback: null,
    presentationState: null
  });

  assert.deepEqual(sections.stage, {
    terrain: "sand",
    title: "沙原战场 · 中立遭遇",
    subtitle: "坐标 (1,1) · 无额外障碍",
    badge: "PVE"
  });
});

test("battle panel actions disable when it is not the controlled camp's turn", () => {
  const update = createBattleUpdate();
  if (update.battle) {
    update.battle.activeUnitId = "neutral-1-stack";
  }

  const sections = buildBattlePanelSections({
    update,
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: "neutral-1-stack",
    actionPending: false,
    feedback: null,
    presentationState: null
  });

  assert.equal(sections.actions.every((action) => action.enabled === false), true);
});

test("battle unit visuals switch to the selected portrait variant for the chosen target", () => {
  assert.equal(resolveBattlePanelUnitVisual("orc_warrior", { selected: false }).portraitState, "idle");
  assert.equal(resolveBattlePanelUnitVisual("orc_warrior", { selected: true }).portraitState, "selected");
});
