import assert from "node:assert/strict";
import test from "node:test";
import { ClientState, matchMaker, Server, WebSocketTransport } from "colyseus";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import type { ClientMessage, ServerMessage } from "@veil/shared/protocol";
import { configureRoomSnapshotStore, resetLobbyRoomRegistry, VeilColyseusRoom } from "@server/transport/colyseus-room/VeilColyseusRoom";
import { registerRuntimeObservabilityRoutes, resetRuntimeObservability } from "@server/domain/ops/observability";
import { resetAccountTokenDeliveryState } from "@server/adapters/account-token-delivery";

const OBSERVABILITY_ADMIN_TOKEN = process.env.VEIL_ADMIN_TOKEN?.trim() || "observability-admin-token";
process.env.VEIL_ADMIN_TOKEN = OBSERVABILITY_ADMIN_TOKEN;

interface FakeClient {
  sessionId: string;
  state: number;
  sent: ServerMessage[];
  leaveCalls: Array<{ code?: number; data?: string }>;
  ref: {
    removeAllListeners(): void;
    removeListener(): void;
    once(): void;
  };
  send(type: string | number, payload?: unknown): void;
  leave(code?: number, data?: string): void;
  enqueueRaw(): void;
  raw(): void;
}

function createFakeClient(sessionId: string): FakeClient {
  return {
    sessionId,
    state: ClientState.JOINED,
    sent: [],
    leaveCalls: [],
    ref: {
      removeAllListeners() {},
      removeListener() {},
      once() {}
    },
    send(type: string | number, payload?: unknown) {
      this.sent.push({ type, ...(payload as object) } as ServerMessage);
    },
    leave(code?: number, data?: string) {
      this.leaveCalls.push({ code, data });
    },
    enqueueRaw() {},
    raw() {}
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function createTestRoom(logicalRoomId: string, seed = 1001): Promise<VeilColyseusRoom> {
  await matchMaker.setup(
    undefined,
    {
      async update() {},
      async remove() {},
      async persist() {}
    } as never,
    "http://127.0.0.1"
  );

  const room = new VeilColyseusRoom();
  const internalRoom = room as VeilColyseusRoom & {
    __init(): void;
    _listing: Record<string, unknown>;
    _internalState: number;
  };

  internalRoom.roomId = logicalRoomId;
  internalRoom.roomName = "veil";
  internalRoom._listing = {
    roomId: logicalRoomId,
    clients: 0,
    locked: false,
    private: false,
    unlisted: false,
    metadata: {}
  };

  internalRoom.__init();
  await room.onCreate({ logicalRoomId, seed });
  internalRoom._internalState = 1;
  return room;
}

function cleanupRoom(room: VeilColyseusRoom): void {
  const internalRoom = room as VeilColyseusRoom & {
    _autoDisposeTimeout?: NodeJS.Timeout;
    _events: {
      emit(event: string): void;
    };
  };

  if (internalRoom._autoDisposeTimeout) {
    clearTimeout(internalRoom._autoDisposeTimeout);
    internalRoom._autoDisposeTimeout = undefined;
  }

  internalRoom._events.emit("dispose");
  room.clock.clear();
  room.clock.stop();
}

async function emitRoomMessage(room: VeilColyseusRoom, type: string, client: FakeClient, payload: object): Promise<void> {
  const internalRoom = room as VeilColyseusRoom & {
    onMessageEvents: {
      emit(event: string, ...args: unknown[]): void;
    };
  };

  internalRoom.onMessageEvents.emit(type, client, payload);
  await flushAsyncWork();
}

async function connectPlayer(
  room: VeilColyseusRoom,
  client: FakeClient,
  playerId: string,
  requestId: string
): Promise<void> {
  room.clients.push(client as never);
  room.onJoin(client as never, {}, { playerId, authSession: null } as never);
  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId,
    roomId: room.roomId,
    playerId
  });
}

function lastMessageOfType<T extends ServerMessage["type"]>(
  client: FakeClient,
  type: T
): Extract<ServerMessage, { type: T }> | undefined {
  return client.sent.findLast((message): message is Extract<ServerMessage, { type: T }> => message.type === type);
}

function withEnv<T>(overrides: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  return run().finally(() => {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

async function startObservabilityServer(port: number): Promise<Server> {
  configureRoomSnapshotStore(null);
  resetLobbyRoomRegistry();
  resetAccountTokenDeliveryState();
  resetRuntimeObservability();

  const transport = new WebSocketTransport();
  registerRuntimeObservabilityRoutes(transport.getExpressApp() as never);
  const server = new Server({ transport });
  server.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await server.listen(port, "127.0.0.1");
  return server;
}

async function joinRoom(port: number, logicalRoomId: string, playerId: string): Promise<ColyseusRoom> {
  const client = new Client(`http://127.0.0.1:${port}`);
  return client.joinOrCreate("veil", {
    logicalRoomId,
    playerId,
    seed: 1001
  });
}

async function sendRequest<T extends ServerMessage["type"]>(
  room: ColyseusRoom,
  message: ClientMessage,
  expectedType: T
): Promise<Extract<ServerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${expectedType}`));
    }, 5_000);

    const unsubscribe = room.onMessage("*", (type, payload) => {
      if (typeof type !== "string") {
        return;
      }

      const incoming = { type, ...(payload as object) } as ServerMessage;
      if (!("requestId" in incoming) || incoming.requestId !== message.requestId) {
        return;
      }

      clearTimeout(timeout);
      unsubscribe();

      if (incoming.type === "error") {
        reject(new Error(incoming.reason));
        return;
      }

      if (incoming.type !== expectedType) {
        reject(new Error(`Unexpected response type: ${incoming.type}`));
        return;
      }

      resolve(incoming as Extract<ServerMessage, { type: T }>);
    });

    room.send(message.type, message);
  });
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("per-player websocket action rate limit rejects and kicks the client on violation", { concurrency: false }, async (t) => {
  await withEnv(
    {
      VEIL_RATE_LIMIT_WS_ACTION_WINDOW_MS: "60000",
      VEIL_RATE_LIMIT_WS_ACTION_MAX: "2"
    },
    async () => {
      resetLobbyRoomRegistry();
      configureRoomSnapshotStore(null);
      resetRuntimeObservability();
      const room = await createTestRoom(`ws-rate-limit-${Date.now()}`);
      const client = createFakeClient("session-ws-rate-limit");

      t.after(() => {
        cleanupRoom(room);
        resetLobbyRoomRegistry();
        configureRoomSnapshotStore(null);
        resetRuntimeObservability();
      });

      await connectPlayer(room, client, "player-1", "connect-ws-rate-limit");
      await emitRoomMessage(room, "world.action", client, {
        type: "world.action",
        requestId: "move-1",
        action: {
          type: "hero.move",
          heroId: "hero-1",
          destination: { x: 2, y: 1 }
        }
      });
      await emitRoomMessage(room, "world.action", client, {
        type: "world.action",
        requestId: "move-2",
        action: {
          type: "hero.move",
          heroId: "hero-1",
          destination: { x: 2, y: 1 }
        }
      });
      await emitRoomMessage(room, "world.action", client, {
        type: "world.action",
        requestId: "move-3",
        action: {
          type: "hero.move",
          heroId: "hero-1",
          destination: { x: 2, y: 1 }
        }
      });

      const rateLimitError = lastMessageOfType(client, "error");

      assert.equal(rateLimitError?.requestId, "move-3");
      assert.equal(rateLimitError?.reason, "rate_limit_exceeded");
      assert.equal(client.leaveCalls.length, 1);
      assert.deepEqual(client.leaveCalls[0], {
        code: 4002,
        data: "rate_limit_exceeded"
      });
      assert.equal(client.sent.filter((message) => message.type === "session.state" && message.requestId === "move-3").length, 0);
    }
  );
});

test("observability reports websocket action rate-limit violations and kicks", { concurrency: false }, async (t) => {
  await withEnv(
    {
      VEIL_RATE_LIMIT_WS_ACTION_WINDOW_MS: "60000",
      VEIL_RATE_LIMIT_WS_ACTION_MAX: "1"
    },
    async () => {
      const port = 45000 + Math.floor(Math.random() * 1000);
      const server = await startObservabilityServer(port);
      const room = await joinRoom(port, `room-ws-rate-limit-${Date.now()}`, "player-1");

      t.after(async () => {
        room.connection.close();
        await wait(25);
        resetLobbyRoomRegistry();
        resetRuntimeObservability();
        await server.gracefullyShutdown(false).catch(() => undefined);
      });

      await sendRequest(
        room,
        {
          type: "connect",
          requestId: "connect-1",
          roomId: "room-ws-rate-limit",
          playerId: "player-1"
        },
        "session.state"
      );
      await sendRequest(
        room,
        {
          type: "world.action",
          requestId: "world-action-1",
          action: {
            type: "hero.move",
            heroId: "hero-1",
            destination: { x: 2, y: 1 }
          }
        },
        "session.state"
      );
      await assert.rejects(
        sendRequest(
          room,
          {
            type: "world.action",
            requestId: "world-action-2",
            action: {
              type: "hero.move",
              heroId: "hero-1",
              destination: { x: 2, y: 1 }
            }
          },
          "session.state"
        ),
        /rate_limit_exceeded/
      );

      await wait(100);

      const healthResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/health`);
      const healthPayload = (await healthResponse.json()) as {
        runtime: {
          gameplayTraffic: {
            worldActionsTotal: number;
            websocketActionRateLimitedTotal: number;
            websocketActionKickTotal: number;
          };
        };
      };
      const metricsResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/metrics`, {
        headers: {
          "x-veil-admin-token": OBSERVABILITY_ADMIN_TOKEN
        }
      });
      const metricsText = await metricsResponse.text();

      assert.equal(healthResponse.status, 200);
      assert.equal(healthPayload.runtime.gameplayTraffic.worldActionsTotal, 1);
      assert.equal(healthPayload.runtime.gameplayTraffic.websocketActionRateLimitedTotal, 1);
      assert.equal(healthPayload.runtime.gameplayTraffic.websocketActionKickTotal, 1);
      assert.equal(metricsResponse.status, 200);
      assert.match(metricsText, /^veil_ws_action_rate_limited_total 1$/m);
      assert.match(metricsText, /^veil_ws_action_kicks_total 1$/m);
    }
  );
});
