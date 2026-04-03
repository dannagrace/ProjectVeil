import type { RuntimeDiagnosticsConnectionStatus } from "../../../packages/shared/src/index";
import type { StoredAuthSession } from "./auth-session";
import type { SessionUpdate } from "./local-session";
import type { PlayerAccountProfile, PlayerAccountSessionDevice } from "./player-account";

interface LobbyBootState {
  playerId: string;
  displayName: string;
  loginId: string;
  authSession: StoredAuthSession | null;
}

interface ReplayDetailBootState {
  selectedReplayId: string | null;
}

interface BootDiagnosticsState {
  connectionStatus: RuntimeDiagnosticsConnectionStatus;
}

interface H5BootstrapState {
  lobby: LobbyBootState;
  accountDraftName: string;
  accountLoginId: string;
  diagnostics: BootDiagnosticsState;
  log: string[];
}

interface H5AccountBootstrapState {
  lobby: LobbyBootState;
  account: PlayerAccountProfile;
  accountDraftName: string;
  accountLoginId: string;
  accountStatus: string;
  accountSessions: PlayerAccountSessionDevice[];
  accountSessionsLoading: boolean;
  replayDetail: ReplayDetailBootState;
}

interface H5BootSession {
  snapshot(): Promise<SessionUpdate>;
}

interface BootstrapH5AppOptions {
  state: H5BootstrapState;
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
  getSession: () => Promise<H5BootSession>;
  applyUpdate: (update: SessionUpdate, source: "system") => void;
  syncPlayerAccountProfile: () => Promise<void> | void;
}

interface SyncH5AccountBootstrapOptions {
  state: H5AccountBootstrapState;
  playerId: string;
  roomId: string;
  loadAccountProfileWithProgression: (playerId: string, roomId: string) => Promise<PlayerAccountProfile>;
  loadPlayerAccountSessions: () => Promise<PlayerAccountSessionDevice[]>;
  readStoredAuthSession: () => StoredAuthSession | null;
  clearReplayDetail: (status: string) => void;
  render: () => void;
}

interface RegisterAutomationHooksOptions {
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
}

function summarizeBootSessionFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return "会话恢复失败，请刷新页面或稍后重试。";
  }

  if (error.message === "session_not_ready" || error.message === "session_unavailable") {
    return "会话恢复失败，请返回大厅后重新进入房间。";
  }

  return `会话恢复失败：${error.message}`;
}

export async function bootstrapH5App({
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
}: BootstrapH5AppOptions): Promise<void> {
  bindKeyboardShortcuts();
  render();

  const syncedAuthSession = await syncCurrentAuthSession();
  state.lobby.authSession = syncedAuthSession;
  if (syncedAuthSession) {
    state.lobby.playerId = syncedAuthSession.playerId;
    state.lobby.displayName = syncedAuthSession.displayName;
    state.lobby.loginId = syncedAuthSession.loginId ?? state.lobby.loginId;
    state.accountDraftName = syncedAuthSession.displayName;
    state.accountLoginId = syncedAuthSession.loginId ?? state.accountLoginId;
  }

  if (!shouldBootGame) {
    await refreshLobbyRoomList();
    return;
  }

  if (!queryPlayerId && !syncedAuthSession?.playerId) {
    logoutGuestSession();
    return;
  }

  const replayed = readStoredSessionReplay(roomId, playerId);
  if (replayed) {
    applyReplayedUpdate(replayed);
  }

  try {
    const session = await getSession();
    const initial = await session.snapshot();
    state.diagnostics.connectionStatus = "connected";
    state.log = [
      `会话已连接。Room ${roomId} / Player ${playerId}`,
      ...state.log.filter(
        (line) => line !== "正在连接本地会话服务..." && line !== `会话已连接。Room ${roomId} / Player ${playerId}`
      )
    ].slice(0, 12);
    applyUpdate(initial, "system");
    void syncPlayerAccountProfile();
  } catch (error) {
    state.diagnostics.connectionStatus = "reconnect_failed";
    state.log = [
      replayed ? "远端会话暂不可用，当前仅展示最近缓存状态。" : summarizeBootSessionFailure(error),
      ...state.log.filter((line) => line !== "正在连接本地会话服务...")
    ].slice(0, 12);
    render();
  }
}

export async function syncH5PlayerAccountProfile({
  state,
  playerId,
  roomId,
  loadAccountProfileWithProgression,
  loadPlayerAccountSessions,
  readStoredAuthSession,
  clearReplayDetail,
  render
}: SyncH5AccountBootstrapOptions): Promise<void> {
  state.accountSessionsLoading = true;
  const account = await loadAccountProfileWithProgression(playerId, roomId);
  const accountSessions =
    state.lobby.authSession?.authMode === "account" || readStoredAuthSession()?.authMode === "account"
      ? await loadPlayerAccountSessions()
      : [];
  state.account = account;
  state.accountSessions = accountSessions;
  state.accountDraftName = account.displayName;
  state.accountLoginId = account.loginId ?? state.accountLoginId;
  state.accountStatus =
    account.source === "remote"
      ? account.loginId
        ? `账号资料与全局仓库已同步，当前已绑定登录 ID ${account.loginId}。`
        : "账号资料与全局仓库已同步，可继续把当前游客档升级成口令账号。"
      : "当前运行在本地游客档，昵称仅保存在浏览器。";
  if (
    state.replayDetail.selectedReplayId &&
    !account.recentBattleReplays.some((replay) => replay.id === state.replayDetail.selectedReplayId) &&
    !account.battleReportCenter?.items.some((report) => report.id === state.replayDetail.selectedReplayId)
  ) {
    clearReplayDetail("最近战报已刷新，当前选中的回放已不可用。");
  }
  state.accountSessionsLoading = false;
  render();
}

export function registerAutomationHooks({
  window,
  devDiagnosticsEnabled,
  renderGameToText,
  exportDiagnosticSnapshot,
  renderDiagnosticSnapshotToText,
  advanceUiTime
}: RegisterAutomationHooksOptions): void {
  window.render_game_to_text = renderGameToText;
  if (devDiagnosticsEnabled) {
    window.export_diagnostic_snapshot = exportDiagnosticSnapshot;
    window.render_diagnostic_snapshot_to_text = renderDiagnosticSnapshotToText;
  } else {
    delete window.export_diagnostic_snapshot;
    delete window.render_diagnostic_snapshot_to_text;
  }
  window.advanceTime = advanceUiTime;
}
