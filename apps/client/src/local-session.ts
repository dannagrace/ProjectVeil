import { createRoom, type AuthoritativeWorldRoom } from "../../../apps/server/src/index";
import type {
  BattleAction,
  BattleState,
  ClientMessage,
  MovementPlan,
  PlayerWorldView,
  ServerMessage,
  SessionStatePayload,
  Vec2,
  WorldEvent
} from "../../../packages/shared/src/index";
import { listReachableTiles, planHeroMovement } from "../../../packages/shared/src/index";

export interface SessionUpdate {
  world: PlayerWorldView;
  battle: BattleState | null;
  events: WorldEvent[];
  movementPlan: MovementPlan | null;
  reachableTiles: Vec2[];
  reason?: string;
}

interface GameSession {
  snapshot(reason?: string): Promise<SessionUpdate>;
  moveHero(heroId: string, destination: Vec2): Promise<SessionUpdate>;
  collect(heroId: string, position: Vec2): Promise<SessionUpdate>;
  actInBattle(action: BattleAction): Promise<SessionUpdate>;
  previewMovement(heroId: string, destination: Vec2): Promise<MovementPlan | null>;
  listReachable(heroId: string): Promise<Vec2[]>;
}

interface GameSessionOptions {
  onPushUpdate?: (update: SessionUpdate) => void;
}

function fromPayload(payload: SessionStatePayload): SessionUpdate {
  return {
    world: payload.world,
    battle: payload.battle,
    events: payload.events,
    movementPlan: payload.movementPlan,
    reachableTiles: payload.reachableTiles,
    ...(payload.reason ? { reason: payload.reason } : {})
  };
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
    const heroId = world.ownHeroes[0]?.id;
    return {
      world,
      battle: this.room.getActiveBattle(),
      events: [],
      movementPlan: null,
      reachableTiles: heroId ? listReachableTiles(this.room.getInternalState(), heroId) : [],
      ...(reason ? { reason } : {})
    };
  }

  async moveHero(heroId: string, destination: Vec2): Promise<SessionUpdate> {
    const result = this.room.dispatch(this.playerId, {
      type: "hero.move",
      heroId,
      destination
    });
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    return {
      world: result.snapshot.state,
      battle: result.battle ?? this.room.getActiveBattle(),
      events: result.events ?? [],
      movementPlan: result.movementPlan ?? null,
      reachableTiles: nextHeroId && !this.room.getActiveBattle() ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async collect(heroId: string, position: Vec2): Promise<SessionUpdate> {
    const result = this.room.dispatch(this.playerId, {
      type: "hero.collect",
      heroId,
      position
    });
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    return {
      world: result.snapshot.state,
      battle: result.battle ?? this.room.getActiveBattle(),
      events: result.events ?? [],
      movementPlan: result.movementPlan ?? null,
      reachableTiles: nextHeroId && !this.room.getActiveBattle() ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  async actInBattle(action: BattleAction): Promise<SessionUpdate> {
    const result = this.room.dispatchBattle(this.playerId, action);
    const nextHeroId = result.snapshot.state.ownHeroes[0]?.id;
    return {
      world: result.snapshot.state,
      battle: result.battle ?? this.room.getActiveBattle(),
      events: result.events ?? [],
      movementPlan: null,
      reachableTiles: nextHeroId && !this.room.getActiveBattle() ? listReachableTiles(this.room.getInternalState(), nextHeroId) : [],
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
  private readonly socket: WebSocket;
  private readonly roomId: string;
  private readonly playerId: string;
  private readonly onPushUpdate: ((update: SessionUpdate) => void) | undefined;
  private requestCounter = 0;

  constructor(socket: WebSocket, roomId: string, playerId: string, options?: GameSessionOptions) {
    this.socket = socket;
    this.roomId = roomId;
    this.playerId = playerId;
    this.onPushUpdate = options?.onPushUpdate;
    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as ServerMessage;
      if (payload.type === "session.state" && payload.delivery === "push") {
        this.onPushUpdate?.(fromPayload(payload.payload));
      }
    });
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `req-${this.requestCounter}`;
  }

  private send<T extends ServerMessage>(message: ClientMessage, expectedType: T["type"]): Promise<T> {
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        const payload = JSON.parse(String(event.data)) as ServerMessage;
        if (payload.requestId !== message.requestId) {
          return;
        }

        this.socket.removeEventListener("message", onMessage);
        if (payload.type === "error") {
          reject(new Error(payload.reason));
          return;
        }

        if (payload.type !== expectedType) {
          reject(new Error(`Unexpected response type: ${payload.type}`));
          return;
        }

        resolve(payload as T);
      };

      this.socket.addEventListener("message", onMessage);
      this.socket.send(JSON.stringify(message));
    });
  }

  async snapshot(): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "connect",
        requestId: this.nextRequestId(),
        roomId: this.roomId,
        playerId: this.playerId
      },
      "session.state"
    );
    return fromPayload(response.payload);
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
    return fromPayload(response.payload);
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
    return fromPayload(response.payload);
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
    return fromPayload(response.payload);
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

export async function createGameSession(
  roomId: string,
  playerId: string,
  seed = 1001,
  options?: GameSessionOptions
): Promise<GameSession> {
  const remoteUrl = `ws://${window.location.hostname || "127.0.0.1"}:2567`;

  try {
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(remoteUrl);
      const timer = window.setTimeout(() => {
        ws.close();
        reject(new Error("connect_timeout"));
      }, 1200);

      ws.addEventListener("open", () => {
        window.clearTimeout(timer);
        resolve(ws);
      });

      ws.addEventListener("error", () => {
        window.clearTimeout(timer);
        reject(new Error("connect_failed"));
      });
    });

    return new RemoteGameSession(socket, roomId, playerId, options);
  } catch {
    return new LocalGameSession(roomId, playerId, seed);
  }
}
