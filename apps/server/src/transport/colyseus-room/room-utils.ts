import type { Client as ColyseusClient } from "colyseus";
import { DEFAULT_MIN_SUPPORTED_CLIENT_VERSION, normalizeClientVersion } from "@veil/shared/platform";
import type { ServerMessage, SessionStatePayload } from "@veil/shared/protocol";
import { resolveMinimumSupportedClientVersion } from "@server/domain/battle/feature-flags";
import type { RoomPersistenceSnapshot } from "@server/index";
import type { RoomSnapshotStore } from "@server/persistence";
import type { MessageOfType } from "@server/transport/colyseus-room/types";
import { DEFAULT_PLAYER_SLOT_ID, MAP_SYNC_CHUNK_PADDING, MAP_SYNC_CHUNK_SIZE } from "@server/transport/colyseus-room/constants";

export function hasPlayerReportStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "createPlayerReport">> {
  return Boolean(store?.createPlayerReport);
}

export function hasBattleSnapshotStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore &
  Required<
    Pick<
      RoomSnapshotStore,
      "saveBattleSnapshotStart" | "saveBattleSnapshotResolution" | "settleInterruptedBattleSnapshot" | "listBattleSnapshotsForPlayer"
    >
  > {
  return Boolean(
    store?.saveBattleSnapshotStart &&
      store.saveBattleSnapshotResolution &&
      store.settleInterruptedBattleSnapshot &&
      store.listBattleSnapshotsForPlayer
  );
}
export function readMinimumSupportedClientVersion(
  channel: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    resolveMinimumSupportedClientVersion(channel, env) ??
    normalizeClientVersion(env.MIN_SUPPORTED_CLIENT_VERSION) ??
    DEFAULT_MIN_SUPPORTED_CLIENT_VERSION
  );
}

export function sendMessage<T extends ServerMessage["type"]>(
  client: ColyseusClient,
  type: T,
  payload: MessageOfType<T>
): void {
  client.send(type, payload);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function compareDefaultPlayerSlotIds(left: string, right: string): number {
  const leftMatch = DEFAULT_PLAYER_SLOT_ID.exec(left);
  const rightMatch = DEFAULT_PLAYER_SLOT_ID.exec(right);
  if (!leftMatch || !rightMatch) {
    return left.localeCompare(right);
  }

  return Number(leftMatch[1]) - Number(rightMatch[1]) || left.localeCompare(right);
}

export function isDefaultPlayerSlotId(playerId: string): boolean {
  return DEFAULT_PLAYER_SLOT_ID.test(playerId);
}

export function cloneResourceLedger(ledger?: { gold: number; wood: number; ore: number }): { gold: number; wood: number; ore: number } {
  return {
    gold: ledger?.gold ?? 0,
    wood: ledger?.wood ?? 0,
    ore: ledger?.ore ?? 0
  };
}

export function rebindWorldStatePlayerId(
  state: RoomPersistenceSnapshot["state"],
  previousPlayerId: string,
  nextPlayerId: string
): RoomPersistenceSnapshot["state"] {
  if (previousPlayerId === nextPlayerId) {
    return state;
  }

  const nextHeroes = state.heroes.map((hero) =>
    hero.playerId === previousPlayerId
      ? {
          ...hero,
          playerId: nextPlayerId
        }
      : hero
  );

  const nextResources = { ...state.resources };
  nextResources[nextPlayerId] = cloneResourceLedger(nextResources[nextPlayerId] ?? nextResources[previousPlayerId]);
  delete nextResources[previousPlayerId];

  const nextVisibilityByPlayer = { ...state.visibilityByPlayer };
  if (nextVisibilityByPlayer[previousPlayerId]) {
    nextVisibilityByPlayer[nextPlayerId] = [...nextVisibilityByPlayer[previousPlayerId]!];
    delete nextVisibilityByPlayer[previousPlayerId];
  }

  const nextAfkStrikes = state.afkStrikes ? { ...state.afkStrikes } : undefined;
  if (nextAfkStrikes?.[previousPlayerId] != null) {
    nextAfkStrikes[nextPlayerId] = nextAfkStrikes[previousPlayerId]!;
    delete nextAfkStrikes[previousPlayerId];
  }

  return {
    ...state,
    heroes: nextHeroes,
    resources: nextResources,
    visibilityByPlayer: nextVisibilityByPlayer,
    ...(nextAfkStrikes ? { afkStrikes: nextAfkStrikes } : {})
  };
}

export function resolveFocusedMapBounds(world: SessionStatePayload["world"]): { x: number; y: number; width: number; height: number } | null {
  if (world.map.width <= MAP_SYNC_CHUNK_SIZE && world.map.height <= MAP_SYNC_CHUNK_SIZE) {
    return null;
  }

  if (world.ownHeroes.length === 0) {
    return null;
  }

  const chunkXs = world.ownHeroes.map((hero) => Math.floor(hero.position.x / MAP_SYNC_CHUNK_SIZE));
  const chunkYs = world.ownHeroes.map((hero) => Math.floor(hero.position.y / MAP_SYNC_CHUNK_SIZE));
  const maxChunkX = Math.max(0, Math.ceil(world.map.width / MAP_SYNC_CHUNK_SIZE) - 1);
  const maxChunkY = Math.max(0, Math.ceil(world.map.height / MAP_SYNC_CHUNK_SIZE) - 1);
  const minChunkX = clamp(Math.min(...chunkXs) - MAP_SYNC_CHUNK_PADDING, 0, maxChunkX);
  const maxFocusedChunkX = clamp(Math.max(...chunkXs) + MAP_SYNC_CHUNK_PADDING, 0, maxChunkX);
  const minChunkY = clamp(Math.min(...chunkYs) - MAP_SYNC_CHUNK_PADDING, 0, maxChunkY);
  const maxFocusedChunkY = clamp(Math.max(...chunkYs) + MAP_SYNC_CHUNK_PADDING, 0, maxChunkY);
  const x = minChunkX * MAP_SYNC_CHUNK_SIZE;
  const y = minChunkY * MAP_SYNC_CHUNK_SIZE;

  return {
    x,
    y,
    width: Math.min(world.map.width - x, (maxFocusedChunkX - minChunkX + 1) * MAP_SYNC_CHUNK_SIZE),
    height: Math.min(world.map.height - y, (maxFocusedChunkY - minChunkY + 1) * MAP_SYNC_CHUNK_SIZE)
  };
}

