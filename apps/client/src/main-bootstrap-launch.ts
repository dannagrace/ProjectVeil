import type { RuntimeDiagnosticsConnectionStatus } from "../../../packages/shared/src/index";
import { syncH5PlayerAccountProfile } from "./main-boot";
import { launchH5ClientApp } from "./main-launch";
import type { SessionUpdate } from "./local-session";
import type { StoredAuthSession } from "./auth-session";
import type { PlayerAccountProfile, PlayerAccountSessionDevice } from "./player-account";

interface LobbyBootstrapState {
  playerId: string;
  displayName: string;
  loginId: string;
  authSession: StoredAuthSession | null;
}

interface ReplayDetailBootstrapState {
  selectedReplayId: string | null;
}

interface MainBootstrapState {
  lobby: LobbyBootstrapState;
  account: PlayerAccountProfile;
  accountDraftName: string;
  accountLoginId: string;
  accountStatus: string;
  accountSessions: PlayerAccountSessionDevice[];
  accountSessionsLoading: boolean;
  replayDetail: ReplayDetailBootstrapState;
  diagnostics: {
    connectionStatus: RuntimeDiagnosticsConnectionStatus;
  };
  log: string[];
}

interface MainBootstrapSession {
  snapshot(): Promise<SessionUpdate>;
}

interface LaunchMainH5AppOptions {
  state: MainBootstrapState;
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
  getSession: () => Promise<MainBootstrapSession>;
  applyUpdate: (update: SessionUpdate, source: "system") => void;
  loadAccountProfileWithProgression: (playerId: string, roomId: string) => Promise<PlayerAccountProfile>;
  loadPlayerAccountSessions: () => Promise<PlayerAccountSessionDevice[]>;
  readStoredAuthSession: () => StoredAuthSession | null;
  clearReplayDetail: (status: string) => void;
  onPlayerAccountProfileSynced?: () => void;
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
  launchH5ClientAppImpl?: typeof launchH5ClientApp;
  syncH5PlayerAccountProfileImpl?: typeof syncH5PlayerAccountProfile;
}

export function launchMainH5App({
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
  loadAccountProfileWithProgression,
  loadPlayerAccountSessions,
  readStoredAuthSession,
  clearReplayDetail,
  onPlayerAccountProfileSynced,
  window,
  devDiagnosticsEnabled,
  renderGameToText,
  exportDiagnosticSnapshot,
  renderDiagnosticSnapshotToText,
  advanceUiTime,
  launchH5ClientAppImpl = launchH5ClientApp,
  syncH5PlayerAccountProfileImpl = syncH5PlayerAccountProfile
}: LaunchMainH5AppOptions): void {
  launchH5ClientAppImpl({
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
    syncPlayerAccountProfile: () =>
      syncH5PlayerAccountProfileImpl({
        state,
        playerId,
        roomId,
        loadAccountProfileWithProgression,
        loadPlayerAccountSessions,
        readStoredAuthSession,
        clearReplayDetail,
        render
      }).then(() => {
        onPlayerAccountProfileSynced?.();
      }),
    window,
    devDiagnosticsEnabled,
    renderGameToText,
    exportDiagnosticSnapshot,
    renderDiagnosticSnapshotToText,
    advanceUiTime
  });
}
