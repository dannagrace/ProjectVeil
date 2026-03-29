import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { sys } from "cc";
import { createMemoryStorage, createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";
import { createVeilRootHarness, installVeilRootRuntime, resetVeilRootRuntime } from "./helpers/veil-root-harness.ts";

afterEach(() => {
  resetVeilRootRuntime();
  (sys as unknown as { localStorage: Storage | null }).localStorage = null;
});

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

  installVeilRootRuntime({
    readStoredReplay: () => replayedUpdate,
    createSession: async () => fakeSession as never
  });

  await root.connect();

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

  const originalDateNow = Date.now;
  installVeilRootRuntime({
    createSession: async () => freshSession as never
  });
  Date.now = () => 1234567890123;

  try {
    await root.startNewRun();
  } finally {
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

test("VeilRoot lobby handoff enters a room with the authenticated session and live snapshot", async () => {
  const storage = createMemoryStorage();
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  root.showLobby = true;
  root.roomId = "room-bravo";
  root.playerId = "guest-7";
  root.displayName = "Guest 7";

  const liveUpdate = createSessionUpdate(4, "room-bravo", "guest-7");
  const fakeSession = {
    async snapshot() {
      return liveUpdate;
    },
    async dispose() {}
  };
  const queryUpdates: Array<string | null> = [];
  root.syncBrowserRoomQuery = (roomId: string | null) => {
    queryUpdates.push(roomId);
  };

  installVeilRootRuntime({
    loginGuestAuthSession: async () => ({
      token: "guest.token",
      playerId: "guest-7",
      displayName: "Guest 7",
      authMode: "guest",
      provider: "guest",
      source: "remote"
    }),
    createSession: async () => fakeSession as never
  });

  await root.enterLobbyRoom();

  assert.equal(root.showLobby, false);
  assert.equal(root.session, fakeSession);
  assert.equal(root.playerId, "guest-7");
  assert.equal(root.authToken, "guest.token");
  assert.equal(root.sessionSource, "remote");
  assert.equal(root.lastUpdate?.world.meta.day, 4);
  assert.deepEqual(queryUpdates, ["room-bravo"]);
});

test("VeilRoot keeps the lobby visible and explains when an account session has expired", async () => {
  const storage = createMemoryStorage();
  storage.setItem(
    "project-veil:auth-session",
    JSON.stringify({
      token: "expired.token",
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
  root.showLobby = true;
  root.roomId = "room-charlie";
  root.playerId = "account-player";
  root.displayName = "暮潮守望";
  root.authMode = "account";
  root.authToken = "expired.token";
  root.authProvider = "account-password";
  root.loginId = "veil-ranger";
  root.sessionSource = "remote";

  installVeilRootRuntime({
    syncAuthSession: async () => null
  });

  await root.enterLobbyRoom();

  assert.equal(root.showLobby, true);
  assert.equal(root.session, null);
  assert.equal(root.authToken, null);
  assert.equal(root.authMode, "guest");
  assert.equal(root.authProvider, "guest");
  assert.equal(root.sessionSource, "none");
  assert.equal(root.lobbyStatus, "账号会话已失效，请重新登录后再进入房间。");
});

test("VeilRoot forwards session connection events into runtime diagnostics and logs", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-alpha";
  root.playerId = "player-1";
  root.displayName = "暮潮守望";
  root.authToken = "account.token";

  const liveUpdate = createSessionUpdate(7);
  let capturedOptions:
    | {
        onConnectionEvent?: ((event: "reconnecting" | "reconnected" | "reconnect_failed") => void) | undefined;
        getDisplayName?: (() => string) | undefined;
        getAuthToken?: (() => string | null) | undefined;
      }
    | undefined;

  installVeilRootRuntime({
    createSession: async (_roomId, _playerId, _seed, options) => {
      capturedOptions = options;
      return {
        async snapshot() {
          return liveUpdate;
        },
        async dispose() {}
      } as never;
    }
  });

  await root.connect();

  assert.equal(capturedOptions?.getDisplayName?.(), "暮潮守望");
  assert.equal(capturedOptions?.getAuthToken?.(), "account.token");

  capturedOptions?.onConnectionEvent?.("reconnecting");
  assert.equal(root.diagnosticsConnectionStatus, "reconnecting");
  assert.equal(root.logLines[0], "连接已中断，正在尝试重连...");

  capturedOptions?.onConnectionEvent?.("reconnected");
  assert.equal(root.diagnosticsConnectionStatus, "connected");
  assert.equal(root.logLines[0], "连接已恢复。");

  capturedOptions?.onConnectionEvent?.("reconnect_failed");
  assert.equal(root.diagnosticsConnectionStatus, "reconnect_failed");
  assert.equal(root.logLines[0], "重连失败，正在尝试恢复房间快照...");
});
