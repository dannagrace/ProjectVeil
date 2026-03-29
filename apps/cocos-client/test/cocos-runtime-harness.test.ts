import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { VeilCocosSession } from "../assets/scripts/VeilCocosSession.ts";
import { createSessionUpdate, FakeColyseusRoom } from "./helpers/cocos-session-fixtures.ts";
import {
  createVeilCocosSessionRuntimeHarness,
  createVeilRootRuntimeHarness,
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
