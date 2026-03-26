import type {
  FogState,
  OccupantState,
  PlayerBuildingView,
  PlayerTileView,
  PlayerWorldView,
  ResourceNode
} from "./models";

export interface EncodedPlayerMapOverlay {
  index: number;
  resource?: ResourceNode;
  occupant?: OccupantState;
  building?: PlayerBuildingView;
}

export interface EncodedPlayerMapTiles {
  format: "typed-array-v1";
  terrain: string;
  fog: string;
  walkable: string;
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

const TERRAIN_CODES: Record<PlayerTileView["terrain"], number> = {
  grass: 0,
  dirt: 1,
  sand: 2,
  water: 3,
  unknown: 4
};

const TERRAIN_VALUES: PlayerTileView["terrain"][] = ["grass", "dirt", "sand", "water", "unknown"];
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

export function encodePlayerWorldView(view: PlayerWorldView): PlayerWorldViewPayload {
  const tileCount = view.map.tiles.length;
  const terrain = new Uint8Array(tileCount);
  const fog = new Uint8Array(tileCount);
  const walkable = new Uint8Array(tileCount);
  const overlays: EncodedPlayerMapOverlay[] = [];

  for (let index = 0; index < tileCount; index += 1) {
    const tile = view.map.tiles[index]!;
    terrain[index] = TERRAIN_CODES[tile.terrain];
    fog[index] = FOG_CODES[tile.fog];
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

  return {
    ...view,
    map: {
      width: view.map.width,
      height: view.map.height,
      encodedTiles: {
        format: "typed-array-v1",
        terrain: encodeBase64(terrain),
        fog: encodeBase64(fog),
        walkable: encodeBase64(walkable),
        overlays
      }
    }
  };
}

export function decodePlayerWorldView(view: PlayerWorldView | PlayerWorldViewPayload): PlayerWorldView {
  if ("tiles" in view.map && Array.isArray(view.map.tiles)) {
    return view as PlayerWorldView;
  }

  const encoded = "encodedTiles" in view.map ? view.map.encodedTiles : undefined;
  if (!encoded || encoded.format !== "typed-array-v1") {
    throw new Error("unsupported_player_world_view_encoding");
  }

  const terrain = decodeBase64(encoded.terrain);
  const fog = decodeBase64(encoded.fog);
  const walkable = decodeBase64(encoded.walkable);
  const tileCount = view.map.width * view.map.height;

  if (terrain.length !== tileCount || fog.length !== tileCount || walkable.length !== tileCount) {
    throw new Error("invalid_player_world_view_encoding_length");
  }

  const overlaysByIndex = new Map<number, EncodedPlayerMapOverlay>(
    encoded.overlays.map((overlay: EncodedPlayerMapOverlay) => [overlay.index, overlay] as const)
  );
  const tiles: PlayerTileView[] = Array.from({ length: tileCount }, (_, index) => {
    const overlay = overlaysByIndex.get(index);
    return {
      position: {
        x: index % view.map.width,
        y: Math.floor(index / view.map.width)
      },
      fog: FOG_VALUES[fog[index]!] ?? "hidden",
      terrain: TERRAIN_VALUES[terrain[index]!] ?? "unknown",
      walkable: walkable[index] === 1,
      resource: overlay?.resource,
      occupant: overlay?.occupant,
      building: overlay?.building
    };
  });

  return {
    ...view,
    map: {
      width: view.map.width,
      height: view.map.height,
      tiles
    }
  };
}
