import type {
  FogState,
  OccupantState,
  PlayerBuildingView,
  PlayerTileView,
  PlayerWorldView,
  ResourceNode
} from "./models.ts";

export interface EncodedPlayerMapOverlay {
  index: number;
  resource?: ResourceNode;
  occupant?: OccupantState;
  building?: PlayerBuildingView;
}

export interface EncodedPlayerMapBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EncodedPlayerMapTiles {
  format: "typed-array-v1";
  bounds: EncodedPlayerMapBounds;
  terrain: string | Uint8Array;
  fog: string | Uint8Array;
  walkable: string | Uint8Array;
  overlays: EncodedPlayerMapOverlay[];
}

export interface PlayerWorldViewPayload extends Omit<PlayerWorldView, "map"> {
  map: {
    width: number;
    height: number;
    tiles?: PlayerTileView[];
    encodedTiles?: EncodedPlayerMapTiles;
  };
}

export interface EncodePlayerWorldViewOptions {
  bounds?: Partial<EncodedPlayerMapBounds>;
  binary?: boolean;
}

const TERRAIN_CODES: Record<PlayerTileView["terrain"], number> = {
  grass: 0,
  dirt: 1,
  sand: 2,
  water: 3,
  swamp: 4,
  unknown: 5
};

const TERRAIN_VALUES: PlayerTileView["terrain"][] = ["grass", "dirt", "sand", "water", "swamp", "unknown"];
const FOG_CODES: Record<FogState, number> = {
  hidden: 0,
  explored: 1,
  visible: 2
};
const FOG_VALUES: FogState[] = ["hidden", "explored", "visible"];

function encodeBase64(bytes: Uint8Array): string {
  if ("Buffer" in globalThis && typeof globalThis.Buffer !== "undefined") {
    return globalThis.Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

function decodeBase64(encoded: string): Uint8Array {
  if ("Buffer" in globalThis && typeof globalThis.Buffer !== "undefined") {
    return new Uint8Array(globalThis.Buffer.from(encoded, "base64"));
  }

  const binary = globalThis.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function resolveEncodedBytes(encoded: string | Uint8Array): Uint8Array {
  return typeof encoded === "string" ? decodeBase64(encoded) : encoded;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveBounds(view: PlayerWorldView, bounds?: Partial<EncodedPlayerMapBounds>): EncodedPlayerMapBounds {
  const x = clamp(Math.floor(bounds?.x ?? 0), 0, Math.max(0, view.map.width - 1));
  const y = clamp(Math.floor(bounds?.y ?? 0), 0, Math.max(0, view.map.height - 1));
  const maxWidth = view.map.width - x;
  const maxHeight = view.map.height - y;
  const width = clamp(Math.floor(bounds?.width ?? maxWidth), 1, maxWidth);
  const height = clamp(Math.floor(bounds?.height ?? maxHeight), 1, maxHeight);

  return { x, y, width, height };
}

function tileIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

function createPatchedTile(
  view: PlayerWorldViewPayload | PlayerWorldView,
  bounds: EncodedPlayerMapBounds,
  localIndex: number,
  terrainCode: number,
  fogCode: number,
  walkableCode: number,
  overlay?: EncodedPlayerMapOverlay
): PlayerTileView {
  const localX = localIndex % bounds.width;
  const localY = Math.floor(localIndex / bounds.width);

  return {
    position: {
      x: bounds.x + localX,
      y: bounds.y + localY
    },
    fog: FOG_VALUES[fogCode] ?? "hidden",
    terrain: TERRAIN_VALUES[terrainCode] ?? "unknown",
    walkable: walkableCode === 1,
    resource: overlay?.resource,
    occupant: overlay?.occupant,
    building: overlay?.building
  };
}

export function encodePlayerWorldView(
  view: PlayerWorldView,
  options?: EncodePlayerWorldViewOptions
): PlayerWorldViewPayload {
  const bounds = resolveBounds(view, options?.bounds);
  const tileCount = bounds.width * bounds.height;
  const terrain = new Uint8Array(tileCount);
  const fog = new Uint8Array(tileCount);
  const walkable = new Uint8Array(tileCount);
  const overlays: EncodedPlayerMapOverlay[] = [];

  let localIndex = 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const tile = view.map.tiles[tileIndex(view.map.width, x, y)]!;
      terrain[localIndex] = TERRAIN_CODES[tile.terrain];
      fog[localIndex] = FOG_CODES[tile.fog];
      walkable[localIndex] = tile.walkable ? 1 : 0;

      if (tile.resource || tile.occupant || tile.building) {
        overlays.push({
          index: localIndex,
          ...(tile.resource ? { resource: tile.resource } : {}),
          ...(tile.occupant ? { occupant: tile.occupant } : {}),
          ...(tile.building ? { building: tile.building } : {})
        });
      }

      localIndex += 1;
    }
  }

  return {
    ...view,
    map: {
      width: view.map.width,
      height: view.map.height,
      encodedTiles: {
        format: "typed-array-v1",
        bounds,
        terrain: options?.binary ? terrain : encodeBase64(terrain),
        fog: options?.binary ? fog : encodeBase64(fog),
        walkable: options?.binary ? walkable : encodeBase64(walkable),
        overlays
      }
    }
  };
}

export function decodePlayerWorldView(
  view: PlayerWorldView | PlayerWorldViewPayload,
  baseView?: PlayerWorldView | null
): PlayerWorldView {
  if ("tiles" in view.map && Array.isArray(view.map.tiles)) {
    return view as PlayerWorldView;
  }

  const encoded = "encodedTiles" in view.map ? view.map.encodedTiles : undefined;
  if (!encoded || encoded.format !== "typed-array-v1") {
    throw new Error("unsupported_player_world_view_encoding");
  }

  const terrain = resolveEncodedBytes(encoded.terrain);
  const fog = resolveEncodedBytes(encoded.fog);
  const walkable = resolveEncodedBytes(encoded.walkable);
  const bounds = encoded.bounds ?? {
    x: 0,
    y: 0,
    width: view.map.width,
    height: view.map.height
  };
  const tileCount = bounds.width * bounds.height;

  if (terrain.length !== tileCount || fog.length !== tileCount || walkable.length !== tileCount) {
    throw new Error("invalid_player_world_view_encoding_length");
  }

  const isFullMap =
    bounds.x === 0 && bounds.y === 0 && bounds.width === view.map.width && bounds.height === view.map.height;
  const overlaysByIndex = new Map<number, EncodedPlayerMapOverlay>(
    encoded.overlays.map((overlay: EncodedPlayerMapOverlay) => [overlay.index, overlay] as const)
  );
  const tiles: PlayerTileView[] = isFullMap
    ? Array.from({ length: tileCount }, (_, index) =>
        createPatchedTile(view, bounds, index, terrain[index]!, fog[index]!, walkable[index]!, overlaysByIndex.get(index))
      )
    : (() => {
        if (!baseView || baseView.map.width !== view.map.width || baseView.map.height !== view.map.height) {
          throw new Error("missing_player_world_view_base");
        }

        const nextTiles = baseView.map.tiles.map((tile) => ({ ...tile, position: { ...tile.position } }));
        for (let index = 0; index < tileCount; index += 1) {
          const nextTile = createPatchedTile(
            view,
            bounds,
            index,
            terrain[index]!,
            fog[index]!,
            walkable[index]!,
            overlaysByIndex.get(index)
          );
          nextTiles[tileIndex(view.map.width, nextTile.position.x, nextTile.position.y)] = nextTile;
        }

        return nextTiles;
      })();

  return {
    ...view,
    map: {
      width: view.map.width,
      height: view.map.height,
      tiles
    }
  };
}
