import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  resetVeilCocosSessionRuntimeForTests,
  setVeilCocosSessionRuntimeForTests,
  VeilCocosSession
} from "../assets/scripts/VeilCocosSession.ts";
import { createMemoryStorage, createSdkLoader, createSessionUpdate, FakeColyseusRoom } from "./helpers/cocos-session-fixtures.ts";

afterEach(() => {
  resetVeilCocosSessionRuntimeForTests();
});

test("VeilCocosSession falls back to a fresh join when the stored reconnection token is stale", async () => {
  const storage = createMemoryStorage();
  storage.setItem("project-veil:cocos:reconnection:room-alpha:player-1", "stale-reconnect-token");
  const freshRoom = new FakeColyseusRoom([createSessionUpdate(4)], "fresh-join-token");
  const events: string[] = [];
  const reconnectTokens: string[] = [];
  const joinedOptions: Array<{ logicalRoomId: string; playerId: string; seed: number }> = [];

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [freshRoom],
      reconnectTokens,
      joinedOptions
    })
  });

  const session = await VeilCocosSession.create("room-alpha", "player-1", 1001, {
    onConnectionEvent: (event) => {
      events.push(event);
    }
  });

  const snapshot = await session.snapshot();

  assert.equal(snapshot.world.meta.day, 4);
  assert.deepEqual(reconnectTokens, ["stale-reconnect-token"]);
  assert.deepEqual(joinedOptions, [{ logicalRoomId: "room-alpha", playerId: "player-1", seed: 1001 }]);
  assert.deepEqual(events, []);
  assert.equal(storage.getItem("project-veil:cocos:reconnection:room-alpha:player-1"), "fresh-join-token");

  await session.dispose();
});
