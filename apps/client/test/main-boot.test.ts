import assert from "node:assert/strict";
import test from "node:test";
import type { SessionUpdate } from "../src/local-session";
import type { StoredAuthSession } from "../src/auth-session";
import { bootstrapH5App, registerAutomationHooks, syncH5PlayerAccountProfile } from "../src/main-boot";
import { createFallbackPlayerAccountProfile } from "../src/player-account";

function createSessionUpdate(reason?: string): SessionUpdate {
  return {
    world: {
      meta: {
        roomId: "room-alpha",
        seed: 1001,
        day: 2
      },
      map: {
        width: 1,
        height: 1,
        tiles: []
      },
      ownHeroes: [],
      visibleHeroes: [],
      resources: {
        gold: 50,
        wood: 3,
        ore: 1
      },
      playerId: "player-auth"
    },
    battle: null,
    events: [],
    movementPlan: null,
    reachableTiles: [{ x: 0, y: 0 }],
    ...(reason ? { reason } : {})
  };
}

function createStoredSession(overrides: Partial<StoredAuthSession> = {}): StoredAuthSession {
  return {
    token: "signed.token",
    playerId: "player-auth",
    displayName: "访客骑士",
    authMode: "account",
    loginId: "veil-ranger",
    source: "remote",
    ...overrides
  };
}

test("bootstrapH5App replays cached session state before the fresh snapshot and syncs cached auth boot state", async () => {
  const replayed = createSessionUpdate("cached");
  const initial = createSessionUpdate("snapshot");
  const events: string[] = [];
  const state = {
    lobby: {
      playerId: "player-from-query",
      displayName: "本地昵称",
      loginId: "",
      authSession: null
    },
    accountDraftName: "本地昵称",
    accountLoginId: "",
    diagnostics: {
      connectionStatus: "connecting" as const
    },
    log: ["正在连接本地会话服务...", "old-line"]
  };

  await bootstrapH5App({
    state,
    shouldBootGame: true,
    queryPlayerId: "",
    roomId: "room-alpha",
    playerId: "player-auth",
    bindKeyboardShortcuts: () => {
      events.push("bindKeyboardShortcuts");
    },
    render: () => {
      events.push("render");
    },
    syncCurrentAuthSession: async () => {
      events.push("syncCurrentAuthSession");
      return createStoredSession();
    },
    refreshLobbyRoomList: async () => {
      events.push("refreshLobbyRoomList");
    },
    logoutGuestSession: () => {
      events.push("logoutGuestSession");
    },
    readStoredSessionReplay: (roomId, playerId) => {
      events.push(`readStoredSessionReplay:${roomId}:${playerId}`);
      return replayed;
    },
    applyReplayedUpdate: (update) => {
      events.push(`applyReplayedUpdate:${update.reason}`);
    },
    getSession: async () => {
      events.push("getSession");
      return {
        snapshot: async () => {
          events.push("snapshot");
          return initial;
        }
      };
    },
    applyUpdate: (update, source) => {
      events.push(`applyUpdate:${source}:${update.reason}`);
    },
    syncPlayerAccountProfile: () => {
      events.push("syncPlayerAccountProfile");
    }
  });

  assert.deepEqual(events, [
    "bindKeyboardShortcuts",
    "render",
    "syncCurrentAuthSession",
    "readStoredSessionReplay:room-alpha:player-auth",
    "applyReplayedUpdate:cached",
    "getSession",
    "snapshot",
    "applyUpdate:system:snapshot",
    "syncPlayerAccountProfile"
  ]);
  assert.equal(state.lobby.playerId, "player-auth");
  assert.equal(state.lobby.displayName, "访客骑士");
  assert.equal(state.lobby.loginId, "veil-ranger");
  assert.equal(state.accountDraftName, "访客骑士");
  assert.equal(state.accountLoginId, "veil-ranger");
  assert.equal(state.diagnostics.connectionStatus, "connected");
  assert.deepEqual(state.log, ["会话已连接。Room room-alpha / Player player-auth", "old-line"]);
});

test("bootstrapH5App keeps the cached session visible and marks boot failure when the remote snapshot is unavailable", async () => {
  const replayed = createSessionUpdate("cached");
  const events: string[] = [];
  const state = {
    lobby: {
      playerId: "player-auth",
      displayName: "访客骑士",
      loginId: "",
      authSession: null
    },
    accountDraftName: "访客骑士",
    accountLoginId: "",
    diagnostics: {
      connectionStatus: "connecting" as const
    },
    log: ["正在连接本地会话服务...", "old-line"]
  };

  await bootstrapH5App({
    state,
    shouldBootGame: true,
    queryPlayerId: "player-auth",
    roomId: "room-alpha",
    playerId: "player-auth",
    bindKeyboardShortcuts: () => {
      events.push("bindKeyboardShortcuts");
    },
    render: () => {
      events.push("render");
    },
    syncCurrentAuthSession: async () => {
      events.push("syncCurrentAuthSession");
      return createStoredSession({ source: "local" });
    },
    refreshLobbyRoomList: async () => {
      events.push("refreshLobbyRoomList");
    },
    logoutGuestSession: () => {
      events.push("logoutGuestSession");
    },
    readStoredSessionReplay: () => {
      events.push("readStoredSessionReplay");
      return replayed;
    },
    applyReplayedUpdate: (update) => {
      events.push(`applyReplayedUpdate:${update.reason}`);
    },
    getSession: async () => {
      events.push("getSession");
      throw new Error("session_unavailable");
    },
    applyUpdate: () => {
      events.push("applyUpdate");
    },
    syncPlayerAccountProfile: () => {
      events.push("syncPlayerAccountProfile");
    }
  });

  assert.deepEqual(events, [
    "bindKeyboardShortcuts",
    "render",
    "syncCurrentAuthSession",
    "readStoredSessionReplay",
    "applyReplayedUpdate:cached",
    "getSession",
    "render"
  ]);
  assert.equal(state.diagnostics.connectionStatus, "reconnect_failed");
  assert.deepEqual(state.log, ["远端会话暂不可用，当前仅展示最近缓存状态。", "old-line"]);
});

test("bootstrapH5App logs out when no query player or synced session can restore the boot identity", async () => {
  const events: string[] = [];
  const state = {
    lobby: {
      playerId: "guest-001",
      displayName: "本地游客",
      loginId: "",
      authSession: createStoredSession({ authMode: "guest", source: "local", playerId: "guest-001", loginId: undefined })
    },
    accountDraftName: "本地游客",
    accountLoginId: "",
    diagnostics: {
      connectionStatus: "connecting" as const
    },
    log: ["正在连接本地会话服务..."]
  };

  await bootstrapH5App({
    state,
    shouldBootGame: true,
    queryPlayerId: "",
    roomId: "room-alpha",
    playerId: "guest-001",
    bindKeyboardShortcuts: () => {
      events.push("bindKeyboardShortcuts");
    },
    render: () => {
      events.push("render");
    },
    syncCurrentAuthSession: async () => {
      events.push("syncCurrentAuthSession");
      return null;
    },
    refreshLobbyRoomList: async () => {
      events.push("refreshLobbyRoomList");
    },
    logoutGuestSession: () => {
      events.push("logoutGuestSession");
    },
    readStoredSessionReplay: () => {
      events.push("readStoredSessionReplay");
      return null;
    },
    applyReplayedUpdate: () => {
      events.push("applyReplayedUpdate");
    },
    getSession: async () => {
      events.push("getSession");
      throw new Error("should_not_fetch_session");
    },
    applyUpdate: () => {
      events.push("applyUpdate");
    },
    syncPlayerAccountProfile: () => {
      events.push("syncPlayerAccountProfile");
    }
  });

  assert.deepEqual(events, ["bindKeyboardShortcuts", "render", "syncCurrentAuthSession", "logoutGuestSession"]);
  assert.equal(state.lobby.authSession, null);
  assert.equal(state.diagnostics.connectionStatus, "connecting");
});

test("syncH5PlayerAccountProfile keeps boot usable when progression falls back to local storage", async () => {
  const events: string[] = [];
  const state = {
    lobby: {
      playerId: "player-auth",
      displayName: "访客骑士",
      loginId: "",
      authSession: null
    },
    account: createFallbackPlayerAccountProfile("player-auth", "room-alpha", "旧昵称"),
    accountDraftName: "旧昵称",
    accountLoginId: "old-login",
    accountStatus: "",
    accountSessions: [
      {
        sessionId: "stale",
        provider: "password",
        deviceLabel: "Laptop",
        lastUsedAt: "2026-03-29T00:00:00.000Z",
        createdAt: "2026-03-29T00:00:00.000Z",
        refreshExpiresAt: "2026-04-29T00:00:00.000Z",
        current: true
      }
    ],
    accountSessionsLoading: false,
    replayDetail: {
      selectedReplayId: "missing-replay"
    }
  };

  await syncH5PlayerAccountProfile({
    state,
    playerId: "player-auth",
    roomId: "room-alpha",
    loadAccountProfileWithProgression: async () => {
      events.push("loadAccountProfileWithProgression");
      return createFallbackPlayerAccountProfile("player-auth", "room-alpha", "离线勇者");
    },
    loadPlayerAccountSessions: async () => {
      events.push("loadPlayerAccountSessions");
      return [];
    },
    readStoredAuthSession: () => {
      events.push("readStoredAuthSession");
      return null;
    },
    clearReplayDetail: (status) => {
      events.push(`clearReplayDetail:${status}`);
    },
    render: () => {
      events.push("render");
    }
  });

  assert.deepEqual(events, [
    "loadAccountProfileWithProgression",
    "readStoredAuthSession",
    "clearReplayDetail:最近战报已刷新，当前选中的回放已不可用。",
    "render"
  ]);
  assert.equal(state.account.source, "local");
  assert.equal(state.account.displayName, "离线勇者");
  assert.equal(state.accountDraftName, "离线勇者");
  assert.equal(state.accountLoginId, "old-login");
  assert.equal(state.accountStatus, "当前运行在本地游客档，昵称仅保存在浏览器。");
  assert.deepEqual(state.accountSessions, []);
  assert.equal(state.accountSessionsLoading, false);
});

test("registerAutomationHooks wires CI-facing automation helpers and only exposes diagnostic export in dev", async () => {
  const prodWindow: {
    render_game_to_text?: () => string;
    export_diagnostic_snapshot?: () => string;
    advanceTime?: (ms: number) => Promise<void>;
  } = {
    export_diagnostic_snapshot: () => "stale"
  };
  const devWindow: typeof prodWindow = {};

  registerAutomationHooks({
    window: prodWindow,
    devDiagnosticsEnabled: false,
    renderGameToText: () => "rendered",
    exportDiagnosticSnapshot: () => "diagnostic",
    advanceUiTime: async (ms) => {
      assert.equal(ms, 16);
    }
  });
  registerAutomationHooks({
    window: devWindow,
    devDiagnosticsEnabled: true,
    renderGameToText: () => "rendered-dev",
    exportDiagnosticSnapshot: () => "diagnostic-dev",
    advanceUiTime: async () => {}
  });

  assert.equal(prodWindow.render_game_to_text?.(), "rendered");
  assert.equal(prodWindow.export_diagnostic_snapshot, undefined);
  await assert.doesNotReject(async () => prodWindow.advanceTime?.(16));
  assert.equal(devWindow.render_game_to_text?.(), "rendered-dev");
  assert.equal(devWindow.export_diagnostic_snapshot?.(), "diagnostic-dev");
});
