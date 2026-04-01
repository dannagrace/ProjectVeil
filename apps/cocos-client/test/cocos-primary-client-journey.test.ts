import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Node, sys } from "cc";
import { resetVeilCocosSessionRuntimeForTests, setVeilCocosSessionRuntimeForTests, VeilCocosSession } from "../assets/scripts/VeilCocosSession.ts";
import { createFallbackCocosPlayerAccountProfile } from "../assets/scripts/cocos-lobby.ts";
import { resetPixelSpriteRuntimeForTests } from "../assets/scripts/cocos-pixel-sprites.ts";
import { buildCocosRuntimeDiagnosticsSnapshot } from "../assets/scripts/cocos-runtime-diagnostics.ts";
import { writeStoredCocosAuthSession } from "../assets/scripts/cocos-session-launch.ts";
import { resetVeilRootRuntimeForTests, setVeilRootRuntimeForTests, VeilRoot } from "../assets/scripts/VeilRoot.ts";
import { createMemoryStorage, createSessionUpdate, createSdkLoader, FakeColyseusRoom } from "./helpers/cocos-session-fixtures.ts";

type RootState = VeilRoot & Record<string, any>;

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function waitFor(assertion: () => boolean, onTimeout: () => unknown, attempts = 30): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) {
      return;
    }
    await flushMicrotasks();
  }

  assert.fail(JSON.stringify(onTimeout(), null, 2));
}

function createRootHarness() {
  const sceneNode = new Node("PrimaryJourneyScene");
  const rootNode = new Node("VeilRootJourney");
  rootNode.parent = sceneNode;
  const root = rootNode.addComponent(VeilRoot) as RootState;
  root.renderView = () => undefined;
  root.ensureViewNodes = () => undefined;
  root.ensureUiCameraVisibility = () => undefined;
  root.ensureHudActionBinding = () => undefined;
  root.syncBrowserRoomQuery = () => undefined;
  root.syncWechatShareBridge = () => ({
    available: false,
    menuEnabled: false,
    handlerRegistered: false,
    canShareDirectly: false,
    immediateShared: false,
    payload: null,
    message: "disabled"
  });
  return { root, rootNode };
}

function captureJourneyArtifact(options: {
  root: RootState;
  phase: string;
  joinedOptions?: Array<{ logicalRoomId: string; playerId: string; seed: number }>;
  room?: FakeColyseusRoom;
}) {
  const { root } = options;
  const update = root.lastUpdate ?? null;
  return {
    phase: options.phase,
    identity: {
      roomId: root.roomId,
      playerId: root.playerId,
      displayName: root.displayName,
      authMode: root.authMode,
      loginId: root.loginId,
      sessionSource: root.sessionSource,
      authTokenPresent: Boolean(root.authToken)
    },
    lobby: {
      showLobby: root.showLobby,
      status: root.lobbyStatus,
      loading: root.lobbyLoading,
      entering: root.lobbyEntering,
      rooms: root.lobbyRooms?.map((room: Record<string, unknown>) => ({
        roomId: room.roomId,
        day: room.day,
        connectedPlayers: room.connectedPlayers
      })) ?? []
    },
    room: {
      diagnosticsConnectionStatus: root.diagnosticsConnectionStatus,
      lastUpdateDay: update?.world.meta.day ?? null,
      lastUpdateReason: root.lastRoomUpdateReason,
      lastUpdateSource: root.lastRoomUpdateSource,
      logTail: root.logLines?.slice(0, 8) ?? [],
      timelineTail: root.timelineEntries?.slice(0, 6) ?? [],
      sentMessages: options.room?.sentMessages ?? [],
      joinedOptions: options.joinedOptions ?? []
    },
    diagnostics: buildCocosRuntimeDiagnosticsSnapshot({
      devOnly: true,
      mode: update?.battle ? "battle" : "world",
      roomId: root.roomId,
      playerId: root.playerId,
      connectionStatus: root.diagnosticsConnectionStatus,
      lastUpdateSource: root.lastRoomUpdateSource,
      lastUpdateReason: root.lastRoomUpdateReason,
      lastUpdateAt: root.lastRoomUpdateAtMs,
      update,
      account: root.lobbyAccountProfile ?? createFallbackCocosPlayerAccountProfile(root.playerId, root.roomId, root.displayName),
      timelineEntries: root.timelineEntries ?? [],
      logLines: root.logLines ?? [],
      predictionStatus: root.predictionStatus ?? "",
      recoverySummary:
        typeof root.predictionStatus === "string" && root.predictionStatus.includes("回放缓存状态")
          ? root.predictionStatus
          : null,
      primaryClientTelemetry: root.primaryClientTelemetry ?? []
    })
  };
}

afterEach(() => {
  resetVeilRootRuntimeForTests();
  resetVeilCocosSessionRuntimeForTests();
  resetPixelSpriteRuntimeForTests();
  (sys as unknown as { localStorage: Storage | null }).localStorage = null;
  delete (globalThis as { history?: History }).history;
  delete (globalThis as { location?: Location }).location;
});

test("primary cocos client journey reuses an account session from lobby bootstrap and joins the selected room", async () => {
  const storage = createMemoryStorage();
  const roomUpdate = createSessionUpdate(4, "room-journey", "player-account");
  const room = new FakeColyseusRoom([roomUpdate], "journey-reconnect-token");
  const joinedOptions: Array<{ logicalRoomId: string; playerId: string; seed: number }> = [];
  const syncedAuthSession = {
    token: "account.session.token",
    playerId: "player-account",
    displayName: "暮潮守望",
    authMode: "account" as const,
    provider: "account-password" as const,
    loginId: "veil-ranger",
    source: "remote" as const
  };

  writeStoredCocosAuthSession(storage, syncedAuthSession);
  (sys as unknown as { localStorage: Storage }).localStorage = storage;
  (globalThis as { location?: Pick<Location, "search" | "href"> }).location = {
    search: "",
    href: "http://127.0.0.1:4173/"
  };
  (globalThis as { history?: Pick<History, "replaceState"> }).history = {
    replaceState() {}
  };

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room],
      joinedOptions
    })
  });
  setVeilRootRuntimeForTests({
    createSession: (...args) => VeilCocosSession.create(...args),
    readStoredReplay: (...args) => VeilCocosSession.readStoredReplay(...args),
    syncAuthSession: async () => syncedAuthSession,
    loadLobbyRooms: async () => [
      {
        roomId: "room-journey",
        seed: 1001,
        day: 4,
        connectedPlayers: 1,
        heroCount: 1,
        activeBattles: 0,
        updatedAt: "2026-03-31T08:22:00.000Z"
      }
    ],
    loadAccountProfile: async () =>
      createFallbackCocosPlayerAccountProfile("player-account", "room-journey", "暮潮守望", {
        source: "remote",
        authMode: "account",
        loginId: "veil-ranger"
      })
  });

  const { root } = createRootHarness();
  root.onLoad();
  root.start();

  await waitFor(
    () => root.showLobby === true && root.lobbyRooms.length === 1 && root.sessionSource === "remote",
    () => captureJourneyArtifact({ root, phase: "lobby-bootstrap", joinedOptions, room })
  );

  assert.equal(root.authMode, "account");
  assert.equal(root.loginId, "veil-ranger");
  assert.equal(root.lobbyRooms[0]?.roomId, "room-journey");
  await root.enterLobbyRoom("room-journey");

  await waitFor(
    () => root.showLobby === false && root.lastUpdate?.world.meta.roomId === "room-journey",
    () => captureJourneyArtifact({ root, phase: "room-join", joinedOptions, room })
  );

  assert.equal(root.authMode, "account");
  assert.equal(root.loginId, "veil-ranger");
  assert.equal(root.sessionSource, "remote");
  assert.equal(root.lastUpdate?.world.meta.day, 4);
  assert.deepEqual(joinedOptions, [
    {
      logicalRoomId: "room-journey",
      playerId: "player-account",
      seed: 1001
    }
  ]);
  assert.deepEqual(room.sentMessages, [
    {
      type: "connect",
      payload: {
        type: "connect",
        requestId: "cocos-req-1",
        roomId: "room-journey",
        playerId: "player-account",
        displayName: "暮潮守望",
        authToken: "account.session.token"
      }
    }
  ]);

  root.onDestroy();
  await flushMicrotasks();
});

test("primary cocos client journey surfaces stale stored account sessions before room entry and clears auth state", async () => {
  const storage = createMemoryStorage();

  writeStoredCocosAuthSession(storage, {
    token: "expired.account.token",
    playerId: "player-expired",
    displayName: "失效旅人",
    authMode: "account",
    provider: "account-password",
    loginId: "expired-ranger",
    source: "remote"
  });
  (sys as unknown as { localStorage: Storage }).localStorage = storage;
  (globalThis as { location?: Pick<Location, "search" | "href"> }).location = {
    search: "",
    href: "http://127.0.0.1:4173/"
  };
  (globalThis as { history?: Pick<History, "replaceState"> }).history = {
    replaceState() {}
  };

  setVeilRootRuntimeForTests({
    syncAuthSession: async () => null
  });

  const { root } = createRootHarness();
  root.onLoad();

  await root.enterLobbyRoom("room-expired");

  const storedSession = storage.getItem("project-veil:auth-session");
  assert.equal(root.showLobby, true, JSON.stringify(captureJourneyArtifact({ root, phase: "stale-session" }), null, 2));
  assert.equal(root.authMode, "guest");
  assert.equal(root.authToken, null);
  assert.equal(root.sessionSource, "none");
  assert.equal(root.loginId, "");
  assert.equal(storedSession, null);
  assert.equal(root.lobbyStatus, "账号会话已失效，请重新登录后再进入房间。");

  root.onDestroy();
  await flushMicrotasks();
});
