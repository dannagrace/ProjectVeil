import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  resetVeilCocosSessionRuntimeForTests,
  setVeilCocosSessionRuntimeForTests,
  VeilCocosSession
} from "../assets/scripts/VeilCocosSession.ts";
import {
  createReachableReply,
  createRawStateReply,
  createMemoryStorage,
  createSdkLoader,
  createSessionUpdate,
  FakeColyseusRoom
} from "./helpers/cocos-session-fixtures.ts";

afterEach(() => {
  resetVeilCocosSessionRuntimeForTests();
});

function encodeBytes(values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function createEncodedStatePayload(options?: {
  bounds?: { x: number; y: number; width: number; height: number };
  terrain?: number[];
  fog?: number[];
  walkable?: number[];
}) {
  const update = createSessionUpdate(1);
  return {
    world: {
      ...update.world,
      map: {
        width: update.world.map.width,
        height: update.world.map.height,
        encodedTiles: {
          format: "typed-array-v1",
          terrain: encodeBytes(options?.terrain ?? [0, 1, 2, 0]),
          fog: encodeBytes(options?.fog ?? [2, 1, 0, 2]),
          walkable: encodeBytes(options?.walkable ?? [1, 1, 1, 1]),
          overlays: [],
          ...(options?.bounds ? { bounds: options.bounds } : {})
        }
      }
    },
    battle: null,
    events: [],
    movementPlan: null,
    reachableTiles: [{ x: 0, y: 0 }]
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test("VeilCocosSession reuses a stored reconnection token and announces recovery", async () => {
  const storage = createMemoryStorage();
  storage.setItem("project-veil:cocos:reconnection:room-alpha:player-1", "stored-reconnect-token");
  const recoveredUpdate = createSessionUpdate(2);
  const recoveredRoom = new FakeColyseusRoom([recoveredUpdate], "fresh-reconnect-token");
  const events: string[] = [];
  const reconnectTokens: string[] = [];
  const endpoints: string[] = [];

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      reconnectRooms: [recoveredRoom],
      reconnectTokens,
      endpoints
    })
  });

  const session = await VeilCocosSession.create("room-alpha", "player-1", 1001, {
    remoteUrl: "http://127.0.0.1:2567",
    onConnectionEvent: (event) => {
      events.push(event);
    }
  });

  const snapshot = await session.snapshot();

  assert.equal(snapshot.world.meta.day, 2);
  assert.deepEqual(reconnectTokens, ["stored-reconnect-token"]);
  assert.deepEqual(events, ["reconnected"]);
  assert.equal(storage.getItem("project-veil:cocos:reconnection:room-alpha:player-1"), "fresh-reconnect-token");
  assert.deepEqual(endpoints, ["http://127.0.0.1:2567"]);

  await session.dispose();
});

test("VeilCocosSession persists local snapshot replay data from live snapshots and pushes", async () => {
  const storage = createMemoryStorage();
  const initialUpdate = createSessionUpdate(3);
  const pushedUpdate = createSessionUpdate(4);
  const room = new FakeColyseusRoom([initialUpdate], "reconnect-token");

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room]
    })
  });

  const pushUpdates: number[] = [];
  const session = await VeilCocosSession.create("room-alpha", "player-1", 1001, {
    onPushUpdate: (update) => {
      pushUpdates.push(update.world.meta.day);
    }
  });

  await session.snapshot();
  assert.equal(VeilCocosSession.readStoredReplay("room-alpha", "player-1")?.world.meta.day, 3);

  room.emitPush(pushedUpdate);

  assert.deepEqual(pushUpdates, [4]);
  assert.equal(VeilCocosSession.readStoredReplay("room-alpha", "player-1")?.world.meta.day, 4);

  await session.dispose();
});

test("VeilCocosSession fetches leaderboard entries over the HTTP API and computes ranks", async () => {
  const requestedUrls: string[] = [];

  setVeilCocosSessionRuntimeForTests({
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          players: [
            { playerId: "player-7", displayName: "North", eloRating: 1722, tier: "platinum" },
            { playerId: "player-3", displayName: "South", eloRating: 1610, tier: "platinum" }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  });

  const entries = await VeilCocosSession.fetchLeaderboard("ws://127.0.0.1:2567", 2);

  assert.deepEqual(
    entries.map((entry) => [entry.rank, entry.playerId, entry.displayName, entry.eloRating, entry.tier]),
    [
      [1, "player-7", "North", 1722, "platinum"],
      [2, "player-3", "South", 1610, "platinum"]
    ]
  );
  assert.deepEqual(requestedUrls, ["http://127.0.0.1:2567/api/leaderboard?limit=2"]);
});

test("VeilCocosSession reports reconnect lifecycle transitions from the active room", async () => {
  const storage = createMemoryStorage();
  const room = new FakeColyseusRoom([createSessionUpdate(3)], "reconnect-token");
  const events: string[] = [];

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room]
    })
  });

  const session = await VeilCocosSession.create("room-alpha", "player-1", 1001, {
    onConnectionEvent: (event) => {
      events.push(event);
    }
  });

  await session.snapshot();
  room.emitDrop();
  room.emitReconnect();

  assert.deepEqual(events, ["reconnecting", "reconnected"]);

  await session.dispose();
});

test("VeilCocosSession hands off to a fresh room after reconnect failure and replays a recovery snapshot", async () => {
  const storage = createMemoryStorage();
  const initialRoom = new FakeColyseusRoom([createSessionUpdate(1)], "initial-token");
  const recoveredRoom = new FakeColyseusRoom([createSessionUpdate(5), createSessionUpdate(5)], "recovered-token");
  const events: string[] = [];
  const pushedDays: number[] = [];
  const joinedOptions: Array<{ logicalRoomId: string; playerId: string; seed: number }> = [];

  setVeilCocosSessionRuntimeForTests({
    storage,
    wait: async () => undefined,
    loadSdk: createSdkLoader({
      joinRooms: [initialRoom, recoveredRoom],
      joinedOptions
    })
  });

  const session = await VeilCocosSession.create("room-alpha", "player-1", 1001, {
    onConnectionEvent: (event) => {
      events.push(event);
    },
    onPushUpdate: (update) => {
      pushedDays.push(update.world.meta.day);
    }
  });

  await session.snapshot();
  initialRoom.emitLeave(4002);
  await new Promise((resolve) => setImmediate(resolve));

  const recoveredSnapshot = await session.snapshot("after-handoff");

  assert.equal(recoveredSnapshot.world.meta.day, 5);
  assert.equal(recoveredSnapshot.reason, "after-handoff");
  assert.deepEqual(events, ["reconnect_failed", "reconnected"]);
  assert.deepEqual(pushedDays, [5]);
  assert.deepEqual(joinedOptions, [
    { logicalRoomId: "room-alpha", playerId: "player-1", seed: 1001 },
    { logicalRoomId: "room-alpha", playerId: "player-1", seed: 1001 }
  ]);
  assert.equal(storage.getItem("project-veil:cocos:reconnection:room-alpha:player-1"), "recovered-token");

  await session.dispose();
});

test("VeilCocosSession retries a recoverable reachable query after reconnect handoff", async () => {
  const storage = createMemoryStorage();
  const initialRoom = new FakeColyseusRoom([createSessionUpdate(2)], "initial-token");
  const recoveredRoom = new FakeColyseusRoom(
    [createSessionUpdate(6)],
    "recovered-token",
    {
      "world.reachable": [createReachableReply([{ x: 1, y: 0 }, { x: 1, y: 1 }])]
    }
  );
  const events: string[] = [];
  const pushedDays: number[] = [];

  setVeilCocosSessionRuntimeForTests({
    storage,
    wait: async () => undefined,
    loadSdk: createSdkLoader({
      joinRooms: [initialRoom, recoveredRoom]
    })
  });

  const session = await VeilCocosSession.create("room-alpha", "player-1", 1001, {
    onConnectionEvent: (event) => {
      events.push(event);
    },
    onPushUpdate: (update) => {
      pushedDays.push(update.world.meta.day);
    }
  });

  await session.snapshot();

  const reachablePromise = session.listReachable("hero-1");
  await flushMicrotasks();
  initialRoom.emitLeave(4002);

  const reachableTiles = await reachablePromise;

  assert.deepEqual(reachableTiles, [{ x: 1, y: 0 }, { x: 1, y: 1 }]);
  assert.deepEqual(events, ["reconnect_failed", "reconnected"]);
  assert.deepEqual(pushedDays, [6]);
  assert.equal(storage.getItem("project-veil:cocos:reconnection:room-alpha:player-1"), "recovered-token");
  assert.deepEqual(recoveredRoom.sentMessages.map((entry) => entry.type), ["connect", "world.reachable"]);

  await session.dispose();
});

test("VeilCocosSession rejects malformed encoded room snapshots", async () => {
  const storage = createMemoryStorage();
  const room = new FakeColyseusRoom(
    [
      createRawStateReply(
        createEncodedStatePayload({
          terrain: [0, 1, 2]
        })
      )
    ],
    "reconnect-token"
  );

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room]
    })
  });

  const session = await VeilCocosSession.create("room-alpha", "player-1", 1001);

  await assert.rejects(() => session.snapshot(), /invalid_player_world_view_encoding_length/);
  assert.equal(VeilCocosSession.readStoredReplay("room-alpha", "player-1"), null);

  await session.dispose();
});

test("VeilCocosSession rejects delta room snapshots before it has an authoritative base", async () => {
  const storage = createMemoryStorage();
  const room = new FakeColyseusRoom(
    [
      createRawStateReply(
        createEncodedStatePayload({
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          terrain: [0],
          fog: [2],
          walkable: [1]
        })
      )
    ],
    "reconnect-token"
  );

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room]
    })
  });

  const session = await VeilCocosSession.create("room-alpha", "player-1", 1001);

  await assert.rejects(() => session.snapshot(), /missing_player_world_view_base/);

  await session.dispose();
});

test("VeilCocosSession includes display name and auth token in the authenticated connect payload", async () => {
  const storage = createMemoryStorage();
  const room = new FakeColyseusRoom([createSessionUpdate(8)], "reconnect-token");

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room]
    })
  });

  const session = await VeilCocosSession.create("room-alpha", "player-1", 1001, {
    getDisplayName: () => "暮潮守望",
    getAuthToken: () => "account.token"
  });

  await session.snapshot();

  assert.deepEqual(room.sentMessages, [
    {
      type: "connect",
      payload: {
        type: "connect",
        requestId: "cocos-req-1",
        roomId: "room-alpha",
        playerId: "player-1",
        clientChannel: "wechat",
        clientVersion: "1.0.3",
        displayName: "暮潮守望",
        authToken: "account.token"
      }
    }
  ]);

  await session.dispose();
});
