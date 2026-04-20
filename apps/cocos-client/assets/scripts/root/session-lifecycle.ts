import type { VeilCocosSession, VeilCocosSessionOptions } from "../VeilCocosSession.ts";
import { createCocosLobbyPreferences, createFallbackCocosPlayerAccountProfile, readPreferredCocosDisplayName } from "../cocos-lobby.ts";
import { resolveCocosClientVersion } from "../cocos-client-version.ts";
import { readStoredCocosAuthSession, resolveCocosLaunchIdentity } from "../cocos-session-launch.ts";
import { formatSessionActionReason } from "../cocos-ui-formatters.ts";
import { readLaunchReferrerId } from "../cocos-share-card.ts";
import { FORCE_UPGRADE_MESSAGE } from "./constants";
import { resolveVeilRootRuntime } from "./runtime";

type VeilRootSessionLifecycleState = any;

export function disposeCurrentSessionForRoot(
  state: VeilRootSessionLifecycleState
): Promise<void> {
  bumpSessionEpochForRoot(state);
  state.stopMatchmakingPolling();
  const currentSession = state.session;
  state.session = null;
  if (currentSession) {
    return currentSession.dispose().catch(() => undefined);
  }
  return Promise.resolve();
}

export function resetSessionViewportForRoot(
  state: VeilRootSessionLifecycleState,
  logLine: string
): void {
  state.lastUpdate = null;
  state.pendingPrediction = null;
  state.selectedBattleTargetId = null;
  state.moveInFlight = false;
  state.battleActionInFlight = false;
  state.battleFeedback = null;
  state.battlePresentation.reset();
  state.predictionStatus = "";
  state.inputDebug = "input waiting";
  state.timelineEntries = [];
  state.primaryClientTelemetry = [];
  state.logLines = [logLine];
}

export async function handleForcedUpgradeForRoot(
  state: VeilRootSessionLifecycleState,
  failureMessage: string
): Promise<void> {
  state.upgradeRequired = true;
  state.showLobby = true;
  state.lobbyStatus = failureMessage;
  resetSessionViewportForRoot(state, failureMessage);
  state.predictionStatus = failureMessage;
  const currentSession = state.session;
  state.session = null;
  if (currentSession) {
    await currentSession.dispose().catch(() => undefined);
  }
}

export function describeSessionErrorForRoot(
  error: unknown,
  fallback: string
): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  if (error.message.endsWith("_timeout")) {
    return "房间请求超时，请检查本地开发服务。";
  }

  if (error.message === "connect_failed" || error.message === "connect_timeout") {
    return "房间连接失败，请检查本地开发服务。";
  }

  if (error.message === "room_left" || error.message === "session_unavailable") {
    return "房间会话已失效，请点击刷新状态恢复。";
  }

  if (error.message === "upgrade_required") {
    return FORCE_UPGRADE_MESSAGE;
  }

  if (
    error.message === "unsupported_player_world_view_encoding" ||
    error.message === "invalid_player_world_view_encoding_length" ||
    error.message === "missing_player_world_view_base"
  ) {
    return "房间状态损坏，请重建房间或检查服务端同步。";
  }

  const formattedReason = formatSessionActionReason(error.message);
  if (formattedReason !== error.message) {
    return formattedReason;
  }

  return error.message || fallback;
}

export function bumpSessionEpochForRoot(state: VeilRootSessionLifecycleState): number {
  state.sessionEpoch += 1;
  return state.sessionEpoch;
}

export function bumpLobbyAccountEpochForRoot(state: VeilRootSessionLifecycleState): number {
  state.lobbyAccountEpoch += 1;
  return state.lobbyAccountEpoch;
}

export function isActiveSessionEpochForRoot(
  state: VeilRootSessionLifecycleState,
  epoch: number
): boolean {
  return epoch === state.sessionEpoch;
}

export function isActiveLobbyAccountEpochForRoot(
  state: VeilRootSessionLifecycleState,
  epoch: number
): boolean {
  return epoch === state.lobbyAccountEpoch;
}

export function createSessionOptionsForRoot(
  state: VeilRootSessionLifecycleState,
  epoch: number
): VeilCocosSessionOptions {
  return {
    remoteUrl: state.remoteUrl,
    getDisplayName: () => state.displayName || state.playerId,
    getAuthToken: () => state.authToken,
    getClientVersion: () => resolveCocosClientVersion(),
    getClientChannel: () => (state.runtimePlatform === "wechat-game" ? "wechat" : "h5"),
    onPushUpdate: (update) => {
      if (!isActiveSessionEpochForRoot(state, epoch)) {
        return;
      }

      state.pushLog("已收到房间推送更新。");
      void state.applySessionUpdate(update);
    },
    onServerMessage: (message) => {
      if (!isActiveSessionEpochForRoot(state, epoch)) {
        return;
      }

      if (message.type === "COSMETIC_APPLIED") {
        state.pushLog(
          message.action === "emote"
            ? `战斗表情：${message.playerId} 使用了 ${message.cosmeticId}`
            : `外观同步：${message.playerId} ${message.action === "equipped" ? "装备" : "解锁"} ${message.cosmeticId}`
        );
        if (message.playerId === state.playerId && message.equippedCosmetics) {
          state.lobbyAccountProfile = {
            ...state.lobbyAccountProfile,
            equippedCosmetics: {
              ...state.lobbyAccountProfile.equippedCosmetics,
              ...message.equippedCosmetics
            }
          };
        }
        state.renderView();
        return;
      }

      if (message.type === "event.progress.update") {
        state.pushLog(`赛季活动推进：${message.payload.objectiveId} +${message.payload.delta} 分`);
        state.handleSeasonalEventProgressPush(message);
      }
    },
    onConnectionEvent: (event) => {
      if (!isActiveSessionEpochForRoot(state, epoch)) {
        return;
      }

      state.handleConnectionEvent(event);
    }
  };
}

export function hydrateLaunchIdentityForRoot(
  state: VeilRootSessionLifecycleState
): void {
  state.stopMatchmakingPolling();
  state.updateMatchmakingStatus({ status: "idle" });
  const storage = state.readWebStorage();
  const launchIdentity = resolveCocosLaunchIdentity({
    defaultRoomId: state.roomId,
    defaultPlayerId: state.playerId,
    defaultDisplayName: state.displayName,
    search: state.readLaunchSearch(),
    storedSession: readStoredCocosAuthSession(storage)
  });
  state.launchReferrerId = readLaunchReferrerId(state.readLaunchSearch());

  if (launchIdentity.shouldOpenLobby) {
    const storedSession = readStoredCocosAuthSession(storage);
    const lobbyPreferences = createCocosLobbyPreferences(
      {
        ...(storedSession?.playerId ? { playerId: storedSession.playerId } : {}),
        ...(state.roomId !== "test-room" ? { roomId: state.roomId } : {})
      },
      undefined,
      storage
    );
    state.roomId = lobbyPreferences.roomId;
    const resolvedPlayerId = storedSession?.playerId ?? lobbyPreferences.playerId;
    const reusesStoredSession = storedSession?.playerId === resolvedPlayerId;
    state.playerId = resolvedPlayerId;
    state.displayName =
      reusesStoredSession && storedSession
        ? storedSession.displayName
        : readPreferredCocosDisplayName(state.playerId, storage);
    state.authToken = reusesStoredSession && storedSession ? storedSession.token ?? null : null;
    state.authMode = reusesStoredSession && storedSession ? storedSession.authMode : "guest";
    state.authProvider = reusesStoredSession && storedSession ? storedSession.provider ?? "guest" : "guest";
    state.loginId = reusesStoredSession && storedSession ? storedSession.loginId ?? "" : "";
    state.sessionSource = reusesStoredSession && storedSession ? storedSession.source : "none";
    state.commitAccountProfile(
      createFallbackCocosPlayerAccountProfile(state.playerId, state.roomId, state.displayName),
      false
    );
    state.showLobby = true;
    state.autoConnect = false;
    state.lobbyStatus = storedSession
      ? `已恢复${storedSession.source === "remote" ? "云端" : "本地"}${storedSession.authMode === "account" ? "正式账号" : "游客"}会话，可直接选房或继续修改房间。`
      : state.runtimePlatform === "wechat-game"
        ? "微信小游戏启动参数适配已就绪；当前仍走游客/账号会话，后续可在此处接入 wx.login()。"
        : "请选择一个房间，或输入新的房间 ID 后直接开局。";
      state.pushLog("Cocos Lobby 已待命。");
      return;
    }

  state.roomId = launchIdentity.roomId;
  state.playerId = launchIdentity.playerId;
  state.displayName = launchIdentity.displayName;
  state.authMode = launchIdentity.authMode;
  state.authProvider = launchIdentity.authProvider;
  state.loginId = launchIdentity.loginId ?? "";
  state.authToken = launchIdentity.authToken;
  state.sessionSource = launchIdentity.sessionSource;
  state.commitAccountProfile(
    createFallbackCocosPlayerAccountProfile(state.playerId, state.roomId, state.displayName),
    false
  );

  if (launchIdentity.usedStoredSession) {
    state.pushLog(
      `已复用${launchIdentity.sessionSource === "remote" ? "云端" : "本地"}${launchIdentity.authMode === "account" ? "正式账号" : "游客"}会话 ${launchIdentity.playerId}。`
    );
    return;
  }

  if (launchIdentity.roomId !== "test-room") {
    state.pushLog(`已从启动参数载入房间 ${launchIdentity.roomId}。`);
  }
}

export async function connectSessionForRoot(
  state: VeilRootSessionLifecycleState
): Promise<void> {
  if (state.session) {
    state.pushLog("当前房间已经连接。");
    state.renderView();
    return;
  }

  state.diagnosticsConnectionStatus = "connecting";
  state.pushLog(`正在连接 ${state.remoteUrl} ...`);
  const replayed = resolveVeilRootRuntime().readStoredReplay(state.roomId, state.playerId);
  if (replayed) {
    state.applyReplayedSessionUpdate(replayed);
    state.pushLog("已回放本地缓存，等待房间实时同步。");
  }
  state.renderView();

  const sessionEpoch = bumpSessionEpochForRoot(state);
  state.upgradeRequired = false;
  let nextSession: VeilCocosSession | null = null;
  try {
    nextSession = await resolveVeilRootRuntime().createSession(
      state.roomId,
      state.playerId,
      state.seed,
      createSessionOptionsForRoot(state, sessionEpoch)
    );
    if (!isActiveSessionEpochForRoot(state, sessionEpoch)) {
      await nextSession.dispose().catch(() => undefined);
      return;
    }

    state.session = nextSession;
    state.trackClientAnalyticsEvent("session_start", {
      roomId: state.roomId,
      authMode: state.authMode,
      platform: "wechat"
    });
    state.lastUpdate = await nextSession.snapshot();
    if (!isActiveSessionEpochForRoot(state, sessionEpoch)) {
      await nextSession.dispose().catch(() => undefined);
      return;
    }

    state.pushLog("房间快照已加载，点击地块即可移动。");
    await state.applySessionUpdate(state.lastUpdate);
    if (state.sessionSource === "remote") {
      void state.refreshGameplayAccountProfile();
    }
  } catch (error) {
    state.maybeReportSessionRuntimeError(error, "connect");
    if (!isActiveSessionEpochForRoot(state, sessionEpoch)) {
      if (nextSession) {
        await nextSession.dispose().catch(() => undefined);
      }
      return;
    }

    const failureMessage = describeSessionErrorForRoot(error, "连接房间失败。");
    state.pushLog(failureMessage);
    state.predictionStatus = failureMessage;
    if (error instanceof Error && error.message === "upgrade_required") {
      await handleForcedUpgradeForRoot(state, failureMessage);
    }
    if (state.session) {
      await state.session.dispose().catch(() => undefined);
      state.session = null;
    }
    state.renderView();
  }
}

export async function refreshSnapshotForRoot(
  state: VeilRootSessionLifecycleState
): Promise<void> {
  if (!state.session) {
    await connectSessionForRoot(state);
    return;
  }

  try {
    await state.applySessionUpdate(await state.session.snapshot());
    state.pushLog("房间快照已刷新。");
    state.renderView();
  } catch (error) {
    state.maybeReportSessionRuntimeError(error, "refresh_snapshot");
    const failureMessage = describeSessionErrorForRoot(error, "Snapshot refresh failed.");
    if (error instanceof Error && error.message === "upgrade_required") {
      await handleForcedUpgradeForRoot(state, failureMessage);
      state.renderView();
      return;
    }
    state.pushLog(failureMessage);
    state.predictionStatus = failureMessage;
    state.renderView();
  }
}
