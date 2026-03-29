import assert from "node:assert/strict";
import test from "node:test";
import type { StoredAuthSession } from "../src/auth-session";
import { launchH5ClientApp } from "../src/main-launch";

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

test("launchH5ClientApp boots the cached H5 session fallback flow and registers automation hooks", async () => {
  const events: string[] = [];
  const hookedWindow: {
    render_game_to_text?: () => string;
    export_diagnostic_snapshot?: () => string;
    render_diagnostic_snapshot_to_text?: () => string;
    advanceTime?: (ms: number) => Promise<void>;
  } = {};
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
  const replayed = {
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
    reason: "cached"
  };

  await new Promise<void>((resolve, reject) => {
    launchH5ClientApp({
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
      },
      window: hookedWindow,
      devDiagnosticsEnabled: false,
      renderGameToText: () => "rendered",
      exportDiagnosticSnapshot: () => "diagnostic",
      renderDiagnosticSnapshotToText: () => "diagnostic-text",
      advanceUiTime: async (ms) => {
        events.push(`advanceUiTime:${ms}`);
      },
      startApp: ({ bootstrapApp, registerAutomationHooks }) => {
        void bootstrapApp().then(resolve, reject);
        registerAutomationHooks();
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
