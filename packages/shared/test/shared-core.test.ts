import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBattleAction,
  applyBattleOutcomeToWorld,
  createDemoBattleState,
  createEmptyBattleState,
  createHeroBattleState,
  createDefaultHeroLoadout,
  createNeutralBattleState,
  createDefaultHeroProgression,
  createPlayerWorldView,
  createWorldStateFromConfigs,
  filterWorldEventsForPlayer,
  getDefaultBattleSkillCatalog,
  getDefaultUnitCatalog,
  getBattleOutcome,
  pickAutomatedBattleAction,
  planPlayerViewMovement,
  predictPlayerWorldAction,
  resetRuntimeConfigs,
  resolveWorldAction,
  setBattleSkillCatalog,
  setUnitCatalog,
  validateBattleAction,
  validateWorldAction,
  type BattleOutcome,
  type BattleState,
  type HeroState,
  type NeutralArmyState,
  type ResourceNode,
  type TileState,
  type UnitStack,
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
    armyCount: overrides.armyCount ?? 12
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

function cloneBattleState(state: BattleState): BattleState {
  return structuredClone(state);
}

function cloneBattleUnit(unit: UnitStack): UnitStack {
  return structuredClone(unit);
}

test("createPlayerWorldView respects fog-of-war visibility rules", () => {
  const heroOne = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 }
  });
  const hiddenEnemy = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    position: { x: 1, y: 0 }
  });
  const visibleEnemy = createHero({
    id: "hero-3",
    playerId: "player-2",
    name: "萨恩",
    position: { x: 0, y: 1 }
  });

  const state = createWorldState({
    width: 2,
    height: 2,
    heroes: [heroOne, hiddenEnemy, visibleEnemy],
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0, {
        resource: { kind: "ore", amount: 5 },
        occupant: { kind: "hero", refId: "hero-2" }
      }),
      createTile(0, 1, {
        resource: { kind: "gold", amount: 300 },
        occupant: { kind: "hero", refId: "hero-3" }
      }),
      createTile(1, 1, { resource: { kind: "wood", amount: 5 } })
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "explored", "visible", "hidden"]
    }
  });

  const view = createPlayerWorldView(state, "player-1");

  assert.equal(view.map.tiles[0]?.terrain, "grass");
  assert.deepEqual(view.map.tiles[0]?.occupant, { kind: "hero", refId: "hero-1" });

  assert.equal(view.map.tiles[1]?.fog, "explored");
  assert.equal(view.map.tiles[1]?.terrain, "grass");
  assert.equal(view.map.tiles[1]?.resource, undefined);
  assert.equal(view.map.tiles[1]?.occupant, undefined);

  assert.equal(view.map.tiles[3]?.fog, "hidden");
  assert.equal(view.map.tiles[3]?.terrain, "unknown");
  assert.equal(view.map.tiles[3]?.walkable, false);

  assert.deepEqual(view.visibleHeroes, [
    {
      id: "hero-3",
      playerId: "player-2",
      name: "萨恩",
      position: { x: 0, y: 1 }
    }
  ]);
  assert.deepEqual(view.resources, { gold: 0, wood: 0, ore: 0 });
});

test("resolveWorldAction starts a battle when a hero reaches a neutral army tile", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 },
    move: { total: 6, remaining: 6 }
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-1",
    position: { x: 2, y: 0 },
    reward: { kind: "gold", amount: 300 },
    stacks: [{ templateId: "wolf_pack", count: 8 }]
  };
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    neutralArmies: { "neutral-1": neutralArmy },
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0),
      createTile(2, 0, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ]
  });

  const outcome = resolveWorldAction(state, {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 0 }
  });

  assert.equal(outcome.movementPlan?.endsInEncounter, true);
  assert.equal(outcome.movementPlan?.encounterKind, "neutral");
  assert.deepEqual(outcome.movementPlan?.path, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 }
  ]);
  assert.deepEqual(outcome.movementPlan?.travelPath, [
    { x: 0, y: 0 },
    { x: 1, y: 0 }
  ]);

  assert.equal(outcome.state.heroes[0]?.position.x, 1);
  assert.equal(outcome.state.heroes[0]?.position.y, 0);
  assert.equal(outcome.state.heroes[0]?.move.remaining, 5);

  assert.deepEqual(outcome.events, [
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      battleId: "battle-neutral-1",
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 0 }
      ],
      moveCost: 1
    }
  ]);
});

test("createWorldStateFromConfigs reuses deterministic generation for preview and room startup", () => {
  const worldConfig = {
    width: 4,
    height: 3,
    heroes: [
      {
        id: "hero-1",
        playerId: "player-1",
        name: "凯琳",
        position: { x: 0, y: 0 },
        vision: 2,
        move: { total: 6, remaining: 6 },
        stats: {
          attack: 2,
          defense: 2,
          power: 1,
          knowledge: 1,
          hp: 30,
          maxHp: 30
        },
        progression: createDefaultHeroProgression(),
        armyTemplateId: "hero_guard_basic",
        armyCount: 12
      }
    ],
    resourceSpawn: {
      goldChance: 0.08,
      woodChance: 0.08,
      oreChance: 0.08
    }
  };
  const mapObjectsConfig = {
    neutralArmies: [
      {
        id: "neutral-1",
        position: { x: 3, y: 2 },
        reward: { kind: "gold" as const, amount: 300 },
        stacks: [{ templateId: "wolf_pack", count: 8 }]
      }
    ],
    guaranteedResources: [
      {
        position: { x: 1, y: 0 },
        resource: { kind: "wood" as const, amount: 5 }
      }
    ],
    buildings: [
      {
        id: "recruit-post-1",
        kind: "recruitment_post" as const,
        position: { x: 0, y: 2 },
        label: "前线招募所",
        unitTemplateId: "hero_guard_basic",
        recruitCount: 4,
        cost: {
          gold: 240,
          wood: 0,
          ore: 0
        }
      },
      {
        id: "shrine-1",
        kind: "attribute_shrine" as const,
        position: { x: 2, y: 1 },
        label: "战旗圣坛",
        bonus: {
          attack: 1,
          defense: 0,
          power: 0,
          knowledge: 0
        }
      },
      {
        id: "mine-1",
        kind: "resource_mine" as const,
        position: { x: 3, y: 0 },
        label: "前线伐木场",
        resourceKind: "wood" as const,
        income: 2
      }
    ]
  };

  const previewState = createWorldStateFromConfigs(worldConfig, mapObjectsConfig, 2026, "preview-room");
  const roomState = createWorldStateFromConfigs(worldConfig, mapObjectsConfig, 2026, "preview-room");
  const guaranteedTile = previewState.map.tiles.find((tile) => tile.position.x === 1 && tile.position.y === 0);
  const neutralTile = previewState.map.tiles.find((tile) => tile.position.x === 3 && tile.position.y === 2);
  const buildingTile = previewState.map.tiles.find((tile) => tile.position.x === 0 && tile.position.y === 2);
  const shrineTile = previewState.map.tiles.find((tile) => tile.position.x === 2 && tile.position.y === 1);
  const mineTile = previewState.map.tiles.find((tile) => tile.position.x === 3 && tile.position.y === 0);

  assert.deepEqual(previewState.map.tiles, roomState.map.tiles);
  assert.equal(previewState.meta.roomId, "preview-room");
  assert.deepEqual(guaranteedTile?.resource, { kind: "wood", amount: 5 });
  assert.deepEqual(neutralTile?.occupant, { kind: "neutral", refId: "neutral-1" });
  assert.equal(buildingTile?.building?.id, "recruit-post-1");
  assert.equal(shrineTile?.building?.kind, "attribute_shrine");
  assert.equal(mineTile?.building?.kind, "resource_mine");
  assert.deepEqual(previewState.map.tiles[0]?.occupant, { kind: "hero", refId: "hero-1" });
});

test("applyBattleOutcomeToWorld grants neutral rewards and moves the hero onto the defeated army tile", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 0 }
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-1",
    position: { x: 2, y: 0 },
    reward: { kind: "gold", amount: 300 },
    stacks: [{ templateId: "wolf_pack", count: 8 }]
  };
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    neutralArmies: { "neutral-1": neutralArmy },
    tiles: [
      createTile(0, 0),
      createTile(1, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(2, 0, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ]
  });

  const outcome = applyBattleOutcomeToWorld(state, "battle-neutral-1", "hero-1", {
    status: "attacker_victory",
    survivingAttackers: ["hero-1-stack"],
    survivingDefenders: []
  });

  assert.equal(outcome.state.heroes[0]?.position.x, 2);
  assert.equal(outcome.state.resources["player-1"]?.gold, 300);
  assert.equal(outcome.state.neutralArmies["neutral-1"], undefined);
  assert.equal(outcome.state.heroes[0]?.progression.level, 2);
  assert.equal(outcome.state.heroes[0]?.progression.experience, 120);
  assert.equal(outcome.state.heroes[0]?.progression.neutralBattlesWon, 1);
  assert.deepEqual(outcome.events, [
    {
      type: "battle.resolved",
      heroId: "hero-1",
      battleId: "battle-neutral-1",
      result: "attacker_victory"
    },
    {
      type: "hero.progressed",
      heroId: "hero-1",
      battleId: "battle-neutral-1",
      battleKind: "neutral",
      experienceGained: 120,
      totalExperience: 120,
      level: 2,
      levelsGained: 1
    },
    {
      type: "hero.collected",
      heroId: "hero-1",
      resource: { kind: "gold", amount: 300 }
    }
  ]);
});

test("applyBattleOutcomeToWorld grants PvP experience to the winning hero", () => {
  const attacker = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 },
    armyCount: 12
  });
  const defender = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    position: { x: 2, y: 1 },
    armyCount: 10
  });
  const state = createWorldState({
    width: 3,
    height: 3,
    heroes: [attacker, defender],
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(2, 0),
      createTile(0, 1),
      createTile(1, 1, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(2, 1, { occupant: { kind: "hero", refId: "hero-2" } }),
      createTile(0, 2),
      createTile(1, 2),
      createTile(2, 2)
    ]
  });

  const outcome = applyBattleOutcomeToWorld(state, "battle-hero-1-vs-hero-2", "hero-1", {
    status: "defender_victory",
    survivingAttackers: [],
    survivingDefenders: ["hero-2-stack"]
  });

  const winningDefender = outcome.state.heroes.find((hero) => hero.id === "hero-2");

  assert.equal(winningDefender?.progression.level, 2);
  assert.equal(winningDefender?.progression.experience, 164);
  assert.equal(winningDefender?.progression.pvpBattlesWon, 1);
  assert.deepEqual(outcome.events, [
    {
      type: "battle.resolved",
      heroId: "hero-1",
      defenderHeroId: "hero-2",
      battleId: "battle-hero-1-vs-hero-2",
      result: "defender_victory"
    },
    {
      type: "hero.progressed",
      heroId: "hero-2",
      battleId: "battle-hero-1-vs-hero-2",
      battleKind: "hero",
      experienceGained: 164,
      totalExperience: 164,
      level: 2,
      levelsGained: 1
    }
  ]);
});

test("createPlayerWorldView returns player-scoped resources after collection", () => {
  const collector = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 }
  });
  const observer = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    position: { x: 1, y: 0 }
  });

  const state = createWorldState({
    width: 2,
    height: 1,
    heroes: [collector, observer],
    tiles: [
      createTile(0, 0, {
        resource: { kind: "gold", amount: 300 },
        occupant: { kind: "hero", refId: "hero-1" }
      }),
      createTile(1, 0, { occupant: { kind: "hero", refId: "hero-2" } })
    ]
  });

  const outcome = resolveWorldAction(state, {
    type: "hero.collect",
    heroId: "hero-1",
    position: { x: 0, y: 0 }
  });

  const playerOneView = createPlayerWorldView(outcome.state, "player-1");
  const playerTwoView = createPlayerWorldView(outcome.state, "player-2");

  assert.deepEqual(playerOneView.resources, { gold: 300, wood: 0, ore: 0 });
  assert.deepEqual(playerTwoView.resources, { gold: 0, wood: 0, ore: 0 });
});

test("resolveWorldAction recruits units from a recruitment post and resets stock on next day", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 },
    armyCount: 12
  });
  const state = createWorldState({
    width: 2,
    height: 2,
    heroes: [hero],
    buildings: {
      "recruit-post-1": {
        id: "recruit-post-1",
        kind: "recruitment_post",
        position: { x: 1, y: 1 },
        label: "前线招募所",
        unitTemplateId: "hero_guard_basic",
        recruitCount: 4,
        availableCount: 4,
        cost: {
          gold: 240,
          wood: 0,
          ore: 0
        }
      }
    },
    resources: {
      "player-1": {
        gold: 300,
        wood: 0,
        ore: 0
      }
    },
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(0, 1),
      createTile(1, 1, {
        occupant: { kind: "hero", refId: "hero-1" },
        building: {
          id: "recruit-post-1",
          kind: "recruitment_post",
          position: { x: 1, y: 1 },
          label: "前线招募所",
          unitTemplateId: "hero_guard_basic",
          recruitCount: 4,
          availableCount: 4,
          cost: {
            gold: 240,
            wood: 0,
            ore: 0
          }
        }
      })
    ]
  });

  const recruitOutcome = resolveWorldAction(state, {
    type: "hero.recruit",
    heroId: "hero-1",
    buildingId: "recruit-post-1"
  });

  assert.equal(recruitOutcome.state.heroes[0]?.armyCount, 16);
  assert.equal(recruitOutcome.state.resources["player-1"]?.gold, 60);
  assert.equal(recruitOutcome.state.buildings["recruit-post-1"]?.availableCount, 0);
  assert.equal(recruitOutcome.state.map.tiles[3]?.building?.availableCount, 0);
  assert.deepEqual(recruitOutcome.events, [
    {
      type: "hero.recruited",
      heroId: "hero-1",
      buildingId: "recruit-post-1",
      buildingKind: "recruitment_post",
      unitTemplateId: "hero_guard_basic",
      count: 4,
      cost: {
        gold: 240,
        wood: 0,
        ore: 0
      }
    }
  ]);

  const nextDayOutcome = resolveWorldAction(recruitOutcome.state, {
    type: "turn.endDay"
  });

  assert.equal(nextDayOutcome.state.buildings["recruit-post-1"]?.availableCount, 4);
  assert.equal(nextDayOutcome.state.map.tiles[3]?.building?.availableCount, 4);
});

test("resolveWorldAction visits an attribute shrine once, grants permanent stats, and does not reset on next day", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 }
  });
  const state = createWorldState({
    width: 2,
    height: 2,
    heroes: [hero],
    buildings: {
      "shrine-1": {
        id: "shrine-1",
        kind: "attribute_shrine",
        position: { x: 1, y: 1 },
        label: "战旗圣坛",
        bonus: {
          attack: 1,
          defense: 0,
          power: 1,
          knowledge: 0
        },
        visitedHeroIds: []
      }
    },
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(0, 1),
      createTile(1, 1, {
        occupant: { kind: "hero", refId: "hero-1" },
        building: {
          id: "shrine-1",
          kind: "attribute_shrine",
          position: { x: 1, y: 1 },
          label: "战旗圣坛",
          bonus: {
            attack: 1,
            defense: 0,
            power: 1,
            knowledge: 0
          },
          visitedHeroIds: []
        }
      })
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "visible", "visible"]
    }
  });

  const visitOutcome = resolveWorldAction(state, {
    type: "hero.visit",
    heroId: "hero-1",
    buildingId: "shrine-1"
  });

  assert.equal(visitOutcome.state.heroes[0]?.stats.attack, 3);
  assert.equal(visitOutcome.state.heroes[0]?.stats.power, 2);
  assert.deepEqual(visitOutcome.state.buildings["shrine-1"]?.visitedHeroIds, ["hero-1"]);
  assert.deepEqual(visitOutcome.events, [
    {
      type: "hero.visited",
      heroId: "hero-1",
      buildingId: "shrine-1",
      buildingKind: "attribute_shrine",
      bonus: {
        attack: 1,
        defense: 0,
        power: 1,
        knowledge: 0
      }
    }
  ]);

  assert.deepEqual(
    predictPlayerWorldAction(createPlayerWorldView(state, "player-1"), {
      type: "hero.visit",
      heroId: "hero-1",
      buildingId: "shrine-1"
    }).world.ownHeroes[0]?.stats,
    {
      attack: 3,
      defense: 2,
      power: 2,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    }
  );

  assert.deepEqual(validateWorldAction(visitOutcome.state, {
    type: "hero.visit",
    heroId: "hero-1",
    buildingId: "shrine-1"
  }), {
    valid: false,
    reason: "building_already_visited"
  });

  const nextDayOutcome = resolveWorldAction(visitOutcome.state, {
    type: "turn.endDay"
  });

  assert.deepEqual(nextDayOutcome.state.buildings["shrine-1"]?.visitedHeroIds, ["hero-1"]);
  assert.equal(nextDayOutcome.state.heroes[0]?.stats.attack, 3);
  assert.equal(nextDayOutcome.state.heroes[0]?.stats.power, 2);
});

test("resolveWorldAction claims a resource mine and grants daily income on end day", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 },
    move: { total: 6, remaining: 0 }
  });
  const state = createWorldState({
    width: 2,
    height: 2,
    heroes: [hero],
    buildings: {
      "mine-1": {
        id: "mine-1",
        kind: "resource_mine",
        position: { x: 1, y: 1 },
        label: "前线伐木场",
        resourceKind: "wood",
        income: 2
      }
    },
    resources: {
      "player-1": {
        gold: 0,
        wood: 0,
        ore: 0
      }
    },
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(0, 1),
      createTile(1, 1, {
        occupant: { kind: "hero", refId: "hero-1" },
        building: {
          id: "mine-1",
          kind: "resource_mine",
          position: { x: 1, y: 1 },
          label: "前线伐木场",
          resourceKind: "wood",
          income: 2
        }
      })
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "visible", "visible"]
    }
  });

  const predictedClaim = predictPlayerWorldAction(createPlayerWorldView(state, "player-1"), {
    type: "hero.claimMine",
    heroId: "hero-1",
    buildingId: "mine-1"
  });
  assert.equal(predictedClaim.reason, undefined);
  assert.equal(
    predictedClaim.world.map.tiles.find((tile) => tile.position.x === 1 && tile.position.y === 1)?.building?.ownerPlayerId,
    "player-1"
  );

  const claimOutcome = resolveWorldAction(state, {
    type: "hero.claimMine",
    heroId: "hero-1",
    buildingId: "mine-1"
  });

  assert.equal(claimOutcome.state.buildings["mine-1"]?.ownerPlayerId, "player-1");
  assert.equal(claimOutcome.state.map.tiles[3]?.building?.ownerPlayerId, "player-1");
  assert.deepEqual(claimOutcome.events, [
    {
      type: "hero.claimedMine",
      heroId: "hero-1",
      buildingId: "mine-1",
      buildingKind: "resource_mine",
      resourceKind: "wood",
      income: 2,
      ownerPlayerId: "player-1"
    }
  ]);

  assert.deepEqual(validateWorldAction(claimOutcome.state, {
    type: "hero.claimMine",
    heroId: "hero-1",
    buildingId: "mine-1"
  }), {
    valid: false,
    reason: "building_already_owned"
  });

  const nextDayOutcome = resolveWorldAction(claimOutcome.state, {
    type: "turn.endDay"
  });

  assert.equal(nextDayOutcome.state.resources["player-1"]?.wood, 2);
  assert.equal(nextDayOutcome.state.heroes[0]?.move.remaining, 6);
  assert.deepEqual(nextDayOutcome.events, [
    {
      type: "turn.advanced",
      day: 2
    },
    {
      type: "resource.produced",
      playerId: "player-1",
      buildingId: "mine-1",
      buildingKind: "resource_mine",
      resource: {
        kind: "wood",
        amount: 2
      }
    }
  ]);
});

test("resolveWorldAction advances patrolling neutral armies by one tile on end day", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 }
  });
  const state = createWorldState({
    width: 4,
    height: 2,
    heroes: [hero],
    neutralArmies: {
      "neutral-1": {
        id: "neutral-1",
        position: { x: 3, y: 1 },
        origin: { x: 3, y: 1 },
        reward: { kind: "gold", amount: 300 },
        stacks: [{ templateId: "wolf_pack", count: 8 }],
        behavior: {
          mode: "patrol",
          patrolPath: [{ x: 2, y: 1 }, { x: 3, y: 1 }],
          patrolIndex: 0,
          aggroRange: 0
        }
      }
    },
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0),
      createTile(2, 0),
      createTile(3, 0),
      createTile(0, 1),
      createTile(1, 1),
      createTile(2, 1),
      createTile(3, 1, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ]
  });

  const outcome = resolveWorldAction(state, {
    type: "turn.endDay"
  });

  assert.deepEqual(outcome.events, [
    {
      type: "turn.advanced",
      day: 2
    },
    {
      type: "neutral.moved",
      neutralArmyId: "neutral-1",
      from: { x: 3, y: 1 },
      to: { x: 2, y: 1 },
      reason: "patrol"
    }
  ]);
  assert.deepEqual(outcome.state.neutralArmies["neutral-1"]?.position, { x: 2, y: 1 });
  assert.equal(outcome.state.neutralArmies["neutral-1"]?.behavior?.patrolIndex, 1);
});

test("resolveWorldAction can start a neutral-initiated battle on end day", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 0 }
  });
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    neutralArmies: {
      "neutral-1": {
        id: "neutral-1",
        position: { x: 2, y: 0 },
        origin: { x: 2, y: 0 },
        reward: { kind: "gold", amount: 300 },
        stacks: [{ templateId: "wolf_pack", count: 8 }],
        behavior: {
          mode: "guard",
          patrolPath: [],
          patrolIndex: 0,
          aggroRange: 1
        }
      }
    },
    tiles: [
      createTile(0, 0),
      createTile(1, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(2, 0, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ]
  });

  const outcome = resolveWorldAction(state, {
    type: "turn.endDay"
  });

  assert.deepEqual(outcome.events, [
    {
      type: "turn.advanced",
      day: 2
    },
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      initiator: "neutral",
      battleId: "battle-neutral-1",
      path: [{ x: 1, y: 0 }],
      moveCost: 0
    }
  ]);
  assert.deepEqual(outcome.state.neutralArmies["neutral-1"]?.position, { x: 2, y: 0 });
});

test("planPlayerViewMovement stops at the tile before a visible neutral encounter", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 },
    move: { total: 6, remaining: 6 }
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-1",
    position: { x: 2, y: 0 },
    reward: { kind: "gold", amount: 300 },
    stacks: [{ templateId: "wolf_pack", count: 8 }]
  };
  const state = createWorldState({
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

  const view = createPlayerWorldView(state, "player-1");
  const plan = planPlayerViewMovement(view, "hero-1", { x: 2, y: 0 });

  assert.equal(plan?.endsInEncounter, true);
  assert.equal(plan?.encounterKind, "neutral");
  assert.deepEqual(plan?.travelPath, [
    { x: 0, y: 0 },
    { x: 1, y: 0 }
  ]);
  assert.equal(plan?.moveCost, 1);
});

test("predictPlayerWorldAction updates the player view immediately for move and collect", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 0, y: 0 },
    move: { total: 6, remaining: 6 }
  });
  const state = createWorldState({
    width: 2,
    height: 2,
    heroes: [hero],
    tiles: [
      createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(1, 0, { resource: { kind: "wood", amount: 5 } }),
      createTile(0, 1),
      createTile(1, 1)
    ],
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "visible", "visible"]
    }
  });

  const view = createPlayerWorldView(state, "player-1");
  const predictedMove = predictPlayerWorldAction(view, {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 1, y: 0 }
  });

  assert.equal(predictedMove.reason, undefined);
  assert.equal(predictedMove.world.ownHeroes[0]?.position.x, 1);
  assert.equal(predictedMove.world.ownHeroes[0]?.position.y, 0);
  assert.equal(predictedMove.world.ownHeroes[0]?.move.remaining, 5);
  assert.equal(
    predictedMove.world.map.tiles.find((tile) => tile.position.x === 0 && tile.position.y === 0)?.occupant,
    undefined
  );
  assert.deepEqual(
    predictedMove.world.map.tiles.find((tile) => tile.position.x === 1 && tile.position.y === 0)?.occupant,
    { kind: "hero", refId: "hero-1" }
  );

  const predictedCollect = predictPlayerWorldAction(predictedMove.world, {
    type: "hero.collect",
    heroId: "hero-1",
    position: { x: 1, y: 0 }
  });

  assert.equal(predictedCollect.reason, undefined);
  assert.deepEqual(predictedCollect.world.resources, { gold: 0, wood: 5, ore: 0 });
  assert.equal(
    predictedCollect.world.map.tiles.find((tile) => tile.position.x === 1 && tile.position.y === 0)?.resource,
    undefined
  );
});

test("applyBattleOutcomeToWorld penalizes the hero on defeat and keeps the neutral army", () => {
  const hero = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 0 }
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-1",
    position: { x: 2, y: 0 },
    reward: { kind: "gold", amount: 300 },
    stacks: [{ templateId: "wolf_pack", count: 8 }]
  };
  const state = createWorldState({
    width: 3,
    height: 1,
    heroes: [hero],
    neutralArmies: { "neutral-1": neutralArmy },
    tiles: [
      createTile(0, 0),
      createTile(1, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(2, 0, { occupant: { kind: "neutral", refId: "neutral-1" } })
    ]
  });

  const outcome = applyBattleOutcomeToWorld(state, "battle-neutral-1", "hero-1", {
    status: "defender_victory",
    survivingAttackers: [],
    survivingDefenders: ["neutral-1-stack-1"]
  });

  assert.equal(outcome.state.heroes[0]?.position.x, 1);
  assert.equal(outcome.state.heroes[0]?.stats.hp, 15);
  assert.equal(outcome.state.heroes[0]?.move.remaining, 0);
  assert.ok(outcome.state.neutralArmies["neutral-1"]);
  assert.deepEqual(outcome.events, [
    {
      type: "battle.resolved",
      heroId: "hero-1",
      battleId: "battle-neutral-1",
      result: "defender_victory"
    }
  ]);
});

test("applyBattleOutcomeToWorld keeps defenderHeroId on hero-vs-hero resolution events", () => {
  const attacker = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 }
  });
  const defender = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    position: { x: 2, y: 1 }
  });
  const state = createWorldState({
    width: 3,
    height: 3,
    heroes: [attacker, defender],
    tiles: [
      createTile(0, 0),
      createTile(1, 0),
      createTile(2, 0),
      createTile(0, 1),
      createTile(1, 1, { occupant: { kind: "hero", refId: "hero-1" } }),
      createTile(2, 1, { occupant: { kind: "hero", refId: "hero-2" } }),
      createTile(0, 2),
      createTile(1, 2),
      createTile(2, 2)
    ]
  });

  const outcome = applyBattleOutcomeToWorld(state, "battle-hero-1-vs-hero-2", "hero-1", {
    status: "attacker_victory",
    survivingAttackers: ["hero-1-stack"],
    survivingDefenders: []
  });

  assert.deepEqual(outcome.events, [
    {
      type: "battle.resolved",
      heroId: "hero-1",
      defenderHeroId: "hero-2",
      battleId: "battle-hero-1-vs-hero-2",
      result: "attacker_victory"
    },
    {
      type: "hero.progressed",
      heroId: "hero-1",
      battleId: "battle-hero-1-vs-hero-2",
      battleKind: "hero",
      experienceGained: 164,
      totalExperience: 164,
      level: 2,
      levelsGained: 1
    }
  ]);
});

test("filterWorldEventsForPlayer hides unrelated hero timelines while keeping mine income and both sides of PvP encounters", () => {
  const attacker = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "凯琳",
    position: { x: 1, y: 1 }
  });
  const defender = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "罗安",
    position: { x: 2, y: 1 }
  });
  const bystander = createHero({
    id: "hero-3",
    playerId: "player-3",
    name: "萨恩",
    position: { x: 0, y: 0 }
  });
  const state = createWorldState({
    heroes: [attacker, defender, bystander]
  });
  const events = [
    {
      type: "hero.moved" as const,
      heroId: "hero-1",
      path: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      moveCost: 1
    },
    {
      type: "hero.collected" as const,
      heroId: "hero-3",
      resource: { kind: "wood" as const, amount: 5 }
    },
    {
      type: "battle.started" as const,
      heroId: "hero-1",
      defenderHeroId: "hero-2",
      encounterKind: "hero" as const,
      battleId: "battle-hero-1-vs-hero-2",
      path: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      moveCost: 1
    },
    {
      type: "battle.resolved" as const,
      heroId: "hero-1",
      defenderHeroId: "hero-2",
      battleId: "battle-hero-1-vs-hero-2",
      result: "attacker_victory" as const
    },
    {
      type: "hero.claimedMine" as const,
      heroId: "hero-1",
      buildingId: "mine-1",
      buildingKind: "resource_mine" as const,
      resourceKind: "wood" as const,
      income: 2,
      ownerPlayerId: "player-1"
    },
    {
      type: "resource.produced" as const,
      playerId: "player-1",
      buildingId: "mine-1",
      buildingKind: "resource_mine" as const,
      resource: {
        kind: "wood" as const,
        amount: 2
      }
    },
    {
      type: "resource.produced" as const,
      playerId: "player-3",
      buildingId: "mine-2",
      buildingKind: "resource_mine" as const,
      resource: {
        kind: "gold" as const,
        amount: 300
      }
    },
    {
      type: "turn.advanced" as const,
      day: 2
    }
  ];

  assert.deepEqual(filterWorldEventsForPlayer(state, "player-1", events), [
    events[0],
    events[2],
    events[3],
    events[4],
    events[5],
    events[7]
  ]);
  assert.deepEqual(filterWorldEventsForPlayer(state, "player-2", events), [events[2], events[3], events[7]]);
  assert.deepEqual(filterWorldEventsForPlayer(state, "player-3", events), [events[1], events[6], events[7]]);
});

test("applyBattleAction uses deterministic damage and retaliation flow", () => {
  const initial = createDemoBattleState();
  const activeUnitId = initial.activeUnitId;
  assert.equal(activeUnitId, "wolf-d");

  const next = applyBattleAction(initial, {
    type: "battle.attack",
    attackerId: "wolf-d",
    defenderId: "pikeman-a"
  });

  assert.equal(next.rng.cursor, 2);
  assert.equal(next.round, 1);
  assert.equal(next.activeUnitId, "pikeman-a");
  assert.equal(next.units["pikeman-a"]?.count, 10);
  assert.equal(next.units["pikeman-a"]?.currentHp, 1);
  assert.equal(next.units["pikeman-a"]?.hasRetaliated, true);
  assert.equal(next.units["pikeman-a"]?.statusEffects?.[0]?.id, "poisoned");
  assert.equal(next.units["wolf-d"]?.count, 6);
  assert.equal(next.units["wolf-d"]?.currentHp, 6);
  assert.deepEqual(next.log.slice(-4), [
    "恶狼 对 枪兵 造成 27 伤害",
    "恶狼 的毒牙让 枪兵 陷入中毒",
    "枪兵 反击 恶狼，造成 18 伤害",
    "枪兵 受到中毒影响，损失 2 生命"
  ]);
});

test("applyBattleAction supports active ranged skills without retaliation", () => {
  const initial = createDemoBattleState();
  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a", "wolf-d"];

  const next = applyBattleAction(initial, {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "power_shot",
    targetId: "wolf-d"
  });

  assert.equal(next.rng.cursor, 1);
  assert.equal(next.activeUnitId, "wolf-d");
  assert.equal(next.units["pikeman-a"]?.count, 12);
  assert.equal(next.units["wolf-d"]?.count, 6);
  assert.equal(next.units["wolf-d"]?.hasRetaliated, false);
  assert.equal(next.units["pikeman-a"]?.skills?.find((skill) => skill.id === "power_shot")?.remainingCooldown, 2);
  assert.match(next.log.at(-1) ?? "", /投矛射击/);
});

test("applyBattleAction supports armor spell buffs on the acting unit", () => {
  const initial = createDemoBattleState();
  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a", "wolf-d"];

  const next = applyBattleAction(initial, {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "armor_spell",
    targetId: "pikeman-a"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.equal(next.units["pikeman-a"]?.statusEffects?.[0]?.id, "arcane_armor");
  assert.equal(next.units["pikeman-a"]?.statusEffects?.[0]?.defenseModifier, 3);
  assert.equal(next.units["pikeman-a"]?.skills?.find((skill) => skill.id === "armor_spell")?.remainingCooldown, 3);
  assert.match(next.log.at(-1) ?? "", /护甲术/);
});

test("pickAutomatedBattleAction prefers ready skills before default attacks", () => {
  const initial = createDemoBattleState();

  assert.deepEqual(pickAutomatedBattleAction(initial), {
    type: "battle.skill",
    unitId: "wolf-d",
    skillId: "crippling_howl",
    targetId: "pikeman-a"
  });

  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a", "wolf-d"];

  assert.deepEqual(pickAutomatedBattleAction(initial), {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "armor_spell",
    targetId: "pikeman-a"
  });
});

test("validateBattleAction covers wait and skill rejection branches", () => {
  const initial = createDemoBattleState();

  assert.deepEqual(validateBattleAction(initial, { type: "battle.wait", unitId: "pikeman-a" }), {
    valid: false,
    reason: "unit_not_active"
  });

  const unavailableWaitState = cloneBattleState(initial);
  unavailableWaitState.activeUnitId = "pikeman-a";
  unavailableWaitState.turnOrder = ["pikeman-a", "wolf-d"];
  unavailableWaitState.units["pikeman-a"] = {
    ...unavailableWaitState.units["pikeman-a"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(validateBattleAction(unavailableWaitState, { type: "battle.wait", unitId: "pikeman-a" }), {
    valid: false,
    reason: "unit_not_available"
  });

  assert.deepEqual(
    validateBattleAction(initial, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "power_shot",
      targetId: "wolf-d"
    }),
    {
      valid: false,
      reason: "unit_not_active"
    }
  );

  const unavailableCasterState = cloneBattleState(initial);
  unavailableCasterState.activeUnitId = "pikeman-a";
  unavailableCasterState.turnOrder = ["pikeman-a", "wolf-d"];
  unavailableCasterState.units["pikeman-a"] = {
    ...unavailableCasterState.units["pikeman-a"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(
    validateBattleAction(unavailableCasterState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "power_shot",
      targetId: "wolf-d"
    }),
    {
      valid: false,
      reason: "unit_not_available"
    }
  );

  const passiveSkillState = cloneBattleState(initial);
  assert.deepEqual(
    validateBattleAction(passiveSkillState, {
      type: "battle.skill",
      unitId: "wolf-d",
      skillId: "venomous_fangs",
      targetId: "pikeman-a"
    }),
    {
      valid: false,
      reason: "skill_not_available"
    }
  );

  const cooldownState = cloneBattleState(initial);
  cooldownState.activeUnitId = "pikeman-a";
  cooldownState.turnOrder = ["pikeman-a", "wolf-d"];
  cooldownState.units["pikeman-a"] = {
    ...cooldownState.units["pikeman-a"]!,
    skills: cooldownState.units["pikeman-a"]!.skills?.map((skill) =>
      skill.id === "power_shot" ? { ...skill, remainingCooldown: 1 } : skill
    )
  };
  assert.deepEqual(
    validateBattleAction(cooldownState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "power_shot",
      targetId: "wolf-d"
    }),
    {
      valid: false,
      reason: "skill_on_cooldown"
    }
  );

  assert.deepEqual(
    validateBattleAction(cooldownState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "armor_spell",
      targetId: "wolf-d"
    }),
    {
      valid: false,
      reason: "invalid_skill_target"
    }
  );

  assert.deepEqual(
    validateBattleAction(cooldownState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "armor_spell"
    }),
    {
      valid: true
    }
  );

  assert.deepEqual(
    validateBattleAction(
      {
        ...cloneBattleState(initial),
        activeUnitId: "pikeman-a",
        turnOrder: ["pikeman-a", "wolf-d"]
      },
      {
        type: "battle.skill",
        unitId: "pikeman-a",
        skillId: "power_shot"
      }
    ),
    {
      valid: false,
      reason: "skill_target_missing"
    }
  );

  const missingTargetState = cloneBattleState(cooldownState);
  missingTargetState.units["wolf-d"] = {
    ...missingTargetState.units["wolf-d"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(
    validateBattleAction(missingTargetState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "sundering_spear",
      targetId: "wolf-d"
    }),
    {
      valid: false,
      reason: "defender_not_available"
    }
  );

  const friendlyTargetState = cloneBattleState(cooldownState);
  friendlyTargetState.units["ally-a"] = {
    ...cloneBattleUnit(friendlyTargetState.units["pikeman-a"]!),
    id: "ally-a",
    stackName: "友军枪兵"
  };
  assert.deepEqual(
    validateBattleAction(friendlyTargetState, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "sundering_spear",
      targetId: "ally-a"
    }),
    {
      valid: false,
      reason: "friendly_fire_blocked"
    }
  );
});

test("validateBattleAction covers attack rejection branches", () => {
  const initial = createDemoBattleState();

  assert.deepEqual(
    validateBattleAction(initial, {
      type: "battle.attack",
      attackerId: "pikeman-a",
      defenderId: "wolf-d"
    }),
    {
      valid: false,
      reason: "attacker_not_active"
    }
  );

  const unavailableAttackerState = cloneBattleState(initial);
  unavailableAttackerState.units["wolf-d"] = {
    ...unavailableAttackerState.units["wolf-d"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(
    validateBattleAction(unavailableAttackerState, {
      type: "battle.attack",
      attackerId: "wolf-d",
      defenderId: "pikeman-a"
    }),
    {
      valid: false,
      reason: "attacker_not_available"
    }
  );

  const unavailableDefenderState = cloneBattleState(initial);
  unavailableDefenderState.units["pikeman-a"] = {
    ...unavailableDefenderState.units["pikeman-a"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(
    validateBattleAction(unavailableDefenderState, {
      type: "battle.attack",
      attackerId: "wolf-d",
      defenderId: "pikeman-a"
    }),
    {
      valid: false,
      reason: "defender_not_available"
    }
  );

  const friendlyAttackState = cloneBattleState(initial);
  friendlyAttackState.activeUnitId = "pikeman-a";
  friendlyAttackState.turnOrder = ["pikeman-a", "wolf-d"];
  friendlyAttackState.units["ally-a"] = {
    ...cloneBattleUnit(friendlyAttackState.units["pikeman-a"]!),
    id: "ally-a",
    stackName: "友军枪兵"
  };
  assert.deepEqual(
    validateBattleAction(friendlyAttackState, {
      type: "battle.attack",
      attackerId: "pikeman-a",
      defenderId: "ally-a"
    }),
    {
      valid: false,
      reason: "friendly_fire_blocked"
    }
  );

  const validAttackState = cloneBattleState(initial);
  assert.deepEqual(
    validateBattleAction(validAttackState, {
      type: "battle.attack",
      attackerId: "wolf-d",
      defenderId: "pikeman-a"
    }),
    {
      valid: true
    }
  );
});

test("applyBattleAction logs rejected actions without mutating battle flow", () => {
  const initial = createDemoBattleState();

  const next = applyBattleAction(initial, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  assert.equal(next.activeUnitId, initial.activeUnitId);
  assert.deepEqual(next.turnOrder, initial.turnOrder);
  assert.equal(next.log.at(-1), "Action rejected: attacker_not_active");
});

test("applyBattleAction resolves wait plus turn-start poison death and cooldown ticking", () => {
  const initial = createDemoBattleState();
  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a", "wolf-d"];
  initial.units["wolf-d"] = {
    ...initial.units["wolf-d"]!,
    count: 1,
    currentHp: 2,
    skills: initial.units["wolf-d"]!.skills?.map((skill) =>
      skill.id === "crippling_howl" ? { ...skill, remainingCooldown: 1 } : skill
    ),
    statusEffects: [
      {
        id: "poisoned",
        name: "中毒",
        description: "回合开始时损失生命。",
        durationRemaining: 1,
        attackModifier: 0,
        defenseModifier: 0,
        damagePerTurn: 2
      }
    ]
  };

  const next = applyBattleAction(initial, {
    type: "battle.wait",
    unitId: "pikeman-a"
  });

  assert.equal(next.activeUnitId, "pikeman-a");
  assert.deepEqual(next.turnOrder, ["pikeman-a"]);
  assert.equal(next.units["wolf-d"]?.count, 0);
  assert.equal(next.units["wolf-d"]?.currentHp, 0);
  assert.equal(next.units["wolf-d"]?.skills?.find((skill) => skill.id === "crippling_howl")?.remainingCooldown, 0);
  assert.deepEqual(next.units["wolf-d"]?.statusEffects, []);
  assert.deepEqual(next.log.slice(-2), ["pikeman-a 选择等待", "恶狼 受到中毒影响，损失 2 生命"]);
});

test("applyBattleAction advances into turn-start processing even when the next unit has no skills", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.units["wolf-d"] = {
    ...state.units["wolf-d"]!,
    skills: undefined
  };

  const next = applyBattleAction(state, {
    type: "battle.wait",
    unitId: "pikeman-a"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.deepEqual(next.units["wolf-d"]?.skills, []);
  assert.equal(next.log.at(-1), "pikeman-a 选择等待");
});

test("applyBattleAction defend refreshes the round and clears temporary flags", () => {
  const initial = createDemoBattleState();
  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a"];
  initial.units["pikeman-a"] = {
    ...initial.units["pikeman-a"]!,
    hasRetaliated: true,
    defending: true
  };
  initial.units["wolf-d"] = {
    ...initial.units["wolf-d"]!,
    hasRetaliated: true,
    defending: true
  };

  const next = applyBattleAction(initial, {
    type: "battle.defend",
    unitId: "pikeman-a"
  });

  assert.equal(next.round, 2);
  assert.equal(next.activeUnitId, "wolf-d");
  assert.deepEqual(next.turnOrder, ["wolf-d", "pikeman-a"]);
  assert.equal(next.units["pikeman-a"]?.hasRetaliated, false);
  assert.equal(next.units["wolf-d"]?.hasRetaliated, false);
  assert.equal(next.units["pikeman-a"]?.defending, false);
  assert.equal(next.units["wolf-d"]?.defending, false);
  assert.equal(next.log.at(-1), "pikeman-a 进入防御");
});

test("applyBattleAction refreshes explicit on-hit statuses instead of stacking them", () => {
  const initial = createDemoBattleState();
  initial.activeUnitId = "pikeman-a";
  initial.turnOrder = ["pikeman-a", "wolf-d"];
  initial.units["wolf-d"] = {
    ...initial.units["wolf-d"]!,
    statusEffects: [
      {
        id: "armor_break",
        name: "破甲",
        description: "短时间内护甲被撕裂，防御力下降。",
        durationRemaining: 1,
        attackModifier: 0,
        defenseModifier: -2,
        damagePerTurn: 0,
        sourceUnitId: "someone-else"
      }
    ]
  };

  const next = applyBattleAction(initial, {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "sundering_spear",
    targetId: "wolf-d"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.equal(next.units["wolf-d"]?.statusEffects?.length, 1);
  assert.equal(next.units["wolf-d"]?.statusEffects?.[0]?.id, "armor_break");
  assert.equal(next.units["wolf-d"]?.statusEffects?.[0]?.durationRemaining, 1);
  assert.equal(next.units["wolf-d"]?.statusEffects?.[0]?.sourceUnitId, "pikeman-a");
  assert.equal(next.units["wolf-d"]?.hasRetaliated, true);
  assert.equal(next.units["pikeman-a"]?.skills?.find((skill) => skill.id === "sundering_spear")?.remainingCooldown, 2);
  assert.match(next.log.join("\n"), /破甲投枪/);
  assert.match(next.log.join("\n"), /陷入破甲/);
});

test("applyBattleAction does not attach on-hit statuses to targets defeated by the strike", () => {
  const state = createDemoBattleState();
  state.units["pikeman-a"] = {
    ...state.units["pikeman-a"]!,
    count: 1,
    currentHp: 1,
    statusEffects: []
  };

  const next = applyBattleAction(state, {
    type: "battle.attack",
    attackerId: "wolf-d",
    defenderId: "pikeman-a"
  });

  assert.equal(next.units["pikeman-a"]?.count, 0);
  assert.equal(next.units["pikeman-a"]?.currentHp, 0);
  assert.deepEqual(next.units["pikeman-a"]?.statusEffects, []);
  assert.match(next.log.at(-1) ?? "", /造成 \d+ 伤害/);
});

test("pickAutomatedBattleAction falls back between buff, enemy skill, attack, and null states", () => {
  const buffedState = createDemoBattleState();
  buffedState.activeUnitId = "pikeman-a";
  buffedState.turnOrder = ["pikeman-a", "wolf-d"];
  buffedState.units["pikeman-a"] = {
    ...buffedState.units["pikeman-a"]!,
    statusEffects: [
      {
        id: "arcane_armor",
        name: "护甲术",
        description: "临时提升防御。",
        durationRemaining: 2,
        attackModifier: 0,
        defenseModifier: 3,
        damagePerTurn: 0
      },
      {
        id: "battle_frenzy",
        name: "战意激发",
        description: "短暂提升攻击。",
        durationRemaining: 2,
        attackModifier: 2,
        defenseModifier: 0,
        damagePerTurn: 0
      }
    ]
  };

  assert.deepEqual(pickAutomatedBattleAction(buffedState), {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "sundering_spear",
    targetId: "wolf-d"
  });

  buffedState.units["wolf-d"] = {
    ...buffedState.units["wolf-d"]!,
    statusEffects: [
      {
        id: "armor_break",
        name: "破甲",
        description: "短时间内护甲被撕裂，防御力下降。",
        durationRemaining: 2,
        attackModifier: 0,
        defenseModifier: -2,
        damagePerTurn: 0
      }
    ]
  };
  assert.deepEqual(pickAutomatedBattleAction(buffedState), {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "power_shot",
    targetId: "wolf-d"
  });

  const fallbackState = cloneBattleState(buffedState);
  fallbackState.units["pikeman-a"] = {
    ...fallbackState.units["pikeman-a"]!,
    skills: fallbackState.units["pikeman-a"]!.skills?.map((skill) => ({ ...skill, remainingCooldown: 1 }))
  };
  assert.deepEqual(pickAutomatedBattleAction(fallbackState), {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  const noEnemyState = cloneBattleState(fallbackState);
  noEnemyState.units["wolf-d"] = {
    ...noEnemyState.units["wolf-d"]!,
    count: 0,
    currentHp: 0
  };
  assert.equal(pickAutomatedBattleAction(noEnemyState), null);

  const noActiveState = cloneBattleState(fallbackState);
  noActiveState.activeUnitId = null;
  assert.equal(pickAutomatedBattleAction(noActiveState), null);
});

test("battle outcome helpers report in-progress and both victory states", () => {
  const inProgress = createDemoBattleState();
  assert.deepEqual(getBattleOutcome(inProgress), { status: "in_progress" });

  const attackerVictory = cloneBattleState(inProgress);
  attackerVictory.units["wolf-d"] = {
    ...attackerVictory.units["wolf-d"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(getBattleOutcome(attackerVictory), {
    status: "attacker_victory",
    survivingAttackers: ["pikeman-a"],
    survivingDefenders: []
  });

  const defenderVictory = cloneBattleState(inProgress);
  defenderVictory.units["pikeman-a"] = {
    ...defenderVictory.units["pikeman-a"]!,
    count: 0,
    currentHp: 0
  };
  assert.deepEqual(getBattleOutcome(defenderVictory), {
    status: "defender_victory",
    survivingAttackers: [],
    survivingDefenders: ["wolf-d"]
  });
});

test("createEmptyBattleState returns the minimal neutral battle shell", () => {
  assert.deepEqual(createEmptyBattleState(), {
    id: "battle-empty",
    round: 0,
    lanes: 1,
    activeUnitId: null,
    turnOrder: [],
    units: {},
    environment: [],
    log: [],
    rng: {
      seed: 1,
      cursor: 0
    }
  });
});

test("applyBattleAction routes contact attacks through blockers before hitting the target", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.environment = [
    {
      id: "hazard-blocker-0",
      kind: "blocker",
      lane: 0,
      name: "碎石路障",
      description: "近身接战前需要先破开这道障碍。",
      durability: 1,
      maxDurability: 1
    }
  ];

  const next = applyBattleAction(state, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.deepEqual(next.environment, []);
  assert.equal(next.units["wolf-d"]?.count, 8);
  assert.equal(next.units["wolf-d"]?.currentHp, 8);
  assert.deepEqual(next.log.slice(-2), [
    "枪兵 被 碎石路障 阻挡，只能先破开障碍",
    "碎石路障 被击碎，1 线重新打开"
  ]);
});

test("applyBattleAction triggers contact traps before the strike and logs granted statuses", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.units["wolf-d"] = {
    ...state.units["wolf-d"]!,
    hasRetaliated: true
  };
  state.environment = [
    {
      id: "hazard-trap-0",
      kind: "trap",
      lane: 0,
      name: "捕兽夹陷阱",
      description: "近身突进时会先被陷阱割伤并短暂削弱。",
      damage: 2,
      charges: 1,
      grantedStatusId: "weakened",
      triggeredByCamp: "both"
    }
  ];

  const next = applyBattleAction(state, {
    type: "battle.attack",
    attackerId: "pikeman-a",
    defenderId: "wolf-d"
  });

  assert.deepEqual(next.environment, []);
  assert.equal(next.units["pikeman-a"]?.currentHp, 8);
  assert.deepEqual(next.units["pikeman-a"]?.statusEffects?.map((status) => status.id), ["weakened"]);
  assert.deepEqual(next.log.slice(-3, -1), [
    "枪兵 触发 捕兽夹陷阱，损失 2 生命",
    "枪兵 因 捕兽夹陷阱 陷入削弱"
  ]);
  assert.match(next.log.at(-1) ?? "", /^枪兵 对 恶狼 造成 \d+ 伤害$/);
});

test("applyBattleAction lets ranged skills bypass blockers and traps", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-d"];
  state.environment = [
    {
      id: "hazard-blocker-0",
      kind: "blocker",
      lane: 0,
      name: "碎石路障",
      description: "近身接战前需要先破开这道障碍。",
      durability: 1,
      maxDurability: 1
    },
    {
      id: "hazard-trap-0",
      kind: "trap",
      lane: 0,
      name: "捕兽夹陷阱",
      description: "近身突进时会先被陷阱割伤并短暂削弱。",
      damage: 2,
      charges: 1,
      grantedStatusId: "weakened",
      triggeredByCamp: "both"
    }
  ];

  const next = applyBattleAction(state, {
    type: "battle.skill",
    unitId: "pikeman-a",
    skillId: "power_shot",
    targetId: "wolf-d"
  });

  assert.equal(next.units["pikeman-a"]?.currentHp, 10);
  assert.deepEqual(next.units["pikeman-a"]?.statusEffects, []);
  assert.deepEqual(next.environment, state.environment);
  assert.match(next.log.at(-1) ?? "", /^枪兵 施放 投矛射击，对 恶狼 造成 \d+ 伤害$/);
});

test("applyBattleAction supports self-target skills without granted statuses", () => {
  const customCatalog = getDefaultBattleSkillCatalog();
  customCatalog.skills.push({
    id: "steady_pose",
    name: "稳固架势",
    description: "稳住阵脚，为下一轮交换位置做准备。",
    kind: "active",
    target: "self",
    cooldown: 1,
    effects: {}
  });

  try {
    setBattleSkillCatalog(customCatalog);

    const state = createDemoBattleState();
    state.activeUnitId = "pikeman-a";
    state.turnOrder = ["pikeman-a", "wolf-d"];
    state.units["pikeman-a"] = {
      ...state.units["pikeman-a"]!,
      skills: [
        {
          id: "steady_pose",
          name: "稳固架势",
          description: "稳住阵脚，为下一轮交换位置做准备。",
          kind: "active",
          target: "self",
          cooldown: 1,
          remainingCooldown: 0
        }
      ],
      statusEffects: []
    };

    const next = applyBattleAction(state, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "steady_pose"
    });

    assert.equal(next.activeUnitId, "wolf-d");
    assert.equal(next.units["pikeman-a"]?.skills?.[0]?.remainingCooldown, 1);
    assert.deepEqual(next.units["pikeman-a"]?.statusEffects, []);
    assert.equal(next.log.at(-1), "枪兵 施放 稳固架势");
  } finally {
    resetRuntimeConfigs();
  }
});

test("pickAutomatedBattleAction returns null for an empty or dead active slot", () => {
  const deadActiveState = createDemoBattleState();
  deadActiveState.activeUnitId = "wolf-d";
  deadActiveState.units["wolf-d"] = {
    ...deadActiveState.units["wolf-d"]!,
    count: 0,
    currentHp: 0
  };
  assert.equal(pickAutomatedBattleAction(deadActiveState), null);
});

test("pickAutomatedBattleAction still scores enemy skills against low-count targets", () => {
  const state = createDemoBattleState();
  state.units["pikeman-a"] = {
    ...state.units["pikeman-a"]!,
    count: 2,
    currentHp: 7
  };

  assert.deepEqual(pickAutomatedBattleAction(state), {
    type: "battle.skill",
    unitId: "wolf-d",
    skillId: "crippling_howl",
    targetId: "pikeman-a"
  });
});

test("applyBattleAction skips dead queued units before handing control to the next live stack", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "wolf-dead", "wolf-d"];
  state.units["wolf-dead"] = {
    ...cloneBattleUnit(state.units["wolf-d"]!),
    id: "wolf-dead",
    count: 0,
    currentHp: 0
  };

  const next = applyBattleAction(state, {
    type: "battle.wait",
    unitId: "pikeman-a"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.deepEqual(next.turnOrder, ["wolf-d", "pikeman-a"]);
  assert.equal(next.log.at(-1), "pikeman-a 选择等待");
});

test("applyBattleAction skips missing queued units before handing control to the next live stack", () => {
  const state = createDemoBattleState();
  state.activeUnitId = "pikeman-a";
  state.turnOrder = ["pikeman-a", "missing-unit", "wolf-d"];

  const next = applyBattleAction(state, {
    type: "battle.wait",
    unitId: "pikeman-a"
  });

  assert.equal(next.activeUnitId, "wolf-d");
  assert.deepEqual(next.turnOrder, ["wolf-d", "pikeman-a"]);
  assert.equal(next.log.at(-1), "pikeman-a 选择等待");
});

test("createDemoBattleState throws when required demo templates are missing", () => {
  const customCatalog = getDefaultUnitCatalog();
  customCatalog.templates = customCatalog.templates.filter((template) => template.id !== "wolf_pack");

  try {
    setUnitCatalog(customCatalog);
    assert.throws(() => createDemoBattleState(), /Missing demo battle templates/);
  } finally {
    resetRuntimeConfigs();
  }
});

test("applyBattleAction describes granted statuses that have no numeric modifiers", () => {
  const customCatalog = getDefaultBattleSkillCatalog();
  customCatalog.statuses.push({
    id: "blank_status",
    name: "空白姿态",
    description: "只有持续时间，不带任何数值变化。",
    duration: 1,
    attackModifier: 0,
    defenseModifier: 0,
    damagePerTurn: 0
  });
  customCatalog.skills.push({
    id: "blank_pose",
    name: "空白姿态",
    description: "测试 granted status 的空词条描述。",
    kind: "active",
    target: "self",
    cooldown: 1,
    effects: {
      grantedStatusId: "blank_status"
    }
  });

  try {
    setBattleSkillCatalog(customCatalog);

    const state = createDemoBattleState();
    state.activeUnitId = "pikeman-a";
    state.turnOrder = ["pikeman-a", "wolf-d"];
    state.units["pikeman-a"] = {
      ...state.units["pikeman-a"]!,
      skills: [
        {
          id: "blank_pose",
          name: "空白姿态",
          description: "测试 granted status 的空词条描述。",
          kind: "active",
          target: "self",
          cooldown: 1,
          remainingCooldown: 0
        }
      ],
      statusEffects: []
    };

    const next = applyBattleAction(state, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "blank_pose"
    });

    assert.equal(next.units["pikeman-a"]?.statusEffects?.[0]?.id, "blank_status");
    assert.equal(next.log.at(-1), "枪兵 施放 空白姿态，获得 空白姿态");
  } finally {
    resetRuntimeConfigs();
  }
});

test("applyBattleAction describes granted statuses with negative attack and damage-over-time effects", () => {
  const customCatalog = getDefaultBattleSkillCatalog();
  customCatalog.statuses.push({
    id: "withering_brand",
    name: "枯萎烙印",
    description: "会削弱攻击并附带持续伤害。",
    duration: 2,
    attackModifier: -1,
    defenseModifier: 0,
    damagePerTurn: 3
  });
  customCatalog.skills.push({
    id: "withering_mark",
    name: "枯萎烙印",
    description: "测试 granted status 的负攻击和持续伤害描述。",
    kind: "active",
    target: "self",
    cooldown: 2,
    effects: {
      grantedStatusId: "withering_brand"
    }
  });

  try {
    setBattleSkillCatalog(customCatalog);

    const state = createDemoBattleState();
    state.activeUnitId = "pikeman-a";
    state.turnOrder = ["pikeman-a", "wolf-d"];
    state.units["pikeman-a"] = {
      ...state.units["pikeman-a"]!,
      skills: [
        {
          id: "withering_mark",
          name: "枯萎烙印",
          description: "测试 granted status 的负攻击和持续伤害描述。",
          kind: "active",
          target: "self",
          cooldown: 2,
          remainingCooldown: 0
        }
      ],
      statusEffects: []
    };

    const next = applyBattleAction(state, {
      type: "battle.skill",
      unitId: "pikeman-a",
      skillId: "withering_mark"
    });

    assert.equal(next.units["pikeman-a"]?.statusEffects?.[0]?.id, "withering_brand");
    assert.equal(next.log.at(-1), "枪兵 施放 枯萎烙印，获得 枯萎烙印（-1 攻击，每回合 3 持续伤害）");
  } finally {
    resetRuntimeConfigs();
  }
});

test("battle state builders carry stats, metadata, and missing-template guards", () => {
  const attackerHero = createHero({
    id: "hero-a",
    playerId: "player-1",
    name: "凯琳",
    stats: {
      attack: 3,
      defense: 2,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    armyCount: 15
  });
  const defenderHero = createHero({
    id: "hero-b",
    playerId: "player-2",
    name: "罗安",
    position: { x: 4, y: 2 },
    stats: {
      attack: 1,
      defense: 4,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    armyCount: 11
  });
  const neutralArmy: NeutralArmyState = {
    id: "neutral-2",
    position: { x: 6, y: 3 },
    reward: { kind: "ore", amount: 4 },
    stacks: [{ templateId: "wolf_pack", count: 5 }]
  };

  const neutralBattle = createNeutralBattleState(attackerHero, neutralArmy, 2027);
  assert.equal(neutralBattle.worldHeroId, "hero-a");
  assert.equal(neutralBattle.neutralArmyId, "neutral-2");
  assert.deepEqual(neutralBattle.encounterPosition, { x: 6, y: 3 });
  assert.equal(neutralBattle.lanes, 1);
  assert.equal(neutralBattle.units["hero-a-stack"]?.attack, 7);
  assert.equal(neutralBattle.units["hero-a-stack"]?.defense, 6);
  assert.equal(neutralBattle.units["hero-a-stack"]?.count, 15);
  assert.equal(neutralBattle.units["hero-a-stack"]?.lane, 0);
  assert.equal(neutralBattle.units["neutral-2-stack-1"]?.count, 5);
  assert.equal(neutralBattle.units["neutral-2-stack-1"]?.lane, 0);
  assert.equal(neutralBattle.environment.every((hazard) => hazard.lane < neutralBattle.lanes), true);

  const heroBattle = createHeroBattleState(attackerHero, defenderHero, 2028);
  assert.equal(heroBattle.worldHeroId, "hero-a");
  assert.equal(heroBattle.defenderHeroId, "hero-b");
  assert.deepEqual(heroBattle.encounterPosition, { x: 4, y: 2 });
  assert.equal(heroBattle.lanes, 1);
  assert.equal(heroBattle.units["hero-a-stack"]?.attack, 7);
  assert.equal(heroBattle.units["hero-a-stack"]?.lane, 0);
  assert.equal(heroBattle.units["hero-b-stack"]?.defense, 8);
  assert.equal(heroBattle.units["hero-b-stack"]?.lane, 0);
  assert.equal(heroBattle.environment.every((hazard) => hazard.lane < heroBattle.lanes), true);

  assert.throws(
    () =>
      createNeutralBattleState(
        {
          ...attackerHero,
          armyTemplateId: "missing-template"
        },
        neutralArmy,
        2029
      ),
    /Missing hero army template/
  );
  assert.throws(
    () =>
      createNeutralBattleState(
        attackerHero,
        {
          ...neutralArmy,
          stacks: [{ templateId: "missing-template", count: 5 }]
        },
        2030
      ),
    /Missing neutral unit template/
  );
  assert.throws(
    () =>
      createHeroBattleState(
        {
          ...attackerHero,
          armyTemplateId: "missing-template"
        },
        defenderHero,
        2031
      ),
    /Missing hero army template for PvP battle/
  );
  assert.throws(
    () =>
      createHeroBattleState(
        attackerHero,
        {
          ...defenderHero,
          armyTemplateId: "missing-template"
        },
        2032
      ),
    /Missing hero army template for PvP battle/
  );
});

test("applyBattleAction throws for stale battle skills that no longer exist in runtime config", () => {
  const customCatalog = getDefaultBattleSkillCatalog();
  customCatalog.skills.push({
    id: "obsolete_shot",
    name: "旧式射击",
    description: "用于模拟运行时配置变更后的陈旧战斗数据。",
    kind: "active",
    target: "enemy",
    cooldown: 1,
    effects: {
      damageMultiplier: 1
    }
  });

  try {
    setBattleSkillCatalog(customCatalog);

    const staleState = createDemoBattleState();
    staleState.activeUnitId = "pikeman-a";
    staleState.turnOrder = ["pikeman-a", "wolf-d"];
    staleState.units["pikeman-a"] = {
      ...staleState.units["pikeman-a"]!,
      skills: [
        {
          id: "obsolete_shot",
          name: "旧式射击",
          description: "用于模拟运行时配置变更后的陈旧战斗数据。",
          kind: "active",
          target: "enemy",
          cooldown: 1,
          remainingCooldown: 0
        }
      ]
    };

    resetRuntimeConfigs();

    assert.throws(
      () =>
        applyBattleAction(staleState, {
          type: "battle.skill",
          unitId: "pikeman-a",
          skillId: "obsolete_shot",
          targetId: "wolf-d"
        }),
      /Missing battle skill definition: obsolete_shot/
    );
  } finally {
    resetRuntimeConfigs();
  }
});

test("applyBattleAction returns the normalized state for unknown runtime action types", () => {
  const state = createDemoBattleState();
  state.units["pikeman-a"] = {
    ...state.units["pikeman-a"]!,
    skills: undefined,
    statusEffects: undefined
  };

  const next = applyBattleAction(
    state,
    {
      type: "battle.unknown",
      attackerId: "wolf-d",
      defenderId: "pikeman-a"
    } as unknown as import("../src/index").BattleAction
  );

  assert.deepEqual(next.units["pikeman-a"]?.skills, []);
  assert.deepEqual(next.units["pikeman-a"]?.statusEffects, []);
  assert.deepEqual(next.log, state.log);
});
