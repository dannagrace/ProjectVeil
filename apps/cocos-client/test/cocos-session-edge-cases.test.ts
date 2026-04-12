import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import {
  resetVeilCocosSessionRuntimeForTests,
  setVeilCocosSessionRuntimeForTests,
  VeilCocosSession
} from "../assets/scripts/VeilCocosSession.ts";
import {
  createMemoryStorage,
  createRawStateReply,
  createSdkLoader,
  createSessionUpdate,
  FakeColyseusRoom
} from "./helpers/cocos-session-fixtures.ts";

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
});

afterEach(() => {
  mock.timers.reset();
  resetVeilCocosSessionRuntimeForTests();
});

function encodeBytes(values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function createEncodedStatePayload(day: number, options: {
  roomId?: string;
  playerId?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  terrain?: number[];
  fog?: number[];
  walkable?: number[];
}) {
  const update = createSessionUpdate(day, options.roomId, options.playerId);
  return {
    world: {
      ...update.world,
      map: {
        width: update.world.map.width,
        height: update.world.map.height,
        encodedTiles: {
          format: "typed-array-v1",
          terrain: encodeBytes(options.terrain ?? [0, 1, 2, 0]),
          fog: encodeBytes(options.fog ?? [2, 1, 0, 2]),
          walkable: encodeBytes(options.walkable ?? [1, 1, 1, 1]),
          overlays: [],
          ...(options.bounds ? { bounds: options.bounds } : {})
        }
      }
    },
    battle: null,
    events: [],
    movementPlan: null,
    reachableTiles: [{ x: 0, y: 0 }]
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

async function advance(ms: number): Promise<void> {
  mock.timers.tick(ms);
  await flushMicrotasks();
}

test("VeilCocosSession preserves an in-flight reachable query across a network drop and same-room reconnect", async () => {
  const storage = createMemoryStorage();
  const room = new FakeColyseusRoom([createSessionUpdate(2)], "room-token");
  const events: string[] = [];

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room]
    })
  });

  const session = await VeilCocosSession.create("room-edge-1", "player-edge-1", 1001, {
    onConnectionEvent: (event) => {
      events.push(event);
    }
  });

  await session.snapshot();

  const reachablePromise = session.listReachable("hero-1");
  room.emitDrop();
  await advance(2500);
  room.emitReconnect();
  room.emitReachable("cocos-req-2", [{ x: 1, y: 0 }, { x: 1, y: 1 }]);

  const reachableTiles = await reachablePromise;

  assert.deepEqual(reachableTiles, [{ x: 1, y: 0 }, { x: 1, y: 1 }]);
  assert.deepEqual(events, ["reconnecting", "reconnected"]);
  assert.deepEqual(room.sentMessages.map((entry) => entry.type), ["connect", "world.reachable"]);
  assert.equal(storage.getItem("project-veil:cocos:reconnection:room-edge-1:player-edge-1"), "room-token");

  await session.dispose();
});

test("VeilCocosSession retries recovery with a fresh authoritative snapshot after a desynced delta recovery reply", async () => {
  const storage = createMemoryStorage();
  const initialRoom = new FakeColyseusRoom([createSessionUpdate(1, "room-edge-2", "player-edge-2")], "initial-token");
  const desyncedRecoveryRoom = new FakeColyseusRoom(
    [
      createRawStateReply(
        createEncodedStatePayload(5, {
          roomId: "room-edge-2",
          playerId: "player-edge-2",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          terrain: [0],
          fog: [2],
          walkable: [1]
        })
      )
    ],
    "desynced-token"
  );
  const authoritativeRoom = new FakeColyseusRoom(
    [
      createSessionUpdate(6, "room-edge-2", "player-edge-2"),
      createSessionUpdate(6, "room-edge-2", "player-edge-2")
    ],
    "authoritative-token"
  );
  const events: string[] = [];
  const pushedDays: number[] = [];

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [initialRoom, desyncedRecoveryRoom, authoritativeRoom]
    })
  });

  const session = await VeilCocosSession.create("room-edge-2", "player-edge-2", 1001, {
    onConnectionEvent: (event) => {
      events.push(event);
    },
    onPushUpdate: (update) => {
      pushedDays.push(update.world.meta.day);
    }
  });

  await session.snapshot();
  initialRoom.emitLeave(4002);
  await flushMicrotasks();

  assert.deepEqual(events, ["reconnect_failed"]);
  assert.deepEqual(pushedDays, []);

  await advance(1499);
  assert.deepEqual(events, ["reconnect_failed"]);

  await advance(1);
  const recoveredSnapshot = await session.snapshot("after-resync");

  assert.equal(recoveredSnapshot.world.meta.day, 6);
  assert.equal(recoveredSnapshot.reason, "after-resync");
  assert.deepEqual(events, ["reconnect_failed", "reconnected"]);
  assert.deepEqual(pushedDays, [6]);
  assert.equal(storage.getItem("project-veil:cocos:reconnection:room-edge-2:player-edge-2"), "authoritative-token");
  assert.equal(VeilCocosSession.readStoredReplay("room-edge-2", "player-edge-2")?.world.meta.day, 6);

  await session.dispose();
});

test("VeilCocosSession replays an in-flight action against the recovered room when disconnect and input race", async () => {
  const storage = createMemoryStorage();
  const initialRoom = new FakeColyseusRoom([createSessionUpdate(2, "room-edge-3", "player-edge-3")], "initial-token");
  const recoveredRoom = new FakeColyseusRoom(
    [createSessionUpdate(3, "room-edge-3", "player-edge-3")],
    "recovered-token",
    {
      "world.action": [createSessionUpdate(4, "room-edge-3", "player-edge-3")]
    }
  );
  const events: string[] = [];
  const pushedDays: number[] = [];

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [initialRoom, recoveredRoom]
    })
  });

  const session = await VeilCocosSession.create("room-edge-3", "player-edge-3", 1001, {
    onConnectionEvent: (event) => {
      events.push(event);
    },
    onPushUpdate: (update) => {
      pushedDays.push(update.world.meta.day);
    }
  });

  await session.snapshot();

  const movePromise = session.moveHero("hero-1", { x: 1, y: 1 });
  await flushMicrotasks();
  initialRoom.emitLeave(4002);
  await flushMicrotasks();
  const moveUpdate = await movePromise;

  assert.equal(moveUpdate.world.meta.day, 4);
  assert.deepEqual(events, ["reconnect_failed", "reconnected"]);
  assert.deepEqual(pushedDays, [3]);
  assert.deepEqual(initialRoom.sentMessages.map((entry) => entry.type), ["connect", "world.action"]);
  assert.deepEqual(recoveredRoom.sentMessages.map((entry) => entry.type), ["connect", "world.action"]);
  assert.equal(storage.getItem("project-veil:cocos:reconnection:room-edge-3:player-edge-3"), "recovered-token");

  await session.dispose();
});

test("VeilCocosSession accepts the recovered turn deadline when the old deadline expires mid-reconnect", async () => {
  const storage = createMemoryStorage();
  const initialUpdate = createSessionUpdate(2, "room-edge-4", "player-edge-4");
  initialUpdate.world.turnDeadlineAt = new Date(1000).toISOString();
  const recoveredUpdate = createSessionUpdate(3, "room-edge-4", "player-edge-4");
  recoveredUpdate.world.turnDeadlineAt = new Date(6000).toISOString();

  const initialRoom = new FakeColyseusRoom([initialUpdate], "initial-token");
  const recoveredRoom = new FakeColyseusRoom(
    [recoveredUpdate, recoveredUpdate],
    "recovered-token"
  );
  const events: string[] = [];
  const pushedDeadlines: string[] = [];

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [initialRoom, new Error("connect_failed_once"), recoveredRoom]
    })
  });

  const session = await VeilCocosSession.create("room-edge-4", "player-edge-4", 1001, {
    onConnectionEvent: (event) => {
      events.push(event);
    },
    onPushUpdate: (update) => {
      pushedDeadlines.push(update.world.turnDeadlineAt ?? "");
    }
  });

  const initialSnapshot = await session.snapshot();
  initialRoom.emitLeave(4002);
  await flushMicrotasks();

  assert.equal(initialSnapshot.world.turnDeadlineAt, new Date(1000).toISOString());

  await advance(1000);
  assert.equal(Date.now(), 1000);
  assert.deepEqual(events, ["reconnect_failed"]);

  await advance(500);
  const recoveredSnapshot = await session.snapshot("after-turn-resync");

  assert.equal(recoveredSnapshot.world.turnDeadlineAt, new Date(6000).toISOString());
  assert.equal(recoveredSnapshot.reason, "after-turn-resync");
  assert.deepEqual(events, ["reconnect_failed", "reconnected"]);
  assert.deepEqual(pushedDeadlines, [new Date(6000).toISOString()]);
  assert.equal(
    VeilCocosSession.readStoredReplay("room-edge-4", "player-edge-4")?.world.turnDeadlineAt,
    new Date(6000).toISOString()
  );

  await session.dispose();
});

test("VeilCocosSession clears replay state and stays closed after a consented room closure", async () => {
  const storage = createMemoryStorage();
  const room = new FakeColyseusRoom([createSessionUpdate(2, "room-edge-5", "player-edge-5")], "room-token");
  const events: string[] = [];
  const joinedOptions: Array<{ logicalRoomId: string; playerId: string; seed: number }> = [];

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room],
      joinedOptions
    })
  });

  const session = await VeilCocosSession.create("room-edge-5", "player-edge-5", 1001, {
    onConnectionEvent: (event) => {
      events.push(event);
    }
  });

  await session.snapshot();
  room.emitLeave(1000);
  await flushMicrotasks();
  await advance(3000);

  assert.deepEqual(events, []);
  assert.deepEqual(joinedOptions, [{ logicalRoomId: "room-edge-5", playerId: "player-edge-5", seed: 1001 }]);
  assert.equal(storage.getItem("project-veil:cocos:reconnection:room-edge-5:player-edge-5"), null);
  assert.equal(VeilCocosSession.readStoredReplay("room-edge-5", "player-edge-5"), null);

  await session.dispose();
  assert.equal(room.leaveCalls, 1);
});
