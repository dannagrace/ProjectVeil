import assert from "node:assert/strict";
import test from "node:test";
import { ClientState, matchMaker } from "colyseus";
import type { Client } from "colyseus";
import type { ServerMessage } from "../../../packages/shared/src/index";
import {
  VeilColyseusRoom,
  configureRoomSnapshotStore,
  resetLobbyRoomRegistry
} from "../src/colyseus-room";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";

interface FakeClient extends Client {
  sent: ServerMessage[];
}

function createFakeClient(sessionId: string): FakeClient {
  return {
    sessionId,
    state: ClientState.JOINED,
    sent: [],
    ref: {
      removeAllListeners() {},
      removeListener() {},
      once() {}
    },
    send(type: string | number, payload?: unknown) {
      this.sent.push({ type, ...(payload as object) } as ServerMessage);
    },
    leave() {},
    enqueueRaw() {},
    raw() {}
  } as FakeClient;
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

test("room connect re-checks persisted ban state and rejects banned players", async (t) => {
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  await store.savePlayerBan("player-banned", {
    banStatus: "temporary",
    banExpiry: "2026-04-05T00:00:00.000Z",
    banReason: "Exploit abuse"
  });
  const room = await createTestRoom(`ban-enforcement-${Date.now()}`);
  const client = createFakeClient("banned-session");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  room.clients.push(client);
  room.onJoin(client, { playerId: "player-banned" });
  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId: "connect-ban",
    roomId: room.roomId,
    playerId: "player-banned"
  });

  assert.equal(client.sent.some((message) => message.type === "error" && message.reason === "account_banned"), true);
  assert.equal(client.sent.some((message) => message.type === "session.state"), false);
});
