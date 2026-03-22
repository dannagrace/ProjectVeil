import { Room, type Client as ColyseusClient } from "colyseus";
import {
  filterWorldEventsForPlayer,
  listReachableTiles,
  planHeroMovement,
  type ClientMessage,
  type MovementPlan,
  type ServerMessage,
  type SessionStatePayload,
  type WorldEvent
} from "../../../packages/shared/src/index";
import { createRoom, type AuthoritativeWorldRoom, type RoomPersistenceSnapshot } from "./index";
import type { RoomSnapshotStore } from "./persistence";

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
let configuredRoomSnapshotStore: RoomSnapshotStore | null = null;

export function configureRoomSnapshotStore(store: RoomSnapshotStore | null): void {
  configuredRoomSnapshotStore = store;
}

function sendMessage<T extends ServerMessage["type"]>(
  client: ColyseusClient,
  type: T,
  payload: MessageOfType<T>
): void {
  client.send(type, payload);
}

export class VeilColyseusRoom extends Room<VeilRoomOptions> {
  maxClients = 8;
  patchRate = null;

  private worldRoom!: AuthoritativeWorldRoom;
  private readonly playerIdBySessionId = new Map<string, string>();

  async onCreate(options: JoinOptions): Promise<void> {
    const logicalRoomId = options.logicalRoomId ?? "room-alpha";
    this.metadata = { logicalRoomId };
    this.setState({});
    const persistedSnapshot = configuredRoomSnapshotStore
      ? await configuredRoomSnapshotStore.load(logicalRoomId)
      : null;
    this.worldRoom = createRoom(logicalRoomId, options.seed, persistedSnapshot ?? undefined);
    await this.persistRoomState();

    this.onMessage("connect", (client, message: Extract<ClientMessage, { type: "connect" }>) => {
      const playerId = this.getPlayerId(client, message.playerId);
      if (!playerId) {
        sendMessage(client, "error", { requestId: message.requestId, reason: "not_connected" });
        return;
      }

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

      const previousSnapshot = this.worldRoom.serializePersistenceSnapshot();
      const result = this.worldRoom.dispatch(playerId, message.action);
      try {
        await this.persistRoomState();
      } catch {
        this.restoreWorldRoom(previousSnapshot);
        sendMessage(client, "error", { requestId: message.requestId, reason: "persistence_save_failed" });
        return;
      }

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

      const previousSnapshot = this.worldRoom.serializePersistenceSnapshot();
      const result = this.worldRoom.dispatchBattle(playerId, message.action);
      try {
        await this.persistRoomState();
      } catch {
        this.restoreWorldRoom(previousSnapshot);
        sendMessage(client, "error", { requestId: message.requestId, reason: "persistence_save_failed" });
        return;
      }

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
      sendMessage(reconnectedClient, "session.state", {
        requestId: "push",
        delivery: "push",
        payload: this.buildStatePayload(playerId)
      });
    } catch {
      this.playerIdBySessionId.delete(client.sessionId);
    }
  }

  onLeave(client: ColyseusClient): void {
    this.playerIdBySessionId.delete(client.sessionId);
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

  private getPlayerId(client: ColyseusClient, fallback?: string): string | undefined {
    const playerId = this.playerIdBySessionId.get(client.sessionId) ?? fallback;
    if (playerId && !this.playerIdBySessionId.has(client.sessionId)) {
      this.playerIdBySessionId.set(client.sessionId, playerId);
    }

    return playerId;
  }

  private buildStatePayload(
    playerId: string,
    extras?: {
      events?: WorldEvent[];
      movementPlan?: MovementPlan | null;
      reason?: string;
    }
  ): SessionStatePayload {
    const world = this.worldRoom.getSnapshot(playerId).state;
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

      sendMessage(client, "session.state", {
        requestId: "push",
        delivery: "push",
        payload: this.buildStatePayload(playerId, {
          movementPlan: null,
          ...(extras?.events ? { events: extras.events } : {}),
          ...(extras?.reason ? { reason: extras.reason } : {})
        })
      });
    }
  }
}
