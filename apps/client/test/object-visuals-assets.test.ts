import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerTileView, PlayerWorldView } from "../../../packages/shared/src/index";
import {
  assetManifestEntry,
  buildingAsset,
  markerAsset,
  objectBadgeAssets,
  resourceAsset,
  terrainAsset
} from "../src/assets";
import { describeTileObject } from "../src/object-visuals";
import { renderWorldState } from "../src/renderers";

function createTile(overrides: Partial<PlayerTileView> = {}): PlayerTileView {
  return {
    position: { x: 0, y: 0 },
    fog: "visible",
    terrain: "grass",
    walkable: true,
    resource: undefined,
    occupant: undefined,
    building: undefined,
    ...overrides
  };
}

function createWorld(overrides: Partial<PlayerWorldView> = {}): PlayerWorldView {
  return {
    meta: {
      roomId: "room-alpha",
      seed: 1001,
      day: 3
    },
    map: {
      width: 2,
      height: 2,
      tiles: [
        createTile({
          position: { x: 0, y: 0 },
          resource: { kind: "gold", amount: 500 }
        }),
        createTile({
          position: { x: 1, y: 0 },
          occupant: { kind: "neutral", refId: "neutral-1" }
        }),
        createTile({
          position: { x: 0, y: 1 },
          terrain: "sand"
        }),
        createTile({
          position: { x: 1, y: 1 },
          terrain: "water",
          walkable: false,
          fog: "hidden"
        })
      ]
    },
    ownHeroes: [
      {
        id: "hero-1",
        playerId: "player-1",
        name: "凯琳",
        position: { x: 0, y: 0 },
        vision: 4,
        move: { total: 6, remaining: 4 },
        stats: {
          attack: 2,
          defense: 1,
          power: 1,
          knowledge: 0,
          hp: 30,
          maxHp: 30
        },
        progression: {
          level: 2,
          experience: 120,
          skillPoints: 1,
          battlesWon: 2,
          neutralBattlesWon: 2,
          pvpBattlesWon: 0
        },
        loadout: {
          learnedSkills: [],
          equipment: {
            trinketIds: []
          },
          inventory: []
        },
        armyCount: 14,
        armyTemplateId: "hero_guard_basic",
        learnedSkills: []
      }
    ],
    visibleHeroes: [{ id: "hero-2", playerId: "player-2", name: "敌方先锋", position: { x: 1, y: 0 } }],
    resources: {
      gold: 150,
      wood: 10,
      ore: 4
    },
    playerId: "player-1",
    ...overrides
  };
}

test("renderWorldState keeps world text output stable for visible resources, blockers, and fog", () => {
  assert.equal(
    renderWorldState(createWorld()),
    [
      "Room: room-alpha",
      "Day: 3",
      "Own Heroes:",
      "凯琳 HP:30/30 MOV:4/6",
      "Visible Enemies:",
      "敌方先锋 @ (1,0)",
      "",
      "G(gold:500)G[M]     ",
      "S        ?        "
    ].join("\n")
  );
});

test("describeTileObject maps a resource mine through assets, badges, and manifest metadata", () => {
  const descriptor = describeTileObject(
    createTile({
      position: { x: 2, y: 1 },
      building: {
        id: "mine-1",
        kind: "resource_mine",
        label: "",
        resourceKind: "gold",
        income: 250
      }
    })
  );

  assert.deepEqual(descriptor, {
    title: "资源矿场",
    subtitle: "占领后会在每日推进时自动产出资源。当前无人占领。",
    value: "金币 +250/天",
    icon: "/assets/pixel/buildings/resource-mine.png",
    faction: "crown",
    rarity: "elite",
    interactionType: "move"
  });
  assert.deepEqual(objectBadgeAssets(descriptor), {
    faction: "/assets/pixel/badges/faction-crown.png",
    rarity: "/assets/pixel/badges/rarity-elite.png",
    interaction: "/assets/pixel/badges/interaction-move.png"
  });
  assert.deepEqual(assetManifestEntry(descriptor?.icon ?? ""), {
    slot: "building.resource_mine",
    stage: "production",
    source: "generated"
  });
});

test("asset helpers fall back predictably for unknown asset or config keys", () => {
  assert.equal(buildingAsset("missing-building"), null);
  assert.equal(resourceAsset("missing-resource"), null);
  assert.equal(assetManifestEntry("/assets/pixel/buildings/missing.png"), null);
  assert.equal(terrainAsset("missing-terrain", 9, 4), "/assets/pixel/terrain/fog-tile.png");
  assert.equal(markerAsset("hero", "selected"), "/assets/pixel/markers/hero-marker-selected.png");
  assert.deepEqual(objectBadgeAssets({ faction: "void", rarity: "mythic", interactionType: "teleport" }), {
    faction: null,
    rarity: null,
    interaction: null
  });
});
