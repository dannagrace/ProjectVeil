import { Room, type Client as ColyseusClient } from "colyseus";
import {
  createInitialWorldState,
  encodePlayerWorldView,
  filterWorldEventsForPlayer,
  listReachableTiles,
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
  type PlayerAccountSnapshot,
  type RoomSnapshotStore
} from "./persistence";
import { registerConfigUpdateListener } from "./config-center";
import { applyPlayerEventLogAndAchievements } from "./player-achievements";
import { resolveGuestAuthSession } from "./auth";
import {
  recordBattleActionMessage,
  recordConnectMessage,
  recordRuntimeRoom,
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
const DEFAULT_PLAYER_SLOT_ID = /^player-(\d+)$/;
let configuredRoomSnapshotStore: RoomSnapshotStore | null = null;
const lobbyRoomSummaries = new Map<string, LobbyRoomSummary>();
const lobbyRoomOwnerTokens = new Map<string, number>();
const activeRoomInstances = new Map<string, VeilColyseusRoom>();
let nextLobbyRoomOwnerToken = 1;

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
  private readonly lobbyRoomOwnerToken = nextLobbyRoomOwnerToken++;
  private readonly playerIdBySessionId = new Map<string, string>();
  private readonly reconnectedAtByPlayerId = new Map<string, string>();
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
        } catch {
          ensuredAccount = null;
        }
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
  }

  onJoin(client: ColyseusClient, options?: JoinOptions): void {
    this.playerIdBySessionId.set(client.sessionId, options?.playerId ?? client.sessionId);
    this.publishLobbyRoomSummary();
  }

  async onDrop(client: ColyseusClient): Promise<void> {
    const playerId = this.playerIdBySessionId.get(client.sessionId);
    if (!playerId) {
      return;
    }

    try {
      const reconnectedClient = await this.allowReconnection(client, RECONNECTION_WINDOW_SECONDS);
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

    try {
      await Promise.all(
        playerIds.map(async (playerId) => {
          const playerEvents = filterWorldEventsForPlayer(internalState, playerId, events);
          const playerReplays = completedReplays.flatMap((replay) => this.buildPlayerBattleReplaysForAccount(replay, playerId));
          if (playerEvents.length === 0 && playerReplays.length === 0) {
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
          await store.savePlayerAccountProgress(playerId, {
            achievements: nextAccount.achievements,
            recentEventLog: nextAccount.recentEventLog,
            ...(nextAccount.recentBattleReplays ? { recentBattleReplays: nextAccount.recentBattleReplays } : {}),
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
    const world = encodePlayerWorldView(snapshot, options?.mapBounds ? { bounds: options.mapBounds } : undefined);
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
