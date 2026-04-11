import { CloseCode } from "@colyseus/shared-types";
import { Room, type Client as ColyseusClient } from "colyseus";
import {
  applyEloMatchResult,
  classifyReconnectFailure,
  DEFAULT_MIN_SUPPORTED_CLIENT_VERSION,
  isClientVersionSupported,
  createInitialWorldState,
  createPlayerWorldView,
  encodePlayerWorldView,
  filterWorldEventsForPlayer,
  getBattleBalanceConfig,
  listReachableTilesInPlayerView,
  normalizeClientVersion,
  normalizeEloRating,
  planPlayerViewMovement,
  validateWorldAction,
  resolveCosmeticCatalog,
  type ActionValidationFailure,
  type PlayerWorldView,
  type PlayerBattleReplaySummary,
  type ClientMessage,
  type FeatureFlags,
  type MovementPlan,
  type SessionStateReason,
  type ServerMessage,
  type SessionStatePayload,
  type WorldEvent,
  type WorldAction,
  type BattleAction
} from "../../../packages/shared/src/index";
import { emitAnalyticsEvent } from "./analytics";
import {
  buildAuthoritativeRoomErrorContext,
  createRoom,
  type AuthoritativeWorldRoom,
  type RoomPersistenceSnapshot
} from "./index";
import {
  appendCompletedBattleReplaysToAccount,
  buildPlayerBattleReplaySummariesForPlayer,
  type CompletedBattleReplayCapture
} from "./battle-replays";
import { didPlayerWinBattle, resolveBattlePassConfig } from "./battle-pass";
import {
  applyPlayerAccountsToWorldState,
  applyPlayerHeroArchivesToWorldState,
  isPlayerBanActive,
  type RoomSnapshotStore,
  type PlayerAccountSnapshot,
} from "./persistence";
import {
  configureConfigRuntimeStatusProvider,
  flushPendingConfigUpdate,
  registerConfigUpdateListener
} from "./config-center";
import { applyPlayerEventLogAndAchievements } from "./player-achievements";
import { resolveGuestAuthSession } from "./auth";
import { deriveMinorProtectionState, readMinorProtectionConfig } from "./minor-protection";
import {
  recordBattleActionMessage,
  recordBattleLifecycleResolved,
  recordConnectMessage,
  recordRoomCreated,
  recordRoomDisposed,
  recordRuntimeErrorEvent,
  recordReconnectWindowOpened,
  recordReconnectWindowResolved,
  recordRuntimeRoom,
  recordWebSocketActionKick,
  recordWebSocketActionRateLimited,
  recordWorldActionMessage,
  removeRuntimeRoom
} from "./observability";
import { sendWechatSubscribeMessage, type WechatSubscribeTemplateKey } from "./wechat-subscribe";
import { resolveFeatureFlagsForPlayer } from "./feature-flags";
import { captureServerError } from "./error-monitoring";

type MessageOfType<T extends ServerMessage["type"]> = Omit<Extract<ServerMessage, { type: T }>, "type">;

interface VeilRoomMetadata {
  logicalRoomId: string;
}

interface VeilRoomOptions {
  metadata: VeilRoomMetadata;
}

interface JoinOptions {
  logicalRoomId?: string;
  playerId?: string;
  seed?: number;
}

const RECONNECTION_WINDOW_SECONDS = 20;
const MAP_SYNC_CHUNK_SIZE = 8;
const MAP_SYNC_CHUNK_PADDING = 1;
const DEFAULT_WS_ACTION_RATE_LIMIT_WINDOW_MS = 1_000;
const DEFAULT_WS_ACTION_RATE_LIMIT_MAX = 8;
const DEFAULT_PLAYER_SLOT_ID = /^player-(\d+)$/;
const MINOR_PROTECTION_TICK_MS = 60_000;
const TURN_TIMER_TICK_MS = 5_000;
const TURN_REMINDER_DISCONNECT_THRESHOLD_MS = 30_000;
const ZOMBIE_ROOM_CLEANUP_INTERVAL_MS = 5 * 60 * 1_000;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1_000;
let configuredRoomSnapshotStore: RoomSnapshotStore | null = null;
const lobbyRoomSummaries = new Map<string, LobbyRoomSummary>();
const lobbyRoomOwnerTokens = new Map<string, number>();
const activeRoomInstances = new Map<string, VeilColyseusRoom>();
let nextLobbyRoomOwnerToken = 1;
let zombieRoomCleanupHandle: RoomTimerHandle | null = null;

function reportPersistenceSaveFailure(
  room: AuthoritativeWorldRoom,
  playerId: string,
  requestId: string,
  action: string,
  error: unknown
): void {
  const roomContext = buildAuthoritativeRoomErrorContext(room, playerId);
  const detail = error instanceof Error ? error.message : String(error);

  recordRuntimeErrorEvent({
    id: `${roomContext.roomId}:${playerId}:${requestId}:persistence_save_failed`,
    recordedAt: new Date().toISOString(),
    source: "server",
    surface: "colyseus-room",
    candidateRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
    featureArea: "runtime",
    ownerArea: "multiplayer",
    severity: "error",
    errorCode: "persistence_save_failed",
    message: "Room state persistence failed and the action was rolled back.",
    tags: ["room-persistence", action],
    context: {
      roomId: roomContext.roomId,
      playerId: roomContext.playerId,
      requestId,
      route: null,
      action,
      statusCode: null,
      crash: false,
      detail: `battleId=${roomContext.battleId ?? "none"} heroId=${roomContext.heroId ?? "none"} day=${roomContext.day} error=${detail}`
    }
  });

  void captureServerError({
    errorCode: "persistence_save_failed",
    message: "Room state persistence failed and the action was rolled back.",
    error,
    severity: "error",
    featureArea: "runtime",
    ownerArea: "multiplayer",
    surface: "colyseus-room",
    tags: ["room-persistence", action],
    context: {
      roomId: roomContext.roomId,
      playerId: roomContext.playerId,
      requestId,
      action,
      roomDay: roomContext.day,
      battleId: roomContext.battleId,
      heroId: roomContext.heroId,
      detail
    }
  });
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

interface RoomTimerHandle {
  unref?(): void;
}

interface RoomRuntimeDependencies {
  setInterval(handler: () => void, delayMs: number): RoomTimerHandle;
  clearInterval(handle: RoomTimerHandle): void;
  isMySqlSnapshotStore(store: RoomSnapshotStore | null): boolean;
  now(): number;
  sendWechatSubscribeMessage(
    playerId: string,
    templateKey: WechatSubscribeTemplateKey,
    data: Record<string, unknown>,
    options?: { store?: RoomSnapshotStore | null }
  ): Promise<boolean>;
}

const defaultRoomRuntimeDependencies: RoomRuntimeDependencies = {
  setInterval: (handler, delayMs) => globalThis.setInterval(handler, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
  isMySqlSnapshotStore: (store) => Boolean(store && "getRetentionPolicy" in store),
  now: () => Date.now(),
  sendWechatSubscribeMessage: (playerId, templateKey, data, options) =>
    sendWechatSubscribeMessage(playerId, templateKey, data, options)
};

let roomRuntimeDependencies: RoomRuntimeDependencies = defaultRoomRuntimeDependencies;

interface WebSocketActionRateLimitConfig {
  windowMs: number;
  max: number;
}

function hasPlayerReportStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "createPlayerReport">> {
  return Boolean(store?.createPlayerReport);
}

export interface LobbyRoomSummary {
  roomId: string;
  seed: number;
  day: number;
  connectedPlayers: number;
  disconnectedPlayers: number;
  heroCount: number;
  activeBattles: number;
  statusLabel: string;
  updatedAt: string;
}

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
    await room.runExpiredEmptyRoomCleanup(now);
  }
}

function ensureZombieRoomCleanupLoop(): void {
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

function parseEnvNumber(
  value: string | undefined,
  fallback: number,
  options: { minimum?: number; integer?: boolean } = {}
): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = options.integer ? Math.floor(parsed) : parsed;
  if (options.minimum != null && normalized < options.minimum) {
    return fallback;
  }

  return normalized;
}

function readWebSocketActionRateLimitConfig(env: NodeJS.ProcessEnv = process.env): WebSocketActionRateLimitConfig {
  return {
    windowMs: parseEnvNumber(env.VEIL_RATE_LIMIT_WS_ACTION_WINDOW_MS, DEFAULT_WS_ACTION_RATE_LIMIT_WINDOW_MS, {
      minimum: 1,
      integer: true
    }),
    max: parseEnvNumber(env.VEIL_RATE_LIMIT_WS_ACTION_MAX, DEFAULT_WS_ACTION_RATE_LIMIT_MAX, {
      minimum: 1,
      integer: true
    })
  };
}

function readMinimumSupportedClientVersion(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeClientVersion(env.MIN_SUPPORTED_CLIENT_VERSION) ?? DEFAULT_MIN_SUPPORTED_CLIENT_VERSION;
}

function sendMessage<T extends ServerMessage["type"]>(
  client: ColyseusClient,
  type: T,
  payload: MessageOfType<T>
): void {
  client.send(type, payload);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function compareDefaultPlayerSlotIds(left: string, right: string): number {
  const leftMatch = DEFAULT_PLAYER_SLOT_ID.exec(left);
  const rightMatch = DEFAULT_PLAYER_SLOT_ID.exec(right);
  if (!leftMatch || !rightMatch) {
    return left.localeCompare(right);
  }

  return Number(leftMatch[1]) - Number(rightMatch[1]) || left.localeCompare(right);
}

function isDefaultPlayerSlotId(playerId: string): boolean {
  return DEFAULT_PLAYER_SLOT_ID.test(playerId);
}

function cloneResourceLedger(ledger?: { gold: number; wood: number; ore: number }): { gold: number; wood: number; ore: number } {
  return {
    gold: ledger?.gold ?? 0,
    wood: ledger?.wood ?? 0,
    ore: ledger?.ore ?? 0
  };
}

function rebindWorldStatePlayerId(
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

function resolveFocusedMapBounds(world: SessionStatePayload["world"]): { x: number; y: number; width: number; height: number } | null {
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

export class VeilColyseusRoom extends Room<VeilRoomOptions> {
  maxClients = 8;
  patchRate = null;

  public worldRoom!: AuthoritativeWorldRoom;
  private readonly wsActionRateLimitConfig = readWebSocketActionRateLimitConfig();
  private readonly minorProtectionConfig = readMinorProtectionConfig();
  private readonly lobbyRoomOwnerToken = nextLobbyRoomOwnerToken++;
  private readonly playerIdBySessionId = new Map<string, string>();
  private readonly disconnectedAtByPlayerId = new Map<string, string>();
  private readonly reconnectedAtByPlayerId = new Map<string, string>();
  private readonly wsActionTimestampsByPlayerId = new Map<string, number[]>();
  private unsubscribeConfigUpdate: (() => void) | null = null;
  private turnTimerHandle: RoomTimerHandle | null = null;
  private turnOwnerPlayerId: string | null = null;
  private turnTimerTickInFlight = false;
  private roomRetired = false;
  private emptyRoomSinceAtMs: number | null = null;

  async onCreate(options: JoinOptions): Promise<void> {
    const logicalRoomId = options.logicalRoomId ?? "room-alpha";
    this.metadata = { logicalRoomId };
    lobbyRoomOwnerTokens.set(logicalRoomId, this.lobbyRoomOwnerToken);
    activeRoomInstances.set(logicalRoomId, this);
    this.emptyRoomSinceAtMs = roomRuntimeDependencies.now();
    ensureZombieRoomCleanupLoop();
    this.setState({});
    const persistedSnapshot = configuredRoomSnapshotStore
      ? await configuredRoomSnapshotStore.load(logicalRoomId)
      : null;

    if (persistedSnapshot) {
      this.worldRoom = createRoom(logicalRoomId, options.seed, persistedSnapshot);
    } else {
      let initialState = createInitialWorldState(options.seed, logicalRoomId);
      if (configuredRoomSnapshotStore) {
        const playerIds = Array.from(
          new Set([...initialState.heroes.map((hero) => hero.playerId), ...Object.keys(initialState.resources)])
        );
        const [accounts, heroArchives] = await Promise.all([
          configuredRoomSnapshotStore.loadPlayerAccounts(playerIds),
          configuredRoomSnapshotStore.loadPlayerHeroArchives(playerIds)
        ]);
        initialState = applyPlayerAccountsToWorldState(initialState, accounts);
        initialState = applyPlayerHeroArchivesToWorldState(initialState, heroArchives);
      }

      this.worldRoom = createRoom(logicalRoomId, options.seed, {
        state: initialState,
        battles: []
      });
    }

    await this.persistRoomState();
    this.publishLobbyRoomSummary();
    recordRoomCreated(logicalRoomId);
    this.ensureTurnTimerLoop();

    this.unsubscribeConfigUpdate = registerConfigUpdateListener((bundle) => {
      for (const client of this.clients) {
        sendMessage(client, "config.update", {
          requestId: "push",
          delivery: "push",
          payload: { bundle }
        });
      }
    });
    this.clock.setInterval(() => {
      void this.tickMinorPlaytime();
    }, MINOR_PROTECTION_TICK_MS);

    this.onMessage("connect", async (client, message: Extract<ClientMessage, { type: "connect" }>) => {
      recordConnectMessage();
      if (!isClientVersionSupported(message.clientVersion, readMinimumSupportedClientVersion())) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "upgrade_required" });
        return;
      }

      const authSession = message.authToken ? resolveGuestAuthSession(message.authToken) : null;
      if (message.authToken && !authSession) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "unauthorized" });
        return;
      }

      const playerId = authSession?.playerId ?? this.getPlayerId(client, message.playerId);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }

      this.playerIdBySessionId.set(client.sessionId, playerId);
      this.disconnectedAtByPlayerId.delete(playerId);
      this.refreshEmptyRoomTracking();
      let ensuredAccount: PlayerAccountSnapshot | null = null;
      if (configuredRoomSnapshotStore) {
        try {
          ensuredAccount = await configuredRoomSnapshotStore.ensurePlayerAccount({
            playerId,
            ...((authSession?.displayName ?? message.displayName?.trim())
              ? { displayName: authSession?.displayName ?? message.displayName?.trim() ?? playerId }
              : {}),
            lastRoomId: logicalRoomId
          });
        } catch (error) {
          console.error("[VeilRoom] Failed to ensure player account during connect", {
            roomId: logicalRoomId,
            playerId,
            error
          });
          ensuredAccount = null;
        }
      }
      if (isPlayerBanActive(ensuredAccount)) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "account_banned" });
        client.leave(CloseCode.WITH_ERROR, "account_banned");
        return;
      }
      if (await this.enforceMinorProtectionForClient(client, playerId, ensuredAccount, message.requestId)) {
        return;
      }
      if (
        !this.worldRoom.getInternalState().heroes.some((hero) => hero.playerId === playerId) &&
        !this.findAvailablePlayerWorldSlotId()
      ) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "room_full" });
        client.leave(CloseCode.WITH_ERROR, "room_full");
        return;
      }
      await this.ensurePlayerWorldSlot(playerId, ensuredAccount);
      if (this.shouldRunTurnTimer()) {
        this.ensureTurnTimerState();
        await this.persistRoomState();
      }
      this.publishLobbyRoomSummary();

      sendMessage(client, "session.state", {
        requestId: message.requestId,
        delivery: "reply",
        payload: this.buildStatePayload(playerId)
      });
      emitAnalyticsEvent("session_start", {
        playerId,
        roomId: logicalRoomId,
        payload: {
          roomId: logicalRoomId,
          authMode: authSession?.authMode ?? "guest",
          platform: "colyseus"
        }
      });
    });

    this.onMessage("world.preview", (client, message: Extract<ClientMessage, { type: "world.preview" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      const snapshot = createPlayerWorldView(this.worldRoom.getInternalState(), playerId);

      sendMessage(client, "world.preview", {
        requestId: message.requestId,
        movementPlan: planPlayerViewMovement(snapshot, message.heroId, message.destination) ?? null
      });
    });

    this.onMessage("world.reachable", (client, message: Extract<ClientMessage, { type: "world.reachable" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      const snapshot = createPlayerWorldView(this.worldRoom.getInternalState(), playerId);

      sendMessage(client, "world.reachable", {
        requestId: message.requestId,
        reachableTiles: listReachableTilesInPlayerView(snapshot, message.heroId)
      });
    });

    this.onMessage("world.action", async (client, message: Extract<ClientMessage, { type: "world.action" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }

      if (!this.consumePlayerActionRateLimit(playerId)) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "rate_limit_exceeded" });
        recordWebSocketActionRateLimited();
        recordWebSocketActionKick();
        client.leave(CloseCode.WITH_ERROR, "rate_limit_exceeded");
        return;
      }

      recordWorldActionMessage();
      if (message.action.type === "world.surrender") {
        const resolved = await this.handleSurrenderAction(client, playerId, message);
        if (!resolved) {
          sendMessage(client, "error", { requestId: message.requestId, reason: "surrender_failed" });
        }
        return;
      }

      const previousSnapshot = this.worldRoom.serializePersistenceSnapshot();
      const previousTurnOwnerPlayerId = this.turnOwnerPlayerId;
      const result = this.worldRoom.dispatch(playerId, message.action);
      if (!result.ok) {
        sendMessage(client, "session.state", {
          requestId: message.requestId,
          delivery: "reply",
          payload: this.buildStatePayload(playerId, {
            events: [],
            movementPlan: null,
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.rejection ? { rejection: result.rejection } : {})
          })
        });
        return;
      }

      this.afterSuccessfulWorldAction(playerId, message.action);
      try {
        await this.persistRoomState();
      } catch (error) {
        reportPersistenceSaveFailure(this.worldRoom, playerId, message.requestId, message.action.type, error);
        this.restoreWorldRoom(previousSnapshot);
        this.ensureTurnTimerState();
        this.publishLobbyRoomSummary();
        sendMessage(client, "error", { requestId: message.requestId, reason: "persistence_save_failed" });
        return;
      }
      await this.persistPlayerAccountProgress(result.events ?? [], this.worldRoom.consumeCompletedBattleReplays());
      this.emitAnalyticsForWorldEvents(playerId, result.events ?? []);

      this.publishLobbyRoomSummary();
      sendMessage(client, "session.state", {
        requestId: message.requestId,
        delivery: "reply",
        payload: this.buildStatePayload(playerId, {
          events: result.events ?? [],
          movementPlan: result.movementPlan ?? null,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.rejection ? { rejection: result.rejection } : {})
        })
      });
      this.broadcastState(client, {
        events: result.events ?? [],
        movementPlan: result.movementPlan ?? null
      });
      await this.maybeSendTurnReminderForTurnStart(previousTurnOwnerPlayerId);
    });

    this.onMessage("battle.action", async (client, message: Extract<ClientMessage, { type: "battle.action" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }

      if (!this.consumePlayerActionRateLimit(playerId)) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "rate_limit_exceeded" });
        recordWebSocketActionRateLimited();
        recordWebSocketActionKick();
        client.leave(CloseCode.WITH_ERROR, "rate_limit_exceeded");
        return;
      }

      recordBattleActionMessage();
      const previousSnapshot = this.worldRoom.serializePersistenceSnapshot();
      const previousTurnOwnerPlayerId = this.turnOwnerPlayerId;
      const result = this.worldRoom.dispatchBattle(playerId, message.action);
      if (!result.ok) {
        sendMessage(client, "session.state", {
          requestId: message.requestId,
          delivery: "reply",
          payload: this.buildStatePayload(playerId, {
            events: [],
            movementPlan: null,
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.rejection ? { rejection: result.rejection } : {})
          })
        });
        return;
      }

      this.afterSuccessfulBattleAction(playerId);
      try {
        await this.persistRoomState();
      } catch (error) {
        reportPersistenceSaveFailure(this.worldRoom, playerId, message.requestId, message.action.type, error);
        this.restoreWorldRoom(previousSnapshot);
        this.ensureTurnTimerState();
        this.publishLobbyRoomSummary();
        sendMessage(client, "error", { requestId: message.requestId, reason: "persistence_save_failed" });
        return;
      }
      await this.persistPlayerAccountProgress(result.events ?? [], this.worldRoom.consumeCompletedBattleReplays());
      this.emitAnalyticsForWorldEvents(playerId, result.events ?? []);

      this.publishLobbyRoomSummary();
      sendMessage(client, "session.state", {
        requestId: message.requestId,
        delivery: "reply",
        payload: this.buildStatePayload(playerId, {
          events: result.events ?? [],
          movementPlan: null,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.rejection ? { rejection: result.rejection } : {})
        })
      });
      this.broadcastState(client, {
        events: result.events ?? [],
        movementPlan: null
      });
      await this.maybeSendTurnReminderForTurnStart(previousTurnOwnerPlayerId);
    });

    this.onMessage("report.player", async (client, message: Extract<ClientMessage, { type: "report.player" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      if (!hasPlayerReportStore(configuredRoomSnapshotStore)) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "reporting_unavailable" });
        return;
      }

      const targetPlayerId = this.resolveReportTargetPlayerId(playerId, message.targetPlayerId);
      if (!targetPlayerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "report_target_unavailable" });
        return;
      }

      try {
        const report = await configuredRoomSnapshotStore.createPlayerReport({
          reporterId: playerId,
          targetId: targetPlayerId,
          reason: message.reason,
          ...(message.description?.trim() ? { description: message.description.trim() } : {}),
          roomId: logicalRoomId
        });
        sendMessage(client, "report.player", {
          requestId: message.requestId,
          reportId: report.reportId,
          targetPlayerId: report.targetId,
          reason: report.reason,
          status: report.status,
          createdAt: report.createdAt
        });
        sendMessage(client, "session.state", {
          requestId: message.requestId,
          delivery: "reply",
          payload: this.buildStatePayload(playerId, {
            movementPlan: null,
            reason: "report_submitted"
          })
        });
      } catch (error) {
        const reason =
          error instanceof Error && error.message === "duplicate_player_report"
            ? "duplicate_player_report"
            : "report_submit_failed";
        sendMessage(client, "error", { requestId: message.requestId, reason });
      }
    });

    this.onMessage("USE_EMOTE", async (client, message: Extract<ClientMessage, { type: "USE_EMOTE" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }
      if (!configuredRoomSnapshotStore?.loadPlayerAccount) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "cosmetics_unavailable" });
        return;
      }

      const account = await configuredRoomSnapshotStore.loadPlayerAccount(playerId);
      if (!account) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "player_account_not_found" });
        return;
      }

      const emoteId = message.emoteId.trim();
      const definition = resolveCosmeticCatalog().find((entry) => entry.id === emoteId && entry.category === "battle_emote");
      if (!definition) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "cosmetic_not_found" });
        return;
      }
      if (!(account.cosmeticInventory?.ownedIds ?? []).includes(emoteId)) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "cosmetic_not_owned" });
        return;
      }

      sendMessage(client, "COSMETIC_APPLIED", {
        requestId: message.requestId,
        delivery: "reply",
        playerId,
        cosmeticId: emoteId,
        action: "emote",
        ...(account.equippedCosmetics ? { equippedCosmetics: account.equippedCosmetics } : {})
      });
      this.broadcastCosmeticApplied(client, {
        playerId,
        cosmeticId: emoteId,
        action: "emote",
        ...(account.equippedCosmetics ? { equippedCosmetics: account.equippedCosmetics } : {})
      });
    });
  }

  onJoin(client: ColyseusClient, options?: JoinOptions): void {
    this.playerIdBySessionId.set(client.sessionId, options?.playerId ?? client.sessionId);
    this.refreshEmptyRoomTracking();
    this.publishLobbyRoomSummary();
  }

  disconnectPlayer(playerId: string, reason = "account_banned"): number {
    let disconnected = 0;
    for (const client of this.clients) {
      if (this.playerIdBySessionId.get(client.sessionId) !== playerId) {
        continue;
      }

      sendMessage(client, "error", { requestId: "push", reason });
      client.leave(CloseCode.WITH_ERROR, reason);
      disconnected += 1;
    }
    return disconnected;
  }

  async onDrop(client: ColyseusClient): Promise<void> {
    const playerId = this.playerIdBySessionId.get(client.sessionId);
    if (!playerId) {
      return;
    }

    this.playerIdBySessionId.delete(client.sessionId);
    this.disconnectedAtByPlayerId.set(playerId, new Date(roomRuntimeDependencies.now()).toISOString());
    this.refreshEmptyRoomTracking();
    this.ensureTurnTimerState();
    this.publishLobbyRoomSummary();
    let reconnectWindowOpen = false;

    try {
      recordReconnectWindowOpened();
      reconnectWindowOpen = true;
      const reconnectedClient = await this.allowReconnection(client, RECONNECTION_WINDOW_SECONDS);
      if (configuredRoomSnapshotStore?.loadPlayerBan) {
        const ban = await configuredRoomSnapshotStore.loadPlayerBan(playerId);
        if (isPlayerBanActive(ban)) {
          if (reconnectWindowOpen) {
            recordReconnectWindowResolved("failure", {
              roomId: this.metadata.logicalRoomId,
              playerId,
              reason: "auth_invalid"
            });
            reconnectWindowOpen = false;
          }
          reconnectedClient.leave(CloseCode.WITH_ERROR, "account_banned");
          this.publishLobbyRoomSummary();
          return;
        }
      }
      if (await this.enforceMinorProtectionForClient(reconnectedClient, playerId, null, "push")) {
        if (reconnectWindowOpen) {
          recordReconnectWindowResolved("failure", {
            roomId: this.metadata.logicalRoomId,
            playerId,
            reason: "auth_invalid"
          });
          reconnectWindowOpen = false;
        }
        this.publishLobbyRoomSummary();
        return;
      }
      this.playerIdBySessionId.set(reconnectedClient.sessionId, playerId);
      this.disconnectedAtByPlayerId.delete(playerId);
      this.reconnectedAtByPlayerId.set(playerId, new Date().toISOString());
      this.ensureTurnTimerState();
      this.publishLobbyRoomSummary();
      sendMessage(reconnectedClient, "session.state", {
        requestId: "push",
        delivery: "push",
        payload: this.buildStatePayload(playerId)
      });
      if (reconnectWindowOpen) {
        recordReconnectWindowResolved("success", {
          roomId: this.metadata.logicalRoomId,
          playerId
        });
        reconnectWindowOpen = false;
      }
    } catch (error) {
      if (reconnectWindowOpen) {
        recordReconnectWindowResolved("failure", {
          roomId: this.metadata.logicalRoomId,
          playerId,
          reason: classifyReconnectFailure({
            error,
            fallbackReason: "reconnect_window_expired"
          })
        });
      }
      this.playerIdBySessionId.delete(client.sessionId);
      this.refreshEmptyRoomTracking();
      this.ensureTurnTimerState();
      this.publishLobbyRoomSummary();
    }
  }

  onLeave(client: ColyseusClient): void {
    const playerId = this.playerIdBySessionId.get(client.sessionId);
    this.playerIdBySessionId.delete(client.sessionId);
    if (playerId && !this.getConnectedPlayerIds().includes(playerId)) {
      this.disconnectedAtByPlayerId.set(playerId, new Date(roomRuntimeDependencies.now()).toISOString());
    }
    this.refreshEmptyRoomTracking();
    this.ensureTurnTimerState();
    this.publishLobbyRoomSummary();
  }

  onDispose(): void {
    this.unsubscribeConfigUpdate?.();
    this.unsubscribeConfigUpdate = null;
    this.wsActionTimestampsByPlayerId.clear();
    if (this.turnTimerHandle) {
      roomRuntimeDependencies.clearInterval(this.turnTimerHandle);
      this.turnTimerHandle = null;
    }

    this.retireRoom("dispose");
  }

  private restoreWorldRoom(snapshot: RoomPersistenceSnapshot): void {
    this.worldRoom = createRoom(this.metadata.logicalRoomId, snapshot.state.meta.seed, snapshot);
  }

  private consumePlayerActionRateLimit(playerId: string): boolean {
    const now = Date.now();
    const windowStart = now - this.wsActionRateLimitConfig.windowMs;
    const timestamps = (this.wsActionTimestampsByPlayerId.get(playerId) ?? []).filter((timestamp) => timestamp > windowStart);
    if (timestamps.length >= this.wsActionRateLimitConfig.max) {
      this.wsActionTimestampsByPlayerId.set(playerId, timestamps);
      return false;
    }

    timestamps.push(now);
    this.wsActionTimestampsByPlayerId.set(playerId, timestamps);
    return true;
  }

  private getConnectedPlayerIds(): string[] {
    return Array.from(new Set(this.playerIdBySessionId.values()));
  }

  private getTurnTimerSettings(): { turnTimerMs: number; afkStrikesBeforeForfeit: number } {
    const config = getBattleBalanceConfig();
    return {
      turnTimerMs: config.turnTimerSeconds * 1_000,
      afkStrikesBeforeForfeit: config.afkStrikesBeforeForfeit
    };
  }

  private shouldRunTurnTimer(): boolean {
    return roomRuntimeDependencies.isMySqlSnapshotStore(configuredRoomSnapshotStore);
  }

  private ensureTurnTimerLoop(): void {
    if (!this.shouldRunTurnTimer() || this.turnTimerHandle) {
      return;
    }

    this.turnTimerHandle = roomRuntimeDependencies.setInterval(() => {
      void this.tickTurnTimer();
    }, TURN_TIMER_TICK_MS);
    this.turnTimerHandle.unref?.();
  }

  private listMatchPlayerIds(): string[] {
    return Array.from(new Set(this.worldRoom.getInternalState().heroes.map((hero) => hero.playerId))).sort();
  }

  private findNextMatchPlayerId(playerId: string): string | null {
    const playerIds = this.listMatchPlayerIds();
    if (playerIds.length === 0) {
      return null;
    }

    const currentIndex = playerIds.indexOf(playerId);
    if (currentIndex < 0) {
      return playerIds[0] ?? null;
    }

    return playerIds[(currentIndex + 1) % playerIds.length] ?? null;
  }

  private resolvePvPBattleTurnOwnerPlayerId(): string | null {
    const battle = this.worldRoom.getActiveBattles().find((candidate) => candidate.defenderHeroId);
    if (!battle?.activeUnitId) {
      return null;
    }

    const activeUnit = battle.units[battle.activeUnitId];
    if (!activeUnit) {
      return null;
    }

    const internalState = this.worldRoom.getInternalState();
    if (activeUnit.camp === "attacker") {
      return battle.worldHeroId
        ? internalState.heroes.find((hero) => hero.id === battle.worldHeroId)?.playerId ?? null
        : null;
    }

    return battle.defenderHeroId
      ? internalState.heroes.find((hero) => hero.id === battle.defenderHeroId)?.playerId ?? null
      : null;
  }

  private resolveTurnContext(): { mode: "world" | "battle"; playerId: string } | null {
    const battleOwnerPlayerId = this.resolvePvPBattleTurnOwnerPlayerId();
    if (battleOwnerPlayerId) {
      this.turnOwnerPlayerId = battleOwnerPlayerId;
      return {
        mode: "battle",
        playerId: battleOwnerPlayerId
      };
    }

    const playerIds = this.listMatchPlayerIds();
    if (playerIds.length !== 2) {
      return null;
    }

    const ownerPlayerId =
      this.turnOwnerPlayerId && playerIds.includes(this.turnOwnerPlayerId) ? this.turnOwnerPlayerId : playerIds[0] ?? null;
    if (!ownerPlayerId) {
      return null;
    }

    this.turnOwnerPlayerId = ownerPlayerId;
    return {
      mode: "world",
      playerId: ownerPlayerId
    };
  }

  private setTurnDeadlineFor(playerId: string | null): void {
    const state = this.worldRoom.getInternalState();
    if (!playerId) {
      this.turnOwnerPlayerId = null;
      delete state.turnDeadlineAt;
      return;
    }

    this.turnOwnerPlayerId = playerId;
    state.turnDeadlineAt = new Date(roomRuntimeDependencies.now() + this.getTurnTimerSettings().turnTimerMs).toISOString();
  }

  private getAfkStrikeCount(playerId: string): number {
    const current = this.worldRoom.getInternalState().afkStrikes?.[playerId];
    return typeof current === "number" && Number.isFinite(current) ? current : 0;
  }

  private setAfkStrikeCount(playerId: string, nextValue: number): void {
    const state = this.worldRoom.getInternalState();
    const next = { ...(state.afkStrikes ?? {}) };
    if (nextValue > 0) {
      next[playerId] = nextValue;
    } else {
      delete next[playerId];
    }

    if (Object.keys(next).length > 0) {
      state.afkStrikes = next;
    } else {
      delete state.afkStrikes;
    }
  }

  private ensureTurnTimerState(): void {
    if (!this.shouldRunTurnTimer()) {
      this.setTurnDeadlineFor(null);
      return;
    }

    const context = this.resolveTurnContext();
    if (!context) {
      this.setTurnDeadlineFor(null);
      return;
    }

    const deadlineAt = this.worldRoom.getInternalState().turnDeadlineAt;
    if (!deadlineAt || Number.isNaN(Date.parse(deadlineAt))) {
      this.setTurnDeadlineFor(context.playerId);
    } else {
      this.turnOwnerPlayerId = context.playerId;
    }

    this.pushTurnTimerUpdate();
  }

  private pushTurnTimerUpdate(): void {
    const context = this.resolveTurnContext();
    const deadlineAt = this.worldRoom.getInternalState().turnDeadlineAt;
    if (!context || !deadlineAt) {
      return;
    }

    const remainingMs = Math.max(0, Date.parse(deadlineAt) - roomRuntimeDependencies.now());
    for (const client of this.clients) {
      sendMessage(client, "turn.timer", {
        requestId: "push",
        delivery: "push",
        remainingMs,
        turnOwnerPlayerId: context.playerId
      });
    }
  }

  private afterSuccessfulWorldAction(playerId: string, action: WorldAction): void {
    if (!this.shouldRunTurnTimer()) {
      return;
    }

    this.setAfkStrikeCount(playerId, 0);
    const nextOwnerPlayerId = action.type === "turn.endDay" ? this.findNextMatchPlayerId(playerId) ?? playerId : playerId;
    this.setTurnDeadlineFor(nextOwnerPlayerId);
  }

  private afterSuccessfulBattleAction(playerId: string): void {
    if (!this.shouldRunTurnTimer()) {
      return;
    }

    this.setAfkStrikeCount(playerId, 0);
    this.setTurnDeadlineFor(this.resolvePvPBattleTurnOwnerPlayerId() ?? playerId);
  }

  private async tickTurnTimer(): Promise<void> {
    if (!this.shouldRunTurnTimer() || this.turnTimerTickInFlight) {
      return;
    }

    const deadlineAt = this.worldRoom.getInternalState().turnDeadlineAt;
    if (!deadlineAt) {
      this.ensureTurnTimerState();
      return;
    }

    const context = this.resolveTurnContext();
    if (!context) {
      this.setTurnDeadlineFor(null);
      return;
    }

    const remainingMs = Date.parse(deadlineAt) - roomRuntimeDependencies.now();
    if (remainingMs > 0) {
      this.pushTurnTimerUpdate();
      return;
    }

    this.turnTimerTickInFlight = true;
    try {
      await this.handleTurnTimeout(context);
    } finally {
      this.turnTimerTickInFlight = false;
    }
  }

  private async handleTurnTimeout(context: { mode: "world" | "battle"; playerId: string }): Promise<void> {
    const nextStrikeCount = this.getAfkStrikeCount(context.playerId) + 1;
    this.setAfkStrikeCount(context.playerId, nextStrikeCount);

    if (nextStrikeCount >= this.getTurnTimerSettings().afkStrikesBeforeForfeit) {
      await this.applyAfkForfeit(context.playerId);
      return;
    }

    if (context.mode === "battle") {
      await this.applyAutoBattlePass(context.playerId);
      return;
    }

    await this.applyAutoEndDay(context.playerId);
  }

  private async applyAutoEndDay(playerId: string): Promise<void> {
    const previousSnapshot = this.worldRoom.serializePersistenceSnapshot();
    const previousTurnOwnerPlayerId = this.turnOwnerPlayerId;
    const result = this.worldRoom.dispatch(playerId, { type: "turn.endDay" });
    if (!result.ok) {
      this.ensureTurnTimerState();
      return;
    }

    this.setTurnDeadlineFor(this.findNextMatchPlayerId(playerId) ?? playerId);
    try {
      await this.persistRoomState();
    } catch {
      this.restoreWorldRoom(previousSnapshot);
      this.ensureTurnTimerState();
      this.publishLobbyRoomSummary();
      return;
    }

    await this.persistPlayerAccountProgress(result.events ?? [], this.worldRoom.consumeCompletedBattleReplays());
    this.publishLobbyRoomSummary();
    this.pushSessionStateToAll({
      events: result.events ?? [],
      movementPlan: result.movementPlan ?? null
    });
    this.pushTurnTimerUpdate();
    await this.maybeSendTurnReminderForTurnStart(previousTurnOwnerPlayerId);
  }

  private async applyAutoBattlePass(playerId: string): Promise<void> {
    const battle = this.worldRoom.getBattleForPlayer(playerId);
    const activeUnitId = battle?.activeUnitId ?? null;
    if (!battle || !activeUnitId) {
      this.ensureTurnTimerState();
      return;
    }

    const previousSnapshot = this.worldRoom.serializePersistenceSnapshot();
    const previousTurnOwnerPlayerId = this.turnOwnerPlayerId;
    const result = this.worldRoom.dispatchBattle(playerId, {
      type: "battle.pass",
      unitId: activeUnitId
    });
    if (!result.ok) {
      this.ensureTurnTimerState();
      return;
    }

    this.setTurnDeadlineFor(this.resolvePvPBattleTurnOwnerPlayerId() ?? playerId);
    try {
      await this.persistRoomState();
    } catch {
      this.restoreWorldRoom(previousSnapshot);
      this.ensureTurnTimerState();
      this.publishLobbyRoomSummary();
      return;
    }

    await this.persistPlayerAccountProgress(result.events ?? [], this.worldRoom.consumeCompletedBattleReplays());
    this.publishLobbyRoomSummary();
    this.pushSessionStateToAll({
      events: result.events ?? [],
      movementPlan: null
    });
    this.pushTurnTimerUpdate();
    await this.maybeSendTurnReminderForTurnStart(previousTurnOwnerPlayerId);
  }

  private async applyAfkForfeit(loserPlayerId: string): Promise<void> {
    const winnerPlayerId = this.listMatchPlayerIds().find((candidatePlayerId) => candidatePlayerId !== loserPlayerId);
    if (!winnerPlayerId) {
      this.ensureTurnTimerState();
      return;
    }

    if (!(await this.applySurrenderEloResult(winnerPlayerId, loserPlayerId))) {
      this.ensureTurnTimerState();
      return;
    }

    await this.broadcastSettlementAndCloseRoom(null, "afk_forfeit", "push");
  }

  private async syncMinorProtectionAccount(
    playerId: string,
    account: PlayerAccountSnapshot
  ): Promise<PlayerAccountSnapshot> {
    const store = configuredRoomSnapshotStore;
    if (!store) {
      return account;
    }

    const state = deriveMinorProtectionState(account, new Date(), this.minorProtectionConfig);
    if (
      account.lastPlayDate === state.localDate &&
      (account.dailyPlayMinutes ?? 0) === state.normalizedDailyPlayMinutes
    ) {
      return account;
    }

    return store.savePlayerAccountProgress(playerId, {
      dailyPlayMinutes: state.normalizedDailyPlayMinutes,
      lastPlayDate: state.localDate,
      lastRoomId: this.metadata.logicalRoomId
    });
  }

  private async enforceMinorProtectionForClient(
    client: ColyseusClient,
    playerId: string,
    ensuredAccount: PlayerAccountSnapshot | null,
    requestId: string
  ): Promise<boolean> {
    const store = configuredRoomSnapshotStore;
    let account = ensuredAccount;
    if (!account && store) {
      try {
        account = await store.ensurePlayerAccount({
          playerId,
          lastRoomId: this.metadata.logicalRoomId
        });
      } catch {
        account = null;
      }
    }

    if (!account || account.isMinor !== true) {
      return false;
    }

    const syncedAccount = await this.syncMinorProtectionAccount(playerId, account);
    const state = deriveMinorProtectionState(syncedAccount, new Date(), this.minorProtectionConfig);
    if (state.restrictedHours) {
      sendMessage(client, "error", { requestId, reason: "minor_restricted_hours" });
      client.leave(CloseCode.WITH_ERROR, "minor_restricted_hours");
      return true;
    }

    if (state.dailyLimitReached) {
      sendMessage(client, "error", { requestId, reason: "minor_daily_limit_reached" });
      client.leave(CloseCode.WITH_ERROR, "minor_daily_limit_reached");
      return true;
    }

    return false;
  }

  private async tickMinorPlaytime(): Promise<void> {
    const store = configuredRoomSnapshotStore;
    if (!store) {
      return;
    }

    const playerIds = this.getConnectedPlayerIds();
    if (playerIds.length === 0) {
      return;
    }

    try {
      const loadedAccounts = await store.loadPlayerAccounts(playerIds);
      const accountsByPlayerId = new Map(loadedAccounts.map((account) => [account.playerId, account] as const));

      await Promise.all(
        playerIds.map(async (playerId) => {
          const account =
            accountsByPlayerId.get(playerId) ??
            (await store.ensurePlayerAccount({
              playerId,
              lastRoomId: this.metadata.logicalRoomId
            }));
          if (account.isMinor !== true) {
            return;
          }

          const state = deriveMinorProtectionState(account, new Date(), this.minorProtectionConfig);
          if (state.restrictedHours) {
            await store.savePlayerAccountProgress(playerId, {
              dailyPlayMinutes: state.normalizedDailyPlayMinutes,
              lastPlayDate: state.localDate,
              lastRoomId: this.metadata.logicalRoomId
            });
            this.disconnectPlayer(playerId, "minor_restricted_hours");
            return;
          }
          const nextMinutes = state.normalizedDailyPlayMinutes + 1;
          await store.savePlayerAccountProgress(playerId, {
            dailyPlayMinutes: nextMinutes,
            lastPlayDate: state.localDate,
            lastRoomId: this.metadata.logicalRoomId
          });
          if (nextMinutes >= state.dailyLimitMinutes) {
            this.disconnectPlayer(playerId, "minor_daily_limit_reached");
          }
        })
      );
    } catch (error) {
      console.error("[VeilRoom] Failed to update minor playtime", {
        roomId: this.metadata.logicalRoomId,
        error
      });
    }
  }

  private async persistRoomState(): Promise<void> {
    if (!configuredRoomSnapshotStore) {
      return;
    }

    await configuredRoomSnapshotStore.save(this.metadata.logicalRoomId, this.worldRoom.serializePersistenceSnapshot());
  }

  private async persistPlayerAccountProgress(
    events: WorldEvent[],
    completedReplays: CompletedBattleReplayCapture[]
  ): Promise<void> {
    const store = configuredRoomSnapshotStore;
    if (!store || (events.length === 0 && completedReplays.length === 0)) {
      return;
    }

    const internalState = this.worldRoom.getInternalState();
    const playerIds = Array.from(new Set(internalState.heroes.map((hero) => hero.playerId)));
    const accounts = await store.loadPlayerAccounts(playerIds);
    const battlePassConfig = resolveBattlePassConfig();

    // Compute ELO updates for PVP (hero vs hero) battles
    const eloUpdates = new Map<string, number>();
    for (const replay of completedReplays) {
      if (!replay.defenderPlayerId) continue;
      const attackerPlayerId = replay.attackerPlayerId;
      const defenderPlayerId = replay.defenderPlayerId;
      const attackerAccount = accounts.find((a) => a.playerId === attackerPlayerId);
      const defenderAccount = accounts.find((a) => a.playerId === defenderPlayerId);
      const attackerRating = normalizeEloRating(attackerAccount?.eloRating);
      const defenderRating = normalizeEloRating(defenderAccount?.eloRating);
      const attackerWon = replay.result === "attacker_victory";
      const { winnerRating, loserRating } = applyEloMatchResult(
        attackerWon ? attackerRating : defenderRating,
        attackerWon ? defenderRating : attackerRating
      );
      eloUpdates.set(attackerPlayerId, attackerWon ? winnerRating : loserRating);
      eloUpdates.set(defenderPlayerId, attackerWon ? loserRating : winnerRating);
    }

    try {
      await Promise.all(
        playerIds.map(async (playerId) => {
          const playerEvents = filterWorldEventsForPlayer(internalState, playerId, events);
          const playerReplays = completedReplays.flatMap((replay) => this.buildPlayerBattleReplaysForAccount(replay, playerId));
          if (playerEvents.length === 0 && playerReplays.length === 0 && !eloUpdates.has(playerId)) {
            return;
          }

          const existingAccount =
            accounts.find((account) => account.playerId === playerId) ??
            (await store.ensurePlayerAccount({
              playerId,
              lastRoomId: this.metadata.logicalRoomId
            }));
          const nextAccount = appendCompletedBattleReplaysToAccount(
            applyPlayerEventLogAndAchievements(existingAccount, internalState, playerEvents),
            playerReplays
          );
          const eloRating = eloUpdates.get(playerId);
          const seasonXpDelta = completedReplays
            .filter((replay) => replay.attackerPlayerId === playerId || replay.defenderPlayerId === playerId)
            .reduce(
              (total, replay) =>
                total +
                (didPlayerWinBattle(replay, playerId)
                  ? battlePassConfig.seasonXpPerWin
                  : battlePassConfig.seasonXpPerLoss),
              0
            );
          await store.savePlayerAccountProgress(playerId, {
            achievements: nextAccount.achievements,
            recentEventLog: nextAccount.recentEventLog,
            ...(playerReplays.length > 0 ? { recentBattleReplays: nextAccount.recentBattleReplays } : {}),
            ...(eloRating !== undefined ? { eloRating } : {}),
            ...(seasonXpDelta > 0 ? { seasonXpDelta } : {}),
            lastRoomId: this.metadata.logicalRoomId
          });
        })
      );
    } catch (error) {
      console.error("[VeilRoom] Failed to persist player account progress", {
        roomId: this.metadata.logicalRoomId,
        error
      });
    }
  }

  private buildPlayerBattleReplaysForAccount(
    replay: CompletedBattleReplayCapture,
    playerId: string
  ): PlayerBattleReplaySummary[] {
    return buildPlayerBattleReplaySummariesForPlayer(replay, playerId);
  }

  private async handleSurrenderAction(
    sourceClient: ColyseusClient,
    playerId: string,
    message: Extract<ClientMessage, { type: "world.action" }>
  ): Promise<boolean> {
    const action = message.action;
    if (action.type !== "world.surrender") {
      return false;
    }

    const internalState = this.worldRoom.getInternalState();
    if (this.worldRoom.getBattleForPlayer(playerId)) {
      sendMessage(sourceClient, "error", { requestId: message.requestId, reason: "hero_in_battle" });
      return true;
    }

    const validation = validateWorldAction(internalState, action, playerId);
    if (!validation.valid) {
      sendMessage(sourceClient, "error", {
        requestId: message.requestId,
        reason: validation.reason ?? "surrender_failed"
      });
      return true;
    }

    const surrenderingHero = internalState.heroes.find((hero) => hero.id === action.heroId);
    if (!surrenderingHero || surrenderingHero.playerId !== playerId) {
      sendMessage(sourceClient, "error", { requestId: message.requestId, reason: "hero_not_owned_by_player" });
      return true;
    }

    const opponentPlayerIds = Array.from(
      new Set(internalState.heroes.map((hero) => hero.playerId).filter((candidatePlayerId) => candidatePlayerId !== playerId))
    );
    if (opponentPlayerIds.length !== 1) {
      sendMessage(sourceClient, "error", { requestId: message.requestId, reason: "surrender_opponent_not_found" });
      return true;
    }

    const winnerPlayerId = opponentPlayerIds[0]!;
    if (!(await this.applySurrenderEloResult(winnerPlayerId, playerId))) {
      return false;
    }

    await this.broadcastSettlementAndCloseRoom(sourceClient, "surrender", message.requestId);
    return true;
  }

  private async applySurrenderEloResult(winnerPlayerId: string, loserPlayerId: string): Promise<boolean> {
    const store = configuredRoomSnapshotStore;
    if (!store) {
      return true;
    }

    try {
      const accounts = await store.loadPlayerAccounts([winnerPlayerId, loserPlayerId]);
      const winnerAccount = accounts.find((account) => account.playerId === winnerPlayerId);
      const loserAccount = accounts.find((account) => account.playerId === loserPlayerId);
      const { winnerRating, loserRating } = applyEloMatchResult(
        normalizeEloRating(winnerAccount?.eloRating),
        normalizeEloRating(loserAccount?.eloRating)
      );

      await Promise.all([
        store.savePlayerAccountProgress(winnerPlayerId, {
          eloRating: winnerRating,
          lastRoomId: this.metadata.logicalRoomId
        }),
        store.savePlayerAccountProgress(loserPlayerId, {
          eloRating: loserRating,
          lastRoomId: this.metadata.logicalRoomId
        })
      ]);
      return true;
    } catch (error) {
      console.error("[VeilRoom] Failed to persist surrender ELO result", {
        roomId: this.metadata.logicalRoomId,
        winnerPlayerId,
        loserPlayerId,
        error
      });
      return false;
    }
  }

  private async broadcastSettlementAndCloseRoom(
    sourceClient: ColyseusClient | null,
    reason: SessionStateReason,
    requestId: string
  ): Promise<void> {
    for (const client of [...this.clients]) {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        continue;
      }

      sendMessage(client, "session.state", {
        requestId: client === sourceClient ? requestId : "push",
        delivery: client === sourceClient ? "reply" : "push",
        payload: this.buildStatePayload(playerId, {
          movementPlan: null,
          reason
        })
      });
    }

    if (configuredRoomSnapshotStore) {
      try {
        await configuredRoomSnapshotStore.delete(this.metadata.logicalRoomId);
      } catch (error) {
        console.error("[VeilRoom] Failed to delete surrendered room snapshot", {
          roomId: this.metadata.logicalRoomId,
          error
        });
      }
    }

    for (const client of [...this.clients]) {
      this.playerIdBySessionId.delete(client.sessionId);
      try {
        void client.leave();
      } catch {
        // Ignore disconnect errors while retiring the room after settlement.
      }
    }
    this.clients.splice(0, this.clients.length);
    this.retireRoom(reason);
  }

  private retireRoom(reason: string): void {
    if (this.roomRetired) {
      return;
    }

    this.roomRetired = true;
    try {
      for (const battle of this.worldRoom.getActiveBattles()) {
        recordBattleLifecycleResolved({
          roomId: this.metadata.logicalRoomId,
          battleId: battle.id,
          outcome: "aborted",
          reason
        });
      }

      recordRoomDisposed(this.metadata.logicalRoomId, reason);
    } catch (error) {
      console.error("[VeilRoom] Failed to retire room cleanly", {
        roomId: this.metadata.logicalRoomId,
        reason,
        error
      });
      recordRuntimeErrorEvent({
        id: `room-retire-${this.metadata.logicalRoomId}-${Date.now()}`,
        recordedAt: new Date().toISOString(),
        source: "server",
        surface: "server",
        candidateRevision: "workspace",
        featureArea: "runtime",
        ownerArea: "multiplayer",
        severity: "error",
        errorCode: "room_retire_failed",
        message: "Room retirement cleanup raised an exception.",
        context: {
          roomId: this.metadata.logicalRoomId,
          playerId: null,
          requestId: null,
          route: null,
          action: null,
          statusCode: null,
          crash: false,
          detail: `reason=${reason} error=${error instanceof Error ? error.message : String(error)}`
        }
      });
    } finally {
      this.releaseRoomRegistries();
    }
  }

  private resolveReportTargetPlayerId(playerId: string, requestedTargetPlayerId: string): string | null {
    const targetPlayerId = requestedTargetPlayerId.trim();
    if (!targetPlayerId || targetPlayerId === playerId) {
      return null;
    }

    if (this.getConnectedPlayerIds().includes(targetPlayerId)) {
      return targetPlayerId;
    }

    const battle = this.worldRoom.getBattleForPlayer(playerId);
    if (!battle?.worldHeroId || !battle.defenderHeroId) {
      return null;
    }

    const internalState = this.worldRoom.getInternalState();
    const attackerHero = internalState.heroes.find((hero) => hero.id === battle.worldHeroId);
    const defenderHero = internalState.heroes.find((hero) => hero.id === battle.defenderHeroId);
    const participantPlayerIds = new Set(
      [attackerHero?.playerId, defenderHero?.playerId].filter((value): value is string => Boolean(value))
    );

    return participantPlayerIds.has(targetPlayerId) ? targetPlayerId : null;
  }

  private publishLobbyRoomSummary(): void {
    if (lobbyRoomOwnerTokens.get(this.metadata.logicalRoomId) !== this.lobbyRoomOwnerToken) {
      return;
    }

    const internalState = this.worldRoom.getInternalState();
    const connectedPlayerIds = new Set(this.getConnectedPlayerIds());
    const disconnectedPlayers = Array.from(this.disconnectedAtByPlayerId.keys()).filter(
      (playerId) => !connectedPlayerIds.has(playerId)
    ).length;
    const activeBattles = this.worldRoom.getActiveBattles().length;
    const summary = {
      roomId: this.metadata.logicalRoomId,
      seed: internalState.meta.seed,
      day: internalState.meta.day,
      connectedPlayers: this.playerIdBySessionId.size,
      disconnectedPlayers,
      heroCount: internalState.heroes.length,
      activeBattles,
      statusLabel:
        activeBattles > 0
          ? disconnectedPlayers > 0
            ? "恢复中"
            : "PVP 进行中"
          : disconnectedPlayers > 0
            ? "等待重连"
            : "探索中",
      updatedAt: new Date().toISOString()
    };
    lobbyRoomSummaries.set(this.metadata.logicalRoomId, summary);
    recordRuntimeRoom(summary);
    flushPendingConfigUpdate();
  }

  private refreshEmptyRoomTracking(now = roomRuntimeDependencies.now()): void {
    this.emptyRoomSinceAtMs = this.getConnectedPlayerIds().length === 0 ? this.emptyRoomSinceAtMs ?? now : null;
  }

  private isExpiredEmptyRoom(now: number): boolean {
    return this.getConnectedPlayerIds().length === 0 && this.emptyRoomSinceAtMs != null && now - this.emptyRoomSinceAtMs >= EMPTY_ROOM_TTL_MS;
  }

  runExpiredEmptyRoomCleanup(now: number): Promise<void> {
    return this.disposeIfExpiredEmptyRoom(now);
  }

  private async disposeIfExpiredEmptyRoom(now: number): Promise<void> {
    if (this.roomRetired || activeRoomInstances.get(this.metadata.logicalRoomId) !== this || !this.isExpiredEmptyRoom(now)) {
      return;
    }

    try {
      await this.disconnect();
    } catch (error) {
      console.error("[VeilRoom] Failed to dispose stale empty room", {
        roomId: this.metadata.logicalRoomId,
        emptyRoomForMs: now - (this.emptyRoomSinceAtMs ?? now),
        error
      });
      recordRuntimeErrorEvent({
        id: `room-cleanup-${this.metadata.logicalRoomId}-${Date.now()}`,
        recordedAt: new Date().toISOString(),
        source: "server",
        surface: "server",
        candidateRevision: "workspace",
        featureArea: "runtime",
        ownerArea: "multiplayer",
        severity: "error",
        errorCode: "zombie_room_cleanup_failed",
        message: "Background zombie-room cleanup failed to disconnect an empty room.",
        context: {
          roomId: this.metadata.logicalRoomId,
          playerId: null,
          requestId: null,
          route: null,
          action: null,
          statusCode: null,
          crash: false,
          detail: `empty_room_for_ms=${now - (this.emptyRoomSinceAtMs ?? now)} error=${error instanceof Error ? error.message : String(error)}`
        }
      });
      this.retireRoom("zombie_room_cleanup");
    }
  }

  private releaseRoomRegistries(): void {
    if (activeRoomInstances.get(this.metadata.logicalRoomId) === this) {
      activeRoomInstances.delete(this.metadata.logicalRoomId);
    }

    if (lobbyRoomOwnerTokens.get(this.metadata.logicalRoomId) === this.lobbyRoomOwnerToken) {
      lobbyRoomOwnerTokens.delete(this.metadata.logicalRoomId);
      lobbyRoomSummaries.delete(this.metadata.logicalRoomId);
      removeRuntimeRoom(this.metadata.logicalRoomId);
    }

    flushPendingConfigUpdate();
  }

  private hasPlayerBeenDisconnectedLongEnough(playerId: string): boolean {
    if (this.getConnectedPlayerIds().includes(playerId)) {
      return false;
    }

    const disconnectedAt = this.disconnectedAtByPlayerId.get(playerId);
    if (!disconnectedAt) {
      return false;
    }

    const disconnectedAtMs = Date.parse(disconnectedAt);
    if (!Number.isFinite(disconnectedAtMs)) {
      return false;
    }

    return roomRuntimeDependencies.now() - disconnectedAtMs > TURN_REMINDER_DISCONNECT_THRESHOLD_MS;
  }

  private async maybeSendTurnReminderForTurnStart(previousTurnOwnerPlayerId: string | null): Promise<void> {
    const nextTurnOwnerPlayerId = this.turnOwnerPlayerId;
    if (!configuredRoomSnapshotStore || !nextTurnOwnerPlayerId || nextTurnOwnerPlayerId === previousTurnOwnerPlayerId) {
      return;
    }

    if (!this.hasPlayerBeenDisconnectedLongEnough(nextTurnOwnerPlayerId)) {
      return;
    }

    await roomRuntimeDependencies.sendWechatSubscribeMessage(
      nextTurnOwnerPlayerId,
      "turn_reminder",
      {
        roomId: this.metadata.logicalRoomId,
        turnNumber: this.worldRoom.getInternalState().meta.day
      },
      {
        store: configuredRoomSnapshotStore
      }
    );
  }

  private getPlayerId(client: ColyseusClient, fallback?: string): string | undefined {
    const playerId = this.playerIdBySessionId.get(client.sessionId) ?? fallback;
    if (playerId && !this.playerIdBySessionId.has(client.sessionId)) {
      this.playerIdBySessionId.set(client.sessionId, playerId);
    }

    return playerId;
  }

  private pushSessionStateToAll(extras?: {
    events?: WorldEvent[];
    movementPlan?: MovementPlan | null;
    reason?: string;
    rejection?: ActionValidationFailure;
  }): void {
    for (const client of this.clients) {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        continue;
      }

      const snapshot = this.worldRoom.getSnapshot(playerId).state;
      const mapBounds = resolveFocusedMapBounds(snapshot);

      sendMessage(client, "session.state", {
        requestId: "push",
        delivery: "push",
        payload: this.buildStatePayload(playerId, extras, {
          mapBounds,
          snapshot
        })
      });
    }
  }

  private async ensurePlayerWorldSlot(
    playerId: string,
    ensuredAccount: PlayerAccountSnapshot | null
  ): Promise<void> {
    const internalState = this.worldRoom.getInternalState();
    if (internalState.heroes.some((hero) => hero.playerId === playerId)) {
      return;
    }

    const availableSlotId = this.findAvailablePlayerWorldSlotId();
    if (!availableSlotId) {
      return;
    }

    const snapshot = this.worldRoom.serializePersistenceSnapshot();
    let nextState = rebindWorldStatePlayerId(snapshot.state, availableSlotId, playerId);
    if (configuredRoomSnapshotStore) {
      const heroArchives = await configuredRoomSnapshotStore.loadPlayerHeroArchives([playerId]);
      nextState = applyPlayerHeroArchivesToWorldState(nextState, heroArchives);
    }

    this.restoreWorldRoom({
      ...snapshot,
      state: nextState
    });
    await this.persistRoomState();
    if (ensuredAccount && configuredRoomSnapshotStore) {
      await configuredRoomSnapshotStore.savePlayerAccountProgress(playerId, {
        globalResources: ensuredAccount.globalResources,
        lastRoomId: this.metadata.logicalRoomId
      });
    }
  }

  private findAvailablePlayerWorldSlotId(): string | null {
    const internalState = this.worldRoom.getInternalState();
    const connectedPlayerIds = new Set(this.playerIdBySessionId.values());
    return (
      Array.from(new Set([...internalState.heroes.map((hero) => hero.playerId), ...Object.keys(internalState.resources)]))
        .filter((candidatePlayerId) => {
          if (!isDefaultPlayerSlotId(candidatePlayerId)) {
            return false;
          }

          return !connectedPlayerIds.has(candidatePlayerId);
        })
        .sort(compareDefaultPlayerSlotIds)[0] ?? null
    );
  }

  private buildStatePayload(
    playerId: string,
    extras?: {
      events?: WorldEvent[];
      movementPlan?: MovementPlan | null;
      reason?: string;
      rejection?: ActionValidationFailure;
    },
    options?: {
      mapBounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null;
      snapshot?: PlayerWorldView;
    }
  ): SessionStatePayload {
    const snapshot = options?.snapshot ?? this.worldRoom.getSnapshot(playerId).state;
    const world = encodePlayerWorldView(snapshot, {
      ...(options?.mapBounds ? { bounds: options.mapBounds } : {}),
      binary: true
    });
    const battle = this.worldRoom.getBattleForPlayer(playerId);
    const heroId = world.ownHeroes[0]?.id;
    const events = extras?.events ? filterWorldEventsForPlayer(this.worldRoom.getInternalState(), playerId, extras.events) : [];

    return {
      world,
      battle,
      events,
      movementPlan: extras?.movementPlan ?? null,
      reachableTiles: heroId && !battle ? listReachableTilesInPlayerView(snapshot, heroId) : [],
      featureFlags: this.resolvePlayerFeatureFlags(playerId),
      ...(extras?.reason ? { reason: extras.reason } : {}),
      ...(extras?.rejection ? { rejection: extras.rejection } : {})
    };
  }

  private resolvePlayerFeatureFlags(playerId: string): FeatureFlags {
    return resolveFeatureFlagsForPlayer(playerId);
  }

  private emitAnalyticsForWorldEvents(playerId: string, events: WorldEvent[]): void {
    for (const event of events) {
      if (event.type === "battle.started") {
        emitAnalyticsEvent("battle_start", {
          playerId,
          roomId: this.metadata.logicalRoomId,
          payload: {
            roomId: this.metadata.logicalRoomId,
            battleId: event.battleId,
            encounterKind: event.encounterKind,
            heroId: event.heroId
          }
        });
      }

      if (event.type === "battle.resolved") {
        emitAnalyticsEvent("battle_end", {
          playerId,
          roomId: this.metadata.logicalRoomId,
          payload: {
            roomId: this.metadata.logicalRoomId,
            battleId: event.battleId,
            result: event.result,
            heroId: event.heroId,
            battleKind: "battleKind" in event && typeof event.battleKind === "string" ? event.battleKind : "unknown"
          }
        });
      }
    }
  }

  private broadcastState(
    source: ColyseusClient | null,
    extras?: {
      events?: WorldEvent[];
      movementPlan?: MovementPlan | null;
      reason?: string;
      rejection?: ActionValidationFailure;
    }
  ): void {
    for (const client of this.clients) {
      if (client === source) {
        continue;
      }

      const playerId = this.getPlayerId(client);
      if (!playerId) {
        continue;
      }

      const snapshot = this.worldRoom.getSnapshot(playerId).state;
      const mapBounds = resolveFocusedMapBounds(snapshot);
      sendMessage(client, "session.state", {
        requestId: "push",
        delivery: "push",
        payload: this.buildStatePayload(
          playerId,
          {
            movementPlan: null,
            ...(extras?.events ? { events: extras.events } : {}),
            ...(extras?.reason ? { reason: extras.reason } : {})
          },
          {
            mapBounds,
            snapshot
          }
        )
      });
    }
  }

  private broadcastCosmeticApplied(
    source: ColyseusClient | null,
    message: Omit<Extract<ServerMessage, { type: "COSMETIC_APPLIED" }>, "type" | "requestId" | "delivery">
  ): void {
    for (const client of this.clients) {
      if (client === source) {
        continue;
      }

      sendMessage(client, "COSMETIC_APPLIED", {
        requestId: "push",
        delivery: "push",
        ...message
      });
    }
  }
}
