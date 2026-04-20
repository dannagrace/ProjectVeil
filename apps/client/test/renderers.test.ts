import assert from "node:assert/strict";
import test from "node:test";
import { renderBattleState, renderWorldState } from "../src/renderers";
import type { BattleState, PlayerWorldView } from "@veil/shared/models";

function makeBattleState(overrides: Partial<BattleState> = {}): BattleState {
  return {
    id: "battle-42",
    round: 3,
    lanes: 3,
    activeUnitId: "unit-1",
    turnOrder: [],
    units: {},
    unitCooldowns: {},
    environment: [],
    log: [],
    rng: { seed: 1, cursor: 7 },
    ...overrides
  };
}

function makeWorldView(overrides: Partial<PlayerWorldView> = {}): PlayerWorldView {
  return {
    meta: { roomId: "room-abc", seed: 42, day: 5 },
    map: {
      width: 2,
      height: 2,
      tiles: [
        {
          position: { x: 0, y: 0 },
          fog: "hidden",
          terrain: "unknown",
          walkable: false,
          resource: undefined,
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 1, y: 0 },
          fog: "hidden",
          terrain: "unknown",
          walkable: false,
          resource: undefined,
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 0, y: 1 },
          fog: "visible",
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 1, y: 1 },
          fog: "visible",
          terrain: "dirt",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        }
      ]
    },
    ownHeroes: [],
    visibleHeroes: [],
    resources: { gold: 0, wood: 0, ore: 0 },
    playerId: "player-1",
    ...overrides
  };
}

// renderBattleState tests

test("renderBattleState returns 'Battle idle' when turnOrder is empty", () => {
  const state = makeBattleState({ turnOrder: [] });
  assert.equal(renderBattleState(state), "Battle idle");
});

test("renderBattleState includes Battle, Round, Active headers for populated state", () => {
  const state = makeBattleState({
    id: "battle-42",
    round: 3,
    activeUnitId: "unit-1",
    turnOrder: ["unit-1", "unit-2"],
    units: {
      "unit-1": {
        id: "unit-1",
        templateId: "wolf",
        camp: "attacker",
        lane: 1,
        stackName: "Wolf Pack",
        initiative: 8,
        attack: 5,
        defense: 3,
        minDamage: 2,
        maxDamage: 4,
        count: 10,
        currentHp: 80,
        maxHp: 100,
        hasRetaliated: false,
        defending: false
      },
      "unit-2": {
        id: "unit-2",
        templateId: "goblin",
        camp: "defender",
        lane: 2,
        stackName: "Goblin Mob",
        initiative: 5,
        attack: 3,
        defense: 2,
        minDamage: 1,
        maxDamage: 3,
        count: 5,
        currentHp: 40,
        maxHp: 50,
        hasRetaliated: false,
        defending: true
      }
    }
  });

  const result = renderBattleState(state);
  assert.ok(result.includes("Battle:"), `Expected "Battle:" in: ${result}`);
  assert.ok(result.includes("Round:"), `Expected "Round:" in: ${result}`);
  assert.ok(result.includes("Active:"), `Expected "Active:" in: ${result}`);
  assert.ok(result.includes("battle-42"), `Expected battle id in: ${result}`);
  assert.ok(result.includes("Round: 3"), `Expected round number in: ${result}`);
  assert.ok(result.includes("Active: unit-1"), `Expected active unit id in: ${result}`);
  assert.ok(result.includes("Wolf Pack"), `Expected unit stack name in: ${result}`);
  assert.ok(result.includes("DEF"), `Expected defending flag in: ${result}`);
  assert.ok(result.includes("RNG Cursor: 7"), `Expected RNG cursor in: ${result}`);
});

// renderWorldState tests

test("renderWorldState includes Room and Day in output", () => {
  const state = makeWorldView();
  const result = renderWorldState(state);
  assert.ok(result.includes("Room:"), `Expected "Room:" in: ${result}`);
  assert.ok(result.includes("Room: room-abc"), `Expected room id in: ${result}`);
  assert.ok(result.includes("Day:"), `Expected "Day:" in: ${result}`);
  assert.ok(result.includes("Day: 5"), `Expected day number in: ${result}`);
});

test("renderWorldState renders hidden tiles as '?'", () => {
  const state = makeWorldView();
  const result = renderWorldState(state);
  assert.ok(result.includes("?"), `Expected "?" for hidden tiles in: ${result}`);
});

test("renderWorldState renders visible grass tile as 'G'", () => {
  const state = makeWorldView();
  const result = renderWorldState(state);
  assert.ok(result.includes("G"), `Expected "G" for visible grass tile in: ${result}`);
});

test("renderWorldState renders visible dirt tile as 'D'", () => {
  const state = makeWorldView();
  const result = renderWorldState(state);
  assert.ok(result.includes("D"), `Expected "D" for visible dirt tile in: ${result}`);
});

test("renderWorldState includes Own Heroes and Visible Enemies sections", () => {
  const state = makeWorldView({
    ownHeroes: [
      {
        id: "hero-1",
        playerId: "player-1",
        name: "Aria",
        position: { x: 0, y: 1 },
        vision: 3,
        move: { total: 4, remaining: 2 },
        stats: {
          attack: 3,
          defense: 2,
          power: 1,
          knowledge: 1,
          hp: 100,
          maxHp: 100
        },
        progression: {
          level: 2,
          experience: 150,
          skillPoints: 1,
          battlesWon: 1,
          neutralBattlesWon: 1,
          pvpBattlesWon: 0
        },
        loadout: {
          learnedSkills: [],
          equipment: { trinketIds: [] },
          inventory: []
        },
        armyTemplateId: "wolves",
        armyCount: 10,
        learnedSkills: []
      }
    ],
    visibleHeroes: [
      {
        id: "hero-2",
        playerId: "player-2",
        name: "Zarak",
        level: 1,
        position: { x: 1, y: 1 }
      }
    ]
  });

  const result = renderWorldState(state);
  assert.ok(result.includes("Own Heroes:"), `Expected "Own Heroes:" in: ${result}`);
  assert.ok(result.includes("Visible Enemies:"), `Expected "Visible Enemies:" in: ${result}`);
  assert.ok(result.includes("Aria"), `Expected hero name in: ${result}`);
  assert.ok(result.includes("HP:100/100"), `Expected hero HP in: ${result}`);
  assert.ok(result.includes("MOV:2/4"), `Expected hero move in: ${result}`);
  assert.ok(result.includes("Zarak"), `Expected visible enemy name in: ${result}`);
  assert.ok(result.includes("(1,1)"), `Expected enemy position in: ${result}`);
});

test("renderWorldState shows 'None' for visible enemies when list is empty", () => {
  const state = makeWorldView({ visibleHeroes: [] });
  const result = renderWorldState(state);
  assert.ok(result.includes("None"), `Expected "None" for empty visible enemies in: ${result}`);
});
