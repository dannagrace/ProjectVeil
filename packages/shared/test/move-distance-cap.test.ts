import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  createPlayerWorldView,
  predictPlayerWorldAction,
  validateWorldAction,
  type HeroState,
  type NeutralArmyState,
  type ResourceNode,
  type TileState,
  type WorldState
} from "../src/index";

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

function createTile(
  x: number,
  y: number,
  options?: {
    walkable?: boolean;
    terrain?: TileState["terrain"];
    resource?: ResourceNode;
    occupant?: TileState["occupant"];
    building?: TileState["building"];
  }
): TileState {
  return {
    position: { x, y },
    terrain: options?.terrain ?? "grass",
    walkable: options?.walkable ?? true,
    resource: options?.resource,
    occupant: options?.occupant,
    building: options?.building
  };
}

function createWorldState(options?: {
  width?: number;
  height?: number;
  tiles?: TileState[];
  heroes?: HeroState[];
  neutralArmies?: Record<string, NeutralArmyState>;
  buildings?: WorldState["buildings"];
  resources?: WorldState["resources"];
  visibilityByPlayer?: WorldState["visibilityByPlayer"];
}): WorldState {
  const width = options?.width ?? 3;
  const height = options?.height ?? 3;
  const tiles =
    options?.tiles ??
    Array.from({ length: width * height }, (_, index) => createTile(index % width, Math.floor(index / width)));
  const heroes = options?.heroes ?? [];

  return {
    meta: {
      roomId: "test-room",
      seed: 1001,
      day: 1
    },
    map: {
      width,
      height,
      tiles
    },
    heroes,
    neutralArmies: options?.neutralArmies ?? {},
    buildings: options?.buildings ?? {},
    resources:
      options?.resources ??
      Object.fromEntries(
        Array.from(new Set(heroes.map((hero) => hero.playerId))).map((playerId) => [
          playerId,
          {
            gold: 0,
            wood: 0,
            ore: 0
          }
        ])
      ),
    visibilityByPlayer: options?.visibilityByPlayer ?? {}
  };
}

function createEncounterState(remainingMove: number): WorldState {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 },
    move: { total: 6, remaining: remainingMove }
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-1",
    position: { x: 2, y: 0 },
    reward: { kind: "gold", amount: 300 },
    stacks: [{ templateId: "wolf_pack", count: 8 }]
  };

  return createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    neutralArmies: { "neutral-1": neutralArmy },
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0),
      createTile(2, 0, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "visible"]
    }
  });
}

test("validateWorldAction rejects encounter moves beyond the remaining full path distance", () => {
  const state = createEncounterState(1);

  assert.deepEqual(validateWorldAction(state, {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 0 }
  }), {
    valid: false,
    reason: "not_enough_move_points"
  });
  assert.equal(
    predictPlayerWorldAction(createPlayerWorldView(state, "player-1"), {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 2, y: 0 }
    }).reason,
    "not_enough_move_points"
  );
});

test("validateWorldAction allows encounter moves within the remaining full path distance", () => {
  const state = createEncounterState(2);

  assert.deepEqual(validateWorldAction(state, {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 0 }
  }), {
    valid: true
  });
  assert.equal(
    predictPlayerWorldAction(createPlayerWorldView(state, "player-1"), {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 2, y: 0 }
    }).reason,
    undefined
  );
});
