import type { StoredAuthSession } from "./auth-session";
import { startH5ClientApp } from "./main-entry";
import { bootstrapH5App, registerAutomationHooks } from "./main-boot";
import type { SessionUpdate } from "./local-session";

interface LobbyBootState {
  playerId: string;
  displayName: string;
  loginId: string;
  authSession: StoredAuthSession | null;
}

interface MainLaunchState {
  lobby: LobbyBootState;
  accountDraftName: string;
  accountLoginId: string;
  diagnostics: {
    connectionStatus: "connecting" | "connected" | "reconnecting" | "reconnect_failed";
  };
  log: string[];
}

interface MainLaunchSession {
  snapshot(): Promise<SessionUpdate>;
}

interface LaunchH5ClientAppOptions {
  state: MainLaunchState;
  shouldBootGame: boolean;
  queryPlayerId: string;
  roomId: string;
  playerId: string;
  bindKeyboardShortcuts: () => void;
  render: () => void;
  syncCurrentAuthSession: () => Promise<StoredAuthSession | null>;
  refreshLobbyRoomList: () => Promise<void>;
  logoutGuestSession: () => void;
  readStoredSessionReplay: (roomId: string, playerId: string) => SessionUpdate | null;
  applyReplayedUpdate: (update: SessionUpdate) => void;
  getSession: () => Promise<MainLaunchSession>;
  applyUpdate: (update: SessionUpdate, source: "system") => void;
  syncPlayerAccountProfile: () => Promise<void> | void;
  window: {
    render_game_to_text?: () => string;
    export_diagnostic_snapshot?: () => string;
    render_diagnostic_snapshot_to_text?: () => string;
    advanceTime?: (ms: number) => Promise<void>;
  };
  devDiagnosticsEnabled: boolean;
  renderGameToText: () => string;
  exportDiagnosticSnapshot: () => string;
  renderDiagnosticSnapshotToText: () => string;
  advanceUiTime: (ms: number) => Promise<void>;
  startApp?: typeof startH5ClientApp;
  bootstrapH5AppImpl?: typeof bootstrapH5App;
  registerAutomationHooksImpl?: typeof registerAutomationHooks;
}

export function launchH5ClientApp({
  state,
  shouldBootGame,
  queryPlayerId,
  roomId,
  playerId,
  bindKeyboardShortcuts,
  render,
  syncCurrentAuthSession,
  refreshLobbyRoomList,
  logoutGuestSession,
  readStoredSessionReplay,
  applyReplayedUpdate,
  getSession,
  applyUpdate,
  syncPlayerAccountProfile,
  window,
  devDiagnosticsEnabled,
  renderGameToText,
  exportDiagnosticSnapshot,
  renderDiagnosticSnapshotToText,
  advanceUiTime,
  startApp = startH5ClientApp,
  bootstrapH5AppImpl = bootstrapH5App,
  registerAutomationHooksImpl = registerAutomationHooks
}: LaunchH5ClientAppOptions): void {
  startApp({
    bootstrapApp: () =>
      bootstrapH5AppImpl({
        state,
        shouldBootGame,
        queryPlayerId,
        roomId,
        playerId,
        bindKeyboardShortcuts,
        render,
        syncCurrentAuthSession,
        refreshLobbyRoomList,
        logoutGuestSession,
        readStoredSessionReplay,
        applyReplayedUpdate,
        getSession,
        applyUpdate,
        syncPlayerAccountProfile
      }),
    registerAutomationHooks: () =>
      registerAutomationHooksImpl({
        window,
        devDiagnosticsEnabled,
        renderGameToText,
        exportDiagnosticSnapshot,
        renderDiagnosticSnapshotToText,
        advanceUiTime
      })
  });
}
