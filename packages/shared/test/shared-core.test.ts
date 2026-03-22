import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBattleAction,
  applyBattleOutcomeToWorld,
  createDemoBattleState,
  createDefaultHeroProgression,
  createPlayerWorldView,
  filterWorldEventsForPlayer,
  planPlayerViewMovement,
  predictPlayerWorldAction,
  resolveWorldAction,
  type BattleOutcome,
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
  }
): TileState {
  return {
    position: { x, y },
    terrain: options?.terrain ?? "grass",
    walkable: options?.walkable ?? true,
    resource: options?.resource,
    occupant: options?.occupant
  };
}

function createWorldState(options?: {
  width?: number;
  height?: number;
  tiles?: TileState[];
  heroes?: HeroState[];
  neutralArmies?: Record<string, NeutralArmyState>;
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

test("filterWorldEventsForPlayer hides unrelated hero timelines but keeps both sides of PvP encounters", () => {
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
      type: "turn.advanced" as const,
      day: 2
    }
  ];

  assert.deepEqual(filterWorldEventsForPlayer(state, "player-1", events), [
    events[0],
    events[2],
    events[3],
    events[4]
  ]);
  assert.deepEqual(filterWorldEventsForPlayer(state, "player-2", events), [events[2], events[3], events[4]]);
  assert.deepEqual(filterWorldEventsForPlayer(state, "player-3", events), [events[1], events[4]]);
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
  assert.equal(next.units["pikeman-a"]?.currentHp, 3);
  assert.equal(next.units["pikeman-a"]?.hasRetaliated, true);
  assert.equal(next.units["wolf-d"]?.count, 6);
  assert.equal(next.units["wolf-d"]?.currentHp, 6);
  assert.deepEqual(next.log.slice(-2), [
    "恶狼 对 枪兵 造成 27 伤害",
    "枪兵 反击 恶狼，造成 18 伤害"
  ]);
});
