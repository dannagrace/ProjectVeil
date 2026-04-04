import { CloseCode } from "@colyseus/shared-types";
import { Room, type Client as ColyseusClient } from "colyseus";
import {
  applyEloMatchResult,
  createInitialWorldState,
  encodePlayerWorldView,
  filterWorldEventsForPlayer,
  listReachableTiles,
  normalizeEloRating,
  planHeroMovement,
  type PlayerWorldView,
  type PlayerBattleReplaySummary,
  type ClientMessage,
  type MovementPlan,
  type ServerMessage,
  type SessionStatePayload,
  type WorldEvent
} from "../../../packages/shared/src/index";
import { createRoom, type AuthoritativeWorldRoom, type RoomPersistenceSnapshot } from "./index";
import {
  appendCompletedBattleReplaysToAccount,
  buildPlayerBattleReplaySummariesForPlayer,
  type CompletedBattleReplayCapture
} from "./battle-replays";
import {
  applyPlayerAccountsToWorldState,
  applyPlayerHeroArchivesToWorldState,
  isPlayerBanActive,
  type PlayerAccountSnapshot,
  type RoomSnapshotStore
} from "./persistence";
import { registerConfigUpdateListener } from "./config-center";
import { applyPlayerEventLogAndAchievements } from "./player-achievements";
import { resolveGuestAuthSession } from "./auth";
import { deriveMinorProtectionState, readMinorProtectionConfig } from "./minor-protection";
import {
  recordBattleActionMessage,
  recordConnectMessage,
  recordRuntimeRoom,
  recordWebSocketActionKick,
  recordWebSocketActionRateLimited,
  recordWorldActionMessage,
  removeRuntimeRoom
} from "./observability";

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
let configuredRoomSnapshotStore: RoomSnapshotStore | null = null;
const lobbyRoomSummaries = new Map<string, LobbyRoomSummary>();
const lobbyRoomOwnerTokens = new Map<string, number>();
const activeRoomInstances = new Map<string, VeilColyseusRoom>();
let nextLobbyRoomOwnerToken = 1;

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
  heroCount: number;
  activeBattles: number;
  updatedAt: string;
}

export function configureRoomSnapshotStore(store: RoomSnapshotStore | null): void {
  configuredRoomSnapshotStore = store;
}

export function listLobbyRooms(): LobbyRoomSummary[] {
  return Array.from(lobbyRoomSummaries.values()).sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.roomId.localeCompare(right.roomId)
  );
}

export function resetLobbyRoomRegistry(): void {
  lobbyRoomSummaries.clear();
  lobbyRoomOwnerTokens.clear();
}

export function getActiveRoomInstances(): Map<string, VeilColyseusRoom> {
  return activeRoomInstances;
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

  return {
    ...state,
    heroes: nextHeroes,
    resources: nextResources,
    visibilityByPlayer: nextVisibilityByPlayer
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
  private readonly reconnectedAtByPlayerId = new Map<string, string>();
  private readonly wsActionTimestampsByPlayerId = new Map<string, number[]>();
  private unsubscribeConfigUpdate: (() => void) | null = null;

  async onCreate(options: JoinOptions): Promise<void> {
    const logicalRoomId = options.logicalRoomId ?? "room-alpha";
    this.metadata = { logicalRoomId };
    lobbyRoomOwnerTokens.set(logicalRoomId, this.lobbyRoomOwnerToken);
    activeRoomInstances.set(logicalRoomId, this);
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
      await this.ensurePlayerWorldSlot(playerId, ensuredAccount);
      this.publishLobbyRoomSummary();

      sendMessage(client, "session.state", {
        requestId: message.requestId,
        delivery: "reply",
        payload: this.buildStatePayload(playerId)
      });
    });

    this.onMessage("world.preview", (client, message: Extract<ClientMessage, { type: "world.preview" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }

      sendMessage(client, "world.preview", {
        requestId: message.requestId,
        movementPlan: planHeroMovement(this.worldRoom.getInternalState(), message.heroId, message.destination) ?? null
      });
    });

    this.onMessage("world.reachable", (client, message: Extract<ClientMessage, { type: "world.reachable" }>) => {
      const playerId = this.getPlayerId(client);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }

      sendMessage(client, "world.reachable", {
        requestId: message.requestId,
        reachableTiles: listReachableTiles(this.worldRoom.getInternalState(), message.heroId)
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
      const previousSnapshot = this.worldRoom.serializePersistenceSnapshot();
      const result = this.worldRoom.dispatch(playerId, message.action);
      try {
        await this.persistRoomState();
      } catch {
        this.restoreWorldRoom(previousSnapshot);
        this.publishLobbyRoomSummary();
        sendMessage(client, "error", { requestId: message.requestId, reason: "persistence_save_failed" });
        return;
      }
      await this.persistPlayerAccountProgress(result.events ?? [], this.worldRoom.consumeCompletedBattleReplays());

      this.publishLobbyRoomSummary();
      sendMessage(client, "session.state", {
        requestId: message.requestId,
        delivery: "reply",
        payload: this.buildStatePayload(playerId, {
          events: result.events ?? [],
          movementPlan: result.movementPlan ?? null,
          ...(result.reason ? { reason: result.reason } : {})
        })
      });
      this.broadcastState(client, {
        events: result.events ?? [],
        movementPlan: result.movementPlan ?? null
      });
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
      const result = this.worldRoom.dispatchBattle(playerId, message.action);
      try {
        await this.persistRoomState();
      } catch {
        this.restoreWorldRoom(previousSnapshot);
        this.publishLobbyRoomSummary();
        sendMessage(client, "error", { requestId: message.requestId, reason: "persistence_save_failed" });
        return;
      }
      await this.persistPlayerAccountProgress(result.events ?? [], this.worldRoom.consumeCompletedBattleReplays());

      this.publishLobbyRoomSummary();
      sendMessage(client, "session.state", {
        requestId: message.requestId,
        delivery: "reply",
        payload: this.buildStatePayload(playerId, {
          events: result.events ?? [],
          movementPlan: null,
          ...(result.reason ? { reason: result.reason } : {})
        })
      });
      this.broadcastState(client, {
        events: result.events ?? [],
        movementPlan: null
      });
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
      } catch (error) {
        const reason =
          error instanceof Error && error.message === "duplicate_player_report"
            ? "duplicate_player_report"
            : "report_submit_failed";
        sendMessage(client, "error", { requestId: message.requestId, reason });
      }
    });
  }

  onJoin(client: ColyseusClient, options?: JoinOptions): void {
    this.playerIdBySessionId.set(client.sessionId, options?.playerId ?? client.sessionId);
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

    try {
      const reconnectedClient = await this.allowReconnection(client, RECONNECTION_WINDOW_SECONDS);
      if (configuredRoomSnapshotStore?.loadPlayerBan) {
        const ban = await configuredRoomSnapshotStore.loadPlayerBan(playerId);
        if (isPlayerBanActive(ban)) {
          this.playerIdBySessionId.delete(client.sessionId);
          reconnectedClient.leave(CloseCode.WITH_ERROR, "account_banned");
          this.publishLobbyRoomSummary();
          return;
        }
      }
      if (await this.enforceMinorProtectionForClient(reconnectedClient, playerId, null, "push")) {
        this.playerIdBySessionId.delete(client.sessionId);
        this.publishLobbyRoomSummary();
        return;
      }
      this.playerIdBySessionId.delete(client.sessionId);
      this.playerIdBySessionId.set(reconnectedClient.sessionId, playerId);
      this.reconnectedAtByPlayerId.set(playerId, new Date().toISOString());
      this.publishLobbyRoomSummary();
      sendMessage(reconnectedClient, "session.state", {
        requestId: "push",
        delivery: "push",
        payload: this.buildStatePayload(playerId)
      });
    } catch {
      this.playerIdBySessionId.delete(client.sessionId);
      this.publishLobbyRoomSummary();
    }
  }

  onLeave(client: ColyseusClient): void {
    this.playerIdBySessionId.delete(client.sessionId);
    this.publishLobbyRoomSummary();
  }

  onDispose(): void {
    this.unsubscribeConfigUpdate?.();
    this.unsubscribeConfigUpdate = null;
    this.wsActionTimestampsByPlayerId.clear();

    if (lobbyRoomOwnerTokens.get(this.metadata.logicalRoomId) !== this.lobbyRoomOwnerToken) {
      return;
    }

    lobbyRoomOwnerTokens.delete(this.metadata.logicalRoomId);
    lobbyRoomSummaries.delete(this.metadata.logicalRoomId);
    activeRoomInstances.delete(this.metadata.logicalRoomId);
    removeRuntimeRoom(this.metadata.logicalRoomId);
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
    const account =
      ensuredAccount ??
      (store
        ? await store.ensurePlayerAccount({
            playerId,
            lastRoomId: this.metadata.logicalRoomId
          })
        : null);

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
          await store.savePlayerAccountProgress(playerId, {
            achievements: nextAccount.achievements,
            recentEventLog: nextAccount.recentEventLog,
            ...(playerReplays.length > 0 ? { recentBattleReplays: nextAccount.recentBattleReplays } : {}),
            ...(eloRating !== undefined ? { eloRating } : {}),
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

  private resolveReportTargetPlayerId(playerId: string, requestedTargetPlayerId: string): string | null {
    const targetPlayerId = requestedTargetPlayerId.trim();
    if (!targetPlayerId || targetPlayerId === playerId) {
      return null;
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
    const summary = {
      roomId: this.metadata.logicalRoomId,
      seed: internalState.meta.seed,
      day: internalState.meta.day,
      connectedPlayers: this.playerIdBySessionId.size,
      heroCount: internalState.heroes.length,
      activeBattles: this.worldRoom.getActiveBattles().length,
      updatedAt: new Date().toISOString()
    };
    lobbyRoomSummaries.set(this.metadata.logicalRoomId, summary);
    recordRuntimeRoom(summary);
  }

  private getPlayerId(client: ColyseusClient, fallback?: string): string | undefined {
    const playerId = this.playerIdBySessionId.get(client.sessionId) ?? fallback;
    if (playerId && !this.playerIdBySessionId.has(client.sessionId)) {
      this.playerIdBySessionId.set(client.sessionId, playerId);
    }

    return playerId;
  }

  private async ensurePlayerWorldSlot(
    playerId: string,
    ensuredAccount: PlayerAccountSnapshot | null
  ): Promise<void> {
    const internalState = this.worldRoom.getInternalState();
    if (internalState.heroes.some((hero) => hero.playerId === playerId)) {
      return;
    }

    const connectedPlayerIds = new Set(this.playerIdBySessionId.values());
    const availableSlotId = Array.from(
      new Set([...internalState.heroes.map((hero) => hero.playerId), ...Object.keys(internalState.resources)])
    )
      .filter((candidatePlayerId) => {
        if (!isDefaultPlayerSlotId(candidatePlayerId)) {
          return false;
        }

        return !connectedPlayerIds.has(candidatePlayerId);
      })
      .sort(compareDefaultPlayerSlotIds)[0];

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

  private buildStatePayload(
    playerId: string,
    extras?: {
      events?: WorldEvent[];
      movementPlan?: MovementPlan | null;
      reason?: string;
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
      reachableTiles: heroId && !battle ? listReachableTiles(this.worldRoom.getInternalState(), heroId) : [],
      ...(extras?.reason ? { reason: extras.reason } : {})
    };
  }

  private broadcastState(
    source: ColyseusClient | null,
    extras?: {
      events?: WorldEvent[];
      movementPlan?: MovementPlan | null;
      reason?: string;
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
}
