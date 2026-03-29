import type { SessionUpdate } from "../../assets/scripts/VeilCocosSession.ts";

export function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear(): void {
      values.clear();
    },
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      values.delete(key);
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    }
  };
}

export function createSessionUpdate(day = 1, roomId = "room-alpha", playerId = "player-1"): SessionUpdate {
  return {
    world: {
      meta: {
        roomId,
        seed: 1001,
        day
      },
      map: {
        width: 2,
        height: 2,
        tiles: [
          {
            position: { x: 0, y: 0 },
            fog: "visible",
            terrain: "grass",
            walkable: true,
            resource: undefined,
            occupant: undefined,
            building: undefined
          },
          {
            position: { x: 1, y: 0 },
            fog: "explored",
            terrain: "dirt",
            walkable: true,
            resource: undefined,
            occupant: undefined,
            building: undefined
          },
          {
            position: { x: 0, y: 1 },
            fog: "hidden",
            terrain: "sand",
            walkable: true,
            resource: undefined,
            occupant: undefined,
            building: undefined
          },
          {
            position: { x: 1, y: 1 },
            fog: "visible",
            terrain: "grass",
            walkable: true,
            resource: undefined,
            occupant: undefined,
            building: undefined
          }
        ]
      },
      ownHeroes: [
        {
          id: "hero-1",
          playerId,
          name: "暮潮守望",
          position: { x: 0, y: 0 },
          vision: 3,
          move: {
            total: 8,
            remaining: 6
          },
          stats: {
            attack: 2,
            defense: 2,
            power: 1,
            knowledge: 1,
            hp: 12,
            maxHp: 12
          },
          progression: {
            level: 1,
            experience: 0,
            skillPoints: 1,
            battlesWon: 0,
            neutralBattlesWon: 0,
            pvpBattlesWon: 0
          },
          loadout: {
            learnedSkills: [],
            equipment: {
              trinketIds: []
            },
            inventory: []
          },
          armyCount: 12,
          armyTemplateId: "militia",
          learnedSkills: []
        }
      ],
      visibleHeroes: [],
      resources: {
        gold: 1000,
        wood: 10,
        ore: 10
      },
      playerId
    },
    battle: null,
    events: [],
    movementPlan: null,
    reachableTiles: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
  };
}

export function toSessionStatePayload(update: SessionUpdate) {
  return {
    world: {
      ...update.world,
      map: {
        width: update.world.map.width,
        height: update.world.map.height,
        tiles: update.world.map.tiles
      }
    },
    battle: update.battle,
    events: update.events,
    movementPlan: update.movementPlan,
    reachableTiles: update.reachableTiles,
    ...(update.reason ? { reason: update.reason } : {})
  };
}

type MessageHandler = (type: string, payload: unknown) => void;

export class FakeColyseusRoom {
  reconnectionToken?: string;
  readonly sentMessages: Array<{ type: string; payload: unknown }> = [];
  readonly connectReplies: SessionUpdate[];
  private messageHandler: MessageHandler | null = null;
  private dropHandler: (() => void) | null = null;
  private reconnectHandler: (() => void) | null = null;
  private leaveHandler: ((code: number) => void) | null = null;

  constructor(connectReplies: SessionUpdate[], reconnectionToken?: string) {
    this.connectReplies = [...connectReplies];
    this.reconnectionToken = reconnectionToken;
  }

  onMessage(_type: string, callback: MessageHandler): void {
    this.messageHandler = callback;
  }

  onDrop(callback: () => void): void {
    this.dropHandler = callback;
  }

  onReconnect(callback: () => void): void {
    this.reconnectHandler = callback;
  }

  onLeave(callback: (code: number) => void): void {
    this.leaveHandler = callback;
  }

  async leave(): Promise<void> {
    this.leaveHandler?.(1000);
  }

  send(type: string, payload: { requestId: string }): void {
    this.sentMessages.push({ type, payload });
    if (type === "connect") {
      const reply = this.connectReplies.shift();
      if (!reply) {
        throw new Error("missing_connect_reply");
      }

      this.messageHandler?.("session.state", {
        type: "session.state",
        requestId: payload.requestId,
        delivery: "reply",
        payload: toSessionStatePayload(reply)
      });
    }
  }

  emitPush(update: SessionUpdate): void {
    this.messageHandler?.("session.state", {
      type: "session.state",
      requestId: "push-1",
      delivery: "push",
      payload: toSessionStatePayload(update)
    });
  }

  emitDrop(): void {
    this.dropHandler?.();
  }

  emitReconnect(): void {
    this.reconnectHandler?.();
  }

  emitLeave(code: number): void {
    this.leaveHandler?.(code);
  }
}

export function createSdkLoader(options: {
  reconnectRooms?: FakeColyseusRoom[];
  joinRooms?: Array<FakeColyseusRoom | Error>;
  reconnectTokens?: string[];
  joinedOptions?: Array<{ logicalRoomId: string; playerId: string; seed: number }>;
  endpoints?: string[];
}) {
  const reconnectRooms = [...(options.reconnectRooms ?? [])];
  const joinRooms = [...(options.joinRooms ?? [])];
  const reconnectTokens = options.reconnectTokens ?? [];
  const joinedOptions = options.joinedOptions ?? [];
  const endpoints = options.endpoints ?? [];

  return async () => ({
    CloseCode: {
      CONSENTED: 1000,
      FAILED_TO_RECONNECT: 4002,
      MAY_TRY_RECONNECT: 4001
    },
    Client: class FakeClient {
      constructor(endpoint: string) {
        endpoints.push(endpoint);
      }

      async reconnect(reconnectionToken: string): Promise<FakeColyseusRoom> {
        reconnectTokens.push(reconnectionToken);
        const room = reconnectRooms.shift();
        if (!room) {
          throw new Error("missing_reconnect_room");
        }
        return room;
      }

      async joinOrCreate(
        _roomName: string,
        roomOptions: { logicalRoomId: string; playerId: string; seed: number }
      ): Promise<FakeColyseusRoom> {
        joinedOptions.push(roomOptions);
        const next = joinRooms.shift();
        if (!next) {
          throw new Error("missing_join_room");
        }
        if (next instanceof Error) {
          throw next;
        }
        return next;
      }
    }
  });
}
