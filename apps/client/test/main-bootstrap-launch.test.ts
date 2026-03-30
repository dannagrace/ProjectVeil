import assert from "node:assert/strict";
import test from "node:test";
import type { SessionUpdate } from "../src/local-session";
import type { StoredAuthSession } from "../src/auth-session";
import { launchMainH5App } from "../src/main-bootstrap-launch";
import { createFallbackPlayerAccountProfile } from "../src/player-account";

function createSessionUpdate(reason: string): SessionUpdate {
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
    reason
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

function createState() {
  return {
    account: createFallbackPlayerAccountProfile("player-auth", "room-alpha", "本地昵称"),
    lobby: {
      playerId: "player-auth",
      displayName: "本地昵称",
      loginId: "",
      authSession: null
    },
    accountDraftName: "本地昵称",
    accountLoginId: "",
    accountStatus: "游客账号资料将在连接后自动同步。",
    accountSessions: [],
    accountSessionsLoading: false,
    replayDetail: {
      selectedReplayId: null
    },
    diagnostics: {
      connectionStatus: "connecting" as const
    },
    log: ["正在连接本地会话服务...", "old-line"]
  };
}

test("launchMainH5App wires main bootstrap through cached-session boot and exposes debug hooks before boot settles", async () => {
  const replayed = createSessionUpdate("cached");
  const initial = createSessionUpdate("snapshot");
  const events: string[] = [];
  const state = createState();
  const hookedWindow: {
    render_game_to_text?: () => string;
    export_diagnostic_snapshot?: () => string;
    render_diagnostic_snapshot_to_text?: () => string;
    advanceTime?: (ms: number) => Promise<void>;
  } = {};
  let resolveAuthSession!: (value: StoredAuthSession | null) => void;
  const authSessionPromise = new Promise<StoredAuthSession | null>((resolve) => {
    resolveAuthSession = resolve;
  });
  let resolveSyncedProfile!: () => void;
  const syncedProfile = new Promise<void>((resolve) => {
    resolveSyncedProfile = resolve;
  });

  launchMainH5App({
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
      return authSessionPromise;
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
    loadAccountProfileWithProgression: async () => {
      throw new Error("loadAccountProfileWithProgression should not be called directly");
    },
    loadPlayerAccountSessions: async () => {
      throw new Error("loadPlayerAccountSessions should not be called directly");
    },
    readStoredAuthSession: () => createStoredSession(),
    clearReplayDetail: () => {
      events.push("clearReplayDetail");
    },
    onPlayerAccountProfileSynced: () => {
      events.push("onPlayerAccountProfileSynced");
    },
    window: hookedWindow,
    devDiagnosticsEnabled: true,
    renderGameToText: () => "rendered",
    exportDiagnosticSnapshot: () => "diagnostic",
    renderDiagnosticSnapshotToText: () => "diagnostic-text",
    advanceUiTime: async (ms) => {
      events.push(`advanceUiTime:${ms}`);
    },
    syncH5PlayerAccountProfileImpl: async ({ playerId, roomId }) => {
      events.push(`syncH5PlayerAccountProfile:${playerId}:${roomId}`);
      resolveSyncedProfile();
    }
  });

  assert.deepEqual(events, ["bindKeyboardShortcuts", "render", "syncCurrentAuthSession"]);
  assert.equal(hookedWindow.render_game_to_text?.(), "rendered");
  assert.equal(hookedWindow.export_diagnostic_snapshot?.(), "diagnostic");
  assert.equal(hookedWindow.render_diagnostic_snapshot_to_text?.(), "diagnostic-text");
  await assert.doesNotReject(async () => hookedWindow.advanceTime?.(16));
  assert.deepEqual(events, ["bindKeyboardShortcuts", "render", "syncCurrentAuthSession", "advanceUiTime:16"]);

  resolveAuthSession(createStoredSession());
  await syncedProfile;
  await Promise.resolve();

  assert.deepEqual(events, [
    "bindKeyboardShortcuts",
    "render",
    "syncCurrentAuthSession",
    "advanceUiTime:16",
    "readStoredSessionReplay:room-alpha:player-auth",
    "applyReplayedUpdate:cached",
    "getSession",
    "snapshot",
    "applyUpdate:system:snapshot",
    "syncH5PlayerAccountProfile:player-auth:room-alpha",
    "onPlayerAccountProfileSynced"
  ]);
  assert.equal(state.lobby.displayName, "访客骑士");
  assert.equal(state.accountDraftName, "访客骑士");
  assert.equal(state.accountLoginId, "veil-ranger");
  assert.equal(state.diagnostics.connectionStatus, "connected");
  assert.deepEqual(state.log, ["会话已连接。Room room-alpha / Player player-auth", "old-line"]);
});

test("launchMainH5App keeps cached local state when the remote session is unavailable and strips dev-only hooks in non-dev boot", async () => {
  const replayed = createSessionUpdate("cached");
  const events: string[] = [];
  const state = createState();
  const hookedWindow: {
    render_game_to_text?: () => string;
    export_diagnostic_snapshot?: () => string;
    render_diagnostic_snapshot_to_text?: () => string;
    advanceTime?: (ms: number) => Promise<void>;
  } = {
    export_diagnostic_snapshot: () => "stale-export",
    render_diagnostic_snapshot_to_text: () => "stale-text"
  };
  let resolveFallbackRender!: () => void;
  const fallbackRendered = new Promise<void>((resolve) => {
    resolveFallbackRender = resolve;
  });
  let renderCount = 0;

  launchMainH5App({
    state,
    shouldBootGame: true,
    queryPlayerId: "player-auth",
    roomId: "room-alpha",
    playerId: "player-auth",
    bindKeyboardShortcuts: () => {
      events.push("bindKeyboardShortcuts");
    },
    render: () => {
      renderCount += 1;
      events.push(`render:${renderCount}`);
      if (renderCount === 2) {
        resolveFallbackRender();
      }
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
    loadAccountProfileWithProgression: async () => {
      throw new Error("loadAccountProfileWithProgression should not run after failed remote boot");
    },
    loadPlayerAccountSessions: async () => {
      throw new Error("loadPlayerAccountSessions should not run after failed remote boot");
    },
    readStoredAuthSession: () => createStoredSession({ source: "local" }),
    clearReplayDetail: () => {
      events.push("clearReplayDetail");
    },
    onPlayerAccountProfileSynced: () => {
      events.push("onPlayerAccountProfileSynced");
    },
    window: hookedWindow,
    devDiagnosticsEnabled: false,
    renderGameToText: () => "rendered",
    exportDiagnosticSnapshot: () => "diagnostic",
    renderDiagnosticSnapshotToText: () => "diagnostic-text",
    advanceUiTime: async (ms) => {
      events.push(`advanceUiTime:${ms}`);
    }
  });

  assert.equal(hookedWindow.render_game_to_text?.(), "rendered");
  assert.equal(hookedWindow.export_diagnostic_snapshot, undefined);
  assert.equal(hookedWindow.render_diagnostic_snapshot_to_text, undefined);
  await assert.doesNotReject(async () => hookedWindow.advanceTime?.(8));
  await fallbackRendered;

  assert.deepEqual(events, [
    "bindKeyboardShortcuts",
    "render:1",
    "syncCurrentAuthSession",
    "advanceUiTime:8",
    "readStoredSessionReplay",
    "applyReplayedUpdate:cached",
    "getSession",
    "render:2"
  ]);
  assert.equal(state.lobby.displayName, "访客骑士");
  assert.equal(state.accountDraftName, "访客骑士");
  assert.equal(state.accountLoginId, "veil-ranger");
  assert.equal(state.diagnostics.connectionStatus, "reconnect_failed");
  assert.deepEqual(state.log, ["远端会话暂不可用，当前仅展示最近缓存状态。", "old-line"]);
});

test("launchMainH5App logs out before session bootstrap when no query player or synced auth session can restore identity", async () => {
  const events: string[] = [];
  const state = createState();
  const hookedWindow: {
    render_game_to_text?: () => string;
    export_diagnostic_snapshot?: () => string;
    render_diagnostic_snapshot_to_text?: () => string;
    advanceTime?: (ms: number) => Promise<void>;
  } = {};

  launchMainH5App({
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
      return createSessionUpdate("cached");
    },
    applyReplayedUpdate: (update) => {
      events.push(`applyReplayedUpdate:${update.reason}`);
    },
    getSession: async () => {
      events.push("getSession");
      return {
        snapshot: async () => createSessionUpdate("snapshot")
      };
    },
    applyUpdate: (update, source) => {
      events.push(`applyUpdate:${source}:${update.reason}`);
    },
    loadAccountProfileWithProgression: async () => {
      throw new Error("loadAccountProfileWithProgression should not run after logout");
    },
    loadPlayerAccountSessions: async () => {
      throw new Error("loadPlayerAccountSessions should not run after logout");
    },
    readStoredAuthSession: () => null,
    clearReplayDetail: () => {
      events.push("clearReplayDetail");
    },
    onPlayerAccountProfileSynced: () => {
      events.push("onPlayerAccountProfileSynced");
    },
    window: hookedWindow,
    devDiagnosticsEnabled: false,
    renderGameToText: () => "rendered",
    exportDiagnosticSnapshot: () => "diagnostic",
    renderDiagnosticSnapshotToText: () => "diagnostic-text",
    advanceUiTime: async (ms) => {
      events.push(`advanceUiTime:${ms}`);
    }
  });

  await Promise.resolve();

  assert.deepEqual(events, ["bindKeyboardShortcuts", "render", "syncCurrentAuthSession", "logoutGuestSession"]);
  assert.equal(state.diagnostics.connectionStatus, "connecting");
  assert.deepEqual(state.log, ["正在连接本地会话服务...", "old-line"]);
  assert.equal(hookedWindow.render_game_to_text?.(), "rendered");
  assert.equal(hookedWindow.export_diagnostic_snapshot, undefined);
  assert.equal(hookedWindow.render_diagnostic_snapshot_to_text, undefined);
});
