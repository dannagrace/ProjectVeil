import { configureConfigRuntimeStatusProvider } from "@server/domain/config-center/runtime";
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
import type { RedisClientLike } from "@server/infra/redis";

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

export interface LobbyRoomSummaryStore {
  upsert(summary: LobbyRoomSummary): Promise<void>;
  delete(roomId: string): Promise<void>;
  list(): Promise<LobbyRoomSummary[]>;
}

export interface RedisLobbyRoomSummaryStoreOptions {
  keyPrefix?: string;
  ttlSeconds?: number;
}

const LOBBY_ROOM_SUMMARY_REDIS_PREFIX = "veil:lobby-room-summary:";
const LOBBY_ROOM_SUMMARY_TTL_SECONDS = 60;
const LOBBY_ROOM_SUMMARY_HASH_SUFFIX = "entries";
let lobbyRoomSummaryStore: LobbyRoomSummaryStore | null = null;

interface RedisLobbyRoomSummaryHashClient extends RedisClientLike {
  expire?(key: string, seconds: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
}

interface RedisLobbyRoomSummaryHashEntry {
  expiresAtMs: number;
  summary: LobbyRoomSummary;
}

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

function sortLobbyRoomSummaries(rooms: LobbyRoomSummary[]): LobbyRoomSummary[] {
  return rooms.sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.roomId.localeCompare(right.roomId)
  );
}

function normalizeLobbyRoomSummary(input: unknown): LobbyRoomSummary | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<Record<keyof LobbyRoomSummary, unknown>>;
  if (
    typeof candidate.roomId !== "string" ||
    typeof candidate.seed !== "number" ||
    typeof candidate.day !== "number" ||
    typeof candidate.connectedPlayers !== "number" ||
    typeof candidate.disconnectedPlayers !== "number" ||
    typeof candidate.heroCount !== "number" ||
    typeof candidate.activeBattles !== "number" ||
    typeof candidate.statusLabel !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    roomId: candidate.roomId,
    seed: candidate.seed,
    day: candidate.day,
    connectedPlayers: candidate.connectedPlayers,
    disconnectedPlayers: candidate.disconnectedPlayers,
    heroCount: candidate.heroCount,
    activeBattles: candidate.activeBattles,
    statusLabel: candidate.statusLabel,
    updatedAt: candidate.updatedAt
  };
}

function mergeLobbyRoomSummaries(...groups: LobbyRoomSummary[][]): LobbyRoomSummary[] {
  const summariesByRoomId = new Map<string, LobbyRoomSummary>();
  for (const summary of groups.flat()) {
    const existing = summariesByRoomId.get(summary.roomId);
    if (!existing || summary.updatedAt.localeCompare(existing.updatedAt) >= 0) {
      summariesByRoomId.set(summary.roomId, summary);
    }
  }
  return sortLobbyRoomSummaries(Array.from(summariesByRoomId.values()));
}

function buildLobbyRoomSummaryRedisIndexKey(prefix: string, suffix: string): string {
  return `${prefix}${suffix}`;
}

function normalizeRedisLobbyRoomSummaryHashEntry(input: unknown): RedisLobbyRoomSummaryHashEntry | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<Record<keyof RedisLobbyRoomSummaryHashEntry, unknown>>;
  const summary = normalizeLobbyRoomSummary(candidate.summary);
  if (typeof candidate.expiresAtMs !== "number" || !summary) {
    return null;
  }
  return {
    expiresAtMs: candidate.expiresAtMs,
    summary
  };
}

export function createRedisLobbyRoomSummaryStore(
  redisClient: RedisClientLike,
  options: RedisLobbyRoomSummaryStoreOptions = {}
): LobbyRoomSummaryStore {
  const keyPrefix = options.keyPrefix ?? LOBBY_ROOM_SUMMARY_REDIS_PREFIX;
  const ttlSeconds = Math.max(1, Math.floor(options.ttlSeconds ?? LOBBY_ROOM_SUMMARY_TTL_SECONDS));
  const summaryHashKey = buildLobbyRoomSummaryRedisIndexKey(keyPrefix, LOBBY_ROOM_SUMMARY_HASH_SUFFIX);
  const hashRedisClient = redisClient as RedisLobbyRoomSummaryHashClient;
  return {
    async upsert(summary) {
      const expiresAtMs = Date.now() + ttlSeconds * 1000;
      await hashRedisClient.hset(summaryHashKey, summary.roomId, JSON.stringify({ expiresAtMs, summary }));
      await hashRedisClient.expire?.(summaryHashKey, ttlSeconds);
    },
    async delete(roomId) {
      await hashRedisClient.hdel(summaryHashKey, roomId);
    },
    async list() {
      const serializedEntries = await hashRedisClient.hgetall(summaryHashKey);
      const roomEntries = Object.entries(serializedEntries);
      if (roomEntries.length === 0) {
        return [];
      }
      const summaries: LobbyRoomSummary[] = [];
      const staleRoomIds: string[] = [];
      const nowMs = Date.now();
      for (const [roomId, serialized] of roomEntries) {
        try {
          const entry = normalizeRedisLobbyRoomSummaryHashEntry(JSON.parse(serialized));
          if (entry && entry.summary.roomId === roomId && entry.expiresAtMs > nowMs) {
            summaries.push(entry.summary);
            continue;
          }
        } catch {
          // Delete malformed entries below.
        }
        staleRoomIds.push(roomId);
      }
      if (staleRoomIds.length > 0) {
        await hashRedisClient.hdel(summaryHashKey, ...staleRoomIds);
      }
      return sortLobbyRoomSummaries(summaries);
    }
  };
}

export function configureLobbyRoomSummaryStore(store: LobbyRoomSummaryStore | null): void {
  lobbyRoomSummaryStore = store;
}

export function listLobbyRooms(): LobbyRoomSummary[] {
  return sortLobbyRoomSummaries(Array.from(lobbyRoomSummaries.values()));
}

export async function listSharedLobbyRooms(): Promise<LobbyRoomSummary[]> {
  if (!lobbyRoomSummaryStore) {
    return listLobbyRooms();
  }

  try {
    return mergeLobbyRoomSummaries(await lobbyRoomSummaryStore.list(), listLobbyRooms());
  } catch {
    return listLobbyRooms();
  }
}

export async function publishSharedLobbyRoomSummary(summary: LobbyRoomSummary): Promise<void> {
  await lobbyRoomSummaryStore?.upsert(summary);
}

export async function deleteSharedLobbyRoomSummary(roomId: string): Promise<void> {
  await lobbyRoomSummaryStore?.delete(roomId);
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
