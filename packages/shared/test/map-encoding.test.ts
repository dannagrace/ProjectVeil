import assert from "node:assert/strict";
import test from "node:test";

import { decodeBufferToMap, encodeMapToBuffer, type TileState, type WorldMapState } from "../src/index.ts";

function createTile(
  x: number,
  y: number,
  options?: {
    walkable?: boolean;
    terrain?: TileState["terrain"];
    resource?: TileState["resource"];
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

function createLargeWorldMapState(): WorldMapState {
  const width = 32;
  const height = 32;
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const terrain = (["grass", "dirt", "sand", "water", "swamp"] as const)[(x + y) % 5] ?? "grass";

    return createTile(x, y, {
      terrain,
      walkable: terrain !== "water",
      ...(index % 53 === 0 ? { resource: { kind: "wood", amount: 5 } } : {}),
      ...(index % 97 === 0 ? { occupant: { kind: "neutral", refId: `neutral-${index}` } } : {}),
      ...(index % 149 === 0
        ? {
            building: {
              id: `watchtower-${index}`,
              kind: "watchtower",
              position: { x, y },
              label: `Watchtower ${index}`,
              visionBonus: 2,
              tier: 1
            }
          }
        : {})
    });
  });

  return {
    width,
    height,
    tiles
  };
}

test("world map typed-array buffer round-trips and normalizes tile ordering by position", () => {
  const map: WorldMapState = {
    width: 3,
    height: 2,
    tiles: [
      createTile(2, 1, {
        terrain: "swamp",
        walkable: true,
        occupant: { kind: "hero", refId: "hero-1" }
      }),
      createTile(0, 0, {
        terrain: "grass",
        walkable: true,
        resource: { kind: "gold", amount: 100 }
      }),
      createTile(1, 0, {
        terrain: "water",
        walkable: false
      }),
      createTile(2, 0, {
        terrain: "sand",
        walkable: true
      }),
      createTile(0, 1, {
        terrain: "dirt",
        walkable: true,
        building: {
          id: "watchtower-1",
          kind: "watchtower",
          position: { x: 0, y: 1 },
          label: "North Watch",
          visionBonus: 2,
          tier: 1
        }
      }),
      createTile(1, 1, {
        terrain: "grass",
        walkable: false
      })
    ]
  };

  const decoded = decodeBufferToMap(encodeMapToBuffer(map));

  assert.deepEqual(decoded, {
    width: 3,
    height: 2,
    tiles: [
      map.tiles[1],
      map.tiles[2],
      map.tiles[3],
      map.tiles[4],
      map.tiles[5],
      map.tiles[0]
    ]
  });
});

test("world map typed-array buffer stays within twenty percent of JSON snapshot size for a sparse 32x32 map", () => {
  const map = createLargeWorldMapState();
  const encoded = encodeMapToBuffer(map);
  const jsonSize = Buffer.byteLength(JSON.stringify(map), "utf8");

  assert.ok(jsonSize > 0);
  assert.ok(encoded.byteLength / jsonSize <= 0.2, `${encoded.byteLength} should be <= 20% of ${jsonSize}`);
  assert.deepEqual(decodeBufferToMap(encoded), map);
});
