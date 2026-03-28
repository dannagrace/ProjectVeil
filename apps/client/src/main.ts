import "./styles.css";
import {
  createBattleReplayPlaybackState,
  createHeroSkillTreeView,
  createHeroAttributeBreakdown,
  createHeroEquipmentLoadoutView,
  createHeroProgressMeterView,
  experienceRequiredForNextLevel,
  formatEquipmentBonusSummary,
  formatEquipmentRarityLabel,
  getDefaultBattleSkillCatalog,
  getEquipmentDefinition,
  pauseBattleReplayPlayback,
  predictPlayerWorldAction,
  playBattleReplayPlayback,
  resetBattleReplayPlayback,
  stepBattleReplayPlayback,
  tickBattleReplayPlayback,
  totalExperienceRequiredForLevel,
  serializeRuntimeDiagnosticsSnapshot,
  type BattleReplayPlaybackState,
  type PlayerBattleReplaySummary,
  type BattleAction,
  type BattleState,
  type EquipmentType,
  type MovementPlan,
  type PlayerTileView,
  type PlayerWorldView,
  type RuntimeDiagnosticsConnectionStatus
} from "../../../packages/shared/src/index";
import { createGameSession, readStoredSessionReplay, type SessionUpdate } from "./local-session";
import { buildH5RuntimeDiagnosticsSnapshot } from "./runtime-diagnostics";
import {
  buildingAsset,
  markerAsset,
  objectBadgeAssets,
  resourceAsset,
  terrainAsset,
  unitAsset,
  unitBadgeAssets,
  unitFrameAsset
} from "./assets";
import { describeTileObject } from "./object-visuals";
import {
  confirmAccountRegistration,
  confirmPasswordRecovery,
  loginGuestAuthSession,
  loginPasswordAuthSession,
  logoutCurrentAuthSession,
  requestAccountRegistration,
  requestPasswordRecovery,
  readStoredAuthSession,
  syncCurrentAuthSession,
  type StoredAuthSession
} from "./auth-session";
import {
  createLobbyPreferences,
  loadLobbyRooms,
  saveLobbyPreferences,
  type LobbyRoomSummary
} from "./lobby-preferences";
import {
  createFallbackPlayerAccountProfile as createLocalAccountProfile,
  loadPlayerAccountProfileWithProgression as loadAccountProfileWithProgression,
  bindPlayerAccountCredentials as bindAccountCredentials,
  loadPlayerAccountSessions,
  loadPlayerBattleReplayDetail,
  rememberPreferredPlayerDisplayName,
  readPreferredPlayerDisplayName as readLocalPreferredDisplayName,
  revokePlayerAccountSession,
  savePlayerAccountDisplayName as saveAccountDisplayName,
  type PlayerAccountProfile as ClientPlayerAccountProfile,
  type PlayerAccountSessionDevice
} from "./player-account";
import {
  renderAchievementProgress,
  renderBattleReportReplayCenter,
  renderRecentAccountEvents
} from "./account-history";
import { renderEncounterSourceDetail, renderRoomActionHint, resolveRoomFeedbackTone } from "./room-feedback";

const params = new URLSearchParams(window.location.search);
const queryRoomId = params.get("roomId")?.trim() ?? "";
const queryPlayerId = params.get("playerId")?.trim() ?? "";
const storedAuthSession = readStoredAuthSession();
const resolvedBootPlayerId = queryPlayerId || storedAuthSession?.playerId || "";
const shouldBootGame = Boolean(queryRoomId && resolvedBootPlayerId);
const initialLobbyPreferences = createLobbyPreferences({
  ...(queryRoomId ? { roomId: queryRoomId } : {}),
  ...(resolvedBootPlayerId ? { playerId: resolvedBootPlayerId } : {})
});
const roomId = shouldBootGame ? queryRoomId : initialLobbyPreferences.roomId;
const playerId = shouldBootGame ? resolvedBootPlayerId : initialLobbyPreferences.playerId;
const initialAccountDisplayName =
  storedAuthSession?.playerId === playerId ? storedAuthSession.displayName : readLocalPreferredDisplayName(playerId);
const initialLobbyDisplayName =
  storedAuthSession?.playerId === initialLobbyPreferences.playerId
    ? storedAuthSession.displayName
    : readLocalPreferredDisplayName(initialLobbyPreferences.playerId);
const initialLobbyLoginId = storedAuthSession?.loginId ?? "";
const battleSkillNameById = new Map(
  getDefaultBattleSkillCatalog().skills.map((skill) => [skill.id, skill.name] as const)
);

declare global {
  interface Window {
    render_game_to_text?: () => string;
    export_diagnostic_snapshot?: () => string;
    advanceTime?: (ms: number) => Promise<void>;
  }
}

const DEV_DIAGNOSTICS_ENABLED = import.meta.env.DEV;

interface BattleModalState {
  visible: boolean;
  title: string;
  body: string;
}

interface BattleFxState {
  flashUnitId: string | null;
  floatingText: string | null;
}

interface BattleSettlementSummary {
  title: string;
  summary: string;
  aftermath: string;
  roomState: string;
  nextAction: string;
  tone: "victory" | "defeat" | "neutral";
}

interface TimelineEntry {
  id: string;
  tone: "move" | "battle" | "loot" | "sync" | "system";
  source: "local" | "push" | "system";
  text: string;
}

interface DiagnosticState {
  connectionStatus: RuntimeDiagnosticsConnectionStatus;
  lastUpdateAt: number | null;
  lastUpdateSource: TimelineEntry["source"] | null;
  lastUpdateReason: string | null;
  lastEventTypes: string[];
  exportStatus: string;
}

interface LobbyViewState {
  playerId: string;
  roomId: string;
  displayName: string;
  loginId: string;
  password: string;
  registrationDisplayName: string;
  registrationToken: string;
  registrationPassword: string;
  recoveryToken: string;
  recoveryPassword: string;
  authSession: StoredAuthSession | null;
  rooms: LobbyRoomSummary[];
  loading: boolean;
  entering: boolean;
  status: string;
}

interface AppState {
  world: PlayerWorldView;
  battle: BattleState | null;
  account: ClientPlayerAccountProfile;
  lobby: LobbyViewState;
  accountDraftName: string;
  accountLoginId: string;
  accountPassword: string;
  accountSaving: boolean;
  accountBinding: boolean;
  accountStatus: string;
  accountSessions: PlayerAccountSessionDevice[];
  accountSessionsLoading: boolean;
  accountSessionRevokingId: string | null;
  replayDetail: {
    selectedReplayId: string | null;
    replay: PlayerBattleReplaySummary | null;
    playback: BattleReplayPlaybackState | null;
    loading: boolean;
    status: string;
  };
  selectedHeroId: string | null;
  selectedTile: { x: number; y: number } | null;
  hoveredTile: { x: number; y: number } | null;
  keyboardCursor: { x: number; y: number } | null;
  previewPlan: MovementPlan | null;
  reachableTiles: Array<{ x: number; y: number }>;
  selectedBattleTargetId: string | null;
  feedbackTone: "idle" | "move" | "battle" | "loot";
  animatedPath: Array<{ x: number; y: number }>;
  animatedPathIndex: number;
  battleFx: BattleFxState;
  pendingBattleAction: BattleAction | null;
  timeline: TimelineEntry[];
  log: string[];
  modal: BattleModalState;
  lastBattleSettlement: BattleSettlementSummary | null;
  lastEncounterStarted: Extract<SessionUpdate["events"][number], { type: "battle.started" }> | null;
  predictionStatus: string;
  diagnostics: DiagnosticState;
}

type BattleUnitView = BattleState["units"][string];
type BattleSkillView = NonNullable<BattleUnitView["skills"]>[number];
type BattleStatusView = NonNullable<BattleUnitView["statusEffects"]>[number];
type BattleHazardView = BattleState["environment"][number];

interface ScheduledUiTask {
  id: number;
  runAt: number;
  callback: () => void;
  canceled: boolean;
}

const state: AppState = {
  world: {
    meta: { roomId: "booting", seed: 0, day: 0 },
    map: { width: 0, height: 0, tiles: [] },
    ownHeroes: [],
    visibleHeroes: [],
    resources: { gold: 0, wood: 0, ore: 0 },
    playerId
  },
  battle: null,
  account: createLocalAccountProfile(playerId, roomId, initialAccountDisplayName),
  lobby: {
    playerId: initialLobbyPreferences.playerId,
    roomId: initialLobbyPreferences.roomId,
    displayName: initialLobbyDisplayName,
    loginId: initialLobbyLoginId,
    password: "",
    registrationDisplayName: "",
    registrationToken: "",
    registrationPassword: "",
    recoveryToken: "",
    recoveryPassword: "",
    authSession: storedAuthSession,
    rooms: [],
    loading: false,
    entering: false,
    status: shouldBootGame ? "" : "优先展示活跃房间，也支持直接输入新房间 ID 创建实例。"
  },
  accountDraftName: initialAccountDisplayName,
  accountLoginId: storedAuthSession?.loginId ?? "",
  accountPassword: "",
  accountSaving: false,
  accountBinding: false,
  accountStatus: "游客账号资料将在连接后自动同步。",
  accountSessions: [],
  accountSessionsLoading: false,
  accountSessionRevokingId: null,
  replayDetail: {
    selectedReplayId: null,
    replay: null,
    playback: null,
    loading: false,
    status: "选择一场最近战斗，即可查看逐步回放。"
  },
  selectedHeroId: null,
  selectedTile: null,
  hoveredTile: null,
  keyboardCursor: null,
  previewPlan: null,
  reachableTiles: [],
  selectedBattleTargetId: null,
  feedbackTone: "idle",
  animatedPath: [],
  animatedPathIndex: -1,
  battleFx: {
    flashUnitId: null,
    floatingText: null
  },
  pendingBattleAction: null,
  timeline: [],
  log: ["正在连接本地会话服务..."],
  modal: {
    visible: false,
    title: "",
    body: ""
  },
  lastBattleSettlement: null,
  lastEncounterStarted: null,
  predictionStatus: "",
  diagnostics: {
    connectionStatus: shouldBootGame ? "connecting" : "connected",
    lastUpdateAt: null,
    lastUpdateSource: null,
    lastUpdateReason: null,
    lastEventTypes: [],
    exportStatus: "等待导出诊断快照"
  }
};

let accountRefreshPromise: Promise<void> | null = null;
let uiClockMs = 0;
let nextUiTaskId = 1;
let scheduledUiTasks: ScheduledUiTask[] = [];
let pathAnimationTaskIds: number[] = [];
let battleFxTaskId: number | null = null;
let replayPlaybackTaskId: number | null = null;
let keyboardShortcutsBound = false;
let replayLoadToken = 0;

interface PendingPrediction {
  world: PlayerWorldView;
  battle: BattleState | null;
  previewPlan: MovementPlan | null;
  reachableTiles: Array<{ x: number; y: number }>;
  feedbackTone: AppState["feedbackTone"];
  predictionStatus: string;
}

let pendingPrediction: PendingPrediction | null = null;

let sessionPromise: ReturnType<typeof createGameSession> | null = shouldBootGame
  ? createGameSession(roomId, playerId, 1001, {
      getDisplayName: () => state.accountDraftName,
      getAuthToken: () => state.lobby.authSession?.token ?? null,
      onPushUpdate: (update) => {
        state.log.unshift("收到房间同步推送");
        state.log = state.log.slice(0, 12);
        applyUpdate(update, "push");
      },
      onConnectionEvent: (event) => {
        state.diagnostics.connectionStatus =
          event === "reconnecting" ? "reconnecting" : event === "reconnect_failed" ? "reconnect_failed" : "connected";
        state.log.unshift(
          event === "reconnecting"
            ? "连接中断，正在尝试重连..."
            : event === "reconnected"
              ? "连接已恢复"
              : "旧连接恢复失败，正在尝试从持久化快照恢复房间..."
        );
        state.log = state.log.slice(0, 12);
        render();
      }
    })
  : null;

function diagnosticsConnectionStatusLabel(status: RuntimeDiagnosticsConnectionStatus): string {
  if (status === "connected") {
    return "已连接";
  }

  if (status === "reconnecting") {
    return "重连中";
  }

  if (status === "reconnect_failed") {
    return "恢复失败";
  }

  return "连接中";
}

function buildDiagnosticSnapshot() {
  const hero = activeHero();

  return buildH5RuntimeDiagnosticsSnapshot({
    devOnly: DEV_DIAGNOSTICS_ENABLED,
    mode: shouldBootGame ? (state.battle ? "battle" : "world") : "lobby",
    room: {
      roomId: shouldBootGame ? state.world.meta.roomId : state.lobby.roomId,
      playerId: shouldBootGame ? state.world.playerId : state.lobby.playerId,
      day: shouldBootGame ? state.world.meta.day : null,
      connectionStatus: state.diagnostics.connectionStatus,
      lastUpdateSource: state.diagnostics.lastUpdateSource,
      lastUpdateReason: state.diagnostics.lastUpdateReason,
      lastUpdateAt: state.diagnostics.lastUpdateAt
    },
    world: shouldBootGame
      ? {
          state: state.world,
          activeHero: hero,
          reachableTiles: state.reachableTiles,
          selectedTile: state.selectedTile,
          hoveredTile: state.hoveredTile,
          keyboardCursor: state.keyboardCursor
        }
      : null,
    battle: state.battle
      ? {
          state: state.battle,
          selectedTargetId: state.selectedBattleTargetId
        }
      : null,
    account: state.account,
    diagnostics: {
      eventTypes: state.diagnostics.lastEventTypes,
      timelineTail: state.timeline.slice(0, 6).map((entry) => ({
        id: entry.id,
        tone: entry.tone,
        source: entry.source,
        text: entry.text
      })),
      logTail: state.log.slice(0, 8),
      predictionStatus: state.predictionStatus,
      pendingUiTasks: scheduledUiTasks.filter((task) => !task.canceled).length,
      replay:
        state.replayDetail.replay == null
          ? null
          : {
              replayId: state.replayDetail.replay.id,
              loading: state.replayDetail.loading,
              status: state.replayDetail.playback?.status ?? "paused",
              currentStepIndex: state.replayDetail.playback?.currentStepIndex ?? 0,
              totalSteps: state.replayDetail.playback?.totalSteps ?? state.replayDetail.replay.steps.length
            }
    }
  });
}

function exportDiagnosticSnapshot(): string {
  return serializeRuntimeDiagnosticsSnapshot(buildDiagnosticSnapshot());
}

function sanitizeSnapshotFileSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized || "unknown";
}

function triggerDiagnosticSnapshotExport(): void {
  if (!DEV_DIAGNOSTICS_ENABLED) {
    return;
  }

  const payload = exportDiagnosticSnapshot();
  const roomSegment = sanitizeSnapshotFileSegment(shouldBootGame ? state.world.meta.roomId : state.lobby.roomId);
  const playerSegment = sanitizeSnapshotFileSegment(shouldBootGame ? state.world.playerId : state.lobby.playerId);
  const fileName = `veil-diagnostic-${roomSegment}-${playerSegment}-${Date.now()}.json`;
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  state.diagnostics.exportStatus = `已导出 ${fileName}`;
  render();
}

function renderDiagnosticPanel(): string {
  if (!DEV_DIAGNOSTICS_ENABLED || !shouldBootGame) {
    return "";
  }

  const hero = activeHero();

  return `
    <div class="log-panel diagnostics-panel" data-testid="diagnostic-panel">
      <div class="diagnostics-head">
        <div>
          <h3>开发态诊断</h3>
          <p class="muted">统一查看房间、英雄、同步与最近链路状态。</p>
        </div>
        <button class="session-link" data-export-diagnostic="true" data-testid="diagnostic-export">导出快照</button>
      </div>
      <div class="diagnostics-grid">
        <div class="diagnostics-card">
          <span>房间同步</span>
          <strong data-testid="diagnostic-connection-status">${diagnosticsConnectionStatusLabel(state.diagnostics.connectionStatus)}</strong>
          <p class="muted">${escapeHtml(state.diagnostics.lastUpdateSource ?? "尚未收到更新")} · ${escapeHtml(state.diagnostics.lastUpdateReason ?? "snapshot")}</p>
        </div>
        <div class="diagnostics-card">
          <span>关键玩法</span>
          <strong>${state.battle ? "战斗链路" : "大地图链路"}</strong>
          <p class="muted">${escapeHtml(hero ? `${hero.name} @ ${hero.position.x},${hero.position.y}` : "当前没有可控英雄")}</p>
        </div>
        <div class="diagnostics-card">
          <span>最近事件</span>
          <strong>${state.diagnostics.lastEventTypes.length}</strong>
          <p class="muted">${escapeHtml(state.diagnostics.lastEventTypes.join(", ") || "无")}</p>
        </div>
        <div class="diagnostics-card">
          <span>账号快照</span>
          <strong>${escapeHtml(state.account.displayName)}</strong>
          <p class="muted">${escapeHtml(`${state.account.source} · replays ${state.account.recentBattleReplays.length} · events ${state.account.recentEventLog.length}`)}</p>
        </div>
      </div>
      <p class="muted diagnostics-export-status" data-testid="diagnostic-export-status">${escapeHtml(state.diagnostics.exportStatus)}</p>
    </div>
  `;
}

async function getSession() {
  if (!sessionPromise) {
    throw new Error("session_not_ready");
  }

  return sessionPromise;
}

function scheduleUiTask(delayMs: number, callback: () => void): number {
  const safeDelayMs = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
  const task: ScheduledUiTask = {
    id: nextUiTaskId++,
    runAt: uiClockMs + safeDelayMs,
    callback,
    canceled: false
  };

  scheduledUiTasks.push(task);
  scheduledUiTasks.sort((left, right) => (left.runAt === right.runAt ? left.id - right.id : left.runAt - right.runAt));
  return task.id;
}

function cancelUiTask(taskId: number | null): void {
  if (taskId == null) {
    return;
  }

  const task = scheduledUiTasks.find((item) => item.id === taskId);
  if (task) {
    task.canceled = true;
  }
}

function cancelUiTaskBatch(taskIds: number[]): void {
  for (const taskId of taskIds) {
    cancelUiTask(taskId);
  }
  taskIds.length = 0;
}

function flushUiTasksThrough(targetMs: number): void {
  const safeTargetMs = Math.max(uiClockMs, Number.isFinite(targetMs) ? targetMs : uiClockMs);

  while (scheduledUiTasks.length > 0) {
    const nextTask = scheduledUiTasks[0];
    if (!nextTask) {
      break;
    }

    if (nextTask.canceled) {
      scheduledUiTasks.shift();
      continue;
    }

    if (nextTask.runAt > safeTargetMs) {
      break;
    }

    scheduledUiTasks.shift();
    uiClockMs = nextTask.runAt;
    nextTask.callback();
  }

  uiClockMs = safeTargetMs;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatAccountSource(account: ClientPlayerAccountProfile): string {
  return account.source === "remote" ? "云端账号" : "本地游客档";
}

function formatAuthModeLabel(session: StoredAuthSession | null): string {
  if (!session) {
    return "未登录";
  }

  if (session.authMode === "account") {
    return session.loginId ? `账号模式 · ${session.loginId}` : "账号模式";
  }

  return "游客模式";
}

function formatCredentialBinding(account: ClientPlayerAccountProfile): string {
  if (!account.loginId) {
    return "尚未绑定口令账号，可把当前游客档升级成长期账号。";
  }

  if (!account.credentialBoundAt) {
    return `已绑定登录 ID：${account.loginId}`;
  }

  const date = new Date(account.credentialBoundAt);
  const label = Number.isNaN(date.getTime()) ? account.credentialBoundAt : date.toLocaleString();
  return `已绑定登录 ID：${account.loginId} · ${label}`;
}

function formatAccountLastSeen(account: ClientPlayerAccountProfile): string {
  if (!account.lastSeenAt) {
    return account.lastRoomId ? `最近房间 ${account.lastRoomId}` : "尚未记录活跃时间";
  }

  const date = new Date(account.lastSeenAt);
  const label = Number.isNaN(date.getTime()) ? account.lastSeenAt : date.toLocaleString();
  return account.lastRoomId ? `${label} · ${account.lastRoomId}` : label;
}

function formatGlobalVault(account: ClientPlayerAccountProfile): string {
  return `全局仓库 金币 ${account.globalResources.gold} / 木材 ${account.globalResources.wood} / 矿石 ${account.globalResources.ore}`;
}

function formatRelativeSessionTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatSessionProviderLabel(provider: string): string {
  if (provider === "wechat-mini-game") {
    return "微信小游戏";
  }
  if (provider === "account-password") {
    return "口令登录";
  }
  return provider;
}

function renderAccountSessionPanel(): string {
  if (state.lobby.authSession?.authMode !== "account") {
    return "";
  }

  const items = state.accountSessions.length
    ? state.accountSessions
        .map((session) => {
          const revokeDisabled = session.current || state.accountSessionRevokingId !== null;
          const revokeLabel =
            state.accountSessionRevokingId === session.sessionId ? "撤销中..." : session.current ? "当前设备" : "撤销";
          return `
            <div class="account-session-item">
              <div class="account-session-copy">
                <div class="account-session-head">
                  <strong>${escapeHtml(session.deviceLabel)}</strong>
                  <span class="account-session-badge">${escapeHtml(
                    session.current ? "当前设备" : formatSessionProviderLabel(session.provider)
                  )}</span>
                </div>
                <p class="account-meta">最近活跃 ${escapeHtml(formatRelativeSessionTimestamp(session.lastUsedAt))}</p>
                <p class="account-meta">刷新令牌到期 ${escapeHtml(formatRelativeSessionTimestamp(session.refreshExpiresAt))}</p>
              </div>
              <button
                class="account-save account-session-action"
                data-revoke-account-session="${escapeHtml(session.sessionId)}"
                ${revokeDisabled ? "disabled" : ""}
              >${escapeHtml(revokeLabel)}</button>
            </div>
          `;
        })
        .join("")
    : `<p class="muted account-status">${escapeHtml(
        state.accountSessionsLoading ? "正在同步设备会话..." : "当前没有可撤销的其他设备会话。"
      )}</p>`;

  return `
    <div class="account-binding-card">
      <div class="account-binding-head">
        <strong>设备会话</strong>
        <span>查看当前正式账号在哪些设备保持登录，并撤销其他设备。</span>
      </div>
      <div class="account-session-list">
        ${items}
      </div>
    </div>
  `;
}

function findReplaySummary(replayId: string | null | undefined): PlayerBattleReplaySummary | null {
  const normalizedReplayId = replayId?.trim();
  if (!normalizedReplayId) {
    return null;
  }

  return state.account.recentBattleReplays.find((replay) => replay.id === normalizedReplayId) ?? null;
}

function clearReplayPlaybackLoop(): void {
  if (replayPlaybackTaskId != null) {
    window.clearTimeout(replayPlaybackTaskId);
  }
  replayPlaybackTaskId = null;
}

function syncReplayPlaybackLoop(): void {
  clearReplayPlaybackLoop();
  if (state.replayDetail.playback?.status !== "playing") {
    return;
  }

  replayPlaybackTaskId = window.setTimeout(() => {
    replayPlaybackTaskId = null;
    if (!state.replayDetail.playback) {
      return;
    }

    state.replayDetail.playback = tickBattleReplayPlayback(state.replayDetail.playback);
    state.replayDetail.status =
      state.replayDetail.playback.status === "completed" ? "本场回放已播放完成。" : "正在自动推进回放。";
    syncReplayPlaybackLoop();
    render();
  }, 420);
}

function clearReplayDetail(status = "选择一场最近战斗，即可查看逐步回放。"): void {
  replayLoadToken += 1;
  clearReplayPlaybackLoop();
  state.replayDetail = {
    selectedReplayId: null,
    replay: null,
    playback: null,
    loading: false,
    status
  };
}

async function selectReplayDetail(replayId: string): Promise<void> {
  const summary = findReplaySummary(replayId);
  if (!summary) {
    clearReplayDetail("该回放已不在最近战报列表中。");
    render();
    return;
  }

  const requestToken = ++replayLoadToken;
  clearReplayPlaybackLoop();
  state.replayDetail = {
    selectedReplayId: replayId,
    replay: summary,
    playback: createBattleReplayPlaybackState(summary),
    loading: true,
    status: "正在加载回放详情..."
  };
  render();

  let replay = summary;
  try {
    const detail = await loadPlayerBattleReplayDetail(state.account.playerId, replayId);
    if (requestToken !== replayLoadToken) {
      return;
    }

    replay = detail ?? summary;
    state.replayDetail = {
      selectedReplayId: replayId,
      replay,
      playback: createBattleReplayPlaybackState(replay),
      loading: false,
      status: detail ? "已加载完整回放，可逐步回看。" : "已从最近战报缓存恢复回放。"
    };
    render();
  } catch {
    if (requestToken !== replayLoadToken) {
      return;
    }

    state.replayDetail = {
      selectedReplayId: replayId,
      replay,
      playback: createBattleReplayPlaybackState(replay),
      loading: false,
      status: "回放详情加载失败，已回退到最近战报缓存。"
    };
    render();
  }
}

function applyReplayPlaybackControl(action: "play" | "pause" | "step" | "reset"): void {
  const currentPlayback = state.replayDetail.playback;
  if (!currentPlayback) {
    return;
  }

  clearReplayPlaybackLoop();
  if (action === "play") {
    state.replayDetail.playback = playBattleReplayPlayback(currentPlayback);
    state.replayDetail.status = "正在自动推进回放。";
    syncReplayPlaybackLoop();
    render();
    return;
  }

  if (action === "pause") {
    state.replayDetail.playback = pauseBattleReplayPlayback(currentPlayback);
    state.replayDetail.status = "回放已暂停。";
    render();
    return;
  }

  if (action === "step") {
    state.replayDetail.playback = stepBattleReplayPlayback(currentPlayback);
    state.replayDetail.status =
      state.replayDetail.playback.status === "completed" ? "已步进到最后一步。" : "已前进一步。";
    render();
    return;
  }

  state.replayDetail.playback = resetBattleReplayPlayback(currentPlayback);
  state.replayDetail.status = "回放已重置到初始状态。";
  render();
}

function formatLobbyRoomUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? updatedAt : date.toLocaleString();
}

function tileLabel(tile: PlayerTileView): string {
  if (tile.fog === "hidden") {
    return "?";
  }

  const terrain = tile.terrain.slice(0, 1).toUpperCase();
  const occupant = tile.occupant?.kind === "neutral" ? "M" : tile.occupant?.kind === "hero" ? "H" : "";
  const resource = tile.resource ? tile.resource.kind.slice(0, 1).toUpperCase() : "";
  const building = tile.building ? "B" : "";
  return `${terrain}${occupant}${resource}${building}`;
}

function markerStateForTile(tile: PlayerTileView): "idle" | "selected" | "hit" {
  if (tile.occupant?.refId && state.battleFx.flashUnitId && state.battleFx.flashUnitId.startsWith(tile.occupant.refId)) {
    return "hit";
  }

  if (state.selectedTile && tile.position.x === state.selectedTile.x && tile.position.y === state.selectedTile.y) {
    return "selected";
  }

  return "idle";
}

function renderTileMedia(tile: PlayerTileView): string {
  const terrainSrc = terrainAsset(tile.terrain, tile.position.x, tile.position.y);
  const resourceSrc = tile.resource ? resourceAsset(tile.resource.kind) : null;
  const buildingSrc = tile.building ? buildingAsset(tile.building.kind) : null;
  const markerState = markerStateForTile(tile);
  const markerSrc =
    tile.occupant?.kind === "hero"
      ? markerAsset("hero", markerState)
      : tile.occupant?.kind === "neutral"
        ? markerAsset("neutral", markerState)
        : null;
  const buildingBadge = buildingSrc
    ? `<img class="tile-building-badge" src="${buildingSrc}" alt="${tile.building?.kind ?? "building"}" />`
    : tile.building
      ? `<span class="tile-building-badge">B</span>`
      : "";

  return `
    <img class="tile-terrain" src="${terrainSrc}" alt="${tile.terrain}" />
    ${resourceSrc ? `<img class="tile-resource" src="${resourceSrc}" alt="${tile.resource?.kind ?? "resource"}" />` : ""}
    ${markerSrc ? `<img class="tile-marker" src="${markerSrc}" alt="${tile.occupant?.kind ?? "marker"}" />` : ""}
    ${buildingBadge}
  `;
}

function formatPath(path: { x: number; y: number }[]): string {
  return path.map((node) => `(${node.x},${node.y})`).join(" -> ");
}

function activeHero() {
  return state.selectedHeroId ? state.world.ownHeroes.find((item) => item.id === state.selectedHeroId) ?? null : null;
}

function formatHeroProgression(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return "Lv 0";
  }

  return `Lv ${hero.progression.level}`;
}

function formatHeroExperience(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return "XP 0/100";
  }

  const meter = createHeroProgressMeterView(hero);
  return `XP ${meter.currentLevelExperience}/${meter.nextLevelExperience}`;
}

function renderHeroProgressPanel(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return `
      <section class="hero-progress-panel info-card">
        <div class="hero-progress-head">
          <strong>升级进度</strong>
          <span class="muted">等待英雄数据</span>
        </div>
      </section>
    `;
  }

  const meter = createHeroProgressMeterView(hero);
  return `
    <section class="hero-progress-panel info-card" data-testid="hero-progress-panel">
      <div class="hero-progress-head">
        <strong>升级进度</strong>
        <span class="status-pill">Lv ${meter.level}</span>
      </div>
      <div class="hero-progress-meta">
        <span>当前 ${meter.currentLevelExperience}/${meter.nextLevelExperience} XP</span>
        <span>还需 ${meter.remainingExperience} XP</span>
      </div>
      <div class="hero-progress-track" aria-label="hero experience progress">
        <div class="hero-progress-fill" style="width:${(meter.progressRatio * 100).toFixed(1)}%"></div>
      </div>
      <p class="hero-progress-copy muted">总经验 ${meter.totalExperience} · 下一级阈值 ${totalExperienceRequiredForLevel(meter.level + 1)}</p>
    </section>
  `;
}

function renderHeroAttributePanel(
  hero: PlayerWorldView["ownHeroes"][number] | null,
  world: PlayerWorldView
): string {
  if (!hero) {
    return "";
  }

  const rows = createHeroAttributeBreakdown(hero, world);
  return `
    <section class="hero-attribute-panel info-card" data-testid="hero-attribute-panel">
      <div class="hero-progress-head">
        <strong>属性来源</strong>
        <span class="muted">悬停查看公式</span>
      </div>
      <div class="hero-attribute-list">
        ${rows
          .map(
            (row) => `
              <div class="hero-attribute-row" title="${escapeHtml(row.formula)}">
                <strong>${row.label}</strong>
                <span>${row.total}</span>
                <span>基础 ${row.base}</span>
                <span>成长 ${row.progression}</span>
                <span>建筑 ${row.buildings}</span>
                <span>装备 ${row.equipment}</span>
                <span>技能 ${row.skills}</span>
                ${row.other !== 0 ? `<span>其他 ${row.other}</span>` : ""}
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function formatEquipmentActionReason(reason: string): string {
  if (reason === "equipment_not_in_inventory") {
    return "背包里没有这件装备";
  }

  if (reason === "equipment_slot_mismatch") {
    return "装备类型和槽位不匹配";
  }

  if (reason === "equipment_definition_missing") {
    return "装备目录缺失，无法装备";
  }

  if (reason === "equipment_slot_empty") {
    return "当前槽位没有可卸下的装备";
  }

  if (reason === "equipment_already_equipped") {
    return "该装备已经穿戴中";
  }

  return reason;
}

function inventoryItemsForSlot(
  hero: PlayerWorldView["ownHeroes"][number],
  slot: EquipmentType
): Array<{
  itemId: string;
  name: string;
  rarityLabel: string;
  bonusSummary: string;
  description: string;
  count: number;
}> {
  const counts = new Map<string, number>();

  for (const itemId of hero.loadout.inventory) {
    const definition = getEquipmentDefinition(itemId);
    if (!definition || definition.type !== slot) {
      continue;
    }

    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([itemId, count]) => {
      const definition = getEquipmentDefinition(itemId);
      if (!definition) {
        return null;
      }

      return {
        itemId,
        name: definition.name,
        rarityLabel: formatEquipmentRarityLabel(definition.rarity),
        bonusSummary: formatEquipmentBonusSummary(definition.bonuses),
        description: definition.description,
        count
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function renderHeroEquipmentPanel(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return "";
  }

  const loadout = createHeroEquipmentLoadoutView(hero);
  const totalBonuses = [
    loadout.summary.attack !== 0 ? `攻击 +${loadout.summary.attack}` : "",
    loadout.summary.defense !== 0 ? `防御 +${loadout.summary.defense}` : "",
    loadout.summary.power !== 0 ? `力量 +${loadout.summary.power}` : "",
    loadout.summary.knowledge !== 0 ? `知识 +${loadout.summary.knowledge}` : "",
    loadout.summary.maxHp !== 0 ? `生命上限 +${loadout.summary.maxHp}` : ""
  ].filter(Boolean);

  return `
    <section class="hero-equipment-panel info-card" data-testid="hero-equipment-panel">
      <div class="hero-progress-head">
        <strong>装备配置</strong>
        <span class="muted">${totalBonuses.join(" / ") || "当前未提供额外属性"}</span>
      </div>
      <div class="hero-equipment-list">
        ${loadout.slots
          .map(
            (slot) => {
              const inventory = inventoryItemsForSlot(hero, slot.slot);
              return `
              <article class="hero-equipment-item">
                <div class="hero-equipment-meta">
                  <div>
                    <span class="hero-equipment-slot">${slot.label}</span>
                    <strong>${escapeHtml(slot.itemName)}</strong>
                  </div>
                  ${slot.rarityLabel ? `<span class="status-pill">${slot.rarityLabel}</span>` : ""}
                </div>
                <p>${escapeHtml(slot.bonusSummary)}</p>
                ${slot.specialEffectSummary ? `<p class="hero-equipment-copy">${escapeHtml(slot.specialEffectSummary)}</p>` : ""}
                ${slot.description ? `<p class="hero-equipment-copy">${escapeHtml(slot.description)}</p>` : ""}
                <div class="hero-equipment-actions">
                  <button
                    class="hero-equipment-button secondary-button"
                    data-hero-unequip-slot="${slot.slot}"
                    ${slot.itemId && !state.battle ? "" : "disabled"}
                  >卸下</button>
                  <span class="hero-equipment-copy">背包 ${inventory.reduce((total, item) => total + item.count, 0)} 件可替换</span>
                </div>
                <div class="hero-equipment-inventory">
                  ${
                    inventory.length > 0
                      ? inventory
                          .map(
                            (item) => `
                              <button
                                class="hero-equipment-button"
                                data-hero-equip-slot="${slot.slot}"
                                data-hero-equip-id="${item.itemId}"
                                ${state.battle ? "disabled" : ""}
                                title="${escapeHtml(`${item.bonusSummary} · ${item.description}`)}"
                              >${escapeHtml(`${item.name} x${item.count}`)}</button>
                            `
                          )
                          .join("")
                      : `<span class="hero-equipment-copy muted">暂无可用替换装备</span>`
                  }
                </div>
              </article>
            `;
            }
          )
          .join("")}
      </div>
    </section>
  `;
}

function formatHeroSkillReason(reason: string): string {
  if (reason === "not_enough_skill_points") {
    return "需要可用技能点";
  }

  if (reason === "hero_level_too_low") {
    return "等级未达标";
  }

  if (reason === "skill_max_rank_reached") {
    return "已满级";
  }

  if (reason === "skill_prerequisite_missing") {
    return "前置未满足";
  }

  return reason;
}

function formatGrantedBattleSkillNames(skillIds: string[]): string {
  if (skillIds.length === 0) {
    return "当前未提供额外战斗技能";
  }

  return skillIds.map((skillId) => battleSkillNameById.get(skillId) ?? skillId).join(" / ");
}

function renderHeroSkillTree(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return `<div class="hero-skill-tree muted">当前没有可展示的技能树。</div>`;
  }

  const tree = createHeroSkillTreeView(hero);
  return `
    <section class="hero-skill-tree" data-testid="hero-skill-tree">
      <div class="hero-skill-tree-head">
        <strong>技能树</strong>
        <span>${tree.availableSkillPoints} 点待分配</span>
      </div>
      <div class="hero-skill-tree-grid">
        ${tree.branches
          .map(
            (branch) => `
              <article class="hero-skill-branch info-card">
                <div class="info-card-head">
                  <div>
                    <div class="info-card-eyebrow">Branch</div>
                    <strong>${escapeHtml(branch.name)}</strong>
                  </div>
                  <span class="status-pill">${branch.skills.reduce((total, skill) => total + skill.currentRank, 0)} / ${branch.skills.reduce((total, skill) => total + skill.maxRank, 0)}</span>
                </div>
                <p class="hero-skill-branch-copy">${escapeHtml(branch.description)}</p>
                <div class="hero-skill-list">
                  ${branch.skills
                    .map(
                      (skill) => `
                        <div class="hero-skill-item">
                          <div class="hero-skill-meta">
                            <div>
                              <strong>${escapeHtml(skill.name)}</strong>
                              <span>Lv ${skill.requiredLevel}+ · Rank ${skill.currentRank}/${skill.maxRank}</span>
                            </div>
                            <button
                              class="hero-skill-button"
                              data-hero-skill-id="${skill.id}"
                              ${skill.canLearn && !state.battle ? "" : "disabled"}
                              title="${escapeHtml(skill.canLearn ? `学习 / 强化到 Rank ${skill.nextRank}` : formatHeroSkillReason(skill.reason ?? ""))}"
                            >
                              ${skill.currentRank > 0 ? "强化" : "学习"}
                            </button>
                          </div>
                          <p>${escapeHtml(skill.description)}</p>
                          <p class="hero-skill-copy">当前效果：${escapeHtml(formatGrantedBattleSkillNames(skill.grantedBattleSkillIds))}</p>
                          <p class="hero-skill-copy">
                            ${
                              skill.nextRank
                                ? `下一阶：${escapeHtml(skill.ranks.find((rank) => rank.rank === skill.nextRank)?.description ?? `Rank ${skill.nextRank}`)}${skill.nextGrantedBattleSkillIds.length > 0 ? ` · 解锁 ${escapeHtml(formatGrantedBattleSkillNames(skill.nextGrantedBattleSkillIds))}` : ""}`
                                : "已经达到当前技能上限"
                            }
                          </p>
                          ${skill.prerequisites.length > 0 ? `<p class="hero-skill-copy">前置：${escapeHtml(skill.prerequisites.join(" / "))}</p>` : ""}
                          ${!skill.canLearn ? `<p class="hero-skill-copy muted">${escapeHtml(formatHeroSkillReason(skill.reason ?? ""))}</p>` : ""}
                        </div>
                      `
                    )
                    .join("")}
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function formatResourceKindLabel(kind: "gold" | "wood" | "ore"): string {
  return kind === "gold" ? "金币" : kind === "wood" ? "木材" : "矿石";
}

function formatDailyIncome(kind: "gold" | "wood" | "ore", amount: number): string {
  return `${formatResourceKindLabel(kind)} +${amount}/天`;
}

function formatHeroCoreStats(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return "ATK 0 · DEF 0 · POW 0 · KNW 0";
  }

  return `ATK ${hero.stats.attack} · DEF ${hero.stats.defense} · POW ${hero.stats.power} · KNW ${hero.stats.knowledge}`;
}

function formatHeroStatBonus(bonus: { attack: number; defense: number; power: number; knowledge: number }): string {
  const parts = [
    bonus.attack > 0 ? `攻击 +${bonus.attack}` : "",
    bonus.defense > 0 ? `防御 +${bonus.defense}` : "",
    bonus.power > 0 ? `力量 +${bonus.power}` : "",
    bonus.knowledge > 0 ? `知识 +${bonus.knowledge}` : ""
  ].filter(Boolean);

  return parts.join(" / ") || "属性提升";
}

function hoveredTileData(): PlayerTileView | null {
  if (!state.hoveredTile) {
    return null;
  }

  return (
    state.world.map.tiles.find(
      (tile) => tile.position.x === state.hoveredTile!.x && tile.position.y === state.hoveredTile!.y
    ) ?? null
  );
}

function clampWorldCoordinate(value: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(limit - 1, Math.floor(value)));
}

function clampWorldPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: clampWorldCoordinate(x, state.world.map.width),
    y: clampWorldCoordinate(y, state.world.map.height)
  };
}

function currentKeyboardCursor(): { x: number; y: number } | null {
  if (state.world.map.width <= 0 || state.world.map.height <= 0) {
    return null;
  }

  const hero = activeHero();
  const fallback =
    state.keyboardCursor ??
    state.selectedTile ??
    (hero
      ? {
          x: hero.position.x,
          y: hero.position.y
        }
      : null) ?? { x: 0, y: 0 };

  return clampWorldPosition(fallback.x, fallback.y);
}

function syncKeyboardCursor(preferred?: { x: number; y: number } | null): void {
  if (state.world.map.width <= 0 || state.world.map.height <= 0) {
    state.keyboardCursor = null;
    return;
  }

  const hero = activeHero();
  const nextCursor = preferred ??
    state.keyboardCursor ??
    state.selectedTile ??
    (hero
      ? {
          x: hero.position.x,
          y: hero.position.y
        }
      : null) ?? { x: 0, y: 0 };

  state.keyboardCursor = clampWorldPosition(nextCursor.x, nextCursor.y);
  if (!state.battle) {
    state.hoveredTile = state.keyboardCursor;
  }
}

function setKeyboardCursor(x: number, y: number, options: { preview?: boolean } = {}): void {
  const nextCursor = currentKeyboardCursor();
  if (!nextCursor && (state.world.map.width <= 0 || state.world.map.height <= 0)) {
    return;
  }

  const clamped = clampWorldPosition(x, y);
  state.keyboardCursor = clamped;

  if (state.battle) {
    render();
    return;
  }

  state.hoveredTile = clamped;
  if (options.preview === false || !sessionPromise) {
    render();
    return;
  }

  void previewTile(clamped.x, clamped.y);
}

function nudgeKeyboardCursor(dx: number, dy: number): void {
  const cursor = currentKeyboardCursor();
  if (!cursor) {
    return;
  }

  setKeyboardCursor(cursor.x + dx, cursor.y + dy);
}

function isReachableTile(x: number, y: number): boolean {
  return state.reachableTiles.some((tile) => tile.x === x && tile.y === y);
}

function isPreviewNode(x: number, y: number): boolean {
  return Boolean(state.previewPlan?.path.some((node) => node.x === x && node.y === y));
}

function isTravelNode(x: number, y: number): boolean {
  return Boolean(state.previewPlan?.travelPath.some((node) => node.x === x && node.y === y));
}

function isAnimatedNode(x: number, y: number): boolean {
  return state.animatedPath.slice(0, state.animatedPathIndex + 1).some((node) => node.x === x && node.y === y);
}

function isBattleEvent(event: SessionUpdate["events"][number]): boolean {
  return event.type === "battle.resolved";
}

function ownedHeroIds(world: PlayerWorldView = state.world): Set<string> {
  return new Set(world.ownHeroes.map((hero) => hero.id));
}

function controlledBattleCamp(
  battle: BattleState | null,
  world: PlayerWorldView = state.world
): "attacker" | "defender" | null {
  if (!battle) {
    return null;
  }

  const ownedIds = ownedHeroIds(world);
  if (battle.worldHeroId && ownedIds.has(battle.worldHeroId)) {
    return "attacker";
  }

  if (battle.defenderHeroId && ownedIds.has(battle.defenderHeroId)) {
    return "defender";
  }

  return null;
}

function battleShortcutContext():
  | {
      active: BattleUnitView;
      enemies: BattleUnitView[];
      selectedTarget: BattleUnitView | null;
      readySkills: BattleSkillView[];
    }
  | null {
  if (!state.battle?.activeUnitId) {
    return null;
  }

  const playerCamp = controlledBattleCamp(state.battle);
  const active = state.battle.units[state.battle.activeUnitId] ?? null;
  if (!playerCamp || !active || active.camp !== playerCamp) {
    return null;
  }

  const enemyCamp = opposingBattleCamp(playerCamp);
  const enemies = Object.values(state.battle.units).filter((unit) => unit.camp === enemyCamp && unit.count > 0);
  const selectedTarget = enemies.find((unit) => unit.id === state.selectedBattleTargetId) ?? enemies[0] ?? null;
  const readySkills = (active.skills ?? []).filter(
    (skill) => skill.kind === "active" && skill.remainingCooldown === 0 && (skill.target !== "enemy" || Boolean(selectedTarget))
  );

  return {
    active,
    enemies,
    selectedTarget,
    readySkills
  };
}

function cycleBattleTarget(offset: number): void {
  const context = battleShortcutContext();
  if (!context || context.enemies.length === 0) {
    return;
  }

  const currentIndex = context.enemies.findIndex((unit) => unit.id === (context.selectedTarget?.id ?? ""));
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + offset + context.enemies.length) % context.enemies.length;
  state.selectedBattleTargetId = context.enemies[nextIndex]?.id ?? context.selectedTarget?.id ?? null;
  render();
}

function buildAutomationTilePayload(tile: PlayerTileView) {
  return {
    x: tile.position.x,
    y: tile.position.y,
    fog: tile.fog,
    terrain: tile.terrain,
    walkable: tile.walkable,
    ...(tile.resource ? { resource: { ...tile.resource } } : {}),
    ...(tile.building
      ? {
          building:
            tile.building.kind === "recruitment_post"
              ? {
                  id: tile.building.id,
                  kind: tile.building.kind,
                  label: tile.building.label,
                  availableCount: tile.building.availableCount,
                  recruitCount: tile.building.recruitCount,
                  cost: { ...tile.building.cost }
                }
              : tile.building.kind === "attribute_shrine"
                ? {
                    id: tile.building.id,
                    kind: tile.building.kind,
                    label: tile.building.label,
                    bonus: { ...tile.building.bonus },
                    ...(typeof tile.building.lastUsedDay === "number" ? { lastUsedDay: tile.building.lastUsedDay } : {})
                  }
                : {
                    id: tile.building.id,
                    kind: tile.building.kind,
                    label: tile.building.label,
                    resourceKind: tile.building.resourceKind,
                    income: tile.building.income,
                    ...(typeof tile.building.lastHarvestDay === "number"
                      ? { lastHarvestDay: tile.building.lastHarvestDay }
                      : {})
                  }
        }
      : {}),
    ...(tile.occupant ? { occupant: { kind: tile.occupant.kind, refId: tile.occupant.refId } } : {})
  };
}

function renderGameToText(): string {
  const hero = activeHero();
  const visibleInteractiveTiles = state.world.map.tiles
    .filter((tile) => tile.fog !== "hidden" && (tile.resource || tile.building || tile.occupant))
    .map(buildAutomationTilePayload);
  const visibleHeroes = [...state.world.visibleHeroes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => ({
      id: item.id,
      playerId: item.playerId,
      name: item.name,
      x: item.position.x,
      y: item.position.y
    }));
  const ownHeroes = [...state.world.ownHeroes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => ({
      id: item.id,
      playerId: item.playerId,
      name: item.name,
      x: item.position.x,
      y: item.position.y,
      move: { total: item.move.total, remaining: item.move.remaining },
      stats: { ...item.stats },
      progression: {
        level: item.progression.level,
        experience: item.progression.experience,
        skillPoints: item.progression.skillPoints,
        battlesWon: item.progression.battlesWon,
        neutralBattlesWon: item.progression.neutralBattlesWon,
        pvpBattlesWon: item.progression.pvpBattlesWon
      },
      armyTemplateId: item.armyTemplateId,
      armyCount: item.armyCount
    }));
  const battle =
    state.battle == null
      ? null
      : {
          id: state.battle.id,
          round: state.battle.round,
          lanes: state.battle.lanes,
          activeUnitId: state.battle.activeUnitId,
          turnOrder: [...state.battle.turnOrder],
          selectedTargetId: state.selectedBattleTargetId,
          units: Object.values(state.battle.units)
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((unit) => ({
              id: unit.id,
              camp: unit.camp,
              lane: unit.lane,
              stackName: unit.stackName,
              count: unit.count,
              currentHp: unit.currentHp,
              maxHp: unit.maxHp,
              attack: unit.attack,
              defense: unit.defense,
              initiative: unit.initiative,
              hasRetaliated: unit.hasRetaliated,
              defending: unit.defending,
              skills: (unit.skills ?? []).map((skill) => ({
                id: skill.id,
                kind: skill.kind,
                target: skill.target,
                cooldown: skill.cooldown,
                remainingCooldown: skill.remainingCooldown
              })),
              statusEffects: (unit.statusEffects ?? []).map((status) => ({
                id: status.id,
                durationRemaining: status.durationRemaining,
                attackModifier: status.attackModifier,
                defenseModifier: status.defenseModifier,
                damagePerTurn: status.damagePerTurn,
                initiativeModifier: status.initiativeModifier,
                blocksActiveSkills: status.blocksActiveSkills
              }))
            })),
          environment: state.battle.environment.map((hazard) =>
            hazard.kind === "blocker"
              ? {
                  id: hazard.id,
                  kind: hazard.kind,
                  lane: hazard.lane,
                  name: hazard.name,
                  durability: hazard.durability,
                  maxDurability: hazard.maxDurability
                }
              : {
                  id: hazard.id,
                  kind: hazard.kind,
                  lane: hazard.lane,
                  effect: hazard.effect,
                  name: hazard.name,
                  damage: hazard.damage,
                  charges: hazard.charges,
                  revealed: hazard.revealed,
                  triggered: hazard.triggered,
                  ...(hazard.grantedStatusId ? { grantedStatusId: hazard.grantedStatusId } : {})
                }
          ),
          logTail: state.battle.log.slice(-8)
        };

  const payload = {
    mode: shouldBootGame ? (state.battle ? "battle" : "world") : "lobby",
    coordinateSystem: "origin=(0,0) at top-left; x increases right; y increases down",
    automationControls: shouldBootGame
      ? {
          world: {
            moveCursor: "Arrow keys",
            interact: "Enter / Space",
            endDay: "B"
          },
          battle: {
            cycleTarget: "Arrow keys",
            attack: "Enter / Space",
            skill: "A",
            defendOrWait: "B"
          },
          modal: {
            close: "Enter / Space / Escape"
          }
        }
      : null,
    room: {
      roomId: shouldBootGame ? state.world.meta.roomId : state.lobby.roomId,
      playerId: shouldBootGame ? state.world.playerId : state.lobby.playerId,
      day: shouldBootGame ? state.world.meta.day : null
    },
    resources: shouldBootGame ? { ...state.world.resources } : null,
    hero:
      hero == null
        ? null
        : {
            id: hero.id,
            name: hero.name,
            x: hero.position.x,
            y: hero.position.y,
            move: { total: hero.move.total, remaining: hero.move.remaining },
            stats: { ...hero.stats },
            armyTemplateId: hero.armyTemplateId,
            armyCount: hero.armyCount,
            skillPoints: hero.progression.skillPoints
          },
    ownHeroes,
    visibleHeroes,
    visibleInteractiveTiles,
    reachableTiles: state.reachableTiles.map((tile) => ({ x: tile.x, y: tile.y })),
    previewPlan: state.previewPlan
      ? {
          moveCost: state.previewPlan.moveCost,
          endsInEncounter: state.previewPlan.endsInEncounter,
          encounterKind: state.previewPlan.encounterKind,
          path: state.previewPlan.path.map((node) => ({ x: node.x, y: node.y })),
          travelPath: state.previewPlan.travelPath.map((node) => ({ x: node.x, y: node.y }))
        }
      : null,
    selectedTile: state.selectedTile ? { ...state.selectedTile } : null,
    hoveredTile: state.hoveredTile ? { ...state.hoveredTile } : null,
    keyboardCursor: state.keyboardCursor ? { ...state.keyboardCursor } : null,
    feedbackTone: state.feedbackTone,
    predictionStatus: state.predictionStatus,
    modal: state.modal.visible ? { ...state.modal } : null,
    replayDetail: state.replayDetail.replay
      ? {
          replayId: state.replayDetail.replay.id,
          loading: state.replayDetail.loading,
          status: state.replayDetail.playback?.status ?? "paused",
          currentStepIndex: state.replayDetail.playback?.currentStepIndex ?? 0,
          totalSteps: state.replayDetail.playback?.totalSteps ?? state.replayDetail.replay.steps.length,
          currentAction: state.replayDetail.playback?.currentStep?.action.type ?? null,
          nextAction: state.replayDetail.playback?.nextStep?.action.type ?? null
        }
      : null,
    animation: {
      animatedPath: state.animatedPath.map((node) => ({ x: node.x, y: node.y })),
      animatedPathIndex: state.animatedPathIndex,
      battleFx: { ...state.battleFx },
      pendingUiTasks: scheduledUiTasks.filter((task) => !task.canceled).length
    },
    battle,
    timelineTail: state.timeline.slice(0, 6).map((entry) => entry.text),
    logTail: state.log.slice(0, 8),
    lobby:
      shouldBootGame
        ? null
        : {
            roomId: state.lobby.roomId,
            playerId: state.lobby.playerId,
            displayName: state.lobby.displayName,
            loading: state.lobby.loading,
            entering: state.lobby.entering,
            status: state.lobby.status,
            rooms: state.lobby.rooms.map((item) => ({
              roomId: item.roomId,
              day: item.day,
              connectedPlayers: item.connectedPlayers,
              heroCount: item.heroCount,
              activeBattles: item.activeBattles
            }))
          }
  };

  return JSON.stringify(payload, null, 2);
}

async function advanceUiTime(ms: number): Promise<void> {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  flushUiTasksThrough(uiClockMs + safeMs);
  if (safeMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(16, safeMs)));
  } else {
    await Promise.resolve();
  }
  render();
}

function opposingBattleCamp(camp: "attacker" | "defender" | null): "attacker" | "defender" | null {
  if (!camp) {
    return null;
  }

  return camp === "attacker" ? "defender" : "attacker";
}

function battleSkillKindLabel(kind: BattleSkillView["kind"]): string {
  return kind === "active" ? "主动技能" : "被动技能";
}

function battleSkillTargetLabel(target: BattleSkillView["target"]): string {
  return target === "enemy" ? "敌方单体" : "自身增益";
}

function battleSkillReadyLabel(skill: BattleSkillView): string {
  if (skill.kind === "passive") {
    return "被动常驻";
  }

  return skill.remainingCooldown > 0 ? `冷却 ${skill.remainingCooldown}/${skill.cooldown}` : "已就绪";
}

function battleStatusModifierParts(status: BattleStatusView): string[] {
  const parts: string[] = [];

  if (status.attackModifier !== 0) {
    parts.push(`${status.attackModifier > 0 ? "+" : ""}${status.attackModifier} 攻击`);
  }

  if (status.defenseModifier !== 0) {
    parts.push(`${status.defenseModifier > 0 ? "+" : ""}${status.defenseModifier} 防御`);
  }

  if (status.damagePerTurn > 0) {
    parts.push(`每回合 ${status.damagePerTurn} 持续伤害`);
  }

  return parts;
}

function renderBattleDetailItem(title: string, meta: string, copy: string): string {
  return `
    <div class="battle-detail-item">
      <strong>${title}</strong>
      <span class="battle-detail-meta">${meta}</span>
      <span class="battle-detail-copy">${copy}</span>
    </div>
  `;
}

function renderBattleSkillDetail(skill: BattleSkillView): string {
  const deliveryLabel =
    skill.target === "enemy" ? (skill.delivery === "ranged" ? "远程" : "接战") : "自身";
  return renderBattleDetailItem(
    skill.name,
    `${battleSkillKindLabel(skill.kind)} · ${battleSkillTargetLabel(skill.target)} · ${deliveryLabel} · ${battleSkillReadyLabel(skill)}`,
    skill.description
  );
}

function renderBattleStatusDetail(status: BattleStatusView): string {
  const modifierText = battleStatusModifierParts(status);
  return renderBattleDetailItem(
    status.name,
    [`剩余 ${status.durationRemaining} 回合`, ...modifierText].join(" · "),
    status.description
  );
}

function renderBattleFlagDetail(title: string, copy: string): string {
  return renderBattleDetailItem(title, "战斗姿态", copy);
}

function renderBattleHazardDetail(hazard: BattleHazardView): string {
  if (hazard.kind === "blocker") {
    return renderBattleDetailItem(
      hazard.name,
      `${hazard.lane + 1} 线 · 耐久 ${hazard.durability}/${hazard.maxDurability}`,
      hazard.description
    );
  }

  return renderBattleDetailItem(
    hazard.name,
    `${hazard.lane + 1} 线 · ${hazard.damage} 伤害 · 剩余 ${hazard.charges} 次`,
    hazard.description
  );
}

function renderBattleDetailGroup(title: string, items: string[], emptyMessage: string): string {
  return `
    <div class="battle-detail-group">
      <div class="battle-detail-title">${title}</div>
      <div class="battle-detail-list">
        ${items.length > 0 ? items.join("") : `<div class="battle-detail-empty">${emptyMessage}</div>`}
      </div>
    </div>
  `;
}

function renderBattleIntelCard(
  title: string,
  eyebrow: string,
  badge: string,
  unit: BattleUnitView | null,
  emptyMessage: string
): string {
  if (!unit) {
    return `
      <article class="battle-intel-card info-card">
        <div class="battle-intel-card-head">
          <div>
            <div class="info-card-eyebrow">${eyebrow}</div>
            <strong>${title}</strong>
          </div>
          <span class="status-pill">${badge}</span>
        </div>
        <div class="battle-detail-empty">${emptyMessage}</div>
      </article>
    `;
  }

  const flagDetails: string[] = [];
  if (unit.defending) {
    flagDetails.push(renderBattleFlagDetail("防御姿态", "本回合采取防守站位，承伤能力更稳。"));
  }
  if (unit.hasRetaliated) {
    flagDetails.push(renderBattleFlagDetail("已完成反击", "本轮反击次数已消耗，再受击时不会再次反击。"));
  }

  return `
    <article class="battle-intel-card info-card">
      <div class="battle-intel-card-head">
        <div>
          <div class="info-card-eyebrow">${eyebrow}</div>
          <strong>${title} · ${unit.stackName}</strong>
        </div>
        <span class="status-pill">${badge}</span>
      </div>
      <div class="battle-intel-stats">
        <span class="battle-intel-chip">数量 x${unit.count}</span>
        <span class="battle-intel-chip">HP ${unit.currentHp}/${unit.maxHp}</span>
        <span class="battle-intel-chip">线位 ${unit.lane + 1}</span>
        <span class="battle-intel-chip">ATK ${unit.attack}</span>
        <span class="battle-intel-chip">DEF ${unit.defense}</span>
        <span class="battle-intel-chip">INIT ${unit.initiative}</span>
      </div>
      ${renderBattleDetailGroup("技能", (unit.skills ?? []).map(renderBattleSkillDetail), "当前没有可说明的技能。")}
      ${renderBattleDetailGroup("状态", [...(unit.statusEffects ?? []).map(renderBattleStatusDetail), ...flagDetails], "当前没有持续状态。")}
    </article>
  `;
}

function didCurrentPlayerWinBattle(
  event: Extract<SessionUpdate["events"][number], { type: "battle.resolved" }>,
  world: PlayerWorldView = state.world
): boolean {
  const ownedIds = ownedHeroIds(world);
  if (event.result === "attacker_victory") {
    return ownedIds.has(event.heroId);
  }

  return Boolean(event.defenderHeroId && ownedIds.has(event.defenderHeroId));
}

function findHeroSnapshot(
  heroId: string | null | undefined,
  world: PlayerWorldView = state.world
): PlayerWorldView["ownHeroes"][number] | PlayerWorldView["visibleHeroes"][number] | null {
  if (!heroId) {
    return null;
  }

  return world.ownHeroes.find((hero) => hero.id === heroId) ?? world.visibleHeroes.find((hero) => hero.id === heroId) ?? null;
}

function formatHeroIdentity(
  hero: PlayerWorldView["ownHeroes"][number] | PlayerWorldView["visibleHeroes"][number] | null,
  fallbackId: string | null | undefined
): string {
  if (!hero) {
    return fallbackId ?? "未知英雄";
  }

  return hero.name.trim() ? `${hero.name} (${hero.playerId})` : hero.id;
}

function formatVisibleHeroSummary(
  hero: PlayerWorldView["ownHeroes"][number] | PlayerWorldView["visibleHeroes"][number] | null,
  fallbackId: string | null | undefined
): string {
  if (!hero) {
    return `玩家 ${fallbackId ?? "unknown"} · 英雄信息待同步`;
  }

  return `玩家 ${hero.playerId} · 英雄 ${hero.name || hero.id} · 坐标 (${hero.position.x},${hero.position.y})`;
}

function battleTurnContextLabel(battle: BattleState, world: PlayerWorldView = state.world): string {
  if (!battle.activeUnitId) {
    return "当前回合：等待下一行动单位";
  }

  const activeUnit = battle.units[battle.activeUnitId];
  if (!activeUnit) {
    return "当前回合：等待权威同步";
  }

  const playerCamp = controlledBattleCamp(battle, world);
  if (!playerCamp) {
    return "当前回合：等待权威同步";
  }

  return activeUnit.camp === playerCamp ? "当前回合：我方操作" : "当前回合：对手操作";
}

function battleSessionSummary(battleId: string, roomId: string): string {
  return `遭遇会话：${roomId}/${battleId}`;
}

function activeHeroSnapshot(world: PlayerWorldView = state.world): PlayerWorldView["ownHeroes"][number] | null {
  return world.ownHeroes[0] ?? null;
}

function opposingHeroId(battle: BattleState, world: PlayerWorldView = state.world): string | null {
  const playerCamp = controlledBattleCamp(battle, world);
  if (!playerCamp) {
    return battle.defenderHeroId ?? battle.worldHeroId ?? null;
  }

  return playerCamp === "attacker" ? battle.defenderHeroId ?? null : battle.worldHeroId ?? null;
}

function renderEncounterHeadline(): { phase: string; detail: string } {
  if (state.battle) {
    const opponentId = opposingHeroId(state.battle, state.world);
    const opponent = findHeroSnapshot(opponentId, state.world);
    return {
      phase: "战斗中",
      detail: state.battle.defenderHeroId
        ? `已进入英雄遭遇战，对手 ${formatHeroIdentity(opponent, opponentId)}。${battleSessionSummary(state.battle.id, state.world.meta.roomId)}。`
        : `已进入中立遭遇战，目标 ${state.battle.neutralArmyId ?? "neutral"}。${battleSessionSummary(state.battle.id, state.world.meta.roomId)}。`
    };
  }

  if (state.previewPlan?.endsInEncounter) {
    if (state.previewPlan.encounterKind === "hero") {
      const opponent = findHeroSnapshot(state.previewPlan.encounterRefId, state.world);
      return {
        phase: "即将接敌",
        detail: `移动将触发英雄遭遇战，对手 ${formatHeroIdentity(opponent, state.previewPlan.encounterRefId)}。`
      };
    }

    return {
      phase: "即将接敌",
      detail: `移动将触发中立遭遇战，目标 ${state.previewPlan.encounterRefId ?? "neutral"}。`
    };
  }

  if (state.lastBattleSettlement) {
    return {
      phase: "已结算",
      detail: state.lastBattleSettlement.aftermath
    };
  }

  return {
    phase: "探索中",
    detail: state.predictionStatus || "房间当前处于地图探索阶段。"
  };
}

function resolveEncounterOpponentContext(): {
  label: string;
  detail: string;
} | null {
  const playerCamp = state.battle ? controlledBattleCamp(state.battle, state.world) : null;

  if (state.battle?.defenderHeroId) {
    const opponentId = opposingHeroId(state.battle, state.world);
    const opponent = findHeroSnapshot(opponentId, state.world);
    return {
      label: "对手信息",
      detail: `${formatVisibleHeroSummary(opponent, opponentId)} · 房间态：战斗中 · ${battleSessionSummary(
        state.battle.id,
        state.world.meta.roomId
      )} · ${battleTurnContextLabel(state.battle, state.world)} · 我方席位：${playerCamp === "attacker" ? "进攻方" : "防守方"}`
    };
  }

  if (state.battle?.neutralArmyId) {
    return {
      label: "遭遇目标",
      detail: `${state.battle.neutralArmyId} · 房间态：战斗中 · ${battleSessionSummary(
        state.battle.id,
        state.world.meta.roomId
      )} · ${battleTurnContextLabel(state.battle, state.world)}`
    };
  }

  if (state.previewPlan?.endsInEncounter && state.previewPlan.encounterKind === "hero") {
    const opponent = findHeroSnapshot(state.previewPlan.encounterRefId, state.world);
    return {
      label: "对手信息",
      detail: `${formatVisibleHeroSummary(opponent, state.previewPlan.encounterRefId)} · 房间态：待接敌`
    };
  }

  if (state.previewPlan?.endsInEncounter && state.previewPlan.encounterKind === "neutral") {
    return {
      label: "遭遇目标",
      detail: `${state.previewPlan.encounterRefId ?? "neutral"} · 房间态：待接敌`
    };
  }

  if (state.lastBattleSettlement && state.lastEncounterStarted) {
    if (state.lastEncounterStarted.encounterKind === "hero") {
      const ownedIds = ownedHeroIds(state.world);
      const opponentId = ownedIds.has(state.lastEncounterStarted.heroId)
        ? state.lastEncounterStarted.defenderHeroId ?? null
        : state.lastEncounterStarted.heroId;
      const opponent = findHeroSnapshot(opponentId, state.world);
      return {
        label: "最近对手",
        detail: `${formatVisibleHeroSummary(opponent, opponentId)} · 房间态：已结算 · ${battleSessionSummary(
          state.lastEncounterStarted.battleId,
          state.world.meta.roomId
        )}`
      };
    }

    return {
      label: "最近遭遇",
      detail: `${state.lastEncounterStarted.neutralArmyId ?? "neutral"} · 房间态：已结算 · ${battleSessionSummary(
        state.lastEncounterStarted.battleId,
        state.world.meta.roomId
      )}`
    };
  }

  return null;
}

function renderRoomResultSummary(): string {
  if (state.lastBattleSettlement) {
    return `房间结果：${state.lastBattleSettlement.roomState}`;
  }

  if (state.battle) {
    return `房间结果：多人遭遇战已接管地图行动，当前由 ${battleSessionSummary(
      state.battle.id,
      state.world.meta.roomId
    )} 驱动；待战斗链路关闭后统一回写房间状态。`;
  }

  if (state.diagnostics.connectionStatus === "reconnecting") {
    return "恢复状态：正在恢复连接与房间主状态，期间可能短暂保留上一帧视图。";
  }

  if (state.diagnostics.connectionStatus === "reconnect_failed") {
    return "恢复状态：正在通过最近快照回补房间，等待权威状态确认当前可行动信息。";
  }

  if (state.predictionStatus.includes("已回放本地缓存状态")) {
    return `恢复状态：${state.predictionStatus}`;
  }

  return "房间结果：当前处于稳定探索态，等待新的移动、交互或多人遭遇。";
}

function buildBattleSettlementSummary(
  event: Extract<SessionUpdate["events"][number], { type: "battle.resolved" }>,
  world: PlayerWorldView,
  events: SessionUpdate["events"]
): BattleSettlementSummary {
  const rewardEvent = events.find((item) => item.type === "hero.collected");
  const progressEvent = events.find((item) => item.type === "hero.progressed");
  const equipmentEvent = events.find((item) => item.type === "hero.equipmentFound");
  const didWin = didCurrentPlayerWinBattle(event, world);
  const opponent = findHeroSnapshot(
    world.playerId === event.attackerPlayerId ? event.defenderHeroId : event.heroId,
    world
  );
  const rewardText =
    rewardEvent?.type === "hero.collected" ? `${rewardEvent.resource.kind} +${rewardEvent.resource.amount}` : null;
  const equipmentText = equipmentEvent?.type === "hero.equipmentFound" ? equipmentEvent.equipmentName : null;
  const progressText =
    progressEvent?.type === "hero.progressed"
      ? progressEvent.levelsGained > 0
        ? `${progressEvent.experienceGained} 经验，升至 Lv ${progressEvent.level}，技能点 +${progressEvent.skillPointsAwarded}`
        : `${progressEvent.experienceGained} 经验`
      : null;
  const summaryParts = [rewardText, equipmentText ? `装备 ${equipmentText}` : null, progressText].filter(Boolean);
  const hero = activeHeroSnapshot(world);
  const winnerNextAction =
    hero && hero.move.remaining > 0
      ? "当前英雄仍可继续移动、交互，或直接推进到下一天。"
      : "当前英雄本日行动已接近结束，可等待其他玩家或直接结束当天。";
  const loserNextAction =
    hero && hero.move.remaining > 0
      ? "可先整理当前房间态，再决定是否继续行动。"
      : "当前英雄已无法继续移动，建议等待其他玩家推进房间或直接结束当天。";

  if (didWin) {
    return {
      title: "战斗胜利",
      summary: event.defenderHeroId
        ? `已击败 ${formatHeroIdentity(opponent, event.defenderHeroId)}。`
        : "已击败本次守军。",
      aftermath: summaryParts.length > 0 ? `结算收益：${summaryParts.join(" · ")}。` : "结算完成，可继续处理房间内后续操作。",
      roomState: event.defenderHeroId
        ? "英雄遭遇已关闭，房间已回到地图探索阶段，本次结果已对双方同步生效。"
        : "守军已清除，房间已回到地图探索阶段，可继续接管地图交互。",
      nextAction: winnerNextAction,
      tone: "victory"
    };
  }

  return {
    title: "战斗失败",
    summary: event.defenderHeroId
      ? `遭遇战失利，对手 ${formatHeroIdentity(opponent, event.defenderHeroId ?? event.heroId)} 仍留在房间内。`
      : "本次遭遇战失利。",
    aftermath: "英雄被击退，生命值下降且本日移动力清零。",
    roomState: event.defenderHeroId
      ? "英雄遭遇已关闭，对手仍保留在房间地图上，当前结算已同步回写。"
      : "守军仍保留在房间地图上，当前结算已同步回写。",
    nextAction: loserNextAction,
    tone: "defeat"
  };
}

function openBattleModal(title: string, body: string): void {
  state.modal = {
    visible: true,
    title,
    body
  };
}

function closeBattleModal(): void {
  state.modal.visible = false;
  render();
}

function clearPendingPrediction(): void {
  pendingPrediction = null;
  state.predictionStatus = "";
}

function applyPendingPrediction(next: {
  world: PlayerWorldView;
  movementPlan: MovementPlan | null;
  reachableTiles: Array<{ x: number; y: number }>;
  status: string;
  tone: AppState["feedbackTone"];
}): void {
  if (!pendingPrediction) {
    pendingPrediction = {
      world: structuredClone(state.world),
      battle: state.battle ? structuredClone(state.battle) : null,
      previewPlan: state.previewPlan ? structuredClone(state.previewPlan) : null,
      reachableTiles: structuredClone(state.reachableTiles),
      feedbackTone: state.feedbackTone,
      predictionStatus: state.predictionStatus
    };
  }

  state.world = next.world;
  state.previewPlan = next.movementPlan;
  state.reachableTiles = next.reachableTiles;
  state.feedbackTone = next.tone;
  state.predictionStatus = next.status;
}

function rollbackPendingPrediction(reason?: string): void {
  if (!pendingPrediction) {
    if (reason) {
      state.log.unshift(`Action rejected: ${reason}`);
      state.log = state.log.slice(0, 12);
      state.predictionStatus = "";
    }
    render();
    return;
  }

  state.world = pendingPrediction.world;
  state.battle = pendingPrediction.battle;
  state.previewPlan = pendingPrediction.previewPlan;
  state.reachableTiles = pendingPrediction.reachableTiles;
  state.feedbackTone = pendingPrediction.feedbackTone;
  state.predictionStatus = "";
  pendingPrediction = null;

  if (reason) {
    state.log.unshift(`Action rejected: ${reason}`);
    state.log = state.log.slice(0, 12);
  }

  render();
}

function applyReplayedUpdate(update: SessionUpdate): void {
  clearPendingPrediction();
  const replayResolved = update.events.find(isBattleEvent);
  const replayStarted = update.events.find(
    (event): event is Extract<SessionUpdate["events"][number], { type: "battle.started" }> => event.type === "battle.started"
  );
  state.world = update.world;
  state.battle = update.battle;
  state.previewPlan = null;
  state.reachableTiles = update.reachableTiles;
  state.selectedHeroId = update.world.ownHeroes[0]?.id ?? state.selectedHeroId;
  state.selectedTile = null;
  state.hoveredTile = null;
  state.selectedBattleTargetId = null;
  state.feedbackTone = update.battle ? "battle" : "idle";
  state.pendingBattleAction = null;
  state.lastBattleSettlement =
    replayResolved?.type === "battle.resolved" ? buildBattleSettlementSummary(replayResolved, update.world, update.events) : null;
  if (replayStarted) {
    state.lastEncounterStarted = replayStarted;
  }
  state.predictionStatus = "已回放本地缓存状态，正在等待房间同步...";
  state.log.unshift("已从本地缓存回放最近房间状态");
  state.log = state.log.slice(0, 12);
  pushTimeline([
    {
      id: `${Date.now()}-replay`,
      tone: "sync",
      source: "system",
      text: "已回放本地缓存，等待权威状态同步"
    }
  ]);
  syncKeyboardCursor();
  render();
}

function appendLog(update: SessionUpdate): void {
  if (update.reason) {
    state.log.unshift(`Action rejected: ${update.reason}`);
  }

  if (update.movementPlan) {
    state.log.unshift(`Path: ${formatPath(update.movementPlan.path)}`);
  }

  for (const event of update.events.slice().reverse()) {
    if (event.type === "battle.started") {
      const ownedIds = ownedHeroIds(update.world);
      const enemyHeroId =
        event.encounterKind === "hero"
          ? ownedIds.has(event.heroId)
            ? event.defenderHeroId
            : event.heroId
          : undefined;
      state.log.unshift(
        event.encounterKind === "hero"
          ? `Encounter: enemy hero ${enemyHeroId ?? "unknown"}`
          : event.initiator === "neutral"
            ? `Ambushed by neutral: ${event.neutralArmyId}`
            : `Encounter: ${event.neutralArmyId}`
      );
    } else if (event.type === "battle.resolved") {
      state.log.unshift(`Battle resolved: ${didCurrentPlayerWinBattle(event, update.world) ? "victory" : "defeat"}`);
    } else if (event.type === "hero.collected") {
      state.log.unshift(`Collected ${event.resource.kind} +${event.resource.amount}`);
    } else if (event.type === "hero.recruited") {
      state.log.unshift(`Recruited ${event.unitTemplateId} x${event.count}`);
    } else if (event.type === "hero.visited") {
      state.log.unshift(`Visited ${event.buildingId}: ${formatHeroStatBonus(event.bonus)}`);
    } else if (event.type === "hero.claimedMine") {
      state.log.unshift(`Claimed mine: ${formatDailyIncome(event.resourceKind, event.income)}`);
    } else if (event.type === "resource.produced") {
      state.log.unshift(`Mine produced ${formatResourceKindLabel(event.resource.kind)} +${event.resource.amount}`);
    } else if (event.type === "hero.skillLearned") {
      state.log.unshift(
        event.newRank > 1
          ? `Upgraded ${event.skillName} to Rank ${event.newRank}`
          : `Learned ${event.skillName}`
      );
    } else if (event.type === "hero.equipmentFound") {
      state.log.unshift(`Found equipment: ${event.equipmentName}`);
    } else if (event.type === "neutral.moved") {
      state.log.unshift(
        event.reason === "chase"
          ? `Neutral ${event.neutralArmyId} is chasing toward (${event.to.x},${event.to.y})`
          : event.reason === "return"
            ? `Neutral ${event.neutralArmyId} returned toward guard point`
            : `Neutral ${event.neutralArmyId} patrolled to (${event.to.x},${event.to.y})`
      );
    } else if (event.type === "hero.progressed") {
      state.log.unshift(
        event.levelsGained > 0
          ? `Hero gained ${event.experienceGained} XP, reached Lv ${event.level}, and earned ${event.skillPointsAwarded} skill point${event.skillPointsAwarded === 1 ? "" : "s"}`
          : `Hero gained ${event.experienceGained} XP`
      );
    } else if (event.type === "hero.moved") {
      state.log.unshift(`Moved ${event.moveCost} steps`);
    } else if (event.type === "turn.advanced") {
      state.log.unshift(`Day advanced to ${event.day}`);
    }
  }

  state.log = state.log.slice(0, 12);
}

function pushTimeline(entries: TimelineEntry[]): void {
  state.timeline = [...entries.reverse(), ...state.timeline].slice(0, 8);
}

function sourceLabel(source: TimelineEntry["source"]): string {
  if (source === "push") {
    return "房间同步";
  }

  if (source === "local") {
    return "本地操作";
  }

  return "系统";
}

function buildTimelineEntries(update: SessionUpdate, source: TimelineEntry["source"]): TimelineEntry[] {
  const items: TimelineEntry[] = [];
  const stamp = Date.now();
  const ownedIds = ownedHeroIds(update.world);

  if (update.reason) {
    items.push({
      id: `${stamp}-reject`,
      tone: "system",
      source,
      text: `操作被拒绝：${update.reason}`
    });
  }

  if (update.movementPlan && update.movementPlan.travelPath.length > 1) {
    items.push({
      id: `${stamp}-path`,
      tone: "move",
      source,
      text: `沿路径移动 ${update.movementPlan.travelPath.length - 1} 格`
    });
  }

  update.events.forEach((event, index) => {
    if (event.type === "hero.moved") {
      items.push({
        id: `${stamp}-move-${index}`,
        tone: "move",
        source,
        text: `英雄完成移动，消耗 ${event.moveCost} 步`
      });
      return;
    }

    if (event.type === "hero.collected") {
      items.push({
        id: `${stamp}-loot-${index}`,
        tone: "loot",
        source,
        text: `获得 ${event.resource.kind} +${event.resource.amount}`
      });
      return;
    }

    if (event.type === "hero.recruited") {
      items.push({
        id: `${stamp}-recruit-${index}`,
        tone: "loot",
        source,
        text: `在招募所补充 ${event.count} 个 ${event.unitTemplateId}`
      });
      return;
    }

    if (event.type === "hero.visited") {
      items.push({
        id: `${stamp}-visit-${index}`,
        tone: "loot",
        source,
        text: `访问属性建筑，获得 ${formatHeroStatBonus(event.bonus)}`
      });
      return;
    }

    if (event.type === "hero.claimedMine") {
      items.push({
        id: `${stamp}-mine-claim-${index}`,
        tone: "loot",
        source,
        text: `占领资源产出点，改为每日产出 ${formatDailyIncome(event.resourceKind, event.income)}`
      });
      return;
    }

    if (event.type === "hero.equipmentFound") {
      items.push({
        id: `${stamp}-equipment-${index}`,
        tone: "loot",
        source,
        text: `战利品：获得 ${event.equipmentName}`
      });
      return;
    }

    if (event.type === "resource.produced") {
      items.push({
        id: `${stamp}-mine-income-${index}`,
        tone: "loot",
        source,
        text: `${event.buildingId} 产出 ${formatResourceKindLabel(event.resource.kind)} +${event.resource.amount}`
      });
      return;
    }

    if (event.type === "hero.skillLearned") {
      items.push({
        id: `${stamp}-skill-${index}`,
        tone: "system",
        source,
        text:
          event.newRank > 1
            ? `${event.branchName} 分支的 ${event.skillName} 强化到 Rank ${event.newRank}`
            : `${event.branchName} 分支习得 ${event.skillName}`
      });
      return;
    }

    if (event.type === "neutral.moved") {
      items.push({
        id: `${stamp}-neutral-move-${index}`,
        tone: event.reason === "chase" ? "battle" : "move",
        source,
        text:
          event.reason === "chase"
            ? `中立守军 ${event.neutralArmyId} 主动追向 (${event.to.x},${event.to.y})`
            : event.reason === "return"
              ? `中立守军 ${event.neutralArmyId} 返回守位`
              : `中立守军 ${event.neutralArmyId} 沿巡逻路线移动`
      });
      return;
    }

    if (event.type === "hero.progressed") {
      items.push({
        id: `${stamp}-progress-${index}`,
        tone: "system",
        source,
        text:
          event.levelsGained > 0
            ? `英雄获得 ${event.experienceGained} 经验，升至 Lv ${event.level}，并得到 ${event.skillPointsAwarded} 点技能点`
            : `英雄获得 ${event.experienceGained} 经验`
      });
      return;
    }

    if (event.type === "battle.started") {
      items.push({
        id: `${stamp}-battle-start-${index}`,
        tone: "battle",
        source,
        text:
          event.encounterKind === "hero"
            ? ownedIds.has(event.heroId)
              ? "主动接触敌方英雄，进入遭遇战"
              : "被敌方英雄接触，进入遭遇战"
            : event.initiator === "neutral"
              ? "中立守军主动袭来，进入战斗"
              : "接触明雷守军，进入战斗"
      });
      return;
    }

    if (event.type === "battle.resolved") {
      items.push({
        id: `${stamp}-battle-end-${index}`,
        tone: "battle",
        source,
        text: didCurrentPlayerWinBattle(event, update.world) ? "战斗胜利，世界状态已回写" : "战斗失败，英雄被击退"
      });
      return;
    }

    if (event.type === "turn.advanced") {
      items.push({
        id: `${stamp}-day-${index}`,
        tone: "system",
        source,
        text: `推进到第 ${event.day} 天`
      });
    }
  });

  if (source === "push" && items.length === 0 && (update.events.length > 0 || update.movementPlan)) {
    items.push({
      id: `${stamp}-sync`,
      tone: "sync",
      source,
      text: "收到房间状态同步"
    });
  }

  return items;
}

function startPathAnimation(path: Array<{ x: number; y: number }>): void {
  cancelUiTaskBatch(pathAnimationTaskIds);
  state.animatedPath = path;
  state.animatedPathIndex = -1;

  if (path.length === 0) {
    render();
    return;
  }

  path.forEach((_, index) => {
    pathAnimationTaskIds.push(scheduleUiTask(index * 110, () => {
      state.animatedPathIndex = index;
      render();
    }));
  });

  pathAnimationTaskIds.push(scheduleUiTask(path.length * 110 + 180, () => {
    state.animatedPath = [];
    state.animatedPathIndex = -1;
    pathAnimationTaskIds = [];
    render();
  }));
}

function triggerBattleFx(unitId: string | null, floatingText: string | null): void {
  cancelUiTask(battleFxTaskId);
  state.battleFx = {
    flashUnitId: unitId,
    floatingText
  };
  render();

  battleFxTaskId = scheduleUiTask(650, () => {
    state.battleFx = {
      flashUnitId: null,
      floatingText: null
    };
    battleFxTaskId = null;
    render();
  });
}

function extractDamageText(lines: string[]): string | null {
  for (const line of [...lines].reverse()) {
    const match = line.match(/造成\s+(\d+)\s+伤害/);
    if (match) {
      return `-${match[1]}`;
    }
  }
  return null;
}

function applyUpdate(update: SessionUpdate, source: TimelineEntry["source"] = "local"): void {
  clearPendingPrediction();
  const hadBattle = Boolean(state.battle);
  const previousBattle = state.battle;
  const startedEncounter = update.events.find(
    (event): event is Extract<SessionUpdate["events"][number], { type: "battle.started" }> => event.type === "battle.started"
  );
  state.diagnostics.connectionStatus = "connected";
  state.diagnostics.lastUpdateAt = Date.now();
  state.diagnostics.lastUpdateSource = source;
  state.diagnostics.lastUpdateReason = update.reason ?? "snapshot";
  state.diagnostics.lastEventTypes = update.events.map((event) => event.type).slice(0, 8);
  state.world = update.world;
  state.battle = update.battle;
  state.previewPlan = null;
  const heroId = state.selectedHeroId ?? update.world.ownHeroes[0]?.id ?? "hero-1";
  state.reachableTiles = update.reachableTiles;
  state.selectedHeroId = update.world.ownHeroes[0]?.id ?? state.selectedHeroId;
  if (!update.battle) {
    state.selectedBattleTargetId = null;
  } else {
    const playerCamp = controlledBattleCamp(update.battle, update.world);
    const enemyCamp = opposingBattleCamp(playerCamp);
    const enemies = Object.values(update.battle.units).filter((unit) => unit.camp === enemyCamp && unit.count > 0);
    if (!state.selectedBattleTargetId || !enemies.some((unit) => unit.id === state.selectedBattleTargetId)) {
      state.selectedBattleTargetId = enemies[0]?.id ?? null;
    }
  }
  appendLog(update);
  pushTimeline(buildTimelineEntries(update, source));
  state.feedbackTone = update.events.some(
    (event) =>
      event.type === "hero.collected" ||
      event.type === "hero.recruited" ||
      event.type === "hero.visited" ||
      event.type === "hero.claimedMine" ||
      event.type === "resource.produced" ||
      event.type === "hero.skillLearned" ||
      event.type === "hero.equipmentFound"
  )
    ? "loot"
    : update.events.some(
          (event) =>
            event.type === "battle.started" ||
            event.type === "battle.resolved" ||
            (event.type === "neutral.moved" && event.reason === "chase")
        )
      ? "battle"
      : update.events.some((event) => event.type === "hero.moved" || event.type === "neutral.moved")
        ? "move"
        : "idle";

  if (update.movementPlan) {
    startPathAnimation(update.movementPlan.travelPath);
  }

  if (state.pendingBattleAction?.type === "battle.attack" && previousBattle && update.battle) {
    triggerBattleFx(state.pendingBattleAction.defenderId, extractDamageText(update.battle.log));
  } else if (state.pendingBattleAction?.type === "battle.defend" && update.battle) {
    triggerBattleFx(state.pendingBattleAction.unitId, "DEF");
  } else if (state.pendingBattleAction?.type === "battle.wait" && update.battle) {
    triggerBattleFx(state.pendingBattleAction.unitId, "WAIT");
  } else if (state.pendingBattleAction?.type === "battle.skill" && update.battle) {
    const targetUnitId = state.pendingBattleAction.targetId ?? state.pendingBattleAction.unitId;
    const isEnemyTargeted = targetUnitId !== state.pendingBattleAction.unitId;
    triggerBattleFx(
      targetUnitId,
      isEnemyTargeted ? extractDamageText(update.battle.log) ?? "SKILL" : "BUFF"
    );
  }

  state.pendingBattleAction = null;

  const resolved = update.events.find(isBattleEvent);
  if (resolved?.type === "battle.resolved") {
    const settlement = buildBattleSettlementSummary(resolved, update.world, update.events);
    state.lastBattleSettlement = settlement;
    openBattleModal(settlement.title, `${settlement.summary}${settlement.aftermath}`);
  } else if (hadBattle && !update.battle && update.events.length === 0) {
    state.lastBattleSettlement = {
      title: "战斗结束",
      summary: "本场遭遇已结束。",
      aftermath: "房间状态已回到地图探索，可继续验证后续流程。",
      roomState: "本场遭遇链路已经关闭，房间已回到地图探索阶段。",
      nextAction: "可继续地图移动、交互，或等待其他玩家完成后续操作。",
      tone: "neutral"
    };
    openBattleModal("战斗结束", "本场遭遇已结束。");
  } else if (startedEncounter) {
    state.lastBattleSettlement = null;
  }

  if (startedEncounter) {
    state.lastEncounterStarted = startedEncounter;
  }

  if (
    update.events.some(
      (event) =>
        event.type === "battle.started" ||
        event.type === "battle.resolved" ||
        event.type === "hero.skillLearned" ||
        event.type === "hero.equipmentFound"
    )
  ) {
    void refreshAccountProfileFromServer();
  }

  syncKeyboardCursor();
  render();
}

async function refreshAccountProfileFromServer(): Promise<void> {
  if (accountRefreshPromise) {
    return accountRefreshPromise;
  }

  accountRefreshPromise = (async () => {
    const account = await loadAccountProfileWithProgression(playerId, roomId);
    state.account = account;
    if (!state.accountSaving) {
      state.accountDraftName = account.displayName;
    }
    render();
  })().finally(() => {
    accountRefreshPromise = null;
  });

  return accountRefreshPromise;
}

async function previewTile(x: number, y: number): Promise<void> {
  state.hoveredTile = { x, y };
  const hero = activeHero();
  if (!hero || state.battle) {
    state.previewPlan = null;
    render();
    return;
  }

  const session = await getSession();
  const previewPlan = await session.previewMovement(hero.id, { x, y });
  if (!state.hoveredTile || state.hoveredTile.x !== x || state.hoveredTile.y !== y) {
    return;
  }

  state.previewPlan = previewPlan;
  render();
}

function clearPreview(): void {
  state.hoveredTile = null;
  state.previewPlan = null;
  render();
}

async function onTileClick(x: number, y: number): Promise<void> {
  state.selectedTile = { x, y };
  state.keyboardCursor = { x, y };
  const hero = activeHero();
  if (!hero || state.battle) {
    render();
    return;
  }

  const targetTile = state.world.map.tiles.find((tile) => tile.position.x === x && tile.position.y === y) ?? null;
  const session = await getSession();
  if (hero.position.x === x && hero.position.y === y) {
    if (targetTile?.building) {
      const buildingAction =
        targetTile.building.kind === "recruitment_post"
          ? ({
              type: "hero.recruit",
              heroId: hero.id,
              buildingId: targetTile.building.id
            } as const)
          : targetTile.building.kind === "attribute_shrine"
            ? ({
                type: "hero.visit",
                heroId: hero.id,
                buildingId: targetTile.building.id
              } as const)
            : ({
                type: "hero.claimMine",
                heroId: hero.id,
                buildingId: targetTile.building.id
              } as const);
      const prediction = predictPlayerWorldAction(state.world, buildingAction);

      if (!prediction.reason) {
        applyPendingPrediction({
          world: prediction.world,
          movementPlan: prediction.movementPlan,
          reachableTiles: prediction.reachableTiles,
          status:
            targetTile.building.kind === "recruitment_post"
              ? `预演中：在 ${targetTile.building.label} 招募 ${targetTile.building.availableCount} 单位`
              : targetTile.building.kind === "attribute_shrine"
                ? `预演中：访问 ${targetTile.building.label}，获得 ${formatHeroStatBonus(targetTile.building.bonus)}`
                : `预演中：占领 ${targetTile.building.label}，改为每日产出 ${formatDailyIncome(targetTile.building.resourceKind, targetTile.building.income)}`,
          tone: "loot"
        });
        render();
      }

      try {
        applyUpdate(
          targetTile.building.kind === "recruitment_post"
            ? await session.recruit(hero.id, targetTile.building.id)
            : targetTile.building.kind === "attribute_shrine"
              ? await session.visitBuilding(hero.id, targetTile.building.id)
              : await session.claimMine(hero.id, targetTile.building.id)
        );
      } catch (error) {
        rollbackPendingPrediction(
          error instanceof Error
            ? error.message
            : targetTile.building.kind === "recruitment_post"
              ? "recruit_failed"
              : targetTile.building.kind === "attribute_shrine"
                ? "visit_failed"
                : "claim_failed"
        );
      }
      return;
    }

    if (targetTile?.resource) {
      const prediction = predictPlayerWorldAction(state.world, {
        type: "hero.collect",
        heroId: hero.id,
        position: { x, y }
      });

      if (!prediction.reason) {
        applyPendingPrediction({
          world: prediction.world,
          movementPlan: prediction.movementPlan,
          reachableTiles: prediction.reachableTiles,
          status: `预演中：拾取 ${targetTile.resource.kind} +${targetTile.resource.amount}`,
          tone: "loot"
        });
        render();
      }
    }

    if (targetTile?.resource) {
      try {
        applyUpdate(await session.collect(hero.id, { x, y }));
      } catch (error) {
        rollbackPendingPrediction(error instanceof Error ? error.message : "collect_failed");
      }
    } else {
      render();
    }
    return;
  }

  const prediction = predictPlayerWorldAction(state.world, {
    type: "hero.move",
    heroId: hero.id,
    destination: { x, y }
  });

  if (!prediction.reason) {
    applyPendingPrediction({
      world: prediction.world,
      movementPlan: prediction.movementPlan,
      reachableTiles: prediction.reachableTiles,
      status: prediction.movementPlan?.endsInEncounter ? "预演中：接敌并等待战斗快照..." : "预演中：移动已提交，等待服务器确认...",
      tone: prediction.movementPlan?.endsInEncounter ? "battle" : "move"
    });
    render();
  }

  try {
    applyUpdate(await session.moveHero(hero.id, { x, y }));
  } catch (error) {
    rollbackPendingPrediction(error instanceof Error ? error.message : "move_failed");
  }
}

async function onEndDay(): Promise<void> {
  if (state.battle) {
    state.predictionStatus = "战斗中无法推进天数";
    render();
    return;
  }

  state.predictionStatus = "正在推进到下一天...";
  render();

  try {
    const session = await getSession();
    applyUpdate(await session.endDay());
  } catch (error) {
    state.predictionStatus = error instanceof Error ? error.message : "end_day_failed";
    render();
  }
}

async function onLearnHeroSkill(skillId: string): Promise<void> {
  const hero = activeHero();
  if (!hero) {
    return;
  }

  if (state.battle) {
    state.predictionStatus = "战斗中无法调整技能树";
    render();
    return;
  }

  const tree = createHeroSkillTreeView(hero);
  const selectedSkill = tree.branches.flatMap((branch) => branch.skills).find((skill) => skill.id === skillId) ?? null;
  if (!selectedSkill) {
    state.predictionStatus = "未找到对应技能";
    render();
    return;
  }

  const session = await getSession();
  const prediction = predictPlayerWorldAction(state.world, {
    type: "hero.learnSkill",
    heroId: hero.id,
    skillId
  });

  if (!prediction.reason) {
    applyPendingPrediction({
      world: prediction.world,
      movementPlan: prediction.movementPlan,
      reachableTiles: prediction.reachableTiles,
      status:
        selectedSkill.currentRank > 0
          ? `预演中：将 ${selectedSkill.name} 强化到 Rank ${selectedSkill.nextRank}`
          : `预演中：学习 ${selectedSkill.name}`,
      tone: "loot"
    });
    render();
  }

  try {
    applyUpdate(await session.learnSkill(hero.id, skillId));
  } catch (error) {
    rollbackPendingPrediction(error instanceof Error ? error.message : "learn_skill_failed");
  }
}

async function onEquipHeroItem(slot: EquipmentType, equipmentId: string): Promise<void> {
  const hero = activeHero();
  if (!hero) {
    return;
  }

  if (state.battle) {
    state.predictionStatus = "战斗中无法调整装备";
    render();
    return;
  }

  const definition = getEquipmentDefinition(equipmentId);
  const session = await getSession();
  const prediction = predictPlayerWorldAction(state.world, {
    type: "hero.equip",
    heroId: hero.id,
    slot,
    equipmentId
  });

  if (!prediction.reason) {
    applyPendingPrediction({
      world: prediction.world,
      movementPlan: prediction.movementPlan,
      reachableTiles: prediction.reachableTiles,
      status: `预演中：装备 ${definition?.name ?? equipmentId}`,
      tone: "loot"
    });
    render();
  }

  try {
    applyUpdate(await session.equipHeroItem(hero.id, slot, equipmentId));
  } catch (error) {
    rollbackPendingPrediction(
      error instanceof Error ? formatEquipmentActionReason(error.message) : "equip_item_failed"
    );
  }
}

async function onUnequipHeroItem(slot: EquipmentType): Promise<void> {
  const hero = activeHero();
  if (!hero) {
    return;
  }

  if (state.battle) {
    state.predictionStatus = "战斗中无法调整装备";
    render();
    return;
  }

  const session = await getSession();
  const prediction = predictPlayerWorldAction(state.world, {
    type: "hero.unequip",
    heroId: hero.id,
    slot
  });

  if (!prediction.reason) {
    applyPendingPrediction({
      world: prediction.world,
      movementPlan: prediction.movementPlan,
      reachableTiles: prediction.reachableTiles,
      status: "预演中：卸下装备",
      tone: "loot"
    });
    render();
  }

  try {
    applyUpdate(await session.unequipHeroItem(hero.id, slot));
  } catch (error) {
    rollbackPendingPrediction(
      error instanceof Error ? formatEquipmentActionReason(error.message) : "unequip_item_failed"
    );
  }
}

async function onBattleAction(action: BattleAction): Promise<void> {
  state.pendingBattleAction = action;
  const session = await getSession();
  applyUpdate(await session.actInBattle(action));
}

async function triggerBattleAttackShortcut(): Promise<void> {
  const context = battleShortcutContext();
  if (!context?.selectedTarget) {
    return;
  }

  await onBattleAction({
    type: "battle.attack",
    attackerId: context.active.id,
    defenderId: context.selectedTarget.id
  });
}

async function triggerBattleSkillShortcut(): Promise<void> {
  const context = battleShortcutContext();
  if (!context) {
    return;
  }

  const skill = context.readySkills[0] ?? null;
  if (!skill) {
    await triggerBattleAttackShortcut();
    return;
  }

  await onBattleAction({
    type: "battle.skill",
    unitId: context.active.id,
    skillId: skill.id,
    ...(skill.target === "enemy" && context.selectedTarget ? { targetId: context.selectedTarget.id } : {})
  });
}

async function triggerBattleDefendShortcut(): Promise<void> {
  const context = battleShortcutContext();
  if (!context) {
    return;
  }

  await onBattleAction(
    context.active.defending
      ? {
          type: "battle.wait",
          unitId: context.active.id
        }
      : {
          type: "battle.defend",
          unitId: context.active.id
        }
  );
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function bindKeyboardShortcuts(): void {
  if (keyboardShortcutsBound) {
    return;
  }

  document.addEventListener("keydown", (event) => {
    if (!shouldBootGame || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (isEditableKeyboardTarget(event.target)) {
      return;
    }

    if (state.modal.visible) {
      if (event.key === "Enter" || event.key === " " || event.key === "Escape") {
        event.preventDefault();
        closeBattleModal();
      }
      return;
    }

    if (state.battle) {
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        cycleBattleTarget(-1);
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        cycleBattleTarget(1);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void triggerBattleAttackShortcut();
        return;
      }

      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        void triggerBattleSkillShortcut();
        return;
      }

      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        void triggerBattleDefendShortcut();
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudgeKeyboardCursor(-1, 0);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      nudgeKeyboardCursor(1, 0);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      nudgeKeyboardCursor(0, -1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      nudgeKeyboardCursor(0, 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      const cursor = currentKeyboardCursor();
      if (!cursor) {
        return;
      }

      event.preventDefault();
      void onTileClick(cursor.x, cursor.y);
      return;
    }

    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      void onEndDay();
    }
  });

  keyboardShortcutsBound = true;
}

async function refreshLobbyRoomList(): Promise<void> {
  state.lobby.loading = true;
  state.lobby.status = "正在刷新可加入房间...";
  render();

  try {
    const rooms = await loadLobbyRooms();
    state.lobby.rooms = rooms;
    state.lobby.loading = false;
    state.lobby.status =
      rooms.length > 0 ? `发现 ${rooms.length} 个活跃房间，可直接加入或继续创建新房间。` : "当前没有活跃房间，输入房间 ID 后即可直接创建新实例。";
  } catch {
    state.lobby.rooms = [];
    state.lobby.loading = false;
    state.lobby.status = "Lobby 服务暂不可达；仍可直接输入房间 ID，进入时会自动尝试远端房间并在失败后回退本地模式。";
  }

  render();
}

function parseAuthRequestFailure(error: unknown): { status: number; code: string } | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const matched = /^auth_request_failed:(\d+):(.+)$/.exec(error.message);
  if (!matched) {
    return null;
  }

  return {
    status: Number(matched[1]),
    code: matched[2] ?? "unknown"
  };
}

function describeAccountFlowError(
  error: unknown,
  fallback: string,
  options: {
    invalidTokenCode?: string;
  } = {}
): string {
  const failure = parseAuthRequestFailure(error);
  if (!failure) {
    return error instanceof Error ? error.message : fallback;
  }

  if (failure.status === 409 && failure.code === "login_id_taken") {
    return "登录 ID 已被占用，请更换后重试。";
  }
  if (failure.status === 401 && options.invalidTokenCode && failure.code === options.invalidTokenCode) {
    return "令牌无效或已过期，请重新申请后再确认。";
  }
  if (failure.status === 401) {
    return "登录 ID 或口令不正确，请检查后重试。";
  }
  if (failure.status === 400) {
    return "输入格式不合法，请检查登录 ID、令牌和口令后重试。";
  }
  if (failure.status === 429) {
    return "请求过于频繁，请稍后再试。";
  }

  return error instanceof Error ? error.message : fallback;
}

async function enterLobbyRoom(roomIdOverride?: string): Promise<void> {
  const preferences = saveLobbyPreferences(state.lobby.playerId, roomIdOverride ?? state.lobby.roomId);
  const displayName = rememberPreferredPlayerDisplayName(preferences.playerId, state.lobby.displayName);
  state.lobby.playerId = preferences.playerId;
  state.lobby.roomId = preferences.roomId;
  state.lobby.displayName = displayName;
  state.lobby.entering = true;
  state.lobby.status = `正在登录游客账号并进入房间 ${preferences.roomId}...`;
  render();

  const authSession = await loginGuestAuthSession(preferences.playerId, displayName);
  state.lobby.authSession = authSession;
  state.lobby.playerId = authSession.playerId;
  state.lobby.displayName = authSession.displayName;
  state.lobby.status =
    authSession.source === "remote"
      ? `游客登录成功，正在进入房间 ${preferences.roomId}...`
      : `登录服务暂不可达，正在以本地游客档进入房间 ${preferences.roomId}...`;
  saveLobbyPreferences(authSession.playerId, preferences.roomId);

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("roomId", preferences.roomId);
  nextUrl.searchParams.delete("playerId");
  window.location.assign(nextUrl.toString());
}

async function loginLobbyAccount(roomIdOverride?: string): Promise<void> {
  const preferences = saveLobbyPreferences(state.lobby.playerId, roomIdOverride ?? state.lobby.roomId);
  const loginId = state.lobby.loginId.trim().toLowerCase();
  if (!loginId) {
    state.lobby.status = "请输入登录 ID 后再使用口令登录。";
    render();
    return;
  }

  if (!state.lobby.password.trim()) {
    state.lobby.status = "请输入账号口令后再登录。";
    render();
    return;
  }

  state.lobby.entering = true;
  state.lobby.status = `正在使用账号 ${loginId} 登录并进入房间 ${preferences.roomId}...`;
  render();

  try {
    const authSession = await loginPasswordAuthSession(loginId, state.lobby.password);
    state.lobby.authSession = authSession;
    state.lobby.playerId = authSession.playerId;
    state.lobby.displayName = authSession.displayName;
    state.lobby.loginId = authSession.loginId ?? loginId;
    state.lobby.password = "";
    state.accountLoginId = authSession.loginId ?? loginId;
    state.accountPassword = "";
    state.lobby.status = `账号登录成功，正在进入房间 ${preferences.roomId}...`;
    saveLobbyPreferences(authSession.playerId, preferences.roomId);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("roomId", preferences.roomId);
    nextUrl.searchParams.delete("playerId");
    window.location.assign(nextUrl.toString());
  } catch (error) {
    state.lobby.entering = false;
    state.lobby.status = describeAccountFlowError(error, "account_login_failed");
    render();
  }
}

async function requestLobbyAccountRegistration(): Promise<void> {
  const loginId = state.lobby.loginId.trim().toLowerCase();
  if (!loginId) {
    state.lobby.status = "请输入登录 ID 后再申请正式注册令牌。";
    render();
    return;
  }

  state.lobby.entering = true;
  state.lobby.status = `正在为 ${loginId} 申请注册令牌...`;
  render();

  try {
    const result = await requestAccountRegistration(loginId, state.lobby.registrationDisplayName);
    state.lobby.entering = false;
    state.lobby.registrationToken = result.registrationToken ?? state.lobby.registrationToken;
    state.lobby.status = result.registrationToken
      ? `注册令牌已生成，可直接确认注册。令牌：${result.registrationToken}${result.expiresAt ? `；过期时间：${result.expiresAt}` : ""}`
      : `注册申请已受理${result.expiresAt ? `，过期时间：${result.expiresAt}` : ""}。`;
    render();
  } catch (error) {
    state.lobby.entering = false;
    state.lobby.status = describeAccountFlowError(error, "account_registration_request_failed");
    render();
  }
}

async function confirmLobbyAccountRegistration(roomIdOverride?: string): Promise<void> {
  const preferences = saveLobbyPreferences(state.lobby.playerId, roomIdOverride ?? state.lobby.roomId);
  const loginId = state.lobby.loginId.trim().toLowerCase();
  if (!loginId) {
    state.lobby.status = "请输入登录 ID 后再确认正式注册。";
    render();
    return;
  }
  if (!state.lobby.registrationToken.trim()) {
    state.lobby.status = "请先申请并填写注册令牌。";
    render();
    return;
  }
  if (!state.lobby.registrationPassword.trim()) {
    state.lobby.status = "请输入注册口令后再确认。";
    render();
    return;
  }

  state.lobby.entering = true;
  state.lobby.status = `正在确认正式注册 ${loginId} 并进入房间 ${preferences.roomId}...`;
  render();

  try {
    const authSession = await confirmAccountRegistration(loginId, state.lobby.registrationToken, state.lobby.registrationPassword);
    state.lobby.authSession = authSession;
    state.lobby.playerId = authSession.playerId;
    state.lobby.displayName = authSession.displayName;
    state.lobby.loginId = authSession.loginId ?? loginId;
    state.lobby.password = "";
    state.lobby.registrationToken = "";
    state.lobby.registrationPassword = "";
    state.accountLoginId = authSession.loginId ?? loginId;
    state.accountPassword = "";
    state.lobby.status = `正式账号注册成功，正在进入房间 ${preferences.roomId}...`;
    saveLobbyPreferences(authSession.playerId, preferences.roomId);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("roomId", preferences.roomId);
    nextUrl.searchParams.delete("playerId");
    window.location.assign(nextUrl.toString());
  } catch (error) {
    state.lobby.entering = false;
    state.lobby.status = describeAccountFlowError(error, "account_registration_confirm_failed", {
      invalidTokenCode: "invalid_registration_token"
    });
    render();
  }
}

async function requestLobbyPasswordRecovery(): Promise<void> {
  const loginId = state.lobby.loginId.trim().toLowerCase();
  if (!loginId) {
    state.lobby.status = "请输入登录 ID 后再申请密码找回令牌。";
    render();
    return;
  }

  state.lobby.entering = true;
  state.lobby.status = `正在为 ${loginId} 申请密码找回令牌...`;
  render();

  try {
    const result = await requestPasswordRecovery(loginId);
    state.lobby.entering = false;
    state.lobby.recoveryToken = result.recoveryToken ?? state.lobby.recoveryToken;
    state.lobby.status = result.recoveryToken
      ? `找回令牌已生成，可直接确认重置。令牌：${result.recoveryToken}${result.expiresAt ? `；过期时间：${result.expiresAt}` : ""}`
      : `密码找回申请已受理${result.expiresAt ? `，过期时间：${result.expiresAt}` : ""}。`;
    render();
  } catch (error) {
    state.lobby.entering = false;
    state.lobby.status = describeAccountFlowError(error, "password_recovery_request_failed");
    render();
  }
}

async function confirmLobbyPasswordRecovery(roomIdOverride?: string): Promise<void> {
  const preferences = saveLobbyPreferences(state.lobby.playerId, roomIdOverride ?? state.lobby.roomId);
  const loginId = state.lobby.loginId.trim().toLowerCase();
  if (!loginId) {
    state.lobby.status = "请输入登录 ID 后再确认密码重置。";
    render();
    return;
  }
  if (!state.lobby.recoveryToken.trim()) {
    state.lobby.status = "请先申请并填写找回令牌。";
    render();
    return;
  }
  if (!state.lobby.recoveryPassword.trim()) {
    state.lobby.status = "请输入新口令后再确认重置。";
    render();
    return;
  }

  state.lobby.entering = true;
  state.lobby.status = `正在重置 ${loginId} 的口令并进入房间 ${preferences.roomId}...`;
  render();

  try {
    await confirmPasswordRecovery(loginId, state.lobby.recoveryToken, state.lobby.recoveryPassword);
    const authSession = await loginPasswordAuthSession(loginId, state.lobby.recoveryPassword);
    state.lobby.authSession = authSession;
    state.lobby.playerId = authSession.playerId;
    state.lobby.displayName = authSession.displayName;
    state.lobby.loginId = authSession.loginId ?? loginId;
    state.lobby.password = "";
    state.lobby.recoveryToken = "";
    state.lobby.recoveryPassword = "";
    state.accountLoginId = authSession.loginId ?? loginId;
    state.accountPassword = "";
    state.lobby.status = `口令重置成功，正在进入房间 ${preferences.roomId}...`;
    saveLobbyPreferences(authSession.playerId, preferences.roomId);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("roomId", preferences.roomId);
    nextUrl.searchParams.delete("playerId");
    window.location.assign(nextUrl.toString());
  } catch (error) {
    state.lobby.entering = false;
    state.lobby.status = describeAccountFlowError(error, "password_recovery_confirm_failed", {
      invalidTokenCode: "invalid_recovery_token"
    });
    render();
  }
}

function returnToLobby(): void {
  saveLobbyPreferences(playerId, roomId);
  rememberPreferredPlayerDisplayName(playerId, state.accountDraftName);
  const nextUrl = new URL(window.location.href);
  nextUrl.search = "";
  window.location.assign(nextUrl.toString());
}

async function logoutGuestSession(): Promise<void> {
  await logoutCurrentAuthSession();
  state.lobby.authSession = null;
  state.lobby.loginId = "";
  state.lobby.password = "";
  state.lobby.entering = false;
  state.lobby.status = "已退出当前游客会话，请重新选择或创建一个账号进入房间。";
  const nextUrl = new URL(window.location.href);
  nextUrl.search = "";
  window.location.assign(nextUrl.toString());
}

function renderBattleActions(): string {
  if (!state.battle || !state.battle.activeUnitId) {
    return `<div class="battle-actions muted" data-testid="battle-actions">当前没有战斗</div>`;
  }

  const active = state.battle.units[state.battle.activeUnitId];
  const playerCamp = controlledBattleCamp(state.battle);
  if (!active) {
    return `<div class="battle-actions muted" data-testid="battle-actions">当前没有可行动单位</div>`;
  }

  if (!playerCamp) {
    return `<div class="battle-actions muted" data-testid="battle-actions">当前无法操作这场战斗</div>`;
  }

  if (active.camp !== playerCamp) {
    return `<div class="battle-actions muted" data-testid="battle-actions">${state.battle.defenderHeroId ? "等待对手操作" : "敌方回合自动执行"}</div>`;
  }

  const enemyCamp = opposingBattleCamp(playerCamp);
  const enemies = Object.values(state.battle.units).filter((unit) => unit.camp === enemyCamp && unit.count > 0);
  const selectedTarget = enemies.find((enemy) => enemy.id === state.selectedBattleTargetId) ?? enemies[0];
  const skillButtons = (active.skills ?? [])
    .filter((skill) => skill.kind === "active")
    .map((skill) => {
      const targetId = skill.target === "enemy" ? (selectedTarget?.id ?? "") : active.id;
      const enabled = skill.target === "enemy" ? Boolean(selectedTarget) && skill.remainingCooldown === 0 : skill.remainingCooldown === 0;
      const labelSuffix =
        skill.target === "enemy"
          ? selectedTarget
            ? ` -> ${selectedTarget.stackName}`
            : " -> 请选择目标"
          : " -> 自身";
      return `
        <button
          data-testid="battle-skill-${skill.id}"
          data-battle-action="skill"
          data-skill-id="${skill.id}"
          data-unit="${active.id}"
          data-target="${targetId}"
          ${enabled ? "" : "disabled"}
          title="${skill.description}"
        >
          ${skill.name}${skill.remainingCooldown > 0 ? ` (${skill.remainingCooldown})` : ""}${labelSuffix}
        </button>
      `;
    })
    .join("");

  return `
    <div class="battle-actions" data-testid="battle-actions">
      <button data-testid="battle-attack" data-battle-action="attack" data-attacker="${active.id}" data-defender="${selectedTarget?.id ?? ""}" ${selectedTarget ? "" : "disabled"}>
        ${selectedTarget ? `攻击 ${selectedTarget.stackName}` : "无可攻击目标"}
      </button>
      ${skillButtons}
      <button data-testid="battle-wait" data-battle-action="wait" data-unit="${active.id}">等待</button>
      <button data-testid="battle-defend" data-battle-action="defend" data-unit="${active.id}" ${active.defending ? "disabled" : ""}>防御</button>
    </div>
  `;
}

function renderBattleIntelPanel(): string {
  if (!state.battle) {
    return `
      <div class="battle-intel info-card" data-testid="battle-intel">
        <div class="battle-intel-headline">
          <strong>战术情报</strong>
          <span>进入战斗后，这里会展开显示技能、状态和冷却说明。</span>
        </div>
      </div>
    `;
  }

  const playerCamp = controlledBattleCamp(state.battle) ?? "attacker";
  const enemyCamp = opposingBattleCamp(playerCamp) ?? "defender";
  const activeUnit = state.battle.activeUnitId ? state.battle.units[state.battle.activeUnitId] ?? null : null;
  const enemies = Object.values(state.battle.units).filter((unit) => unit.camp === enemyCamp && unit.count > 0);
  const selectedTarget = enemies.find((unit) => unit.id === state.selectedBattleTargetId) ?? enemies[0] ?? null;
  const activeBadge =
    activeUnit?.count && activeUnit.count > 0
      ? activeUnit.camp === playerCamp
        ? "我方行动"
        : "敌方行动"
      : "等待中";

  return `
    <section class="battle-intel" data-testid="battle-intel">
      <div class="battle-intel-headline">
        <strong>战术情报</strong>
        <span>把当前行动单位和锁定目标的技能、状态、冷却都摊开来看。</span>
      </div>
      <div class="battle-intel-grid">
        ${renderBattleIntelCard("当前行动单位", "Turn Actor", activeBadge, activeUnit, "当前没有可行动单位。")}
        ${renderBattleIntelCard("已锁定目标", "Target Focus", selectedTarget ? "已锁定" : "未锁定", selectedTarget, "请选择一个敌方目标后查看详细说明。")}
      </div>
      ${renderBattleDetailGroup(
        "战场环境",
        (state.battle.environment ?? []).map(renderBattleHazardDetail),
        "当前战场没有额外障碍或陷阱。"
      )}
    </section>
  `;
}

function renderRoomStatusPanel(): string {
  const encounter = renderEncounterHeadline();
  const hero = activeHero();
  const opponentContext = resolveEncounterOpponentContext();
  const opponentLine = opponentContext
    ? `${opponentContext.label}：${opponentContext.detail}`
    : "对手信息：当前没有遭遇目标";
  const playerSummary = hero
    ? `我方状态：${hero.name} · HP ${hero.stats.hp}/${hero.stats.maxHp} · Move ${hero.move.remaining}/${hero.move.total}`
    : "我方状态：等待英雄数据同步";
  const roomFeedbackTone = resolveRoomFeedbackTone(state);

  return `
    <section class="room-status-panel info-card" data-testid="room-status-panel">
      <div class="info-card-head">
        <div>
          <div class="info-card-eyebrow">Room Phase</div>
          <strong data-testid="room-phase">${encounter.phase}</strong>
        </div>
        <span class="status-pill">${state.world.meta.roomId}</span>
      </div>
      <p data-testid="room-status-detail">${encounter.detail}</p>
      <p class="muted" data-testid="encounter-source" data-tone="${roomFeedbackTone}">${renderEncounterSourceDetail({
        battle: state.battle,
        lastEncounterStarted: state.lastEncounterStarted,
        world: state.world,
        previewPlan: state.previewPlan,
        lastBattleSettlement: state.lastBattleSettlement,
        diagnostics: state.diagnostics,
        predictionStatus: state.predictionStatus
      })}</p>
      <p class="muted" data-testid="room-result-summary" data-tone="${roomFeedbackTone}">${renderRoomResultSummary()}</p>
      <p class="muted" data-testid="opponent-summary">${opponentLine}</p>
      <div class="room-status-chips">
        <span class="battle-intel-chip" data-testid="room-player-summary">${playerSummary}</span>
        <span class="battle-intel-chip" data-testid="room-connection-summary">连接状态：${diagnosticsConnectionStatusLabel(state.diagnostics.connectionStatus)}</span>
      </div>
      <p class="muted" data-testid="room-next-action" data-tone="${roomFeedbackTone}">${renderRoomActionHint({
        battle: state.battle,
        lastBattleSettlement: state.lastBattleSettlement,
        activeHero: activeHero(),
        diagnostics: state.diagnostics,
        predictionStatus: state.predictionStatus
      })}</p>
    </section>
  `;
}

function renderBattleSettlementPanel(): string {
  if (!state.lastBattleSettlement) {
    return "";
  }

  return `
    <section class="battle-settlement-panel info-card tone-${state.lastBattleSettlement.tone}" data-testid="battle-settlement">
      <div class="info-card-head">
        <div>
          <div class="info-card-eyebrow">Settlement</div>
          <strong>${state.lastBattleSettlement.title}</strong>
        </div>
        <span class="status-pill">${state.lastBattleSettlement.tone === "victory" ? "Victory" : state.lastBattleSettlement.tone === "defeat" ? "Defeat" : "Closed"}</span>
      </div>
      <p data-testid="battle-settlement-summary">${state.lastBattleSettlement.summary}</p>
      <p class="muted" data-testid="battle-settlement-aftermath">${state.lastBattleSettlement.aftermath}</p>
      <p class="muted" data-testid="battle-settlement-room-state">${state.lastBattleSettlement.roomState}</p>
      <p class="muted" data-testid="battle-settlement-next-action">${state.lastBattleSettlement.nextAction}</p>
    </section>
  `;
}

function renderBattlefield(): string {
  if (!state.battle) {
    return `<div class="battle-empty" data-testid="battle-empty">No active battle</div>`;
  }

  const playerCamp = controlledBattleCamp(state.battle) ?? "attacker";
  const enemyCamp = opposingBattleCamp(playerCamp) ?? "defender";
  const friendlies = Object.values(state.battle.units).filter((unit) => unit.camp === playerCamp);
  const enemies = Object.values(state.battle.units).filter((unit) => unit.camp === enemyCamp);
  const activeId = state.battle.activeUnitId;
  const campLabel = (camp: "attacker" | "defender") => (camp === playerCamp ? "我方" : "敌方");
  const unitStatusLabel = (unitId: string, unitCount: number, camp: "attacker" | "defender", active: boolean) => {
    if (unitCount <= 0) {
      return "已阵亡";
    }

    if (active) {
      return "当前行动";
    }

    return campLabel(camp);
  };

  const renderUnit = (unitId: string) => {
    const unit = state.battle!.units[unitId]!;
    const isActive = activeId === unit.id;
    const isDead = unit.count <= 0;
    const isSelectable = unit.camp === enemyCamp && unit.count > 0;
    const isSelected = state.selectedBattleTargetId === unit.id;
    const isFlashing = state.battleFx.flashUnitId === unit.id;
    const portraitSrc =
      unitAsset(unit.templateId, isFlashing ? "hit" : isSelected || isActive ? "selected" : "idle") ??
      markerAsset(unit.camp === "attacker" ? "hero" : "neutral", isFlashing ? "hit" : isSelected ? "selected" : "idle");
    const frameSrc = unitFrameAsset(unit.templateId);
    const badgeSrc = unitBadgeAssets(unit.templateId);
    const statusLine = (unit.statusEffects ?? [])
      .map((status) => `${status.name} ${status.durationRemaining}`)
      .join(" · ");

    return `
      <button
        class="unit-card ${unit.camp} ${isActive ? "is-active" : ""} ${isDead ? "is-dead" : ""} ${isSelected ? "is-selected" : ""} ${isFlashing ? "is-flashing" : ""}"
        data-testid="battle-unit-${unit.id}"
        ${isSelectable ? `data-target-unit="${unit.id}"` : "disabled"}
      >
        <div class="unit-portrait-wrap info-card-media">
          <img class="unit-portrait" src="${portraitSrc}" alt="${unit.stackName}" />
          ${frameSrc ? `<img class="unit-frame" src="${frameSrc}" alt="" aria-hidden="true" />` : ""}
          ${badgeSrc.faction ? `<img class="unit-badge unit-badge-faction" src="${badgeSrc.faction}" alt="" aria-hidden="true" />` : ""}
          ${badgeSrc.rarity ? `<img class="unit-badge unit-badge-rarity" src="${badgeSrc.rarity}" alt="" aria-hidden="true" />` : ""}
        </div>
        <div class="info-card-copy">
          <div class="info-card-head">
            <div>
              <div class="info-card-eyebrow">${campLabel(unit.camp)}</div>
              <span class="unit-name">${unit.stackName}</span>
            </div>
            <span class="status-pill">${unitStatusLabel(unit.id, unit.count, unit.camp, isActive)}</span>
          </div>
          <div class="meta-row">
            <span class="unit-meta">x${unit.count}</span>
            <span class="unit-meta">HP ${unit.currentHp}/${unit.maxHp}</span>
          </div>
          <div class="meta-row">
            <span class="unit-meta">线位 ${unit.lane + 1}</span>
          </div>
          <div class="meta-row">
            <span class="unit-meta">ATK ${unit.attack}</span>
            <span class="unit-meta">DEF ${unit.defense}${unit.defending ? " · DEFEND" : ""}</span>
          </div>
          ${statusLine ? `<div class="meta-row"><span class="unit-meta">${statusLine}</span></div>` : ""}
        </div>
        ${isFlashing && state.battleFx.floatingText ? `<span class="floating-text">${state.battleFx.floatingText}</span>` : ""}
      </button>
    `;
  };

  return `
    <div class="battlefield">
      <div class="battle-lane">
        <div class="lane-title">我方部队</div>
        <div class="unit-grid">${friendlies.map((unit) => renderUnit(unit.id)).join("")}</div>
      </div>
      <div class="battle-turn-banner">
        <strong>Round ${state.battle.round}</strong>
        <span>${activeId ? `当前单位：${state.battle.units[activeId]?.stackName ?? activeId}` : "等待结算"}</span>
      </div>
      <div class="battle-lane">
        <div class="lane-title">敌方部队</div>
        <div class="unit-grid">${enemies.map((unit) => renderUnit(unit.id)).join("")}</div>
      </div>
    </div>
  `;
}

function renderBattleLog(): string {
  if (!state.battle) {
    return `<div class="battle-log muted" data-testid="battle-log">尚未进入战斗</div>`;
  }

  const lines = state.battle.log.slice(-6).reverse();
  return `<div class="battle-log" data-testid="battle-log">${lines.map((line) => `<div class="battle-log-line">${line}</div>`).join("")}</div>`;
}

function renderTimeline(): string {
  if (state.timeline.length === 0) {
    return `<div class="timeline-panel muted">等待玩家操作或房间同步...</div>`;
  }

  return `
    <div class="timeline-panel">
      ${state.timeline
        .map(
          (item) => `
            <div class="timeline-item tone-${item.tone}">
              <span class="timeline-source">${sourceLabel(item.source)}</span>
              <strong>${item.text}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderModal(): string {
  if (!state.modal.visible) {
    return "";
  }

  return `
    <div class="modal-backdrop" data-testid="battle-modal-backdrop" data-close-modal="true">
      <div class="modal-card" data-testid="battle-modal" role="dialog" aria-modal="true">
        <div class="eyebrow">Battle Report</div>
        <h2 data-testid="battle-modal-title">${state.modal.title}</h2>
        <p data-testid="battle-modal-body">${state.modal.body}</p>
        <button class="modal-button" data-testid="battle-modal-close" data-close-modal="true">关闭</button>
      </div>
    </div>
  `;
}

function renderLobby(): string {
  const roomFieldMarkup = `
    <label class="lobby-field">
      <span>房间 ID</span>
      <input
        class="account-input"
        data-lobby-room-id="true"
        maxlength="40"
        value="${escapeHtml(state.lobby.roomId)}"
        placeholder="room-alpha"
        ${state.lobby.entering ? "disabled" : ""}
      />
    </label>
  `;
  const roomsMarkup =
    state.lobby.rooms.length === 0
      ? `
        <div class="lobby-room-empty info-card">
          <strong>当前没有活跃房间</strong>
          <span>输入房间 ID 后点击“进入房间”，即可创建一个新的独立实例。</span>
        </div>
      `
      : state.lobby.rooms
          .map(
            (room) => `
              <button
                class="lobby-room-card info-card"
                data-join-room="${escapeHtml(room.roomId)}"
                ${state.lobby.entering ? "disabled" : ""}
              >
                <div class="lobby-room-card-head">
                  <div>
                    <div class="info-card-eyebrow">Instance</div>
                    <strong>${escapeHtml(room.roomId)}</strong>
                  </div>
                  <span class="status-pill">Day ${room.day}</span>
                </div>
                <div class="meta-row">
                  <span class="battle-intel-chip">玩家 ${room.connectedPlayers}</span>
                  <span class="battle-intel-chip">英雄 ${room.heroCount}</span>
                  <span class="battle-intel-chip">战斗 ${room.activeBattles}</span>
                  <span class="battle-intel-chip">Seed ${room.seed}</span>
                </div>
                <span class="lobby-room-meta">最近刷新：${escapeHtml(formatLobbyRoomUpdatedAt(room.updatedAt))}</span>
              </button>
            `
          )
          .join("");

  return `
    <main class="lobby-shell">
      <section class="lobby-hero-panel">
        <div class="eyebrow">Project Veil</div>
        <h1>大厅 / 登录入口</h1>
        <p class="lead">这里负责进入真实房间，而不是再靠手写 URL。现在除了游客档，也能把当前进度绑定成口令账号并直接登录。</p>
        <div class="lobby-hero-copy info-card">
          <div class="info-card-copy">
            <div class="info-card-head">
              <div>
                <div class="info-card-eyebrow">Session Mode</div>
                <strong>${escapeHtml(formatAuthModeLabel(state.lobby.authSession))}</strong>
              </div>
              <span class="status-pill">${state.lobby.authSession?.authMode === "account" ? "Account" : "Guest"}</span>
            </div>
            <span>
              ${
                state.lobby.authSession?.authMode === "account"
                  ? "已缓存口令账号会话，可直接刷新房间列表后进房，也可以退出后切回游客入口。"
                  : "游客身份仍会保留，但现在可以在游戏内把它绑定成登录 ID + 口令，后续直接用账号模式进入。"
              }
            </span>
          </div>
        </div>
      </section>
      <section class="lobby-panel">
        <div class="panel-head">
          <h2>进入房间</h2>
          <div class="hint">可选已有房间，也可手动输入创建新实例</div>
        </div>
        <div class="lobby-form info-card">
          ${roomFieldMarkup}
          <div class="lobby-auth-grid">
            <section class="lobby-auth-card">
              <div class="lobby-auth-head">
                <strong>游客进入</strong>
                <span>创建或继续一个游客档</span>
              </div>
              <label class="lobby-field">
                <span>玩家 ID</span>
                <input
                  class="account-input"
                  data-lobby-player-id="true"
                  maxlength="40"
                  value="${escapeHtml(state.lobby.playerId)}"
                  placeholder="guest-000001"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <label class="lobby-field">
                <span>昵称</span>
                <input
                  class="account-input"
                  data-lobby-display-name="true"
                  maxlength="40"
                  value="${escapeHtml(state.lobby.displayName)}"
                  placeholder="输入昵称"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <button class="account-save" data-enter-room="true" ${state.lobby.entering ? "disabled" : ""}>
                ${state.lobby.entering ? "进入中..." : "游客进入房间"}
              </button>
            </section>
            <section class="lobby-auth-card">
              <div class="lobby-auth-head">
                <strong>账号登录</strong>
                <span>使用已绑定的登录 ID + 口令</span>
              </div>
              <label class="lobby-field">
                <span>登录 ID</span>
                <input
                  class="account-input"
                  data-lobby-login-id="true"
                  maxlength="40"
                  value="${escapeHtml(state.lobby.loginId)}"
                  placeholder="veil-ranger"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <label class="lobby-field">
                <span>账号口令</span>
                <input
                  class="account-input"
                  data-lobby-password="true"
                  type="password"
                  maxlength="80"
                  value="${escapeHtml(state.lobby.password)}"
                  placeholder="至少 6 位"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <button class="account-save" data-login-account="true" ${state.lobby.entering ? "disabled" : ""}>
                ${state.lobby.entering ? "登录中..." : "账号登录并进房"}
              </button>
            </section>
            <section class="lobby-auth-card">
              <div class="lobby-auth-head">
                <strong>正式注册</strong>
                <span>开发态 request / confirm 闭环</span>
              </div>
              <label class="lobby-field">
                <span>注册昵称</span>
                <input
                  class="account-input"
                  data-registration-display-name="true"
                  maxlength="40"
                  value="${escapeHtml(state.lobby.registrationDisplayName)}"
                  placeholder="默认沿用登录 ID"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <label class="lobby-field">
                <span>注册令牌</span>
                <input
                  class="account-input"
                  data-registration-token="true"
                  maxlength="120"
                  value="${escapeHtml(state.lobby.registrationToken)}"
                  placeholder="先申请，再粘贴 dev token"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <label class="lobby-field">
                <span>注册口令</span>
                <input
                  class="account-input"
                  data-registration-password="true"
                  type="password"
                  maxlength="80"
                  value="${escapeHtml(state.lobby.registrationPassword)}"
                  placeholder="至少 6 位"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <div class="lobby-actions">
                <button class="account-save" data-request-registration="true" ${state.lobby.entering ? "disabled" : ""}>申请注册令牌</button>
                <button class="account-save" data-confirm-registration="true" ${state.lobby.entering ? "disabled" : ""}>确认注册并进房</button>
              </div>
            </section>
            <section class="lobby-auth-card">
              <div class="lobby-auth-head">
                <strong>密码找回</strong>
                <span>开发态 request / confirm 闭环</span>
              </div>
              <label class="lobby-field">
                <span>重置令牌</span>
                <input
                  class="account-input"
                  data-recovery-token="true"
                  maxlength="120"
                  value="${escapeHtml(state.lobby.recoveryToken)}"
                  placeholder="先申请，再粘贴 dev token"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <label class="lobby-field">
                <span>新口令</span>
                <input
                  class="account-input"
                  data-recovery-password="true"
                  type="password"
                  maxlength="80"
                  value="${escapeHtml(state.lobby.recoveryPassword)}"
                  placeholder="至少 6 位"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <div class="lobby-actions">
                <button class="account-save" data-request-recovery="true" ${state.lobby.entering ? "disabled" : ""}>申请找回令牌</button>
                <button class="account-save" data-confirm-recovery="true" ${state.lobby.entering ? "disabled" : ""}>确认重置并进房</button>
              </div>
            </section>
          </div>
          <div class="lobby-actions">
            <button class="account-save" data-refresh-lobby="true" ${state.lobby.loading || state.lobby.entering ? "disabled" : ""}>
              ${state.lobby.loading ? "刷新中..." : "刷新房间"}
            </button>
            ${
              state.lobby.authSession
                ? `<button class="session-link" data-logout-guest="true" ${state.lobby.entering ? "disabled" : ""}>退出当前会话</button>`
                : ""
            }
          </div>
          ${
            state.lobby.authSession
              ? `<p class="account-meta">已缓存${state.lobby.authSession.source === "remote" ? "云端" : "本地"}会话：${escapeHtml(
                  state.lobby.authSession.playerId
                )}${state.lobby.authSession.loginId ? ` / ${escapeHtml(state.lobby.authSession.loginId)}` : ""}</p>`
              : ""
          }
          <p class="muted account-status">${escapeHtml(state.lobby.status)}</p>
        </div>
        <div class="panel-head">
          <h2>活跃房间</h2>
          <div class="hint">${state.lobby.rooms.length} 个实例</div>
        </div>
        <div class="lobby-room-list">${roomsMarkup}</div>
      </section>
    </main>
  `;
}

function render(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) {
    return;
  }

  if (!shouldBootGame) {
    root.innerHTML = renderLobby();

    for (const playerIdInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-lobby-player-id]"))) {
      playerIdInput.addEventListener("input", () => {
        const previousSuggestedName = state.lobby.playerId.trim()
          ? readLocalPreferredDisplayName(state.lobby.playerId)
          : "";
        const nextPlayerId = playerIdInput.value;
        state.lobby.playerId = nextPlayerId;

        if (!state.lobby.displayName.trim() || state.lobby.displayName === previousSuggestedName) {
          state.lobby.displayName = nextPlayerId.trim() ? readLocalPreferredDisplayName(nextPlayerId) : "";
          const displayNameField = root.querySelector<HTMLInputElement>("[data-lobby-display-name]");
          if (displayNameField) {
            displayNameField.value = state.lobby.displayName;
          }
        }
      });
      playerIdInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || state.lobby.entering) {
          return;
        }

        event.preventDefault();
        void enterLobbyRoom();
      });
    }

    for (const displayNameInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-lobby-display-name]"))) {
      displayNameInput.addEventListener("input", () => {
        state.lobby.displayName = displayNameInput.value;
      });
      displayNameInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || state.lobby.entering) {
          return;
        }

        event.preventDefault();
        void enterLobbyRoom();
      });
    }

    for (const loginIdInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-lobby-login-id]"))) {
      loginIdInput.addEventListener("input", () => {
        state.lobby.loginId = loginIdInput.value;
      });
      loginIdInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || state.lobby.entering) {
          return;
        }

        event.preventDefault();
        void loginLobbyAccount();
      });
    }

    for (const passwordInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-lobby-password]"))) {
      passwordInput.addEventListener("input", () => {
        state.lobby.password = passwordInput.value;
      });
      passwordInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || state.lobby.entering) {
          return;
        }

        event.preventDefault();
        void loginLobbyAccount();
      });
    }

    for (const displayNameInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-registration-display-name]"))) {
      displayNameInput.addEventListener("input", () => {
        state.lobby.registrationDisplayName = displayNameInput.value;
      });
    }

    for (const registrationTokenInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-registration-token]"))) {
      registrationTokenInput.addEventListener("input", () => {
        state.lobby.registrationToken = registrationTokenInput.value;
      });
    }

    for (const registrationPasswordInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-registration-password]"))) {
      registrationPasswordInput.addEventListener("input", () => {
        state.lobby.registrationPassword = registrationPasswordInput.value;
      });
    }

    for (const recoveryTokenInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-recovery-token]"))) {
      recoveryTokenInput.addEventListener("input", () => {
        state.lobby.recoveryToken = recoveryTokenInput.value;
      });
    }

    for (const recoveryPasswordInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-recovery-password]"))) {
      recoveryPasswordInput.addEventListener("input", () => {
        state.lobby.recoveryPassword = recoveryPasswordInput.value;
      });
    }

    for (const roomIdInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-lobby-room-id]"))) {
      roomIdInput.addEventListener("input", () => {
        state.lobby.roomId = roomIdInput.value;
      });
      roomIdInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || state.lobby.entering) {
          return;
        }

        event.preventDefault();
        if (state.lobby.loginId.trim() && state.lobby.password.trim()) {
          void loginLobbyAccount();
          return;
        }

        void enterLobbyRoom();
      });
    }

    for (const refreshButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-refresh-lobby]"))) {
      refreshButton.addEventListener("click", () => {
        void refreshLobbyRoomList();
      });
    }

    for (const enterButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-enter-room]"))) {
      enterButton.addEventListener("click", () => {
        void enterLobbyRoom();
      });
    }

    for (const loginButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-login-account]"))) {
      loginButton.addEventListener("click", () => {
        void loginLobbyAccount();
      });
    }

    for (const registrationRequestButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-request-registration]"))) {
      registrationRequestButton.addEventListener("click", () => {
        void requestLobbyAccountRegistration();
      });
    }

    for (const registrationConfirmButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-confirm-registration]"))) {
      registrationConfirmButton.addEventListener("click", () => {
        void confirmLobbyAccountRegistration();
      });
    }

    for (const recoveryRequestButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-request-recovery]"))) {
      recoveryRequestButton.addEventListener("click", () => {
        void requestLobbyPasswordRecovery();
      });
    }

    for (const recoveryConfirmButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-confirm-recovery]"))) {
      recoveryConfirmButton.addEventListener("click", () => {
        void confirmLobbyPasswordRecovery();
      });
    }

    for (const roomButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-join-room]"))) {
      roomButton.addEventListener("click", () => {
        if (state.lobby.loginId.trim() && state.lobby.password.trim()) {
          void loginLobbyAccount(roomButton.dataset.joinRoom);
          return;
        }

        void enterLobbyRoom(roomButton.dataset.joinRoom);
      });
    }

    for (const logoutButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-logout-guest]"))) {
      logoutButton.addEventListener("click", () => {
        logoutGuestSession();
      });
    }

    return;
  }

  const hero = activeHero();
  const hoveredTile = hoveredTileData();
  const hoveredObject = describeTileObject(hoveredTile);
  const hoveredBadges = objectBadgeAssets(hoveredObject);
  const interactionLabel = (interactionType: string | null | undefined) => {
    if (interactionType === "battle") {
      return "战斗交互";
    }

    if (interactionType === "pickup") {
      return "拾取交互";
    }

    return "移动交互";
  };
  const grid = state.world.map.tiles
    .map((tile, index) => {
      const selected = state.selectedTile?.x === tile.position.x && state.selectedTile?.y === tile.position.y;
      const hovered = state.hoveredTile?.x === tile.position.x && state.hoveredTile?.y === tile.position.y;
      const keyboardCursor =
        state.keyboardCursor?.x === tile.position.x && state.keyboardCursor?.y === tile.position.y;
      const isHero = hero && hero.position.x === tile.position.x && hero.position.y === tile.position.y;
        const classes = [
          "tile",
          `fog-${tile.fog}`,
        selected ? "is-selected" : "",
        hovered ? "is-hovered" : "",
        keyboardCursor ? "is-keyboard-cursor" : "",
        isHero ? "is-hero" : "",
          tile.occupant?.kind === "neutral" ? "is-neutral" : "",
          isReachableTile(tile.position.x, tile.position.y) ? "is-reachable" : "",
          isPreviewNode(tile.position.x, tile.position.y) ? "is-preview" : "",
          isTravelNode(tile.position.x, tile.position.y) ? "is-travel" : "",
          isAnimatedNode(tile.position.x, tile.position.y) ? "is-animated" : ""
        ]
        .filter(Boolean)
        .join(" ");

      return `<button class="${classes}" data-x="${tile.position.x}" data-y="${tile.position.y}" aria-label="tile-${index}">
        <span class="tile-media">${renderTileMedia(tile)}</span>
        <span class="tile-label">${tileLabel(tile)}</span>
        <span class="tile-coord">${tile.position.x},${tile.position.y}</span>
      </button>`;
    })
    .join("");

  root.innerHTML = `
    <main class="shell">
      <section class="hero-panel">
        <div class="eyebrow">Project Veil</div>
        <h1>H5 调试壳</h1>
        <p class="lead">这里保留给浏览器调试、配置联调和回归验证使用；主客户端运行时已切到 Cocos Creator。</p>
        <div class="session-meta-row">
          <p class="muted" data-testid="session-meta">Room: ${roomId} · Player: ${playerId}</p>
          <button class="session-link" data-return-lobby="true">返回大厅</button>
          <button class="session-link" data-logout-guest="true">切换游客账号</button>
        </div>
        <div class="account-card" data-testid="account-card">
          <div class="account-card-head">
            <div>
              <span class="account-eyebrow">账号资料</span>
              <strong>${escapeHtml(state.account.displayName)}</strong>
            </div>
            <span class="account-badge tone-${state.account.source}">${formatAccountSource(state.account)}</span>
          </div>
          <p class="account-meta">ID ${escapeHtml(state.account.playerId)}</p>
          <p class="account-meta">${escapeHtml(formatCredentialBinding(state.account))}</p>
          <p class="account-meta">${escapeHtml(formatAccountLastSeen(state.account))}</p>
          <p class="account-meta">${escapeHtml(formatGlobalVault(state.account))}</p>
          ${renderAchievementProgress(state.account)}
          ${renderBattleReportReplayCenter({
            account: state.account,
            selectedReplayId: state.replayDetail.selectedReplayId,
            replay: state.replayDetail.replay,
            playback: state.replayDetail.playback,
            loading: state.replayDetail.loading,
            status: state.replayDetail.status
          })}
          ${renderRecentAccountEvents(state.account)}
          <div class="account-editor">
            <input
              class="account-input"
              data-account-name="true"
              maxlength="40"
              value="${escapeHtml(state.accountDraftName)}"
              placeholder="输入昵称"
              ${state.accountSaving ? "disabled" : ""}
            />
            <button
              class="account-save"
              data-save-account="true"
              ${state.accountSaving ? "disabled" : ""}
            >${state.accountSaving ? "保存中..." : "保存昵称"}</button>
          </div>
          <div class="account-binding-card">
            <div class="account-binding-head">
              <strong>${state.account.loginId ? "更新账号口令" : "绑定口令账号"}</strong>
              <span>${state.account.loginId ? "当前档案已可用登录 ID 直接进入" : "把当前游客档升级成可长期登录的账号"}</span>
            </div>
            <div class="account-binding-grid">
              <input
                class="account-input"
                data-account-login-id="true"
                maxlength="40"
                value="${escapeHtml(state.account.loginId ?? state.accountLoginId)}"
                placeholder="veil-ranger"
                ${state.accountSaving || state.accountBinding || state.account.source !== "remote" || Boolean(state.account.loginId) ? "disabled" : ""}
              />
              <input
                class="account-input"
                data-account-password="true"
                type="password"
                maxlength="80"
                value="${escapeHtml(state.accountPassword)}"
                placeholder="${state.account.loginId ? "输入新口令" : "至少 6 位"}"
                ${state.accountSaving || state.accountBinding || state.account.source !== "remote" ? "disabled" : ""}
              />
            </div>
            <button
              class="account-save"
              data-bind-account="true"
              ${state.accountSaving || state.accountBinding || state.account.source !== "remote" ? "disabled" : ""}
            >${state.accountBinding ? "提交中..." : state.account.loginId ? "更新口令" : "绑定账号"}</button>
          </div>
          ${renderAccountSessionPanel()}
          <p class="muted account-status">${escapeHtml(state.accountStatus)}</p>
        </div>
        ${state.predictionStatus ? `<p class="muted" data-testid="prediction-status">${state.predictionStatus}</p>` : ""}
        <div class="stats">
          <div class="card" data-testid="stat-day"><span>Day</span><strong>${state.world.meta.day}</strong></div>
          <div class="card" data-testid="stat-gold"><span>Gold</span><strong>${state.world.resources.gold}</strong></div>
          <div class="card" data-testid="stat-wood"><span>Wood</span><strong>${state.world.resources.wood}</strong></div>
          <div class="card" data-testid="stat-ore"><span>Ore</span><strong>${state.world.resources.ore}</strong></div>
        </div>
        <div class="hero-card" data-testid="hero-card">
          <h2>${hero?.name ?? "No Hero"}</h2>
          <p data-testid="hero-level">${formatHeroProgression(hero)}</p>
          <p data-testid="hero-xp">${formatHeroExperience(hero)}</p>
          ${renderHeroProgressPanel(hero)}
          <p data-testid="hero-stats">${formatHeroCoreStats(hero)}</p>
          <p data-testid="hero-hp">HP ${hero?.stats.hp ?? 0}/${hero?.stats.maxHp ?? 0}</p>
          <p data-testid="hero-move">Move ${hero?.move.remaining ?? 0}/${hero?.move.total ?? 0}</p>
          <p data-testid="hero-wins">Wins ${hero?.progression.battlesWon ?? 0} · Neutral ${hero?.progression.neutralBattlesWon ?? 0} · PvP ${hero?.progression.pvpBattlesWon ?? 0}</p>
          <p data-testid="hero-army">Army ${hero?.armyTemplateId ?? "-"} x ${hero?.armyCount ?? 0}</p>
          <p data-testid="hero-skill-points">Skill Points ${hero?.progression.skillPoints ?? 0}</p>
          <p class="muted" data-testid="hero-preview">${state.previewPlan ? `预览消耗 ${state.previewPlan.moveCost} 步` : state.predictionStatus || "悬停地图格子查看路径"}</p>
          ${renderHeroEquipmentPanel(hero)}
          ${renderHeroAttributePanel(hero, state.world)}
          <button class="modal-button" data-end-day="true" ${state.battle ? "disabled" : ""}>推进到下一天</button>
          ${renderHeroSkillTree(hero)}
        </div>
        <div class="log-panel">
          <h3>时间线</h3>
          <div data-testid="timeline-panel">${renderTimeline()}</div>
        </div>
        <div class="log-panel">
          <h3>事件流</h3>
          <div class="log-list" data-testid="event-log">${state.log.map((line) => `<div class="log-line">${line}</div>`).join("")}</div>
        </div>
        ${renderDiagnosticPanel()}
      </section>
      <section class="map-panel">
        <div class="panel-head">
          <h2>大地图</h2>
          <div class="hint">${state.previewPlan ? formatPath(state.previewPlan.travelPath) : `Hero: ${hero?.position.x ?? "-"},${hero?.position.y ?? "-"}`}</div>
        </div>
        <div class="map-inspector ${state.feedbackTone !== "idle" ? `tone-${state.feedbackTone}` : ""}">
          <div class="inspector-main">
            <strong>${hoveredTile ? `格子 ${hoveredTile.position.x},${hoveredTile.position.y}` : "悬停格子查看详情"}</strong>
            <span>
              ${
                hoveredTile
                  ? [
                      `地形 ${hoveredTile.terrain}`,
                      hoveredTile.resource ? `资源 ${hoveredTile.resource.kind}+${hoveredTile.resource.amount}` : "无资源",
                      hoveredTile.building
                        ? `建筑 ${hoveredTile.building.label}`
                        : hoveredTile.occupant?.kind === "neutral"
                          ? "明雷怪"
                          : hoveredTile.occupant?.kind === "hero"
                            ? "英雄"
                            : "空地"
                    ].join(" · ")
                  : "可达格已高亮，预览路径会在地图上实时显示。"
              }
            </span>
            ${
              hoveredObject
                ? `
                  <div class="object-card info-card">
                    <div class="object-card-media info-card-media">
                      ${hoveredObject.icon ? `<img class="object-card-icon" src="${hoveredObject.icon}" alt="${hoveredObject.title}" />` : `<div class="object-card-empty">${hoveredTile?.terrain ?? "?"}</div>`}
                    </div>
                    <div class="object-card-copy info-card-copy">
                      <div class="info-card-head">
                        <div>
                          <div class="info-card-eyebrow">${hoveredTile?.building ? "建筑交互" : interactionLabel(hoveredObject.interactionType)}</div>
                          <strong>${hoveredObject.title}</strong>
                        </div>
                        <span class="status-pill">${hoveredObject.rarity === "elite" ? "Elite" : "Common"}</span>
                      </div>
                      <span>${hoveredObject.subtitle}</span>
                      <div class="object-card-tags meta-row">
                        ${hoveredBadges.interaction ? `<img class="object-tag" src="${hoveredBadges.interaction}" alt="" aria-hidden="true" />` : ""}
                        ${hoveredBadges.faction ? `<img class="object-tag" src="${hoveredBadges.faction}" alt="" aria-hidden="true" />` : ""}
                        ${hoveredBadges.rarity ? `<img class="object-tag" src="${hoveredBadges.rarity}" alt="" aria-hidden="true" />` : ""}
                        <span class="object-card-value">${hoveredObject.value}</span>
                      </div>
                    </div>
                  </div>
                `
                : ""
            }
          </div>
          <div class="inspector-side">
            <span>可达格</span>
            <strong>${state.reachableTiles.length}</strong>
          </div>
        </div>
        <div class="grid" style="grid-template-columns: repeat(${state.world.map.width}, minmax(0, 1fr));">${grid}</div>
      </section>
      <section class="battle-panel" data-testid="battle-panel">
        <div class="panel-head">
          <h2>战斗面板</h2>
          <div class="hint">${renderEncounterHeadline().phase}</div>
        </div>
        ${renderRoomStatusPanel()}
        ${renderBattleSettlementPanel()}
        ${renderBattlefield()}
        ${renderBattleIntelPanel()}
        ${renderBattleActions()}
        ${renderBattleLog()}
      </section>
    </main>
    ${renderModal()}
  `;

  for (const tileButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-x][data-y]"))) {
    tileButton.addEventListener("mouseenter", () => {
      state.keyboardCursor = {
        x: Number(tileButton.dataset.x),
        y: Number(tileButton.dataset.y)
      };
      void previewTile(Number(tileButton.dataset.x), Number(tileButton.dataset.y));
    });
    tileButton.addEventListener("mouseleave", clearPreview);
    tileButton.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      state.keyboardCursor = {
        x: Number(tileButton.dataset.x),
        y: Number(tileButton.dataset.y)
      };
      void onTileClick(Number(tileButton.dataset.x), Number(tileButton.dataset.y));
    });
    tileButton.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      state.keyboardCursor = {
        x: Number(tileButton.dataset.x),
        y: Number(tileButton.dataset.y)
      };
      void onTileClick(Number(tileButton.dataset.x), Number(tileButton.dataset.y));
    });
  }

  for (const actionButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-battle-action]"))) {
    actionButton.addEventListener("click", () => {
      const kind = actionButton.dataset.battleAction;
      if (kind === "attack") {
        void onBattleAction({
          type: "battle.attack",
          attackerId: actionButton.dataset.attacker!,
          defenderId: actionButton.dataset.defender!
        });
        return;
      }

      if (kind === "wait") {
        void onBattleAction({
          type: "battle.wait",
          unitId: actionButton.dataset.unit!
        });
        return;
      }

      if (kind === "skill") {
        void onBattleAction({
          type: "battle.skill",
          unitId: actionButton.dataset.unit!,
          skillId: actionButton.dataset.skillId!,
          ...(actionButton.dataset.target ? { targetId: actionButton.dataset.target } : {})
        });
        return;
      }

      void onBattleAction({
        type: "battle.defend",
        unitId: actionButton.dataset.unit!
      });
    });
  }

  for (const targetButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-target-unit]"))) {
    targetButton.addEventListener("click", () => {
      state.selectedBattleTargetId = targetButton.dataset.targetUnit ?? null;
      render();
    });
  }

  for (const closeButton of Array.from(root.querySelectorAll<HTMLElement>("[data-close-modal]"))) {
    closeButton.addEventListener("click", closeBattleModal);
  }

  for (const endDayButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-end-day]"))) {
    endDayButton.addEventListener("click", () => {
      void onEndDay();
    });
  }

  for (const skillButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-hero-skill-id]"))) {
    skillButton.addEventListener("click", () => {
      const skillId = skillButton.dataset.heroSkillId;
      if (!skillId) {
        return;
      }

      void onLearnHeroSkill(skillId);
    });
  }

  for (const equipButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-hero-equip-slot]"))) {
    equipButton.addEventListener("click", () => {
      const slot = equipButton.dataset.heroEquipSlot as EquipmentType | undefined;
      const equipmentId = equipButton.dataset.heroEquipId;
      if (!slot || !equipmentId) {
        return;
      }

      void onEquipHeroItem(slot, equipmentId);
    });
  }

  for (const unequipButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-hero-unequip-slot]"))) {
    unequipButton.addEventListener("click", () => {
      const slot = unequipButton.dataset.heroUnequipSlot as EquipmentType | undefined;
      if (!slot) {
        return;
      }

      void onUnequipHeroItem(slot);
    });
  }

  for (const replayButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-select-replay]"))) {
    replayButton.addEventListener("click", () => {
      const replayId = replayButton.dataset.selectReplay;
      if (!replayId) {
        return;
      }

      void selectReplayDetail(replayId);
    });
  }

  for (const replayControlButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-replay-control]"))) {
    replayControlButton.addEventListener("click", () => {
      const action = replayControlButton.dataset.replayControl;
      if (action !== "play" && action !== "pause" && action !== "step" && action !== "reset") {
        return;
      }

      applyReplayPlaybackControl(action);
    });
  }

  for (const clearReplayButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-clear-replay]"))) {
    clearReplayButton.addEventListener("click", () => {
      clearReplayDetail();
      render();
    });
  }

  for (const accountInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-account-name]"))) {
    accountInput.addEventListener("input", () => {
      state.accountDraftName = accountInput.value;
    });
    accountInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || state.accountSaving) {
        return;
      }

      event.preventDefault();
      void onSaveAccountProfile();
    });
  }

  for (const accountLoginIdInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-account-login-id]"))) {
    accountLoginIdInput.addEventListener("input", () => {
      state.accountLoginId = accountLoginIdInput.value;
    });
    accountLoginIdInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || state.accountBinding) {
        return;
      }

      event.preventDefault();
      void onBindAccountProfile();
    });
  }

  for (const accountPasswordInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-account-password]"))) {
    accountPasswordInput.addEventListener("input", () => {
      state.accountPassword = accountPasswordInput.value;
    });
    accountPasswordInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || state.accountBinding) {
        return;
      }

      event.preventDefault();
      void onBindAccountProfile();
    });
  }

  for (const saveAccountButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-save-account]"))) {
    saveAccountButton.addEventListener("click", () => {
      void onSaveAccountProfile();
    });
  }

  for (const bindAccountButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-bind-account]"))) {
    bindAccountButton.addEventListener("click", () => {
      void onBindAccountProfile();
    });
  }

  for (const revokeSessionButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-revoke-account-session]"))) {
    revokeSessionButton.addEventListener("click", () => {
      const sessionId = revokeSessionButton.dataset.revokeAccountSession?.trim();
      if (sessionId) {
        void onRevokeAccountSession(sessionId);
      }
    });
  }

  for (const returnLobbyButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-return-lobby]"))) {
    returnLobbyButton.addEventListener("click", () => {
      returnToLobby();
    });
  }

  for (const logoutButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-logout-guest]"))) {
    logoutButton.addEventListener("click", () => {
      logoutGuestSession();
    });
  }

  for (const exportButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-export-diagnostic]"))) {
    exportButton.addEventListener("click", triggerDiagnosticSnapshotExport);
  }
}

async function bootstrap(): Promise<void> {
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
}

async function syncPlayerAccountProfile(): Promise<void> {
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
  if (state.replayDetail.selectedReplayId && !account.recentBattleReplays.some((replay) => replay.id === state.replayDetail.selectedReplayId)) {
    clearReplayDetail("最近战报已刷新，当前选中的回放已不可用。");
  }
  state.accountSessionsLoading = false;
  render();
}

async function onRevokeAccountSession(sessionId: string): Promise<void> {
  state.accountSessionRevokingId = sessionId;
  state.accountStatus = "正在撤销所选设备会话...";
  render();

  try {
    state.accountSessions = await revokePlayerAccountSession(sessionId);
    state.accountSessionRevokingId = null;
    state.accountStatus = "已撤销所选设备会话，旧刷新令牌现已失效。";
    render();
  } catch (error) {
    state.accountSessionRevokingId = null;
    state.accountStatus = error instanceof Error ? error.message : "account_session_revoke_failed";
    render();
  }
}

async function onSaveAccountProfile(): Promise<void> {
  const nextDisplayName = state.accountDraftName.trim() || playerId;
  state.accountSaving = true;
  state.accountStatus = "正在保存昵称...";
  render();

  const account = await saveAccountDisplayName(playerId, roomId, nextDisplayName);
  state.account = account;
  state.accountDraftName = account.displayName;
  state.accountSaving = false;
  state.accountStatus =
    account.source === "remote"
      ? account.loginId
        ? `昵称已同步到服务端账号，全局仓库仍归属于 ${account.loginId}。`
        : "昵称已同步到服务端账号。"
      : "服务器不可用，昵称已保存到本地浏览器。";
  state.log.unshift(`账号昵称已更新为 ${account.displayName}`);
  state.log = state.log.slice(0, 12);
  render();
}

async function onBindAccountProfile(): Promise<void> {
  const loginId = (state.account.loginId ?? state.accountLoginId).trim().toLowerCase();
  if (!loginId) {
    state.accountStatus = "请输入登录 ID 后再绑定账号。";
    render();
    return;
  }

  if (!state.accountPassword.trim()) {
    state.accountStatus = state.account.loginId ? "请输入新口令后再更新。" : "请输入账号口令后再绑定。";
    render();
    return;
  }

  state.accountBinding = true;
  state.accountStatus = state.account.loginId ? "正在更新账号口令..." : "正在绑定口令账号...";
  render();

  try {
    const account = await bindAccountCredentials(loginId, state.accountPassword, roomId);
    state.account = account;
    state.accountSessions = await loadPlayerAccountSessions();
    state.accountLoginId = account.loginId ?? loginId;
    state.accountPassword = "";
    state.accountBinding = false;
    state.lobby.authSession = readStoredAuthSession();
    state.lobby.loginId = state.accountLoginId;
    state.accountStatus = account.loginId
      ? `口令账号已就绪，后续可用 ${account.loginId} 直接登录同一套英雄档与全局仓库。`
      : "账号绑定已完成。";
    state.log.unshift(`账号已绑定登录 ID ${account.loginId ?? loginId}`);
    state.log = state.log.slice(0, 12);
    render();
  } catch (error) {
    state.accountBinding = false;
    state.accountStatus =
      error instanceof Error && error.message === "player_account_request_failed:401"
        ? "当前会话已失效，请重新登录后再绑定账号。"
        : error instanceof Error
          ? error.message
          : "account_bind_failed";
    render();
  }
}

void bootstrap();
window.render_game_to_text = renderGameToText;
if (DEV_DIAGNOSTICS_ENABLED) {
  window.export_diagnostic_snapshot = exportDiagnosticSnapshot;
}
window.advanceTime = advanceUiTime;
