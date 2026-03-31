import { createRoom, type AuthoritativeWorldRoom } from "../../../apps/server/src/index";
import { Client as ColyseusClient, CloseCode, type Room as ColyseusRoom } from "@colyseus/sdk";
import {
  decodePlayerWorldView,
  listReachableTiles,
  planHeroMovement,
  replaceRuntimeConfigs
} from "../../../packages/shared/src/index";
import type {
  BattleAction,
  BattleState,
  ClientMessage,
  EquipmentType,
  MovementPlan,
  PlayerWorldView,
  RuntimeConfigBundle,
  ServerMessage,
  SessionStatePayload,
  Vec2,
  WorldEvent
} from "../../../packages/shared/src/index";

export interface SessionUpdate {
  world: PlayerWorldView;
  battle: BattleState | null;
  events: WorldEvent[];
  movementPlan: MovementPlan | null;
  reachableTiles: Vec2[];
  reason?: string;
}

export type ConnectionEvent = "reconnecting" | "reconnected" | "reconnect_failed";

interface GameSession {
  snapshot(reason?: string): Promise<SessionUpdate>;
  moveHero(heroId: string, destination: Vec2): Promise<SessionUpdate>;
  collect(heroId: string, position: Vec2): Promise<SessionUpdate>;
  learnSkill(heroId: string, skillId: string): Promise<SessionUpdate>;
  equipHeroItem(heroId: string, slot: EquipmentType, equipmentId: string): Promise<SessionUpdate>;
  unequipHeroItem(heroId: string, slot: EquipmentType): Promise<SessionUpdate>;
  recruit(heroId: string, buildingId: string): Promise<SessionUpdate>;
  visitBuilding(heroId: string, buildingId: string): Promise<SessionUpdate>;
  claimMine(heroId: string, buildingId: string): Promise<SessionUpdate>;
  endDay(): Promise<SessionUpdate>;
  actInBattle(action: BattleAction): Promise<SessionUpdate>;
  previewMovement(heroId: string, destination: Vec2): Promise<MovementPlan | null>;
  listReachable(heroId: string): Promise<Vec2[]>;
}

interface GameSessionOptions {
  onPushUpdate?: (update: SessionUpdate) => void;
  onConfigUpdate?: (bundle: RuntimeConfigBundle) => void;
  onConnectionEvent?: (event: ConnectionEvent) => void;
  getDisplayName?: () => string | null;
  getAuthToken?: () => string | null;
}

const RECONNECTION_TOKEN_PREFIX = "project-veil:reconnection";
const SESSION_REPLAY_PREFIX = "project-veil:session-replay";
const SESSION_REPLAY_VERSION = 1;
const REMOTE_CONNECT_TIMEOUT_MS = 10000; // 延长到 10秒
const REMOTE_RECOVERY_RETRY_MS = 2000;

interface StoredSessionReplayEnvelope {
  version: number;
  storedAt: number;
  update: SessionUpdate;
}

function fromPayload(payload: SessionStatePayload, previousWorld?: PlayerWorldView | null): SessionUpdate {
  return {
    world: decodePlayerWorldView(payload.world, previousWorld),
    battle: payload.battle,
    events: payload.events,
    movementPlan: payload.movementPlan,
    reachableTiles: payload.reachableTiles,
    ...(payload.reason ? { reason: payload.reason } : {})
  };
}

export function getReconnectionStorageKey(roomId: string, playerId: string): string {
  return `${RECONNECTION_TOKEN_PREFIX}:${roomId}:${playerId}`;
}

export function getSessionReplayStorageKey(roomId: string, playerId: string): string {
  return `${SESSION_REPLAY_PREFIX}:${roomId}:${playerId}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVec2Like(value: unknown): value is Vec2 {
  return isObjectRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

function isSessionUpdateLike(value: unknown): value is SessionUpdate {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (!isObjectRecord(value.world) || !isObjectRecord(value.world.meta) || !isObjectRecord(value.world.map)) {
    return false;
  }

  if (
    typeof value.world.meta.roomId !== "string" ||
    typeof value.world.meta.seed !== "number" ||
    typeof value.world.meta.day !== "number" ||
    typeof value.world.playerId !== "string"
  ) {
    return false;
  }

  if (
    typeof value.world.map.width !== "number" ||
    typeof value.world.map.height !== "number" ||
    !Array.isArray(value.world.map.tiles) ||
    !Array.isArray(value.world.ownHeroes) ||
    !Array.isArray(value.world.visibleHeroes) ||
    !isObjectRecord(value.world.resources)
  ) {
    return false;
  }

  if (
    typeof value.world.resources.gold !== "number" ||
    typeof value.world.resources.wood !== "number" ||
    typeof value.world.resources.ore !== "number" ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.reachableTiles)
  ) {
    return false;
  }

  return value.reachableTiles.every((node) => isVec2Like(node));
}

function asStoredSessionReplayEnvelope(value: unknown): StoredSessionReplayEnvelope | null {
  if (isSessionUpdateLike(value)) {
    return {
      version: SESSION_REPLAY_VERSION,
      storedAt: 0,
      update: value
    };
  }

  if (
    !isObjectRecord(value) ||
    typeof value.version !== "number" ||
    typeof value.storedAt !== "number" ||
    !isSessionUpdateLike(value.update)
  ) {
    return null;
  }

  return {
    version: value.version,
    storedAt: value.storedAt,
    update: value.update
  };
}

export function readReconnectionToken(
  storage: Pick<Storage, "getItem">,
  roomId: string,
  playerId: string
): string | null {
  return storage.getItem(getReconnectionStorageKey(roomId, playerId));
}

export function writeReconnectionToken(
  storage: Pick<Storage, "setItem">,
  roomId: string,
  playerId: string,
  token: string
): void {
  storage.setItem(getReconnectionStorageKey(roomId, playerId), token);
}

export function clearReconnectionToken(
  storage: Pick<Storage, "removeItem">,
  roomId: string,
  playerId: string
): void {
  storage.removeItem(getReconnectionStorageKey(roomId, playerId));
}

export function readSessionReplay(
  storage: Pick<Storage, "getItem">,
  roomId: string,
  playerId: string
): SessionUpdate | null {
  const raw = storage.getItem(getSessionReplayStorageKey(roomId, playerId));
  if (!raw) {
    return null;
  }

  try {
    return asStoredSessionReplayEnvelope(JSON.parse(raw))?.update ?? null;
  } catch {
    return null;
  }
}

export function writeSessionReplay(
  storage: Pick<Storage, "setItem">,
  roomId: string,
  playerId: string,
  update: SessionUpdate
): void {
  const envelope: StoredSessionReplayEnvelope = {
    version: SESSION_REPLAY_VERSION,
    storedAt: Date.now(),
    update
  };

  storage.setItem(getSessionReplayStorageKey(roomId, playerId), JSON.stringify(envelope));
}

export function clearSessionReplay(
  storage: Pick<Storage, "removeItem">,
  roomId: string,
  playerId: string
): void {
  storage.removeItem(getSessionReplayStorageKey(roomId, playerId));
}

function getReconnectionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStoredSessionReplay(roomId: string, playerId: string): SessionUpdate | null {
  const storage = getReconnectionStorage();
  if (!storage) {
    return null;
  }

  return readSessionReplay(storage, roomId, playerId);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isRecoverableSessionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "room_left" || error.message === "connect_failed" || error.message === "connect_timeout")
  );
}

interface RemoteConnectOptions {
  useStoredToken?: boolean;
  connectTimeoutMs?: number;
}

interface LocalSessionRuntime {
  connectRemoteGameSession: typeof connectRemoteGameSession;
  createLocalSession: (roomId: string, playerId: string, seed: number) => GameSession;
  wait: typeof wait;
}

class LocalGameSession implements GameSession {
  private readonly room: AuthoritativeWorldRoom;
  private readonly playerId: string;

  constructor(roomId: string, playerId: string, seed = 1001) {
    this.room = createRoom(roomId, seed);
    this.playerId = playerId;
  }

  async snapshot(reason?: string): Promise<SessionUpdate> {
    const world = this.room.getSnapshot(this.playerId).state;
    const battle = this.room.getBattleForPlayer(this.playerId);
    const heroId = world.ownHeroes[0]?.id;
    return {
      world,
      battle,
      events: [],
      movementPlan: null,
      reachableTiles: heroId && !battle ? listReachableTiles(this.room.getInternalState(), heroId) : [],
      ...(reason ? { reason } : {})
    };
  }

  async moveHero(heroId: string, destination: Vec2): Promise<SessionUpdate> {
    const result = this.room.dispatch(this.playerId, {
      type: "hero.move",
      heroId,
      destination
    });
    const events = this.room.filterEventsForPlayer(this.playerId, result.events ?? []);
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    const battle = result.battle ?? this.room.getBattleForPlayer(this.playerId);
    return {
      world: result.snapshot.state,
      battle,
      events,
      movementPlan: result.movementPlan ?? null,
      reachableTiles: nextHeroId && !battle ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async collect(heroId: string, position: Vec2): Promise<SessionUpdate> {
    const result = this.room.dispatch(this.playerId, {
      type: "hero.collect",
      heroId,
      position
    });
    const events = this.room.filterEventsForPlayer(this.playerId, result.events ?? []);
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    const battle = result.battle ?? this.room.getBattleForPlayer(this.playerId);
    return {
      world: result.snapshot.state,
      battle,
      events,
      movementPlan: result.movementPlan ?? null,
      reachableTiles: nextHeroId && !battle ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async learnSkill(heroId: string, skillId: string): Promise<SessionUpdate> {
    const result = this.room.dispatch(this.playerId, {
      type: "hero.learnSkill",
      heroId,
      skillId
    });
    const events = this.room.filterEventsForPlayer(this.playerId, result.events ?? []);
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    const battle = result.battle ?? this.room.getBattleForPlayer(this.playerId);
    return {
      world: result.snapshot.state,
      battle,
      events,
      movementPlan: result.movementPlan ?? null,
      reachableTiles: nextHeroId && !battle ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async equipHeroItem(heroId: string, slot: EquipmentType, equipmentId: string): Promise<SessionUpdate> {
    const result = this.room.dispatch(this.playerId, {
      type: "hero.equip",
      heroId,
      slot,
      equipmentId
    });
    const events = this.room.filterEventsForPlayer(this.playerId, result.events ?? []);
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    const battle = result.battle ?? this.room.getBattleForPlayer(this.playerId);
    return {
      world: result.snapshot.state,
      battle,
      events,
      movementPlan: result.movementPlan ?? null,
      reachableTiles: nextHeroId && !battle ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async unequipHeroItem(heroId: string, slot: EquipmentType): Promise<SessionUpdate> {
    const result = this.room.dispatch(this.playerId, {
      type: "hero.unequip",
      heroId,
      slot
    });
    const events = this.room.filterEventsForPlayer(this.playerId, result.events ?? []);
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    const battle = result.battle ?? this.room.getBattleForPlayer(this.playerId);
    return {
      world: result.snapshot.state,
      battle,
      events,
      movementPlan: result.movementPlan ?? null,
      reachableTiles: nextHeroId && !battle ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async recruit(heroId: string, buildingId: string): Promise<SessionUpdate> {
    const result = this.room.dispatch(this.playerId, {
      type: "hero.recruit",
      heroId,
      buildingId
    });
    const events = this.room.filterEventsForPlayer(this.playerId, result.events ?? []);
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    const battle = result.battle ?? this.room.getBattleForPlayer(this.playerId);
    return {
      world: result.snapshot.state,
      battle,
      events,
      movementPlan: result.movementPlan ?? null,
      reachableTiles: nextHeroId && !battle ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async visitBuilding(heroId: string, buildingId: string): Promise<SessionUpdate> {
    const result = this.room.dispatch(this.playerId, {
      type: "hero.visit",
      heroId,
      buildingId
    });
    const events = this.room.filterEventsForPlayer(this.playerId, result.events ?? []);
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    const battle = result.battle ?? this.room.getBattleForPlayer(this.playerId);
    return {
      world: result.snapshot.state,
      battle,
      events,
      movementPlan: result.movementPlan ?? null,
      reachableTiles: nextHeroId && !battle ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async claimMine(heroId: string, buildingId: string): Promise<SessionUpdate> {
    const result = this.room.dispatch(this.playerId, {
      type: "hero.claimMine",
      heroId,
      buildingId
    });
    const events = this.room.filterEventsForPlayer(this.playerId, result.events ?? []);
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    const battle = result.battle ?? this.room.getBattleForPlayer(this.playerId);
    return {
      world: result.snapshot.state,
      battle,
      events,
      movementPlan: result.movementPlan ?? null,
      reachableTiles: nextHeroId && !battle ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async endDay(): Promise<SessionUpdate> {
    const result = this.room.dispatch(this.playerId, {
      type: "turn.endDay"
    });
    const events = this.room.filterEventsForPlayer(this.playerId, result.events ?? []);
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    const battle = result.battle ?? this.room.getBattleForPlayer(this.playerId);
    return {
      world: result.snapshot.state,
      battle,
      events,
      movementPlan: result.movementPlan ?? null,
      reachableTiles: nextHeroId && !battle ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async actInBattle(action: BattleAction): Promise<SessionUpdate> {
    const result = this.room.dispatchBattle(this.playerId, action);
    const events = this.room.filterEventsForPlayer(this.playerId, result.events ?? []);
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    const battle = result.battle ?? this.room.getBattleForPlayer(this.playerId);
    return {
      world: result.snapshot.state,
      battle,
      events,
      movementPlan: null,
      reachableTiles: nextHeroId && !battle ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async previewMovement(heroId: string, destination: Vec2): Promise<MovementPlan | null> {
    return planHeroMovement(this.room.getInternalState(), heroId, destination) ?? null;
  }

  async listReachable(heroId: string): Promise<Vec2[]> {
    return listReachableTiles(this.room.getInternalState(), heroId);
  }
}

class RemoteGameSession implements GameSession {
  private readonly room: ColyseusRoom;
  private readonly roomId: string;
  private readonly playerId: string;
  private readonly onPushUpdate: ((update: SessionUpdate) => void) | undefined;
  private readonly onConfigUpdate: ((bundle: RuntimeConfigBundle) => void) | undefined;
  private readonly onConnectionEvent: ((event: ConnectionEvent) => void) | undefined;
  private readonly getDisplayName: (() => string | null) | undefined;
  private readonly getAuthToken: (() => string | null) | undefined;
  private latestWorld: PlayerWorldView | null = null;
  private requestCounter = 0;
  private readonly pendingRequests = new Map<
    string,
    {
      expectedType: ServerMessage["type"];
      resolve: (message: ServerMessage) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(room: ColyseusRoom, roomId: string, playerId: string, options?: GameSessionOptions) {
    this.room = room;
    this.roomId = roomId;
    this.playerId = playerId;
    this.onPushUpdate = options?.onPushUpdate;
    this.onConfigUpdate = options?.onConfigUpdate;
    this.onConnectionEvent = options?.onConnectionEvent;
    this.getDisplayName = options?.getDisplayName;
    this.getAuthToken = options?.getAuthToken;
    this.persistReconnectionToken();
    this.room.onMessage("*", (type, payload) => {
      if (typeof type !== "string") {
        return;
      }

      const message = { type, ...(payload as object) } as ServerMessage;
      if (message.type === "session.state" && message.delivery === "push") {
        const update = fromPayload(message.payload, this.latestWorld);
        this.latestWorld = update.world;
        this.persistSessionReplay(update);
        this.onPushUpdate?.(update);
        return;
      }

      // 实时劫持：处理 Admin 后台发来的强制同步请求
      if (type === "session.sync_resources") {
        const syncPayload = payload as { playerId: string; resources: { gold: number; wood: number; ore: number } };
        if (syncPayload.playerId === this.playerId && this.latestWorld) {
            console.log("[Network] ADMIN SYNC RECEIVED:", syncPayload.resources);
            this.latestWorld.resources = { ...syncPayload.resources };
            this.onPushUpdate?.({
                world: this.latestWorld,
                battle: null,
                events: [{ type: "system.announcement", text: "管理员修改了您的资源", tone: "system" } as any],
                movementPlan: null,
                reachableTiles: []
            });
        }
        return;
      }

      if (message.type === "config.update") {
        const bundle = (message as Extract<ServerMessage, { type: "config.update" }>).payload.bundle;
        console.log("[Config] Runtime config updated from server");
        replaceRuntimeConfigs(bundle);
        this.onConfigUpdate?.(bundle);
        return;
      }

      const pending = "requestId" in message ? this.pendingRequests.get(message.requestId) : undefined;
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(message.requestId);

      if (message.type === "error") {
        pending.reject(new Error(message.reason));
        return;
      }

      if (message.type !== pending.expectedType) {
        pending.reject(new Error(`Unexpected response type: ${message.type}`));
        return;
      }

      pending.resolve(message);
    });

    this.room.onDrop(() => {
      this.onConnectionEvent?.("reconnecting");
    });

    this.room.onReconnect(() => {
      this.persistReconnectionToken();
      this.onConnectionEvent?.("reconnected");
    });

    this.room.onLeave((code) => {
      if (code === CloseCode.CONSENTED) {
        this.clearReconnectionToken();
        this.clearPersistedSessionReplay();
      } else if (code === CloseCode.FAILED_TO_RECONNECT) {
        this.onConnectionEvent?.("reconnect_failed");
      }

      for (const pending of this.pendingRequests.values()) {
        pending.reject(new Error("room_left"));
      }
      this.pendingRequests.clear();
    });
  }

  private persistReconnectionToken(): void {
    const storage = getReconnectionStorage();
    if (!storage || !this.room.reconnectionToken) {
      return;
    }

    writeReconnectionToken(storage, this.roomId, this.playerId, this.room.reconnectionToken);
  }

  private clearReconnectionToken(): void {
    const storage = getReconnectionStorage();
    if (!storage) {
      return;
    }

    clearReconnectionToken(storage, this.roomId, this.playerId);
  }

  private persistSessionReplay(update: SessionUpdate): void {
    const storage = getReconnectionStorage();
    if (!storage) {
      return;
    }

    writeSessionReplay(storage, this.roomId, this.playerId, update);
  }

  private clearPersistedSessionReplay(): void {
    const storage = getReconnectionStorage();
    if (!storage) {
      return;
    }

    clearSessionReplay(storage, this.roomId, this.playerId);
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `req-${this.requestCounter}`;
  }

  private send<T extends ServerMessage>(message: ClientMessage, expectedType: T["type"]): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(message.requestId, {
        expectedType,
        resolve: (payload) => resolve(payload as T),
        reject
      });
      this.room.send(message.type, message);
    });
  }

  async snapshot(): Promise<SessionUpdate> {
    const displayName = this.getDisplayName?.()?.trim();
    const authToken = this.getAuthToken?.()?.trim();
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "connect",
        requestId: this.nextRequestId(),
        roomId: this.roomId,
        playerId: this.playerId,
        ...(displayName ? { displayName } : {}),
        ...(authToken ? { authToken } : {})
      },
      "session.state"
    );
    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    this.persistSessionReplay(update);
    return update;
  }

  async moveHero(heroId: string, destination: Vec2): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.move",
          heroId,
          destination
        }
      },
      "session.state"
    );
    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    this.persistSessionReplay(update);
    return update;
  }

  async collect(heroId: string, position: Vec2): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.collect",
          heroId,
          position
        }
      },
      "session.state"
    );
    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    this.persistSessionReplay(update);
    return update;
  }

  async learnSkill(heroId: string, skillId: string): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.learnSkill",
          heroId,
          skillId
        }
      },
      "session.state"
    );
    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    this.persistSessionReplay(update);
    return update;
  }

  async equipHeroItem(heroId: string, slot: EquipmentType, equipmentId: string): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.equip",
          heroId,
          slot,
          equipmentId
        }
      },
      "session.state"
    );
    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    this.persistSessionReplay(update);
    return update;
  }

  async unequipHeroItem(heroId: string, slot: EquipmentType): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.unequip",
          heroId,
          slot
        }
      },
      "session.state"
    );
    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    this.persistSessionReplay(update);
    return update;
  }

  async recruit(heroId: string, buildingId: string): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.recruit",
          heroId,
          buildingId
        }
      },
      "session.state"
    );
    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    this.persistSessionReplay(update);
    return update;
  }

  async visitBuilding(heroId: string, buildingId: string): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.visit",
          heroId,
          buildingId
        }
      },
      "session.state"
    );
    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    this.persistSessionReplay(update);
    return update;
  }

  async claimMine(heroId: string, buildingId: string): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.claimMine",
          heroId,
          buildingId
        }
      },
      "session.state"
    );
    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    this.persistSessionReplay(update);
    return update;
  }

  async endDay(): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "turn.endDay"
        }
      },
      "session.state"
    );
    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    this.persistSessionReplay(update);
    return update;
  }

  async actInBattle(action: BattleAction): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "battle.action",
        requestId: this.nextRequestId(),
        action
      },
      "session.state"
    );
    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    this.persistSessionReplay(update);
    return update;
  }

  async previewMovement(heroId: string, destination: Vec2): Promise<MovementPlan | null> {
    const response = await this.send<Extract<ServerMessage, { type: "world.preview" }>>(
      {
        type: "world.preview",
        requestId: this.nextRequestId(),
        heroId,
        destination
      },
      "world.preview"
    );
    return response.movementPlan;
  }

  async listReachable(heroId: string): Promise<Vec2[]> {
    const response = await this.send<Extract<ServerMessage, { type: "world.reachable" }>>(
      {
        type: "world.reachable",
        requestId: this.nextRequestId(),
        heroId
      },
      "world.reachable"
    );
    return response.reachableTiles;
  }
}

async function connectRemoteGameSession(
  roomId: string,
  playerId: string,
  seed = 1001,
  options?: GameSessionOptions,
  connectOptions?: RemoteConnectOptions
): Promise<{ session: RemoteGameSession; recoveredFromStoredToken: boolean }> {
  // 强制锁定 127.0.0.1:2567，规避 DNS 和 localhost IPv6 解析问题
  const remoteUrl = "ws://127.0.0.1:2567";
  
  const storage = getReconnectionStorage();
  const useStoredToken = connectOptions?.useStoredToken ?? true;
  const reconnectionToken = useStoredToken && storage ? readReconnectionToken(storage, roomId, playerId) : null;
  const client = new ColyseusClient(remoteUrl);
  let recoveredFromStoredToken = false;

  const room = await new Promise<ColyseusRoom>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      console.error("[Network] WS Connection TIMEOUT after 10s");
      reject(new Error("connect_timeout"));
    }, connectOptions?.connectTimeoutMs ?? REMOTE_CONNECT_TIMEOUT_MS);

    const tryJoin = async (): Promise<ColyseusRoom> => {
      if (reconnectionToken) {
        try {
          console.log("[Network] Attempting WS Reconnection...");
          const recoveredRoom = await client.reconnect(reconnectionToken);
          recoveredFromStoredToken = true;
          return recoveredRoom;
        } catch (e) {
          console.warn("[Network] WS Reconnection failed, trying fresh join.", e);
          if (storage) {
            clearReconnectionToken(storage, roomId, playerId);
          }
        }
      }

      console.log(`[Network] Joining room ${roomId} as ${playerId} via ${remoteUrl}`);
      return client.joinOrCreate("veil", {
        logicalRoomId: roomId,
        playerId,
        seed
      });
    };

    tryJoin()
      .then((joinedRoom) => {
        window.clearTimeout(timer);
        console.log("[Network] WS Connection SUCCESS!");
        resolve(joinedRoom);
      })
      .catch((err) => {
        window.clearTimeout(timer);
        console.error("[Network] WS Connection FAILED:", err);
        reject(new Error("connect_failed"));
      });
  });

  return {
    session: new RemoteGameSession(room, roomId, playerId, options),
    recoveredFromStoredToken
  };
}

const defaultLocalSessionRuntime: LocalSessionRuntime = {
  connectRemoteGameSession,
  createLocalSession: (roomId, playerId, seed) => new LocalGameSession(roomId, playerId, seed),
  wait
};

class RecoverableRemoteGameSession implements GameSession {
  private currentSession!: RemoteGameSession;
  private recoveryPromise: Promise<void> | null = null;

  private constructor(
    private readonly roomId: string,
    private readonly playerId: string,
    private readonly seed: number,
    private readonly options?: GameSessionOptions,
    private readonly runtime: LocalSessionRuntime = defaultLocalSessionRuntime
  ) {}

  static async create(
    roomId: string,
    playerId: string,
    seed = 1001,
    options?: GameSessionOptions,
    runtime: LocalSessionRuntime = defaultLocalSessionRuntime
  ): Promise<RecoverableRemoteGameSession> {
    const session = new RecoverableRemoteGameSession(roomId, playerId, seed, options, runtime);
    const { session: remoteSession, recoveredFromStoredToken } = await session.openRemoteSession(true);
    session.currentSession = remoteSession;
    if (recoveredFromStoredToken) {
      options?.onConnectionEvent?.("reconnected");
    }
    return session;
  }

  private async openRemoteSession(
    useStoredToken: boolean
  ): Promise<{ session: RemoteGameSession; recoveredFromStoredToken: boolean }> {
    const sessionOptions: GameSessionOptions = {
      ...(this.options?.onPushUpdate ? { onPushUpdate: this.options.onPushUpdate } : {}),
      ...(this.options?.onConfigUpdate ? { onConfigUpdate: this.options.onConfigUpdate } : {}),
      ...(this.options?.getDisplayName ? { getDisplayName: this.options.getDisplayName } : {}),
      ...(this.options?.getAuthToken ? { getAuthToken: this.options.getAuthToken } : {}),
      onConnectionEvent: (event) => this.handleConnectionEvent(event)
    };

    return this.runtime.connectRemoteGameSession(
      this.roomId,
      this.playerId,
      this.seed,
      sessionOptions,
      { useStoredToken }
    );
  }

  private handleConnectionEvent(event: ConnectionEvent): void {
    if (event === "reconnect_failed") {
      this.options?.onConnectionEvent?.("reconnect_failed");
      void this.beginRecovery();
      return;
    }

    this.options?.onConnectionEvent?.(event);
  }

  private beginRecovery(): Promise<void> {
    if (this.recoveryPromise) {
      return this.recoveryPromise;
    }

    this.recoveryPromise = (async () => {
      const storage = getReconnectionStorage();
      if (storage) {
        clearReconnectionToken(storage, this.roomId, this.playerId);
      }

      while (true) {
        try {
          const { session } = await this.openRemoteSession(false);
          this.currentSession = session;
          const snapshot = await session.snapshot();
          this.options?.onPushUpdate?.(snapshot);
          this.options?.onConnectionEvent?.("reconnected");
          return;
        } catch {
          await this.runtime.wait(REMOTE_RECOVERY_RETRY_MS);
        }
      }
    })().finally(() => {
      this.recoveryPromise = null;
    });

    return this.recoveryPromise;
  }

  private async getActiveSession(): Promise<RemoteGameSession> {
    if (this.recoveryPromise) {
      await this.recoveryPromise;
    }

    return this.currentSession;
  }

  private async runWithSession<T>(operation: (session: RemoteGameSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.getActiveSession();
      try {
        return await operation(session);
      } catch (error) {
        if (!isRecoverableSessionError(error)) {
          throw error;
        }

        await this.beginRecovery();
      }
    }

    throw new Error("session_unavailable");
  }

  async snapshot(reason?: string): Promise<SessionUpdate> {
    const update = await this.runWithSession((session) => session.snapshot());
    return reason ? { ...update, reason } : update;
  }

  async moveHero(heroId: string, destination: Vec2): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.moveHero(heroId, destination));
  }

  async collect(heroId: string, position: Vec2): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.collect(heroId, position));
  }

  async learnSkill(heroId: string, skillId: string): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.learnSkill(heroId, skillId));
  }

  async equipHeroItem(heroId: string, slot: EquipmentType, equipmentId: string): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.equipHeroItem(heroId, slot, equipmentId));
  }

  async unequipHeroItem(heroId: string, slot: EquipmentType): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.unequipHeroItem(heroId, slot));
  }

  async recruit(heroId: string, buildingId: string): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.recruit(heroId, buildingId));
  }

  async visitBuilding(heroId: string, buildingId: string): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.visitBuilding(heroId, buildingId));
  }

  async claimMine(heroId: string, buildingId: string): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.claimMine(heroId, buildingId));
  }

  async endDay(): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.endDay());
  }

  async actInBattle(action: BattleAction): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.actInBattle(action));
  }

  async previewMovement(heroId: string, destination: Vec2): Promise<MovementPlan | null> {
    return this.runWithSession((session) => session.previewMovement(heroId, destination));
  }

  async listReachable(heroId: string): Promise<Vec2[]> {
    return this.runWithSession((session) => session.listReachable(heroId));
  }
}

async function createGameSessionWithRuntime(
  roomId: string,
  playerId: string,
  seed = 1001,
  options?: GameSessionOptions,
  runtime: LocalSessionRuntime = defaultLocalSessionRuntime
): Promise<GameSession> {
  // 强制尝试创建远程连接
  console.log(`[Network] FORCING Remote Session for ${playerId}...`);
  return await RecoverableRemoteGameSession.create(roomId, playerId, seed, options, runtime);
}

export async function createGameSession(
  roomId: string,
  playerId: string,
  seed = 1001,
  options?: GameSessionOptions
): Promise<GameSession> {
  return createGameSessionWithRuntime(roomId, playerId, seed, options);
}

export const localSessionTestHooks = {
  createGameSessionWithRuntime(
    roomId: string,
    playerId: string,
    seed = 1001,
    options?: GameSessionOptions,
    runtimeOverrides?: Partial<LocalSessionRuntime>
  ): Promise<GameSession> {
    return createGameSessionWithRuntime(roomId, playerId, seed, options, {
      ...defaultLocalSessionRuntime,
      ...runtimeOverrides
    });
  },
  createRemoteGameSession(
    room: ColyseusRoom,
    roomId: string,
    playerId: string,
    options?: GameSessionOptions
  ): GameSession {
    return new RemoteGameSession(room, roomId, playerId, options);
  }
};
