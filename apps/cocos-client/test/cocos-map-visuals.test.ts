import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFogOverlayStyle,
  buildMapFeedbackEntriesFromUpdate,
  buildObjectPulseEntriesFromUpdate,
  createTileLookup,
  fogEdgeGidForTile,
  fogEdgeMarkerForTile,
  resolveFogEdgePulseGid,
  resolveFogPulseGid
} from "../assets/scripts/cocos-map-visuals";
import type { PlayerTileView, SessionUpdate } from "../assets/scripts/VeilCocosSession";

function createTile(position: { x: number; y: number }, fog: PlayerTileView["fog"]): PlayerTileView {
  return {
    position,
    fog,
    terrain: "grass",
    walkable: true,
    resource: undefined,
    occupant: undefined,
    building: undefined
  };
}

function createBaseUpdate(): SessionUpdate {
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
        tiles: []
      },
      ownHeroes: [
        {
          id: "hero-1",
          playerId: "player-1",
          name: "Katherine",
          position: { x: 1, y: 1 },
          vision: 4,
          move: {
            total: 6,
            remaining: 4
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
            level: 2,
            experience: 40,
            battlesWon: 1,
            neutralBattlesWon: 1,
            pvpBattlesWon: 0
          },
          armyCount: 11,
          armyTemplateId: "hero_guard_basic"
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
    events: [],
    movementPlan: null,
    reachableTiles: []
  };
}

test("fog edge helpers expose hidden and explored frontier masks", () => {
  const tiles = [
    createTile({ x: 1, y: 1 }, "hidden"),
    createTile({ x: 1, y: 0 }, "visible"),
    createTile({ x: 2, y: 1 }, "explored"),
    createTile({ x: 1, y: 2 }, "hidden"),
    createTile({ x: 0, y: 1 }, "hidden"),
    createTile({ x: 2, y: 0 }, "visible")
  ];
  const lookup = createTileLookup(tiles);

  assert.equal(
    fogEdgeGidForTile(tiles[0]!, lookup, {
      hiddenFogEdgeBaseGid: 100,
      exploredFogEdgeBaseGid: 200
    }),
    102
  );
  assert.equal(fogEdgeMarkerForTile(tiles[0]!, lookup), "~");
  assert.equal(fogEdgeMarkerForTile(tiles[0]!, lookup, 1), "^");
  assert.equal(
    fogEdgeGidForTile(tiles[2]!, lookup, {
      hiddenFogEdgeBaseGid: 100,
      exploredFogEdgeBaseGid: 200
    }),
    200
  );
  assert.equal(fogEdgeMarkerForTile(tiles[2]!, lookup), ":");
  assert.equal(fogEdgeMarkerForTile(tiles[2]!, lookup, 1), ";");
});

test("fog pulse helpers switch to alternate gids on odd phases only", () => {
  assert.equal(resolveFogPulseGid(10, 12, 0), 10);
  assert.equal(resolveFogPulseGid(10, 12, 1), 12);
  assert.equal(resolveFogPulseGid(10, 0, 1), 10);

  assert.equal(resolveFogEdgePulseGid(100, 16, 0), 100);
  assert.equal(resolveFogEdgePulseGid(100, 16, 1), 116);
  assert.equal(resolveFogEdgePulseGid(0, 16, 1), 0);
});

test("buildFogOverlayStyle emits quiet overlay chrome for hidden and explored fog", () => {
  const tiles = [
    createTile({ x: 1, y: 1 }, "hidden"),
    createTile({ x: 1, y: 0 }, "visible"),
    createTile({ x: 2, y: 1 }, "explored"),
    createTile({ x: 2, y: 0 }, "visible"),
    createTile({ x: 0, y: 0 }, "visible")
  ];
  const lookup = createTileLookup(tiles);

  assert.deepEqual(buildFogOverlayStyle(tiles[0]!, lookup, 0), {
    text: "",
    opacity: 192,
    edgeOpacity: 78,
    labelOpacity: 0,
    tone: "hidden",
    featherMask: 3
  });
  assert.deepEqual(buildFogOverlayStyle(tiles[0]!, lookup, 1), {
    text: "",
    opacity: 176,
    edgeOpacity: 62,
    labelOpacity: 0,
    tone: "hidden",
    featherMask: 3
  });
  assert.deepEqual(buildFogOverlayStyle(tiles[2]!, lookup, 0), {
    text: "",
    opacity: 92,
    edgeOpacity: 34,
    labelOpacity: 0,
    tone: "explored",
    featherMask: 1
  });
  assert.deepEqual(buildFogOverlayStyle(tiles[2]!, lookup, 1), {
    text: "",
    opacity: 78,
    edgeOpacity: 24,
    labelOpacity: 0,
    tone: "explored",
    featherMask: 1
  });
  assert.equal(buildFogOverlayStyle(tiles[4]!, lookup, 0), null);
});

test("buildFogOverlayStyle keeps interior fog tiles alpha-blended even without a frontier", () => {
  const hiddenTiles = [
    createTile({ x: 0, y: 0 }, "hidden"),
    createTile({ x: 1, y: 0 }, "hidden"),
    createTile({ x: 0, y: 1 }, "hidden"),
    createTile({ x: 1, y: 1 }, "hidden")
  ];
  const exploredTiles = [
    createTile({ x: 0, y: 0 }, "explored"),
    createTile({ x: 1, y: 0 }, "explored"),
    createTile({ x: 0, y: 1 }, "explored"),
    createTile({ x: 1, y: 1 }, "explored")
  ];

  assert.deepEqual(buildFogOverlayStyle(hiddenTiles[0]!, createTileLookup(hiddenTiles), 0), {
    text: "",
    opacity: 220,
    edgeOpacity: 198,
    labelOpacity: 0,
    tone: "hidden",
    featherMask: 0
  });
  assert.deepEqual(buildFogOverlayStyle(exploredTiles[2]!, createTileLookup(exploredTiles), 0), {
    text: "",
    opacity: 108,
    edgeOpacity: 82,
    labelOpacity: 0,
    tone: "explored",
    featherMask: 0
  });
});

test("buildMapFeedbackEntriesFromUpdate creates tile callouts for move, collect, xp and battle results", () => {
  const update = createBaseUpdate();
  update.world.map.tiles = [
    createTile({ x: 0, y: 0 }, "visible"),
    createTile({ x: 1, y: 0 }, "visible"),
    createTile({ x: 0, y: 1 }, "visible"),
    {
      ...createTile({ x: 1, y: 1 }, "visible"),
      building: {
        id: "mine-1",
        kind: "resource_mine",
        label: "前线伐木场",
        resourceKind: "wood",
        income: 2,
        ownerPlayerId: "player-1"
      }
    }
  ];
  update.events = [
    {
      type: "hero.moved",
      heroId: "hero-1",
      path: [{ x: 0, y: 1 }, { x: 1, y: 1 }],
      moveCost: 1
    },
    {
      type: "hero.collected",
      heroId: "hero-1",
      resource: {
        kind: "wood",
        amount: 5
      }
    },
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
    },
    {
      type: "hero.visited",
      heroId: "hero-1",
      buildingId: "shrine-1",
      buildingKind: "attribute_shrine",
      bonus: {
        attack: 1,
        defense: 0,
        power: 0,
        knowledge: 0
      }
    },
    {
      type: "hero.claimedMine",
      heroId: "hero-1",
      buildingId: "mine-1",
      buildingKind: "resource_mine",
      resourceKind: "wood",
      income: 2,
      ownerPlayerId: "player-1"
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
    },
    {
      type: "hero.progressed",
      heroId: "hero-1",
      battleId: "battle-1",
      battleKind: "neutral",
      experienceGained: 20,
      totalExperience: 60,
      level: 3,
      levelsGained: 1
    },
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      battleId: "battle-1",
      path: [{ x: 0, y: 1 }, { x: 1, y: 1 }],
      moveCost: 1
    },
    {
      type: "battle.resolved",
      heroId: "hero-1",
      battleId: "battle-1",
      result: "attacker_victory"
    }
  ];

  assert.deepEqual(buildMapFeedbackEntriesFromUpdate(update, "hero-1"), [
    {
      position: { x: 1, y: 1 },
      text: "MOVE 1",
      durationSeconds: 0.7
    },
    {
      position: { x: 1, y: 1 },
      text: "+WOOD",
      durationSeconds: 0.85
    },
    {
      position: { x: 1, y: 1 },
      text: "+4",
      durationSeconds: 0.9
    },
    {
      position: { x: 1, y: 1 },
      text: "+ATK",
      durationSeconds: 0.92
    },
    {
      position: { x: 1, y: 1 },
      text: "MINE",
      durationSeconds: 0.94
    },
    {
      position: { x: 1, y: 1 },
      text: "+WOOD",
      durationSeconds: 0.9
    },
    {
      position: { x: 1, y: 1 },
      text: "LV 3",
      durationSeconds: 1
    },
    {
      position: { x: 1, y: 1 },
      text: "PVE",
      durationSeconds: 0.95
    },
    {
      position: { x: 1, y: 1 },
      text: "VICTORY",
      durationSeconds: 1.1
    }
  ]);
});

test("buildObjectPulseEntriesFromUpdate emits bounce targets for collection and encounters", () => {
  const update = createBaseUpdate();
  update.world.map.tiles = [
    createTile({ x: 0, y: 0 }, "visible"),
    createTile({ x: 1, y: 0 }, "visible"),
    createTile({ x: 0, y: 1 }, "visible"),
    {
      ...createTile({ x: 1, y: 1 }, "visible"),
      building: {
        id: "mine-1",
        kind: "resource_mine",
        label: "前线伐木场",
        resourceKind: "wood",
        income: 2,
        ownerPlayerId: "player-1"
      }
    }
  ];
  update.events = [
    {
      type: "hero.collected",
      heroId: "hero-1",
      resource: {
        kind: "wood",
        amount: 5
      }
    },
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
    },
    {
      type: "hero.visited",
      heroId: "hero-1",
      buildingId: "shrine-1",
      buildingKind: "attribute_shrine",
      bonus: {
        attack: 1,
        defense: 0,
        power: 0,
        knowledge: 0
      }
    },
    {
      type: "hero.claimedMine",
      heroId: "hero-1",
      buildingId: "mine-1",
      buildingKind: "resource_mine",
      resourceKind: "wood",
      income: 2,
      ownerPlayerId: "player-1"
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
    },
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      battleId: "battle-1",
      path: [{ x: 0, y: 1 }, { x: 1, y: 1 }],
      moveCost: 1
    }
  ];

  assert.deepEqual(buildObjectPulseEntriesFromUpdate(update, "hero-1"), [
    {
      position: { x: 1, y: 1 },
      scale: 1.18,
      durationSeconds: 0.24
    },
    {
      position: { x: 1, y: 1 },
      scale: 1.2,
      durationSeconds: 0.26
    },
    {
      position: { x: 1, y: 1 },
      scale: 1.22,
      durationSeconds: 0.28
    },
    {
      position: { x: 1, y: 1 },
      scale: 1.2,
      durationSeconds: 0.27
    },
    {
      position: { x: 1, y: 1 },
      scale: 1.16,
      durationSeconds: 0.25
    },
    {
      position: { x: 1, y: 1 },
      scale: 1.14,
      durationSeconds: 0.22
    }
  ]);
});

test("neutral movement feedback uses destination callouts and chase pulses", () => {
  const update = createBaseUpdate();
  update.events = [
    {
      type: "neutral.moved",
      neutralArmyId: "neutral-1",
      from: { x: 2, y: 1 },
      to: { x: 1, y: 1 },
      reason: "chase",
      targetHeroId: "hero-1"
    }
  ];

  assert.deepEqual(buildMapFeedbackEntriesFromUpdate(update, "hero-1"), [
    {
      position: { x: 1, y: 1 },
      text: "CHASE",
      durationSeconds: 0.88
    }
  ]);
  assert.deepEqual(buildObjectPulseEntriesFromUpdate(update, "hero-1"), [
    {
      position: { x: 1, y: 1 },
      scale: 1.18,
      durationSeconds: 0.24
    }
  ]);
});
