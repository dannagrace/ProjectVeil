import type {
  MapBuildingState,
  OccupantState,
  PlayerTileView,
  TileState,
  Vec2,
  WorldMapState
} from "../models.ts";

export interface EncodedWorldMapOverlay {
  index: number;
  resource?: TileState["resource"];
  occupant?: OccupantState;
  building?: MapBuildingState;
}

const MAP_ENCODING_MAGIC = "PVM1";
const MAP_ENCODING_VERSION = 1;
const MAP_ENCODING_HEADER_BYTES = 13;
const TERRAIN_CODES: Record<TileState["terrain"], number> = {
  grass: 0,
  dirt: 1,
  sand: 2,
  water: 3,
  swamp: 4
};
const TERRAIN_VALUES: TileState["terrain"][] = ["grass", "dirt", "sand", "water", "swamp"];
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function samePosition(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clonePosition(position: Vec2): Vec2 {
  return {
    x: position.x,
    y: position.y
  };
}

export function orderTiles(map: WorldMapState): TileState[] {
  const expectedTileCount = map.width * map.height;
  if (map.tiles.length !== expectedTileCount) {
    throw new Error("invalid_world_map_tile_count");
  }

  const orderedTiles = new Array<TileState>(expectedTileCount);
  for (const tile of map.tiles) {
    if (!inBounds(map, tile.position)) {
      throw new Error("invalid_world_map_tile_position");
    }

    const index = tileIndex(map, tile.position);
    if (orderedTiles[index]) {
      throw new Error("duplicate_world_map_tile_position");
    }

    orderedTiles[index] = tile;
  }

  if (orderedTiles.some((tile) => !tile)) {
    throw new Error("incomplete_world_map_tiles");
  }

  return orderedTiles;
}
function parseEncodedWorldMapOverlays(bytes: Uint8Array): EncodedWorldMapOverlay[] {
  if (bytes.length === 0) {
    return [];
  }

  const decoded = JSON.parse(textDecoder.decode(bytes));
  if (!Array.isArray(decoded)) {
    throw new Error("invalid_world_map_overlay_payload");
  }

  return decoded as EncodedWorldMapOverlay[];
}
export function encodeMapToBuffer(map: WorldMapState): Uint8Array {
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width <= 0 || map.height <= 0) {
    throw new Error("invalid_world_map_dimensions");
  }

  if (map.width > 0xffff || map.height > 0xffff) {
    throw new Error("world_map_dimensions_exceed_uint16");
  }

  const orderedTiles = orderTiles(map);
  const tileCount = orderedTiles.length;
  const terrain = new Uint8Array(tileCount);
  const walkable = new Uint8Array(tileCount);
  const overlays: EncodedWorldMapOverlay[] = [];

  for (let index = 0; index < tileCount; index += 1) {
    const tile = orderedTiles[index]!;
    terrain[index] = TERRAIN_CODES[tile.terrain];
    walkable[index] = tile.walkable ? 1 : 0;

    if (tile.resource || tile.occupant || tile.building) {
      overlays.push({
        index,
        ...(tile.resource ? { resource: tile.resource } : {}),
        ...(tile.occupant ? { occupant: tile.occupant } : {}),
        ...(tile.building ? { building: tile.building } : {})
      });
    }
  }

  const overlayBytes = textEncoder.encode(JSON.stringify(overlays));
  const buffer = new Uint8Array(MAP_ENCODING_HEADER_BYTES + terrain.length + walkable.length + overlayBytes.length);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  for (let index = 0; index < MAP_ENCODING_MAGIC.length; index += 1) {
    buffer[index] = MAP_ENCODING_MAGIC.charCodeAt(index);
  }

  view.setUint8(4, MAP_ENCODING_VERSION);
  view.setUint16(5, map.width, true);
  view.setUint16(7, map.height, true);
  view.setUint32(9, overlayBytes.length, true);
  buffer.set(terrain, MAP_ENCODING_HEADER_BYTES);
  buffer.set(walkable, MAP_ENCODING_HEADER_BYTES + terrain.length);
  buffer.set(overlayBytes, MAP_ENCODING_HEADER_BYTES + terrain.length + walkable.length);

  return buffer;
}

export function decodeBufferToMap(buffer: Uint8Array): WorldMapState {
  if (buffer.byteLength < MAP_ENCODING_HEADER_BYTES) {
    throw new Error("invalid_world_map_buffer");
  }

  for (let index = 0; index < MAP_ENCODING_MAGIC.length; index += 1) {
    if (buffer[index] !== MAP_ENCODING_MAGIC.charCodeAt(index)) {
      throw new Error("invalid_world_map_magic");
    }
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint8(4) !== MAP_ENCODING_VERSION) {
    throw new Error("unsupported_world_map_encoding_version");
  }

  const width = view.getUint16(5, true);
  const height = view.getUint16(7, true);
  const overlayLength = view.getUint32(9, true);
  const tileCount = width * height;
  const expectedLength = MAP_ENCODING_HEADER_BYTES + tileCount * 2 + overlayLength;

  if (buffer.byteLength !== expectedLength) {
    throw new Error("invalid_world_map_buffer_length");
  }

  const terrainStart = MAP_ENCODING_HEADER_BYTES;
  const walkableStart = terrainStart + tileCount;
  const overlayStart = walkableStart + tileCount;
  const terrain = buffer.subarray(terrainStart, walkableStart);
  const walkable = buffer.subarray(walkableStart, overlayStart);
  const overlays = parseEncodedWorldMapOverlays(buffer.subarray(overlayStart, overlayStart + overlayLength));
  const tiles: TileState[] = Array.from({ length: tileCount }, (_, index): TileState => {
    const terrainValue = TERRAIN_VALUES[terrain[index]!];
    if (!terrainValue) {
      throw new Error("invalid_world_map_terrain_code");
    }

    return {
      position: {
        x: index % width,
        y: Math.floor(index / width)
      },
      terrain: terrainValue,
      walkable: walkable[index] === 1,
      resource: undefined,
      occupant: undefined,
      building: undefined
    };
  });

  for (const overlay of overlays) {
    if (!Number.isInteger(overlay.index) || overlay.index < 0 || overlay.index >= tileCount) {
      throw new Error("invalid_world_map_overlay_index");
    }

    tiles[overlay.index] = {
      ...tiles[overlay.index]!,
      resource: overlay.resource,
      occupant: overlay.occupant,
      building: overlay.building
    };
  }

  return {
    width,
    height,
    tiles
  };
}
export function distance(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function inBounds(map: WorldMapState, position: Vec2): boolean {
  return position.x >= 0 && position.y >= 0 && position.x < map.width && position.y < map.height;
}

export function tileKey(position: Vec2): string {
  return `${position.x},${position.y}`;
}

export function tileIndex(map: WorldMapState, position: Vec2): number {
  return position.y * map.width + position.x;
}
export function isTraversableTile(
  tile: Pick<TileState, "walkable" | "terrain"> | Pick<PlayerTileView, "walkable" | "terrain">,
  canFlyOverWater: boolean
): boolean {
  return tile.walkable || (canFlyOverWater && tile.terrain === "water");
}

export function terrainMoveCost(terrain: TileState["terrain"] | PlayerTileView["terrain"]): number {
  return terrain === "swamp" ? 2 : 1;
}
export function findTile(map: WorldMapState, position: Vec2): TileState | undefined {
  if (!inBounds(map, position)) {
    return undefined;
  }

  return map.tiles[tileIndex(map, position)];
}
export function getNeighbors(map: WorldMapState, position: Vec2): Vec2[] {
  const candidates = [
    { x: position.x + 1, y: position.y },
    { x: position.x - 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x, y: position.y - 1 }
  ];

  return candidates.filter((item) => inBounds(map, item));
}
