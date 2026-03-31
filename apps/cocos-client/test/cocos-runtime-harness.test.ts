import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { VeilCocosSession } from "../assets/scripts/VeilCocosSession.ts";
import { writeStoredCocosAuthSession } from "../assets/scripts/cocos-session-launch.ts";
import {
  createMemoryStorage,
  createRawStateReply,
  createSessionUpdate,
  FakeColyseusRoom
} from "./helpers/cocos-session-fixtures.ts";
import {
  createVeilCocosSessionRuntimeHarness,
  createVeilRootRuntimeHarness,
  createVeilRootSessionLifecycleHarness,
  resetCocosRuntimeHarnesses
} from "./helpers/cocos-runtime-harness.ts";

afterEach(() => {
  resetCocosRuntimeHarnesses();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function seedStoredReplay(storage: Storage, update: ReturnType<typeof createSessionUpdate>): void {
  storage.setItem(
    `project-veil:cocos:session-replay:${update.world.meta.roomId}:${update.world.playerId}`,
    JSON.stringify({
      version: 1,
      storedAt: Date.now(),
      update
    })
  );
}

function encodeBytes(values: number[]): string {
  return Buffer.from(Uint8Array.from(values)).toString("base64");
}

function createEncodedStatePayload(day: number, roomId: string, playerId: string) {
  const update = createSessionUpdate(day, roomId, playerId);
  return {
    world: {
      ...update.world,
      map: {
        width: update.world.map.width,
        height: update.world.map.height,
        encodedTiles: {
          format: "typed-array-v1",
          terrain: encodeBytes([0, 1, 2, 0]),
          fog: encodeBytes([2, 1, 0, 2]),
          walkable: encodeBytes([1, 1, 1, 1]),
          overlays: []
        }
      }
    },
    battle: null,
    events: update.events,
    movementPlan: update.movementPlan,
    reachableTiles: update.reachableTiles
  };
}

test("Cocos runtime harness boots VeilRoot from lobby handoff into the first live snapshot", async () => {
  const liveUpdate = createSessionUpdate(4, "room-issue-338", "guest-338");
  const harness = createVeilRootRuntimeHarness({
    liveUpdate,
    guestAuthToken: "guest.issue-338.token"
  });

  harness.root.showLobby = true;
  harness.root.roomId = "room-issue-338";
  harness.root.playerId = "guest-338";
  harness.root.displayName = "Guest 338";
  harness.root.syncBrowserRoomQuery = () => undefined;

  await harness.root.enterLobbyRoom();

  assert.equal(harness.root.session, harness.session);
  assert.equal(harness.root.lastUpdate?.world.meta.day, 4);
  assert.equal(harness.root.showLobby, false);
  assert.equal(harness.root.authToken, "guest.issue-338.token");
  assert.equal(harness.root.sessionSource, "remote");
});

test("Cocos runtime harness replays cached VeilRoot state before reconnect recovery converges", async () => {
  const replayedUpdate = createSessionUpdate(2, "room-issue-338", "player-338");
  replayedUpdate.events = [
    {
      type: "battle.resolved",
      battleId: "battle-338",
      battleKind: "neutral",
      heroId: "hero-1",
      result: "attacker_victory",
      resourcesGained: {
        gold: 0,
        wood: 0,
        ore: 0
      },
      experienceGained: 10,
      skillPointsAwarded: 0
    }
  ];
  const liveUpdate = createSessionUpdate(3, "room-issue-338", "player-338");
  const recoveredUpdate = createSessionUpdate(4, "room-issue-338", "player-338");
  const order: string[] = [];
  const harness = createVeilRootRuntimeHarness({
    replayedUpdate,
    liveUpdate
  });

  harness.root.roomId = "room-issue-338";
  harness.root.playerId = "player-338";
  harness.root.applyReplayedSessionUpdate = (update) => {
    order.push(`replay:${update.world.meta.day}`);
    harness.root.lastUpdate = {
      ...update,
      events: [],
      movementPlan: null
    };
  };
  harness.root.applySessionUpdate = async (update) => {
    order.push(`live:${update.world.meta.day}`);
    harness.root.lastUpdate = update;
  };

  await harness.root.connect();
  harness.emitConnectionEvent("reconnect_failed");
  harness.emitPushUpdate(recoveredUpdate);
  harness.emitConnectionEvent("reconnected");
  await flushMicrotasks();

  assert.deepEqual(order, ["replay:2", "live:3", "live:4"]);
  assert.equal(harness.root.lastUpdate?.world.meta.day, 4);
  assert.equal(harness.root.diagnosticsConnectionStatus, "connected");
});

test("Cocos runtime harness lets VeilCocosSession persist replay data across reconnect recovery", async () => {
  const initialRoom = new FakeColyseusRoom([createSessionUpdate(1)], "initial-token");
  const recoveredRoom = new FakeColyseusRoom([createSessionUpdate(5), createSessionUpdate(5)], "recovered-token");
  const events: string[] = [];
  const pushedDays: number[] = [];
  const harness = createVeilCocosSessionRuntimeHarness({
    joinRooms: [initialRoom, recoveredRoom],
    wait: async () => undefined
  });

  const session = await harness.create("room-issue-338", "player-338", 1001, {
    onConnectionEvent: (event) => {
      events.push(event);
    },
    onPushUpdate: (update) => {
      pushedDays.push(update.world.meta.day);
    }
  });

  const initialSnapshot = await session.snapshot();
  initialRoom.emitLeave(4002);
  await flushMicrotasks();
  const recoveredSnapshot = await session.snapshot("after-reconnect");

  assert.equal(initialSnapshot.world.meta.day, 1);
  assert.equal(recoveredSnapshot.world.meta.day, 5);
  assert.equal(recoveredSnapshot.reason, "after-reconnect");
  assert.deepEqual(events, ["reconnect_failed", "reconnected"]);
  assert.deepEqual(pushedDays, [5]);
  assert.equal(
    harness.storage.getItem("project-veil:cocos:reconnection:room-issue-338:player-338"),
    "recovered-token"
  );
  assert.equal(
    VeilCocosSession.readStoredReplay("room-issue-338", "player-338")?.world.meta.day,
    5
  );

  await session.dispose();
});

test("Cocos runtime harness replaces cached replay with the decoded recovery snapshot after reconnect handoff", async () => {
  const replayedUpdate = createSessionUpdate(2, "room-issue-474", "player-474");
  replayedUpdate.world.map.tiles[0] = {
    ...replayedUpdate.world.map.tiles[0],
    terrain: "lava",
    fog: "hidden",
    walkable: false
  };

  const initialRoom = new FakeColyseusRoom([createSessionUpdate(3, "room-issue-474", "player-474")], "initial-token");
  const recoveredRoom = new FakeColyseusRoom(
    [
      createRawStateReply(createEncodedStatePayload(7, "room-issue-474", "player-474")),
      createRawStateReply(createEncodedStatePayload(7, "room-issue-474", "player-474"))
    ],
    "recovered-token"
  );
  const events: string[] = [];
  const pushedDays: number[] = [];
  const storage = createMemoryStorage();
  seedStoredReplay(storage, replayedUpdate);

  const harness = createVeilCocosSessionRuntimeHarness({
    storage,
    joinRooms: [initialRoom, recoveredRoom],
    wait: async () => undefined
  });

  assert.equal(VeilCocosSession.readStoredReplay("room-issue-474", "player-474")?.world.meta.day, 2);

  const session = await harness.create("room-issue-474", "player-474", 1001, {
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
  const recoveredSnapshot = await session.snapshot("post-recovery");
  const storedReplay = VeilCocosSession.readStoredReplay("room-issue-474", "player-474");

  assert.equal(recoveredSnapshot.reason, "post-recovery");
  assert.equal(recoveredSnapshot.world.meta.day, 7);
  assert.deepEqual(events, ["reconnect_failed", "reconnected"]);
  assert.deepEqual(pushedDays, [7]);
  assert.equal(storedReplay?.world.meta.day, 7);
  assert.deepEqual(storedReplay?.world.map.tiles.map((tile) => tile.terrain), ["grass", "dirt", "sand", "grass"]);
  assert.deepEqual(storedReplay?.world.map.tiles.map((tile) => tile.fog), ["visible", "explored", "hidden", "visible"]);
  assert.deepEqual(storedReplay?.world.map.tiles.map((tile) => tile.walkable), [true, true, true, true]);
  assert.equal(
    harness.storage.getItem("project-veil:cocos:reconnection:room-issue-474:player-474"),
    "recovered-token"
  );

  await session.dispose();
});

test("Cocos lifecycle harness replays cached local boot state before VeilRoot opens the live session", async () => {
  const storage = createMemoryStorage();
  writeStoredCocosAuthSession(storage, {
    token: "guest.local.token",
    playerId: "local-player",
    displayName: "本地旅人",
    authMode: "guest",
    provider: "guest",
    source: "local"
  });
  const cachedUpdate = createSessionUpdate(2, "room-local", "local-player");
  const liveUpdate = createSessionUpdate(3, "room-local", "local-player");
  seedStoredReplay(storage, cachedUpdate);

  const room = new FakeColyseusRoom([liveUpdate], "local-reconnect-token");
  const harness = createVeilRootSessionLifecycleHarness({
    storage,
    joinRooms: [room]
  });
  const order: string[] = [];
  const originalApplySessionUpdate = harness.root.applySessionUpdate.bind(harness.root);

  harness.root.readLaunchSearch = () => "?roomId=room-local";
  harness.root.applyReplayedSessionUpdate = (update) => {
    order.push(`replay:${update.world.meta.day}`);
    harness.root.lastUpdate = {
      ...update,
      events: [],
      movementPlan: null
    };
  };
  harness.root.applySessionUpdate = async (update) => {
    order.push(`live:${update.world.meta.day}`);
    await originalApplySessionUpdate(update);
  };

  harness.root.hydrateLaunchIdentity();
  await harness.root.connect();

  assert.equal(harness.root.showLobby, false);
  assert.equal(harness.root.sessionSource, "local");
  assert.equal(harness.root.authToken, "guest.local.token");
  assert.deepEqual(order, ["replay:2", "live:3"]);
  assert.equal(harness.root.lastUpdate?.world.meta.day, 3);
  assert.deepEqual(room.sentMessages, [
    {
      type: "connect",
      payload: {
        type: "connect",
        requestId: "cocos-req-1",
        roomId: "room-local",
        playerId: "local-player",
        displayName: "本地旅人",
        authToken: "guest.local.token"
      }
    }
  ]);
});

test("Cocos lifecycle harness recovers VeilRoot through VeilCocosSession reconnect handoff", async () => {
  const replayedUpdate = createSessionUpdate(2, "room-recover", "player-349");
  const initialUpdate = createSessionUpdate(3, "room-recover", "player-349");
  const recoveredUpdate = createSessionUpdate(5, "room-recover", "player-349");
  const initialRoom = new FakeColyseusRoom([initialUpdate], "initial-token");
  const recoveredRoom = new FakeColyseusRoom([recoveredUpdate, recoveredUpdate], "recovered-token");
  const harness = createVeilRootSessionLifecycleHarness({
    joinRooms: [initialRoom, recoveredRoom],
    wait: async () => undefined
  });
  const order: string[] = [];
  const originalApplySessionUpdate = harness.root.applySessionUpdate.bind(harness.root);

  harness.root.roomId = "room-recover";
  harness.root.playerId = "player-349";
  harness.root.displayName = "Player 349";
  seedStoredReplay(harness.storage, replayedUpdate);
  harness.root.applyReplayedSessionUpdate = (update) => {
    order.push(`replay:${update.world.meta.day}`);
    harness.root.lastUpdate = {
      ...update,
      events: [],
      movementPlan: null
    };
  };
  harness.root.applySessionUpdate = async (update) => {
    order.push(`live:${update.world.meta.day}`);
    await originalApplySessionUpdate(update);
  };

  await harness.root.connect();
  const connectedSession = harness.root.session;
  initialRoom.emitLeave(4002);
  await flushMicrotasks();

  assert.deepEqual(order, ["replay:2", "live:3", "live:5"]);
  assert.equal(harness.root.session, connectedSession);
  assert.equal(harness.root.lastUpdate?.world.meta.day, 5);
  assert.equal(harness.root.diagnosticsConnectionStatus, "connected");
  assert.deepEqual(harness.joinedOptions, [
    { logicalRoomId: "room-recover", playerId: "player-349", seed: 1001 },
    { logicalRoomId: "room-recover", playerId: "player-349", seed: 1001 }
  ]);
  assert.deepEqual(recoveredRoom.sentMessages, [
    {
      type: "connect",
      payload: {
        type: "connect",
        requestId: "cocos-req-1",
        roomId: "room-recover",
        playerId: "player-349",
        displayName: "Player 349"
      }
    }
  ]);
  assert.equal(
    harness.storage.getItem("project-veil:cocos:reconnection:room-recover:player-349"),
    "recovered-token"
  );
});

test("Cocos lifecycle harness disposes the recovered VeilCocosSession room after reconnect handoff", async () => {
  const initialRoom = new FakeColyseusRoom([createSessionUpdate(3, "room-dispose", "player-373")], "initial-token");
  const recoveredUpdate = createSessionUpdate(5, "room-dispose", "player-373");
  const recoveredRoom = new FakeColyseusRoom([recoveredUpdate, recoveredUpdate], "recovered-token");
  const harness = createVeilCocosSessionRuntimeHarness({
    joinRooms: [initialRoom, recoveredRoom],
    wait: async () => undefined
  });

  const session = await harness.create("room-dispose", "player-373");
  await session.snapshot();

  initialRoom.emitLeave(4002);
  await flushMicrotasks();
  await session.dispose();

  assert.equal(initialRoom.leaveCalls, 0);
  assert.equal(recoveredRoom.leaveCalls, 1);
  assert.equal(
    harness.storage.getItem("project-veil:cocos:reconnection:room-dispose:player-373"),
    null
  );
});

test("Cocos lifecycle harness hands lobby auth off into a live VeilRoot session", async () => {
  const storage = createMemoryStorage();
  writeStoredCocosAuthSession(storage, {
    token: "account.token",
    playerId: "account-player",
    displayName: "暮潮守望",
    authMode: "account",
    provider: "account-password",
    loginId: "veil-ranger",
    source: "remote"
  });
  const room = new FakeColyseusRoom([createSessionUpdate(6, "room-lobby", "account-player")], "account-reconnect-token");
  const harness = createVeilRootSessionLifecycleHarness({
    storage,
    joinRooms: [room],
    syncedAuthSession: {
      token: "account.token",
      playerId: "account-player",
      displayName: "暮潮守望",
      authMode: "account",
      provider: "account-password",
      loginId: "veil-ranger",
      source: "remote"
    }
  });

  harness.root.readLaunchSearch = () => "";
  harness.root.syncBrowserRoomQuery = () => undefined;
  harness.root.hydrateLaunchIdentity();
  await harness.root.enterLobbyRoom("room-lobby");

  assert.equal(harness.root.showLobby, false);
  assert.equal(harness.root.authMode, "account");
  assert.equal(harness.root.authToken, "account.token");
  assert.equal(harness.root.sessionSource, "remote");
  assert.equal(harness.root.lastUpdate?.world.meta.day, 6);
  assert.deepEqual(room.sentMessages, [
    {
      type: "connect",
      payload: {
        type: "connect",
        requestId: "cocos-req-1",
        roomId: "room-lobby",
        playerId: "account-player",
        displayName: "暮潮守望",
        authToken: "account.token"
      }
    }
  ]);
});

test("Cocos lifecycle harness tears down the active VeilRoot session on destroy", async () => {
  const room = new FakeColyseusRoom([createSessionUpdate(6, "room-destroy", "player-373")], "destroy-token");
  const harness = createVeilRootSessionLifecycleHarness({
    joinRooms: [room]
  });

  harness.root.roomId = "room-destroy";
  harness.root.playerId = "player-373";
  harness.root.displayName = "Player 373";

  await harness.root.connect();
  harness.root.onDestroy();
  await flushMicrotasks();

  assert.equal(room.leaveCalls, 1);
  assert.equal(harness.root.session, null);
  assert.equal(
    harness.storage.getItem("project-veil:cocos:reconnection:room-destroy:player-373"),
    null
  );
});
