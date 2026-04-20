import { getRuntimeConfigBundleForRoom } from "../project-shared/index.ts";
import { buildCocosAccountReviewPage } from "../cocos-account-review.ts";
import type { CocosBattleFeedbackView } from "../cocos-battle-feedback.ts";
import { buildLobbySkillPanelView, toLobbySkillPanelHeroState } from "../cocos-lobby-skill-panel.ts";
import { buildCocosRuntimeTriageSummaryLines } from "../cocos-runtime-diagnostics.ts";
import { buildCocosShopPanelView } from "../cocos-shop-panel.ts";
import { buildCocosWorldFocusView } from "../cocos-world-focus.ts";
import { cocosPresentationReadiness } from "../cocos-presentation-readiness.ts";
import { getPixelSpriteLoadStatus } from "../cocos-pixel-sprites.ts";
import type { VeilHudRenderState } from "../VeilHudPanel.ts";
import {
  ACCOUNT_REVIEW_PANEL_NODE_NAME,
  BATTLE_NODE_NAME,
  CAMPAIGN_PANEL_NODE_NAME,
  EQUIPMENT_PANEL_NODE_NAME,
  HUD_NODE_NAME,
  LOBBY_NODE_NAME,
  MAP_NODE_NAME,
  SETTINGS_BUTTON_NODE_NAME,
  SETTINGS_PANEL_NODE_NAME,
  TIMELINE_NODE_NAME,
  TUTORIAL_OVERLAY_NODE_NAME
} from "./constants";

type VeilRootRenderState = any;

function expireTransientNoticesForRoot(state: VeilRootRenderState): void {
  if (state.levelUpNotice && state.levelUpNotice.expiresAt <= Date.now()) {
    state.levelUpNotice = null;
  }
  if (state.achievementNotice && state.achievementNotice.expiresAt <= Date.now()) {
    state.achievementNotice = null;
  }
  if (state.battleFeedback && state.battleFeedback.expiresAt <= Date.now()) {
    state.battleFeedback = null;
  }
}

export function buildBattleSettlementRecoveryStateForRoot(
  state: VeilRootRenderState
): {
  title: string;
  detail: string;
  badge: string;
  tone: CocosBattleFeedbackView["tone"];
  summaryLines: string[];
} | null {
  if (!state.lastBattleSettlementSnapshot || state.lastUpdate?.battle) {
    return null;
  }

  const recoverySummaryLines = [
    `最近结算：${state.lastBattleSettlementSnapshot.label}`,
    ...state.lastBattleSettlementSnapshot.summaryLines
  ];

  if (state.diagnosticsConnectionStatus === "reconnecting") {
    return {
      title: "结算恢复中",
      detail: "已保留最近一次结算摘要，正在等待权威房间确认奖励、战利品与英雄同步；不会重复发放奖励。",
      badge: "RECOVER",
      tone: "neutral",
      summaryLines: recoverySummaryLines
    };
  }

  if (state.lastRoomUpdateSource === "replay" && state.lastRoomUpdateReason === "cached_snapshot") {
    return {
      title: "结算快照回放中",
      detail: "当前面板正在展示本地缓存的结算快照，等待服务端权威状态完成覆盖。",
      badge: "REPLAY",
      tone: "neutral",
      summaryLines: recoverySummaryLines
    };
  }

  if (state.diagnosticsConnectionStatus === "reconnect_failed") {
    return {
      title: "结算快照回补中",
      detail: "重连失败后已转入快照回补；当前结算摘要仅作恢复提示，最终奖励与装备状态仍以服务端快照为准。",
      badge: "FALLBACK",
      tone: "neutral",
      summaryLines: recoverySummaryLines
    };
  }

  if (state.lastUpdate?.reason?.includes("reconnect.restore")) {
    return {
      title: "结算已恢复",
      detail: "权威房间已恢复，以下结算摘要与战后状态已重新对齐到服务端快照。",
      badge: "RESUMED",
      tone: "victory",
      summaryLines: recoverySummaryLines
    };
  }

  return null;
}

export function buildHudSessionIndicatorsForRoot(
  state: VeilRootRenderState
): VeilHudRenderState["sessionIndicators"] {
  const indicators: VeilHudRenderState["sessionIndicators"] = [];
  const replayingCachedSnapshot =
    state.lastRoomUpdateSource === "replay" && state.lastRoomUpdateReason === "cached_snapshot";
  const activePvpBattle = state.lastUpdate?.battle?.defenderHeroId
    ? {
        sessionId: `${state.lastUpdate.world.meta.roomId}/${state.lastUpdate.battle.id}`
      }
    : null;

  if (state.diagnosticsConnectionStatus === "reconnecting") {
    indicators.push({
      kind: "reconnecting",
      label: activePvpBattle ? "PVP 重连中" : "重连中",
      detail: activePvpBattle
        ? `正在恢复 ${activePvpBattle.sessionId} 的对手归属、当前回合与权威房间状态。`
        : "正在尝试恢复与权威房间的连接。"
    });
  }

  if (replayingCachedSnapshot) {
    indicators.push({
      kind: "replaying_cached_snapshot",
      label: "缓存快照回放",
      detail: "当前 HUD 正在展示本地缓存的上一份会话快照。"
    });
    indicators.push({
      kind: "awaiting_authoritative_resync",
      label: "等待权威重同步",
      detail: "请等待服务端权威快照覆盖当前回放状态。"
    });
  }

  if (state.diagnosticsConnectionStatus === "reconnect_failed") {
    indicators.push({
      kind: "degraded_offline_fallback",
      label: activePvpBattle ? "PVP 快照回补" : "降级/离线回退",
      detail: activePvpBattle
        ? `最近一次 ${activePvpBattle.sessionId} 重连失败，客户端正依赖回退路径恢复当前对抗结果。`
        : "最近一次重连失败，客户端正依赖回退路径维持会话。"
    });
  }

  return indicators;
}

export function buildHudPresentationStateForRoot(
  state: VeilRootRenderState
): VeilHudRenderState["presentation"] {
  return {
    audio: state.audioRuntime.getState(),
    pixelAssets: getPixelSpriteLoadStatus(),
    readiness: cocosPresentationReadiness
  };
}

export function renderViewForRoot(state: VeilRootRenderState): void {
  expireTransientNoticesForRoot(state);

  state.ensurePixelSpriteGroup("boot");
  if (state.lastUpdate?.battle) {
    state.ensurePixelSpriteGroup("battle");
  }

  state.syncMusicScene();
  state.updateLayout();

  const lobbyNode = state.node.getChildByName(LOBBY_NODE_NAME);
  const hudNode = state.node.getChildByName(HUD_NODE_NAME);
  const mapNode = state.node.getChildByName(MAP_NODE_NAME);
  const battleNode = state.node.getChildByName(BATTLE_NODE_NAME);
  const timelineNode = state.node.getChildByName(TIMELINE_NODE_NAME);
  const tutorialOverlayNode = state.node.getChildByName(TUTORIAL_OVERLAY_NODE_NAME);
  const accountReviewPanelNode = state.node.getChildByName(ACCOUNT_REVIEW_PANEL_NODE_NAME);
  const equipmentPanelNode = state.node.getChildByName(EQUIPMENT_PANEL_NODE_NAME);
  const campaignPanelNode = state.node.getChildByName(CAMPAIGN_PANEL_NODE_NAME);
  const settingsPanelNode = state.node.getChildByName(SETTINGS_PANEL_NODE_NAME);
  const settingsButtonNode = state.node.getChildByName(SETTINGS_BUTTON_NODE_NAME);
  const showingGame = !state.showLobby;

  if (lobbyNode) {
    lobbyNode.active = state.showLobby;
  }
  if (hudNode) {
    hudNode.active = showingGame;
  }
  if (mapNode) {
    mapNode.active = showingGame;
  }
  if (battleNode) {
    battleNode.active = showingGame;
  }
  if (timelineNode) {
    timelineNode.active = showingGame;
  }
  if (accountReviewPanelNode) {
    accountReviewPanelNode.active = showingGame && (
      state.gameplayAccountReviewPanelOpen
      || state.gameplayBattlePassPanelOpen
      || state.gameplayDailyDungeonPanelOpen
      || state.gameplaySeasonalEventPanelOpen
    );
  }
  if (equipmentPanelNode) {
    equipmentPanelNode.active = showingGame && state.gameplayEquipmentPanelOpen;
  }
  if (campaignPanelNode) {
    campaignPanelNode.active = state.gameplayCampaignPanelOpen;
  }
  if (settingsPanelNode) {
    settingsPanelNode.active = state.settingsView.open;
  }
  if (settingsButtonNode) {
    settingsButtonNode.active = true;
  }
  if (tutorialOverlayNode) {
    tutorialOverlayNode.active = false;
  }

  if (state.showLobby) {
    const activeHero = state.activeHero();
    const runtimeBundle = state.lastUpdate
      ? getRuntimeConfigBundleForRoom(state.lastUpdate.world.meta.roomId, state.lastUpdate.world.meta.seed)
      : null;
    state.lobbyPanel?.render({
      playerId: state.playerId,
      displayName: state.displayName || state.playerId,
      roomId: state.roomId,
      authMode: state.authMode,
      loginId: state.loginId,
      privacyConsentAccepted: state.privacyConsentAccepted,
      loginHint: state.describeLobbyLoginHint(),
      loginActionLabel: state.primaryLoginProvider().label,
      shareHint: state.describeLobbyShareHint(),
      vaultSummary: state.formatLobbyVaultSummary(),
      account: state.lobbyAccountProfile,
      campaign: state.gameplayCampaign,
      campaignStatus: state.gameplayCampaignStatus,
      dailyDungeon: state.dailyDungeonSummary,
      dailyDungeonStatus: state.dailyDungeonStatus,
      accountReview: buildCocosAccountReviewPage(state.lobbyAccountReviewState),
      battleReplayItems: state.lobbyAccountReviewState.battleReplays.items,
      battleReplaySectionStatus: state.lobbyAccountReviewState.battleReplays.status,
      battleReplaySectionError: state.lobbyAccountReviewState.battleReplays.errorMessage,
      selectedBattleReplayId: state.lobbyAccountReviewState.selectedBattleReplayId,
      leaderboardEntries: state.lobbyLeaderboardEntries,
      leaderboardStatus: state.lobbyLeaderboardStatus,
      leaderboardError: state.lobbyLeaderboardError,
      sessionSource: state.sessionSource,
      loading: state.lobbyLoading,
      entering: state.lobbyEntering,
      status: state.lobbyStatus,
      announcements: state.lobbyAnnouncements,
      maintenanceMode: state.lobbyMaintenanceMode,
      matchmaking: state.matchmakingView,
      matchmakingSearching: state.isMatchmakingActive(),
      matchmakingBusy: state.lobbyEntering || state.matchmakingJoinInFlight,
      rooms: state.lobbyRooms,
      accountFlow: state.buildActiveAccountFlowPanelView(),
      presentationReadiness: cocosPresentationReadiness,
      activeHero,
      lobbySkillPanel: activeHero && runtimeBundle
        ? buildLobbySkillPanelView(toLobbySkillPanelHeroState(activeHero), runtimeBundle)
        : null,
      battleActive: Boolean(state.lastUpdate?.battle),
      skillPanelBusy: state.moveInFlight || state.battleActionInFlight,
      shop: buildCocosShopPanelView({
        products: state.lobbyShopProducts,
        gemBalance: state.lobbyAccountProfile.gems ?? 0,
        pendingProductId: state.pendingShopProductId,
        experiments: state.lobbyAccountProfile.experiments ?? [],
        ownedCosmeticIds: state.lobbyAccountProfile.cosmeticInventory?.ownedIds ?? [],
        seasonPassPremiumOwned: state.lobbyAccountProfile.seasonPassPremium === true,
        ...(state.lobbyAccountProfile.equippedCosmetics
          ? { equippedCosmetics: state.lobbyAccountProfile.equippedCosmetics }
          : {})
      }),
      shopStatus: state.lobbyShopStatus,
      shopLoading: state.lobbyShopLoading,
      seasonProgress: state.seasonProgress,
      activeSeasonalEvent: state.activeSeasonalEvent,
      dailyQuestClaimingId: state.dailyQuestClaimingId,
      mailboxClaimingMessageId: state.mailboxClaimingMessageId,
      mailboxClaimAllBusy: state.mailboxClaimAllInFlight
    });
    const tutorialOverlayView = state.buildTutorialOverlayView();
    if (tutorialOverlayView) {
      tutorialOverlayNode && (tutorialOverlayNode.active = true);
      state.tutorialOverlay?.render(tutorialOverlayView);
    } else {
      state.tutorialOverlay?.render(null);
    }
    state.renderSettingsOverlay();
    return;
  }

  const hudInteraction = state.buildHudInteractionState();
  state.hudPanel?.render({
    roomId: state.roomId,
    playerId: state.playerId,
    displayName: state.displayName || state.playerId,
    account: state.lobbyAccountProfile,
    authMode: state.authMode,
    loginId: state.loginId,
    sessionSource: state.sessionSource,
    remoteUrl: state.remoteUrl,
    update: state.lastUpdate,
    moveInFlight: state.moveInFlight,
    predictionStatus: state.predictionStatus,
    sessionIndicators: buildHudSessionIndicatorsForRoot(state),
    inputDebug: state.inputDebug,
    runtimeHealth: state.describeRuntimeMemoryHealth(),
    triageSummaryLines: buildCocosRuntimeTriageSummaryLines({
      devOnly: true,
      mode: state.lastUpdate?.battle ? "battle" : "world",
      roomId: state.roomId,
      playerId: state.playerId,
      connectionStatus: state.diagnosticsConnectionStatus,
      lastUpdateSource: state.lastRoomUpdateSource,
      lastUpdateReason: state.lastRoomUpdateReason,
      lastUpdateAt: state.lastRoomUpdateAtMs,
      update: state.lastUpdate,
      account: state.lobbyAccountProfile,
      timelineEntries: state.timelineEntries,
      logLines: state.logLines,
      predictionStatus: state.predictionStatus,
      recoverySummary: state.predictionStatus.includes("回放缓存状态") ? state.predictionStatus : null,
      primaryClientTelemetry: state.primaryClientTelemetry
    }),
    levelUpNotice: state.levelUpNotice
      ? { title: state.levelUpNotice.title, detail: state.levelUpNotice.detail }
      : null,
    achievementNotice: state.achievementNotice
      ? { title: state.achievementNotice.title, detail: state.achievementNotice.detail }
      : null,
    reporting: {
      open: state.reportDialogOpen,
      available: Boolean(state.resolveReportTarget()),
      targetLabel: state.resolveReportTarget()?.name ?? null,
      status: state.reportStatusMessage,
      submitting: state.reportSubmitting
    },
    surrendering: {
      open: state.surrenderDialogOpen,
      available: state.isSurrenderAvailable(),
      targetLabel: state.resolveSurrenderTarget()?.name ?? null,
      status: state.surrenderStatusMessage,
      submitting: state.surrenderSubmitting
    },
    sharing: {
      available: state.canShareLatestBattleResult()
    },
    battlePassEnabled: state.lastUpdate?.featureFlags?.battle_pass_enabled === true,
    seasonalEventAvailable: state.activeSeasonalEvent != null,
    interaction: hudInteraction,
    presentation: buildHudPresentationStateForRoot(state),
    worldFocus: buildCocosWorldFocusView({
      update: state.lastUpdate,
      interaction: hudInteraction,
      predictionStatus: state.predictionStatus,
      levelUpNotice: state.levelUpNotice ? { title: state.levelUpNotice.title, detail: state.levelUpNotice.detail } : null,
      account: state.lobbyAccountProfile
    })
  });
  const tutorialOverlayView = state.buildTutorialOverlayView();
  if (tutorialOverlayView) {
    tutorialOverlayNode && (tutorialOverlayNode.active = true);
    state.tutorialOverlay?.render(tutorialOverlayView);
  } else {
    state.tutorialOverlay?.render(null);
  }
  state.renderSettingsOverlay();
  state.mapBoard?.render(state.lastUpdate);
  state.battlePanel?.render({
    update: state.lastUpdate,
    timelineEntries: state.timelineEntries,
    controlledCamp: state.controlledBattleCamp(),
    selectedTargetId: state.selectedBattleTargetId,
    actionPending: state.battleActionInFlight,
    feedback: state.battleFeedback,
    presentationState: state.battlePresentation.getState(),
    recovery: buildBattleSettlementRecoveryStateForRoot(state),
    connectionStatus: state.diagnosticsConnectionStatus,
    predictionStatus: state.predictionStatus
  });
  state.timelinePanel?.render({
    entries: state.timelineEntries
  });
  state.renderGameplayEquipmentPanel();
  state.renderGameplayCampaignPanel();
  state.renderGameplayAccountReviewPanel();
}
