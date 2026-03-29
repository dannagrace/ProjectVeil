import assert from "node:assert/strict";
import test from "node:test";
import { sys } from "cc";
import { VeilCocosSession } from "../assets/scripts/VeilCocosSession.ts";
import { createMemoryStorage, createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";
import { createVeilRootHarness } from "./helpers/veil-root-harness.ts";

test("VeilRoot boots into lobby mode and triggers lobby bootstrap when no roomId is provided", async () => {
  const storage = createMemoryStorage();
  storage.setItem(
    "project-veil:auth-session",
    JSON.stringify({
      token: "account.token",
      playerId: "account-player",
      displayName: "暮潮守望",
      authMode: "account",
      provider: "account-password",
      loginId: "veil-ranger",
      source: "remote"
    })
  );
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  let bootstrapCalls = 0;
  root.syncLobbyBootstrap = async () => {
    bootstrapCalls += 1;
  };
  root.readLaunchSearch = () => "";

  root.hydrateLaunchIdentity();
  root.start();

  assert.equal(root.showLobby, true);
  assert.equal(root.autoConnect, false);
  assert.equal(root.playerId, "account-player");
  assert.equal(root.sessionSource, "remote");
  assert.match(String(root.lobbyStatus), /已恢复云端正式账号会话/);
  assert.equal(bootstrapCalls, 1);
});

test("VeilRoot connect replays cached session state before applying the live snapshot", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-alpha";
  root.playerId = "player-1";
  root.remoteUrl = "http://127.0.0.1:2567";
  const replayedUpdate = createSessionUpdate(2);
  const liveUpdate = createSessionUpdate(3);
  const order: string[] = [];
  const fakeSession = {
    async snapshot() {
      return liveUpdate;
    },
    async dispose() {}
  };
  const sessionClass = VeilCocosSession as unknown as {
    readStoredReplay: (roomId: string, playerId: string) => unknown;
    create: (...args: unknown[]) => Promise<unknown>;
  };
  const originalReadStoredReplay = sessionClass.readStoredReplay;
  const originalCreate = sessionClass.create;

  root.applyReplayedSessionUpdate = (update) => {
    order.push(`replay:${update.world.meta.day}`);
    root.lastUpdate = {
      ...update,
      events: [],
      movementPlan: null
    };
  };
  root.applySessionUpdate = async (update) => {
    order.push(`live:${update.world.meta.day}`);
    root.lastUpdate = update;
  };

  sessionClass.readStoredReplay = () => replayedUpdate;
  sessionClass.create = async () => fakeSession;

  try {
    await root.connect();
  } finally {
    sessionClass.readStoredReplay = originalReadStoredReplay;
    sessionClass.create = originalCreate;
  }

  assert.deepEqual(order, ["replay:2", "live:3"]);
  assert.equal(root.session, fakeSession);
  assert.equal(root.lastUpdate?.world.meta.day, 3);
});

test("VeilRoot hands control to a fresh session when starting a new run", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-alpha";
  root.playerId = "player-1";
  root.seed = 1001;
  const handoffOrder: string[] = [];
  const previousSession = {
    async dispose() {
      handoffOrder.push("dispose:previous");
    }
  };
  const freshUpdate = createSessionUpdate(6, "run-fr4nch");
  const freshSession = {
    async snapshot() {
      handoffOrder.push("snapshot:fresh");
      return freshUpdate;
    },
    async dispose() {
      handoffOrder.push("dispose:fresh");
    }
  };
  root.session = previousSession;
  root.applySessionUpdate = async (update) => {
    handoffOrder.push(`apply:${update.world.meta.roomId}`);
    root.lastUpdate = update;
  };
  root.syncBrowserRoomQuery = (roomId: string | null) => {
    handoffOrder.push(`query:${roomId}`);
  };

  const sessionClass = VeilCocosSession as unknown as {
    create: (...args: unknown[]) => Promise<unknown>;
  };
  const originalCreate = sessionClass.create;
  const originalDateNow = Date.now;
  sessionClass.create = async () => freshSession;
  Date.now = () => 1234567890123;

  try {
    await root.startNewRun();
  } finally {
    sessionClass.create = originalCreate;
    Date.now = originalDateNow;
  }

  assert.equal(root.session, freshSession);
  assert.equal(root.roomId, "run-5hugnf");
  assert.equal(root.seed, 1002);
  assert.deepEqual(handoffOrder, [
    "snapshot:fresh",
    "query:run-5hugnf",
    "apply:run-fr4nch",
    "dispose:previous"
  ]);
});
