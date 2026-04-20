import { configureConfigRuntimeStatusProvider } from "@server/config-center";
import {
  sendWechatSubscribeMessage
} from "@server/adapters/wechat-subscribe";
import { sendMobilePushNotification } from "@server/adapters/mobile-push";
import type { RoomSnapshotStore } from "@server/persistence";
import type { VeilColyseusRoom } from "@server/transport/colyseus-room/VeilColyseusRoom";
import type {
  LobbyRoomSummary,
  RoomRuntimeDependencies,
  RoomTimerHandle
} from "@server/transport/colyseus-room/types";
import { ZOMBIE_ROOM_CLEANUP_INTERVAL_MS } from "@server/transport/colyseus-room/constants";
import {
  formatBackgroundTaskDetail,
  reportBackgroundTaskFailure
} from "@server/transport/colyseus-room/error-reporting";

export let configuredRoomSnapshotStore: RoomSnapshotStore | null = null;
export const lobbyRoomSummaries = new Map<string, LobbyRoomSummary>();
export const lobbyRoomOwnerTokens = new Map<string, number>();
export const activeRoomInstances = new Map<string, VeilColyseusRoom>();
export let nextLobbyRoomOwnerToken = 1;
export function advanceLobbyRoomOwnerToken(): number {
  nextLobbyRoomOwnerToken += 1;
  return nextLobbyRoomOwnerToken;
}
export let zombieRoomCleanupHandle: RoomTimerHandle | null = null;

configureConfigRuntimeStatusProvider(() => {
  const rooms = Array.from(activeRoomInstances.values())
    .map((room) => ({
      roomId: room.roomId,
      activeBattles: room.worldRoom?.getActiveBattles().length ?? 0
    }))
    .filter((room) => room.activeBattles > 0);

  return {
    rooms,
    activeBattleCount: rooms.reduce((sum, room) => sum + room.activeBattles, 0)
  };
});

const defaultRoomRuntimeDependencies: RoomRuntimeDependencies = {
  setInterval: (handler, delayMs) => globalThis.setInterval(handler, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
  isMySqlSnapshotStore: (store) => Boolean(store && "getRetentionPolicy" in store),
  now: () => Date.now(),
  sendWechatSubscribeMessage: (playerId, templateKey, data, options) =>
    sendWechatSubscribeMessage(playerId, templateKey, data, options),
  sendMobilePushNotification: (playerId, templateKey, data, options) =>
    sendMobilePushNotification(playerId, templateKey, data, options)
};

export let roomRuntimeDependencies: RoomRuntimeDependencies = defaultRoomRuntimeDependencies;

export function configureRoomSnapshotStore(store: RoomSnapshotStore | null): void {
  configuredRoomSnapshotStore = store;
}

export function configureRoomRuntimeDependencies(overrides: Partial<RoomRuntimeDependencies>): void {
  roomRuntimeDependencies = {
    ...roomRuntimeDependencies,
    ...overrides
  };
}

export function resetRoomRuntimeDependencies(): void {
  if (zombieRoomCleanupHandle) {
    roomRuntimeDependencies.clearInterval(zombieRoomCleanupHandle);
    zombieRoomCleanupHandle = null;
  }
  roomRuntimeDependencies = defaultRoomRuntimeDependencies;
}

export function listLobbyRooms(): LobbyRoomSummary[] {
  return Array.from(lobbyRoomSummaries.values()).sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.roomId.localeCompare(right.roomId)
  );
}

export function resetLobbyRoomRegistry(): void {
  lobbyRoomSummaries.clear();
  lobbyRoomOwnerTokens.clear();
  if (zombieRoomCleanupHandle) {
    roomRuntimeDependencies.clearInterval(zombieRoomCleanupHandle);
    zombieRoomCleanupHandle = null;
  }
}

export function getActiveRoomInstances(): Map<string, VeilColyseusRoom> {
  return activeRoomInstances;
}

export async function runZombieRoomCleanup(now = roomRuntimeDependencies.now()): Promise<void> {
  for (const room of Array.from(activeRoomInstances.values())) {
    try {
      await room.runExpiredEmptyRoomCleanup(now);
    } catch (error) {
      const roomState = room.worldRoom.getInternalState();
      reportBackgroundTaskFailure({
        taskType: "zombie_room_cleanup",
        errorCode: "zombie_room_cleanup_tick_failed",
        message: "Background zombie-room cleanup tick failed.",
        logMessage: "[VeilRoom] Zombie room cleanup failed",
        error,
        roomId: room.roomId,
        roomDay: roomState.meta.day,
        detail: formatBackgroundTaskDetail("zombie_room_cleanup", error, {
          activeBattles: room.worldRoom.getActiveBattles().length,
          connectedPlayers: room.clients.length
        })
      });
    }
  }
}

export function ensureZombieRoomCleanupLoop(): void {
  if (zombieRoomCleanupHandle) {
    return;
  }

  zombieRoomCleanupHandle = roomRuntimeDependencies.setInterval(() => {
    void runZombieRoomCleanup().catch((error) => {
      console.error("[VeilRoom] Zombie room cleanup failed", { error });
    });
  }, ZOMBIE_ROOM_CLEANUP_INTERVAL_MS);
  zombieRoomCleanupHandle.unref?.();
}
