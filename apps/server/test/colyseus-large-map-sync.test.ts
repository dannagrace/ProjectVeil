import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import type { ClientMessage, ServerMessage } from "@veil/shared/protocol";
import { configureRoomSnapshotStore, VeilColyseusRoom } from "@server/transport/colyseus-room/VeilColyseusRoom";
import { MemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";

let requestCounter = 0;

function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}-${requestCounter}`;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(port: number): Promise<Server> {
  configureRoomSnapshotStore(new MemoryRoomSnapshotStore());
  const server = new Server({
    transport: new WebSocketTransport()
  });

  server.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await server.listen(port, "127.0.0.1");
  return server;
}

async function joinRoomWithRetry(port: number, roomId: string, playerId: string): Promise<ColyseusRoom> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const client = new Client(`http://127.0.0.1:${port}`);
      return await client.joinOrCreate("veil", {
        logicalRoomId: roomId,
        playerId,
        seed: 1001
      });
    } catch (error) {
      lastError = error;
      await wait(150);
    }
  }

  throw lastError;
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

async function waitForPushState(room: ColyseusRoom): Promise<Extract<ServerMessage, { type: "session.state" }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for push session.state"));
    }, 5_000);

    const unsubscribe = room.onMessage("*", (type, payload) => {
      if (type !== "session.state") {
        return;
      }

      const incoming = { type, ...(payload as object) } as ServerMessage;
      if (incoming.type !== "session.state" || incoming.delivery !== "push") {
        return;
      }

      clearTimeout(timeout);
      unsubscribe();
      resolve(incoming);
    });
  });
}

test("colyseus room push snapshots stay chunk-focused on the 32x32 frontier-expanded map for distant heroes", async (t) => {
  const roomId = `chunk-push-frontier-expanded-${Date.now()}[map:phase2_frontier_expanded]`;
  const port = 39000 + Math.floor(Math.random() * 1000);
  const server = await startServer(port);
  let sourceRoom: ColyseusRoom | null = null;
  let observerRoom: ColyseusRoom | null = null;

  t.after(async () => {
    configureRoomSnapshotStore(null);
    if (observerRoom) {
      observerRoom.removeAllListeners();
      observerRoom.connection.close();
    }
    if (sourceRoom) {
      sourceRoom.removeAllListeners();
      sourceRoom.connection.close();
    }
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  sourceRoom = await joinRoomWithRetry(port, roomId, "player-1");
  observerRoom = await joinRoomWithRetry(port, roomId, "player-2");

  await sendRequest(
    sourceRoom,
    {
      type: "connect",
      requestId: nextRequestId("connect-expanded-source"),
      roomId,
      playerId: "player-1"
    },
    "session.state"
  );
  await sendRequest(
    observerRoom,
    {
      type: "connect",
      requestId: nextRequestId("connect-expanded-observer"),
      roomId,
      playerId: "player-2"
    },
    "session.state"
  );

  const observerPushPromise = waitForPushState(observerRoom);
  await sendRequest(
    sourceRoom,
    {
      type: "world.action",
      requestId: nextRequestId("expanded-move"),
      action: {
        type: "hero.move",
        heroId: "hero-1",
        destination: { x: 3, y: 2 }
      }
    },
    "session.state"
  );

  const observerPush = await observerPushPromise;
  assert.equal(observerPush.payload.world.map.width, 32);
  assert.equal(observerPush.payload.world.map.height, 32);
  assert.deepEqual(observerPush.payload.world.map.encodedTiles?.bounds, {
    x: 16,
    y: 16,
    width: 16,
    height: 16
  });
  assert.ok((observerPush.payload.world.map.encodedTiles?.bounds.width ?? 32) < 32);
  assert.ok((observerPush.payload.world.map.encodedTiles?.bounds.height ?? 32) < 32);
});
