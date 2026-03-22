import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import type { ClientMessage, ServerMessage } from "../../../packages/shared/src/index";
import type { RoomPersistenceSnapshot } from "../src/index";
import { configureRoomSnapshotStore, VeilColyseusRoom } from "../src/colyseus-room";
import type { RoomSnapshotStore } from "../src/persistence";

class MemoryRoomSnapshotStore implements RoomSnapshotStore {
  private readonly snapshots = new Map<string, RoomPersistenceSnapshot>();

  async load(roomId: string): Promise<RoomPersistenceSnapshot | null> {
    const snapshot = this.snapshots.get(roomId);
    return snapshot ? structuredClone(snapshot) : null;
  }

  async save(roomId: string, snapshot: RoomPersistenceSnapshot): Promise<void> {
    this.snapshots.set(roomId, structuredClone(snapshot));
  }

  async delete(roomId: string): Promise<void> {
    this.snapshots.delete(roomId);
  }

  async pruneExpired(): Promise<number> {
    return 0;
  }

  async close(): Promise<void> {}
}

let requestCounter = 0;

function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}-${requestCounter}`;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(port: number, store: RoomSnapshotStore): Promise<Server> {
  configureRoomSnapshotStore(store);
  const server = new Server({
    transport: new WebSocketTransport()
  });

  server.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await server.listen(port, "127.0.0.1");
  return server;
}

async function joinRoomWithRetry(port: number, roomId: string): Promise<ColyseusRoom> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const client = new Client(`http://127.0.0.1:${port}`);
      return await client.joinOrCreate("veil", {
        logicalRoomId: roomId,
        playerId: "player-1",
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

test("colyseus room reloads a persisted active battle after a server restart", async (t) => {
  const roomId = `persist-restart-${Date.now()}`;
  const port = 36000 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  let server = await startServer(port, store);
  let firstRoom: ColyseusRoom | null = null;
  let secondRoom: ColyseusRoom | null = null;

  t.after(async () => {
    configureRoomSnapshotStore(null);
    if (secondRoom) {
      secondRoom.removeAllListeners();
      secondRoom.connection.close();
    }
    if (firstRoom) {
      firstRoom.removeAllListeners();
      firstRoom.connection.close();
    }
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  firstRoom = await joinRoomWithRetry(port, roomId);

  const initialState = await sendRequest(
    firstRoom,
    {
      type: "connect",
      requestId: nextRequestId("connect"),
      roomId,
      playerId: "player-1"
    },
    "session.state"
  );
  assert.deepEqual(initialState.payload.world.ownHeroes[0]?.position, { x: 1, y: 1 });

  const movedIntoBattle = await sendRequest(
    firstRoom,
    {
      type: "world.action",
      requestId: nextRequestId("move"),
      action: {
        type: "hero.move",
        heroId: "hero-1",
        destination: { x: 5, y: 4 }
      }
    },
    "session.state"
  );

  assert.equal(movedIntoBattle.payload.battle?.id, "battle-neutral-1");
  assert.deepEqual(movedIntoBattle.payload.world.ownHeroes[0]?.position, { x: 5, y: 3 });

  firstRoom.removeAllListeners();
  firstRoom.connection.close();
  await server.gracefullyShutdown(false);
  server = await startServer(port, store);

  secondRoom = await joinRoomWithRetry(port, roomId);

  const restoredState = await sendRequest(
    secondRoom,
    {
      type: "connect",
      requestId: nextRequestId("restore-connect"),
      roomId,
      playerId: "player-1"
    },
    "session.state"
  );

  assert.equal(restoredState.payload.battle?.id, "battle-neutral-1");
  assert.deepEqual(restoredState.payload.world.ownHeroes[0]?.position, { x: 5, y: 3 });

  const activeUnitId = restoredState.payload.battle?.activeUnitId;
  assert.ok(activeUnitId);

  const resumedBattle = await sendRequest(
    secondRoom,
    {
      type: "battle.action",
      requestId: nextRequestId("battle"),
      action: {
        type: "battle.defend",
        unitId: activeUnitId
      }
    },
    "session.state"
  );

  assert.equal(resumedBattle.payload.battle?.round, 2);
  assert.equal(resumedBattle.payload.battle?.units[resumedBattle.payload.battle?.activeUnitId ?? ""]?.camp, "attacker");
});
