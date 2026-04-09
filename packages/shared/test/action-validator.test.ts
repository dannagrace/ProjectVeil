import assert from "node:assert/strict";
import test from "node:test";
import {
  createDemoBattleState,
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  precheckBattleAction,
  precheckWorldAction,
  type HeroState,
  type TileState,
  type WorldState
} from "../src/index.ts";

function createHero(overrides: Partial<HeroState> & Pick<HeroState, "id" | "playerId" | "name">): HeroState {
  return {
    id: overrides.id,
    playerId: overrides.playerId,
    name: overrides.name,
    position: overrides.position ?? { x: 0, y: 0 },
    vision: overrides.vision ?? 2,
    move: overrides.move ?? { total: 6, remaining: 6 },
    stats: overrides.stats ?? {
      attack: 2,
      defense: 2,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    progression: overrides.progression ?? createDefaultHeroProgression(),
    loadout: overrides.loadout ?? createDefaultHeroLoadout(),
    armyTemplateId: overrides.armyTemplateId ?? "hero_guard_basic",
    armyCount: overrides.armyCount ?? 12,
    learnedSkills: overrides.learnedSkills ?? []
  };
}

function createTile(x: number, y: number): TileState {
  return {
    position: { x, y },
    terrain: "grass",
    walkable: true,
    resource: undefined,
    occupant: undefined,
    building: undefined
  };
}

function createWorldState(options: {
  width: number;
  height: number;
  heroes: HeroState[];
  tiles: TileState[];
}): WorldState {
  return {
    meta: {
      roomId: "test-room",
      seed: 1001,
      day: 1
    },
    map: {
      width: options.width,
      height: options.height,
      tiles: options.tiles
    },
    heroes: options.heroes,
    neutralArmies: {},
    buildings: {},
    resources: Object.fromEntries(
      Array.from(new Set(options.heroes.map((hero) => hero.playerId))).map((playerId) => [
        playerId,
        { gold: 0, wood: 0, ore: 0 }
      ])
    ),
    visibilityByPlayer: {}
  };
}

test("precheckWorldAction returns a structured rejection for insufficient movement", () => {
  const hero = createHero({
    id: "hero-blocked",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 },
    move: { total: 6, remaining: 1 }
  });
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    tiles: [createTile(0, 0), createTile(1, 0), createTile(2, 0)]
  });

  const result = precheckWorldAction(state, {
    type: "hero.move",
    heroId: "hero-blocked",
    destination: { x: 2, y: 0 }
  });

  assert.deepEqual(result.validation, {
    valid: false,
    reason: "not_enough_move_points"
  });
  assert.deepEqual(result.rejection, {
    scope: "world",
    actionType: "hero.move",
    reason: "not_enough_move_points"
  });
});

test("precheckWorldAction returns a structured rejection for heroes not owned by the requesting player", () => {
  const state = createWorldState({
    width: 2,
    height: 1,
    heroes: [
      createHero({
        id: "hero-owned",
        playerId: "player-2",
        name: "凯琳",
        position: { x: 0, y: 0 }
      })
    ],
    tiles: [createTile(0, 0), createTile(1, 0)]
  });

  const result = precheckWorldAction(
    state,
    {
      type: "hero.move",
      heroId: "hero-owned",
      destination: { x: 1, y: 0 }
    },
    "player-1"
  );

  assert.deepEqual(result.validation, {
    valid: false,
    reason: "hero_not_owned_by_player"
  });
  assert.deepEqual(result.rejection, {
    scope: "world",
    actionType: "hero.move",
    reason: "hero_not_owned_by_player"
  });
});

test("precheckBattleAction returns a structured rejection for cooldown-gated skills", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.unitCooldowns["pikeman-a"] = {
    ...state.unitCooldowns["pikeman-a"],
    power_shot: 1
  };

  const result = precheckBattleAction(state, {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "power_shot",
    targetId: "wolf-d"
  });

  assert.deepEqual(result.validation, {
    valid: false,
    reason: "skill_on_cooldown"
  });
  assert.deepEqual(result.rejection, {
    scope: "battle",
    actionType: "battle.skill",
    reason: "skill_on_cooldown"
  });
});

test("precheckBattleAction returns a structured rejection for attacks from inactive units", () => {
  const state = createDemoBattleState();

  const result = precheckBattleAction(state, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  assert.deepEqual(result.validation, {
    valid: false,
    reason: "attacker_not_active"
  });
  assert.deepEqual(result.rejection, {
    scope: "battle",
    actionType: "battle.attack",
    reason: "attacker_not_active"
  });
});
