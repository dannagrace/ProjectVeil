import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FEATURE_FLAGS } from "@veil/shared/platform";
import type { SessionUpdate } from "../src/local-session";
import type { StoredAuthSession } from "../src/auth-session";
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
    featureFlags: DEFAULT_FEATURE_FLAGS,
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
    achievementPanel: {
      items: []
    },
    log: ["正在连接本地会话服务...", "old-line"]
  };
}

function installFakeBrowser(): void {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  };
  const fakeWindow = {
    location: {
      search: "",
      protocol: "http:",
      hostname: "127.0.0.1",
      href: "http://127.0.0.1:4173/"
    },
    localStorage: storage,
    setTimeout,
    clearTimeout
  };
  const fakeElement = () => ({
    style: {},
    append: () => undefined,
    click: () => undefined,
    remove: () => undefined,
    setAttribute: () => undefined,
    addEventListener: () => undefined,
    querySelectorAll: () => [],
    querySelector: () => null,
    innerHTML: "",
    textContent: "",
    id: ""
  });

  Object.assign(globalThis, {
    window: fakeWindow,
    document: {
      createElement: fakeElement,
      body: {
        appendChild: () => undefined
      },
      querySelector: () => null,
      addEventListener: () => undefined
    }
  });
}

async function loadMainModule(): Promise<typeof import("../src/main")> {
  globalThis.__PROJECT_VEIL_MAIN_SKIP_AUTO_BOOT__ = true;
  installFakeBrowser();
  return import("../src/main");
}

test("startMainH5Boot covers cached-session boot and exposes automation hooks before boot settles", async () => {
  const { startMainH5Boot } = await loadMainModule();
  const replayed = createSessionUpdate("cached");
  const initial = createSessionUpdate("snapshot");
  const events: string[] = [];
  const state = createState();
  const remoteAccount = {
    ...createFallbackPlayerAccountProfile("player-auth", "room-alpha", "访客骑士"),
    loginId: "veil-ranger",
    source: "remote" as const
  };
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

  startMainH5Boot({
    state: state as never,
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
    loadAccountProfileWithProgression: async (playerId, roomId) => {
      events.push(`loadAccountProfileWithProgression:${playerId}:${roomId}`);
      return remoteAccount;
    },
    loadPlayerAccountSessions: async () => {
      events.push("loadPlayerAccountSessions");
      return [];
    },
    readStoredAuthSession: () => createStoredSession(),
    clearReplayDetail: () => {
      events.push("clearReplayDetail");
    },
    onPlayerAccountProfileSynced: () => {
      events.push("onPlayerAccountProfileSynced");
      resolveSyncedProfile();
    },
    window: hookedWindow as Window,
    devDiagnosticsEnabled: true,
    renderGameToText: () => "rendered",
    exportDiagnosticSnapshot: () => "diagnostic",
    renderDiagnosticSnapshotToText: () => "diagnostic-text",
    advanceUiTime: async (ms) => {
      events.push(`advanceUiTime:${ms}`);
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
    "loadAccountProfileWithProgression:player-auth:room-alpha",
    "loadPlayerAccountSessions",
    "render",
    "onPlayerAccountProfileSynced"
  ]);
  assert.equal(state.lobby.displayName, "访客骑士");
  assert.equal(state.accountDraftName, "访客骑士");
  assert.equal(state.accountLoginId, "veil-ranger");
  assert.equal(state.diagnostics.connectionStatus, "connected");
  assert.deepEqual(state.log, ["会话已连接。Room room-alpha / Player player-auth", "old-line"]);

});

test("startMainH5Boot keeps cached local state visible when the remote session is unavailable", async () => {
  const { startMainH5Boot } = await loadMainModule();
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

  await new Promise<void>((resolve, reject) => {
    startMainH5Boot({
      state: state as never,
      shouldBootGame: true,
      queryPlayerId: "player-auth",
      roomId: "room-alpha",
      playerId: "player-auth",
      bindKeyboardShortcuts: () => {
        events.push("bindKeyboardShortcuts");
      },
      render: () => {
        events.push("render");
        if (events.includes("getSession")) {
          resolve();
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
        events.push("loadAccountProfileWithProgression");
        return state.account;
      },
      loadPlayerAccountSessions: async () => {
        events.push("loadPlayerAccountSessions");
        return [];
      },
      readStoredAuthSession: () => createStoredSession({ source: "local" }),
      clearReplayDetail: () => {
        events.push("clearReplayDetail");
      },
      onPlayerAccountProfileSynced: () => {
        events.push("onPlayerAccountProfileSynced");
      },
      window: hookedWindow as Window,
      devDiagnosticsEnabled: false,
      renderGameToText: () => "rendered",
      exportDiagnosticSnapshot: () => "diagnostic",
      renderDiagnosticSnapshotToText: () => "diagnostic-text",
      advanceUiTime: async (ms) => {
        events.push(`advanceUiTime:${ms}`);
      }
    });
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
  assert.equal(hookedWindow.render_game_to_text?.(), "rendered");
  assert.equal(hookedWindow.export_diagnostic_snapshot, undefined);
  assert.equal(hookedWindow.render_diagnostic_snapshot_to_text, undefined);
  await assert.doesNotReject(async () => hookedWindow.advanceTime?.(16));
  assert.deepEqual(events, [
    "bindKeyboardShortcuts",
    "render",
    "syncCurrentAuthSession",
    "readStoredSessionReplay",
    "applyReplayedUpdate:cached",
    "getSession",
    "render",
    "advanceUiTime:16"
  ]);
});
