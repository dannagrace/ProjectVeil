import { DEFAULT_FEATURE_FLAGS } from "../../../../packages/shared/src/index.ts";
import type { SessionUpdate } from "../../assets/scripts/VeilCocosSession.ts";

type FakeRoomReply =
  | SessionUpdate
  | {
      kind: "state";
      payload: unknown;
      delivery?: "reply" | "push";
    }
  | {
      kind: "report";
      reportId: string;
      targetPlayerId: string;
      reason: "cheating" | "harassment" | "afk";
      status: "pending" | "dismissed" | "warned" | "banned";
      createdAt: string;
    }
  | {
      kind: "reachable";
      reachableTiles: Array<{ x: number; y: number }>;
    }
  | {
      kind: "error";
      reason: string;
    };

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
    reachableTiles: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    featureFlags: DEFAULT_FEATURE_FLAGS
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
    featureFlags: update.featureFlags ?? DEFAULT_FEATURE_FLAGS,
    ...(update.reason ? { reason: update.reason } : {})
  };
}

export function createRawStateReply(payload: unknown, delivery: "reply" | "push" = "reply"): FakeRoomReply {
  return {
    kind: "state",
    payload,
    delivery
  };
}

export function createErrorReply(reason: string): FakeRoomReply {
  return {
    kind: "error",
    reason
  };
}

export function createReachableReply(reachableTiles: Array<{ x: number; y: number }>): FakeRoomReply {
  return {
    kind: "reachable",
    reachableTiles
  };
}

export function createReportReply(input: {
  reportId: string;
  targetPlayerId: string;
  reason: "cheating" | "harassment" | "afk";
  status?: "pending" | "dismissed" | "warned" | "banned";
  createdAt: string;
}): FakeRoomReply {
  return {
    kind: "report",
    reportId: input.reportId,
    targetPlayerId: input.targetPlayerId,
    reason: input.reason,
    status: input.status ?? "pending",
    createdAt: input.createdAt
  };
}

type MessageHandler = (type: string, payload: unknown) => void;

export class FakeColyseusRoom {
  reconnectionToken?: string;
  readonly sentMessages: Array<{ type: string; payload: unknown }> = [];
  readonly connectReplies: FakeRoomReply[];
  readonly requestReplies: Partial<Record<string, FakeRoomReply[]>>;
  leaveCalls = 0;
  private messageHandler: MessageHandler | null = null;
  private dropHandler: (() => void) | null = null;
  private reconnectHandler: (() => void) | null = null;
  private leaveHandler: ((code: number) => void) | null = null;

  constructor(
    connectReplies: FakeRoomReply[],
    reconnectionToken?: string,
    requestReplies: Partial<Record<string, FakeRoomReply[]>> = {}
  ) {
    this.connectReplies = [...connectReplies];
    this.reconnectionToken = reconnectionToken;
    this.requestReplies = Object.fromEntries(
      Object.entries(requestReplies).map(([type, replies]) => [type, [...replies]])
    );
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
    this.leaveCalls += 1;
    this.leaveHandler?.(1000);
  }

  send(type: string, payload: { requestId: string }): void {
    this.sentMessages.push({ type, payload });
    const replies = type === "connect" ? this.connectReplies : this.requestReplies[type];
    const reply = replies?.shift();
    if (!reply) {
      return;
    }

    if ("kind" in reply) {
      if (reply.kind === "error") {
        this.emitError(payload.requestId, reply.reason);
        return;
      }

      if (reply.kind === "reachable") {
        this.emitReachable(payload.requestId, reply.reachableTiles);
        return;
      }

      if (reply.kind === "report") {
        this.emitReport(payload.requestId, reply);
        return;
      }

      this.emitState(reply.payload, reply.delivery ?? "reply", payload.requestId);
      return;
    }

    this.emitState(toSessionStatePayload(reply), "reply", payload.requestId);
  }

  emitPush(update: SessionUpdate): void {
    this.emitState(toSessionStatePayload(update), "push", "push-1");
  }

  emitState(payload: unknown, delivery: "reply" | "push" = "push", requestId = "push-1"): void {
    this.messageHandler?.("session.state", {
      type: "session.state",
      requestId,
      delivery,
      payload
    });
  }

  emitError(requestId: string, reason: string): void {
    this.messageHandler?.("error", {
      type: "error",
      requestId,
      reason
    });
  }

  emitReachable(requestId: string, reachableTiles: Array<{ x: number; y: number }>): void {
    this.messageHandler?.("world.reachable", {
      type: "world.reachable",
      requestId,
      reachableTiles
    });
  }

  emitReport(
    requestId: string,
    report: {
      reportId: string;
      targetPlayerId: string;
      reason: "cheating" | "harassment" | "afk";
      status: "pending" | "dismissed" | "warned" | "banned";
      createdAt: string;
    }
  ): void {
    this.messageHandler?.("report.player", {
      type: "report.player",
      requestId,
      reportId: report.reportId,
      targetPlayerId: report.targetPlayerId,
      reason: report.reason,
      status: report.status,
      createdAt: report.createdAt
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
