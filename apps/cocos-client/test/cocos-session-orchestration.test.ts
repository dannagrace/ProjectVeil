import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  resetVeilCocosSessionRuntimeForTests,
  setVeilCocosSessionRuntimeForTests,
  VeilCocosSession
} from "../assets/scripts/VeilCocosSession.ts";
import {
  createMemoryStorage,
  createSdkLoader,
  createSessionUpdate,
  FakeColyseusRoom
} from "./helpers/cocos-session-fixtures.ts";

afterEach(() => {
  resetVeilCocosSessionRuntimeForTests();
});

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
