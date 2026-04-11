import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  createPlayerWorldView,
  findPath,
  listReachableTiles,
  planHeroMovement,
  planPlayerViewMovement,
  validateWorldAction,
  type HeroState,
  type MapBuildingState,
  type NeutralArmyState,
  type PlayerTileView,
  type ResourceNode,
  type TileState,
  type WorldState
} from "../index.ts";

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

function createUpgradeBuilding(position = { x: 1, y: 0 }): MapBuildingState {
  return {
    id: "mine-1",
    kind: "resource_mine",
    position,
    label: "Iron Vein",
    resourceKind: "ore",
    income: 2,
    tier: 1,
    ownerPlayerId: "player-1"
  };
}

function createWorldState(options?: {
  width?: number;
  height?: number;
  tiles?: TileState[];
  heroes?: HeroState[];
  neutralArmies?: Record<string, NeutralArmyState>;
  buildings?: Record<string, MapBuildingState>;
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
            gold: 100,
            wood: 100,
            ore: 100
          }
        ])
      ),
    visibilityByPlayer: options?.visibilityByPlayer ?? {}
  };
}

function createGrid(width: number, height: number, customize?: (tile: TileState) => TileState): TileState[] {
  return Array.from({ length: width * height }, (_, index) => {
    const tile = createTile(index % width, Math.floor(index / width));
    return customize ? customize(tile) : tile;
  });
}

function tileAt(tiles: TileState[], width: number, x: number, y: number): TileState {
  return tiles[y * width + x]!;
}

test("findPath returns the deterministic shortest path on an open grid", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "Kailin",
    position: { x: 0, y: 0 }
  });
  const state = createWorldState({
    width: 3,
    height: 3,
    heroes: [hero]
  });

  const firstPath = findPath(state, hero.id, { x: 2, y: 2 });
  const secondPath = findPath(state, hero.id, { x: 2, y: 2 });

  assert.deepEqual(firstPath, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 2, y: 2 }
  ]);
  assert.deepEqual(secondPath, firstPath);
});

test("planHeroMovement routes around impassable obstacles", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "Kailin",
    position: { x: 0, y: 1 }
  });
  const tiles = createGrid(4, 3);
  for (const y of [0, 1, 2]) {
    tileAt(tiles, 4, 1, y).terrain = "water";
    tileAt(tiles, 4, 1, y).walkable = false;
  }
  tileAt(tiles, 4, 1, 2).terrain = "grass";
  tileAt(tiles, 4, 1, 2).walkable = true;

  const state = createWorldState({
    width: 4,
    height: 3,
    heroes: [hero],
    tiles
  });

  assert.deepEqual(planHeroMovement(state, hero.id, { x: 3, y: 1 }), {
    heroId: hero.id,
    destination: { x: 3, y: 1 },
    path: [
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 1 }
    ],
    travelPath: [
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 1 }
    ],
    moveCost: 5,
    endsInEncounter: false,
    encounterKind: "none"
  });
});

test("findPath returns undefined when the destination is fully blocked off", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "Kailin",
    position: { x: 0, y: 0 }
  });
  const tiles = createGrid(3, 3);
  for (const position of [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 1 }
  ]) {
    const tile = tileAt(tiles, 3, position.x, position.y);
    tile.terrain = "water";
    tile.walkable = false;
  }

  const state = createWorldState({
    width: 3,
    height: 3,
    heroes: [hero],
    tiles
  });

  assert.equal(findPath(state, hero.id, { x: 1, y: 1 }), undefined);
  assert.deepEqual(validateWorldAction(state, {
    type: "hero.move",
    heroId: hero.id,
    destination: { x: 1, y: 1 }
  }), {
    valid: false,
    reason: "path_not_found"
  });
});

test("createPlayerWorldView redacts explored and hidden tiles, and player-view pathing will not cross hidden tiles", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "Kailin",
    position: { x: 0, y: 0 }
  });
  const enemy = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "Rowan",
    position: { x: 2, y: 0 }
  });
  const state = createWorldState({
    width: 3,
    height: 2,
    heroes: [hero, enemy],
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: hero.id } }),
      createTile(1, 0, {
        resource: { kind: "ore", amount: 5 },
        occupant: { kind: "neutral", refId: "neutral-1" }
      }),
      createTile(2, 0, { occupant: { kind: "hero", refId: enemy.id } }),
      createTile(0, 1),
      createTile(1, 1),
      createTile(2, 1, { resource: { kind: "wood", amount: 5 } })
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "explored", "hidden", "visible", "hidden", "hidden"]
    }
  });

  const view = createPlayerWorldView(state, "player-1");
  const exploredTile = view.map.tiles[1] as PlayerTileView;
  const hiddenTile = view.map.tiles[2] as PlayerTileView;

  assert.equal(exploredTile.fog, "explored");
  assert.equal(exploredTile.terrain, "grass");
  assert.equal(exploredTile.resource, undefined);
  assert.equal(exploredTile.occupant, undefined);
  assert.equal(hiddenTile.fog, "hidden");
  assert.equal(hiddenTile.terrain, "unknown");
  assert.equal(hiddenTile.walkable, false);
  assert.deepEqual(view.visibleHeroes, []);
  assert.equal(planPlayerViewMovement(view, hero.id, { x: 2, y: 0 }), undefined);
});

test("validateWorldAction distinguishes valid, blocked, and occupied movement targets", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "Kailin",
    position: { x: 0, y: 0 }
  });
  const alliedHero = createHero({
    id: "hero-2",
    playerId: "player-1",
    name: "Maeve",
    position: { x: 2, y: 0 }
  });
  const tiles = [
    createTile(0, 0, { occupant: { kind: "hero", refId: hero.id } }),
    createTile(1, 0),
    createTile(2, 0, { occupant: { kind: "hero", refId: alliedHero.id } }),
    createTile(0, 1),
    createTile(1, 1, { terrain: "water", walkable: false }),
    createTile(2, 1),
    createTile(0, 2),
    createTile(1, 2),
    createTile(2, 2)
  ];
  const state = createWorldState({
    width: 3,
    height: 3,
    heroes: [hero, alliedHero],
    tiles
  });

  assert.deepEqual(validateWorldAction(state, {
    type: "hero.move",
    heroId: hero.id,
    destination: { x: 1, y: 0 }
  }), {
    valid: true
  });
  assert.deepEqual(validateWorldAction(state, {
    type: "hero.move",
    heroId: hero.id,
    destination: { x: 1, y: 1 }
  }), {
    valid: false,
    reason: "destination_blocked"
  });
  assert.deepEqual(validateWorldAction(state, {
    type: "hero.move",
    heroId: hero.id,
    destination: { x: 2, y: 0 }
  }), {
    valid: false,
    reason: "destination_occupied"
  });
});

test("planHeroMovement charges double movement for swamp tiles", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "Kailin",
    position: { x: 0, y: 0 }
  });
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    tiles: [
      createTile(0, 0),
      createTile(1, 0, { terrain: "swamp" }),
      createTile(2, 0)
    ]
  });

  const plan = planHeroMovement(state, hero.id, { x: 2, y: 0 });

  assert.equal(plan?.moveCost, 3);
  assert.deepEqual(listReachableTiles(createWorldState({
    width: 3,
    height: 1,
    heroes: [
      {
        ...hero,
        move: { total: 2, remaining: 2 }
      }
    ],
    tiles: [
      createTile(0, 0),
      createTile(1, 0, { terrain: "swamp" }),
      createTile(2, 0)
    ]
  }), hero.id), [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
});

test("adjacent building actions are limited to melee range while movement can target farther tiles", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "Kailin",
    position: { x: 0, y: 0 }
  });
  const building = createUpgradeBuilding({ x: 2, y: 0 });
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    buildings: { [building.id]: building },
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: hero.id } }),
      createTile(1, 0),
      createTile(2, 0, { building })
    ]
  });

  assert.deepEqual(validateWorldAction(state, {
    type: "hero.move",
    heroId: hero.id,
    destination: { x: 2, y: 0 }
  }), {
    valid: true
  });
  assert.deepEqual(validateWorldAction(state, {
    type: "hero.upgradeBuilding",
    heroId: hero.id,
    buildingId: building.id
  }), {
    valid: false,
    reason: "hero_not_adjacent_to_building"
  });
});

test("movement validation rejects map boundary destinations", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "Kailin",
    position: { x: 0, y: 0 }
  });
  const state = createWorldState({
    width: 2,
    height: 2,
    heroes: [hero]
  });

  assert.deepEqual(validateWorldAction(state, {
    type: "hero.move",
    heroId: hero.id,
    destination: { x: -1, y: 0 }
  }), {
    valid: false,
    reason: "destination_not_found"
  });
  assert.deepEqual(validateWorldAction(state, {
    type: "hero.move",
    heroId: hero.id,
    destination: { x: 2, y: 2 }
  }), {
    valid: false,
    reason: "destination_not_found"
  });
});

test("a hero can path off an impassable starting tile if an adjacent traversable tile exists", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "Kailin",
    position: { x: 0, y: 0 }
  });
  const state = createWorldState({
    width: 2,
    height: 1,
    heroes: [hero],
    tiles: [
      createTile(0, 0, { terrain: "water", walkable: false, occupant: { kind: "hero", refId: hero.id } }),
      createTile(1, 0)
    ]
  });

  assert.deepEqual(findPath(state, hero.id, { x: 1, y: 0 }), [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
});

test("zero movement remaining leaves only the current tile reachable and rejects farther moves", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "Kailin",
    position: { x: 0, y: 0 },
    move: { total: 6, remaining: 0 }
  });
  const state = createWorldState({
    width: 2,
    height: 1,
    heroes: [hero]
  });

  assert.deepEqual(listReachableTiles(state, hero.id), [{ x: 0, y: 0 }]);
  assert.deepEqual(validateWorldAction(state, {
    type: "hero.move",
    heroId: hero.id,
    destination: { x: 1, y: 0 }
  }), {
    valid: false,
    reason: "not_enough_move_points"
  });
});
