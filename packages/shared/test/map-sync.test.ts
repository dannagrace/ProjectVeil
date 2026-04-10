import assert from "node:assert/strict";
import test from "node:test";

import type { PlayerTileView, PlayerWorldView } from "../src/index.ts";
import { decodePlayerWorldView, encodePlayerWorldView } from "../src/index.ts";

function createTile(
  x: number,
  y: number,
  options?: Partial<Omit<PlayerTileView, "position">>
): PlayerTileView {
  return {
    position: { x, y },
    fog: options?.fog ?? "visible",
    terrain: options?.terrain ?? "grass",
    walkable: options?.walkable ?? true,
    resource: options?.resource,
    occupant: options?.occupant,
    building: options?.building
  };
}

function createView(tiles: PlayerTileView[]): PlayerWorldView {
  return {
    meta: {
      roomId: "room-1",
      seed: 7,
      day: 3
    },
    turnDeadlineAt: "2026-04-10T00:00:00.000Z",
    map: {
      width: 3,
      height: 2,
      tiles
    },
    ownHeroes: [],
    visibleHeroes: [],
    resources: {
      gold: 100,
      wood: 20,
      ore: 5
    },
    playerId: "player-1"
  };
}

function sanitizeTile(tile: PlayerTileView): PlayerTileView {
  if (tile.fog === "hidden") {
    return {
      position: tile.position,
      fog: "hidden",
      terrain: "unknown",
      walkable: false,
      resource: undefined,
      occupant: undefined,
      building: undefined
    };
  }

  if (tile.fog === "explored") {
    return {
      position: tile.position,
      fog: "explored",
      terrain: tile.terrain,
      walkable: tile.walkable,
      resource: undefined,
      occupant: undefined,
      building: tile.building
    };
  }

  return tile;
}

function sanitizeView(view: PlayerWorldView): PlayerWorldView {
  return {
    ...view,
    map: {
      ...view.map,
      tiles: view.map.tiles.map((tile) => sanitizeTile(tile))
    }
  };
}

test("encodePlayerWorldView base64-encodes sanitized tiles and decodePlayerWorldView restores them", () => {
  const view = createView([
    createTile(0, 0, {
      fog: "hidden",
      terrain: "water",
      walkable: true,
      resource: { kind: "gold", amount: 99 },
      occupant: { kind: "hero", refId: "hero-hidden" },
      building: {
        id: "mine-hidden",
        kind: "resource_mine",
        label: "Hidden Mine",
        resourceKind: "gold",
        income: 5,
        tier: 1
      }
    }),
    createTile(1, 0, {
      fog: "explored",
      terrain: "sand",
      walkable: false,
      resource: { kind: "wood", amount: 3 },
      occupant: { kind: "neutral", refId: "neutral-1" },
      building: {
        id: "tower-1",
        kind: "watchtower",
        label: "South Watch",
        visionBonus: 2,
        tier: 1
      }
    }),
    createTile(2, 0, {
      fog: "visible",
      terrain: "swamp",
      walkable: true,
      resource: { kind: "ore", amount: 4 },
      occupant: { kind: "hero", refId: "hero-2" }
    }),
    createTile(0, 1, {
      fog: "visible",
      terrain: "grass",
      walkable: true
    }),
    createTile(1, 1, {
      fog: "visible",
      terrain: "dirt",
      walkable: false,
      building: {
        id: "shrine-1",
        kind: "attribute_shrine",
        label: "Ancient Shrine",
        bonus: {
          attack: 1,
          defense: 0,
          power: 0,
          knowledge: 0
        },
        tier: 2
      }
    }),
    createTile(2, 1, {
      fog: "visible",
      terrain: "water",
      walkable: false
    })
  ]);

  const encoded = encodePlayerWorldView(view);

  assert.ok(encoded.map.encodedTiles);
  assert.equal(encoded.map.encodedTiles?.format, "typed-array-v1");
  assert.equal(typeof encoded.map.encodedTiles?.terrain, "string");
  assert.equal(typeof encoded.map.encodedTiles?.fog, "string");
  assert.equal(typeof encoded.map.encodedTiles?.walkable, "string");
  assert.deepEqual(encoded.map.encodedTiles?.bounds, {
    x: 0,
    y: 0,
    width: 3,
    height: 2
  });
  assert.deepEqual(
    encoded.map.encodedTiles?.overlays.map((overlay) => ({
      index: overlay.index,
      hasResource: Boolean(overlay.resource),
      hasOccupant: Boolean(overlay.occupant),
      hasBuilding: Boolean(overlay.building)
    })),
    [
      { index: 1, hasResource: false, hasOccupant: false, hasBuilding: true },
      { index: 2, hasResource: true, hasOccupant: true, hasBuilding: false },
      { index: 4, hasResource: false, hasOccupant: false, hasBuilding: true }
    ]
  );

  assert.deepEqual(decodePlayerWorldView(encoded), sanitizeView(view));
});

test("encodePlayerWorldView supports binary partial patches and decodePlayerWorldView applies them on top of a base view", () => {
  const baseView = createView([
    createTile(0, 0, { fog: "visible", terrain: "grass", walkable: true }),
    createTile(1, 0, { fog: "visible", terrain: "grass", walkable: true }),
    createTile(2, 0, { fog: "visible", terrain: "sand", walkable: true }),
    createTile(0, 1, { fog: "visible", terrain: "dirt", walkable: true }),
    createTile(1, 1, { fog: "visible", terrain: "grass", walkable: true }),
    createTile(2, 1, { fog: "visible", terrain: "swamp", walkable: true })
  ]);
  const nextView = createView([
    baseView.map.tiles[0]!,
    createTile(1, 0, {
      fog: "explored",
      terrain: "sand",
      walkable: false,
      resource: { kind: "wood", amount: 8 },
      occupant: { kind: "neutral", refId: "neutral-2" },
      building: {
        id: "tower-2",
        kind: "watchtower",
        label: "West Watch",
        visionBonus: 3,
        tier: 2
      }
    }),
    createTile(2, 0, {
      fog: "visible",
      terrain: "water",
      walkable: false,
      occupant: { kind: "hero", refId: "hero-3" }
    }),
    baseView.map.tiles[3]!,
    baseView.map.tiles[4]!,
    baseView.map.tiles[5]!
  ]);

  const encodedPatch = encodePlayerWorldView(nextView, {
    bounds: { x: 1, y: 0, width: 2, height: 1 },
    binary: true
  });

  assert.ok(encodedPatch.map.encodedTiles);
  assert.ok(encodedPatch.map.encodedTiles?.terrain instanceof Uint8Array);
  assert.ok(encodedPatch.map.encodedTiles?.fog instanceof Uint8Array);
  assert.ok(encodedPatch.map.encodedTiles?.walkable instanceof Uint8Array);
  assert.deepEqual(encodedPatch.map.encodedTiles?.bounds, {
    x: 1,
    y: 0,
    width: 2,
    height: 1
  });

  assert.deepEqual(decodePlayerWorldView(encodedPatch, baseView), sanitizeView(nextView));
});

test("decodePlayerWorldView returns an already-decoded world view unchanged", () => {
  const view = createView([
    createTile(0, 0),
    createTile(1, 0),
    createTile(2, 0),
    createTile(0, 1),
    createTile(1, 1),
    createTile(2, 1)
  ]);

  assert.strictEqual(decodePlayerWorldView(view), view);
});

test("decodePlayerWorldView throws for unsupported encodings", () => {
  const view = createView([
    createTile(0, 0),
    createTile(1, 0),
    createTile(2, 0),
    createTile(0, 1),
    createTile(1, 1),
    createTile(2, 1)
  ]);
  const encoded = encodePlayerWorldView(view);

  assert.throws(
    () =>
      decodePlayerWorldView({
        ...encoded,
        map: {
          width: encoded.map.width,
          height: encoded.map.height
        }
      }),
    /unsupported_player_world_view_encoding/
  );

  assert.throws(
    () =>
      decodePlayerWorldView({
        ...encoded,
        map: {
          ...encoded.map,
          encodedTiles: {
            ...encoded.map.encodedTiles!,
            format: "legacy-v0" as "typed-array-v1"
          }
        }
      }),
    /unsupported_player_world_view_encoding/
  );
});

test("decodePlayerWorldView throws for invalid encoded array lengths", () => {
  const view = createView([
    createTile(0, 0),
    createTile(1, 0),
    createTile(2, 0),
    createTile(0, 1),
    createTile(1, 1),
    createTile(2, 1)
  ]);
  const encoded = encodePlayerWorldView(view, { binary: true });

  assert.throws(
    () =>
      decodePlayerWorldView({
        ...encoded,
        map: {
          ...encoded.map,
          encodedTiles: {
            ...encoded.map.encodedTiles!,
            terrain: new Uint8Array([0, 1, 2])
          }
        }
      }),
    /invalid_player_world_view_encoding_length/
  );
});

test("decodePlayerWorldView throws when a partial patch is missing a compatible base view", () => {
  const view = createView([
    createTile(0, 0),
    createTile(1, 0),
    createTile(2, 0),
    createTile(0, 1),
    createTile(1, 1),
    createTile(2, 1)
  ]);
  const encodedPatch = encodePlayerWorldView(view, {
    bounds: { x: 1, y: 0, width: 2, height: 1 },
    binary: true
  });
  const incompatibleBase = {
    ...view,
    map: {
      width: 2,
      height: 2,
      tiles: view.map.tiles.slice(0, 4)
    }
  };

  assert.throws(() => decodePlayerWorldView(encodedPatch), /missing_player_world_view_base/);
  assert.throws(() => decodePlayerWorldView(encodedPatch, incompatibleBase), /missing_player_world_view_base/);
});
