// @ts-nocheck

import {
  createCocosAccountReviewState
} from "../cocos-account-review.ts";
import { createCocosAudioRuntime } from "../cocos-audio-runtime.ts";
import { createCocosBattlePresentationController } from "../cocos-battle-presentation-controller.ts";
import {
  createFallbackCocosPlayerAccountProfile
} from "../cocos-lobby.ts";
import {
  buildMatchmakingStatusView
} from "../cocos-matchmaking-status.ts";
import { cocosPresentationConfig } from "../cocos-presentation-config.ts";
import { createClientPerfTelemetryMonitorState } from "../cocos-client-perf-telemetry.ts";
import { createDefaultCocosSettingsView } from "../cocos-settings-panel.ts";
import {
  resolveCocosLoginProviders,
  resolveCocosLoginRuntimeConfig
} from "../cocos-login-provider.ts";
import {
  detectCocosRuntimePlatform,
  resolveCocosRuntimeCapabilities
} from "../cocos-runtime-platform.ts";

type VeilRootDefaultState = any;

export function assignVeilRootDefaultState(target: VeilRootDefaultState): void {
  const lobbyAccountProfile = createFallbackCocosPlayerAccountProfile("player-1", "test-room");
  const runtimePlatform = detectCocosRuntimePlatform();
  Object.assign(target, {
    hudPanel: null,
    mapBoard: null,
    battlePanel: null,
    timelinePanel: null,
    lobbyPanel: null,
    battleTransition: null,
    session: null,
    lastUpdate: null,
    logLines: ["Cocos 主客户端已就绪。"],
    timelineEntries: [],
    moveInFlight: false,
    battleActionInFlight: false,
    predictionStatus: "",
    inputDebug: "input waiting",
    pendingPrediction: null,
    selectedBattleTargetId: null,
    selectedInteractionBuildingId: null,
    battleFeedback: null,
    fogPulsePhase: 0,
    hudActionBinding: false,
    sessionEpoch: 0,
    authToken: null,
    authMode: "guest",
    authProvider: "guest",
    loginId: "",
    privacyConsentAccepted: false,
    sessionSource: "none",
    levelUpNotice: null,
    achievementNotice: null,
    showLobby: false,
    lobbyRooms: [],
    lobbyStatus: "请选择一个房间，或手动输入新的房间 ID。",
    lobbyAnnouncements: [],
    lobbyMaintenanceMode: null,
    upgradeRequired: false,
    lobbyLoading: false,
    lobbyEntering: false,
    matchmakingStatus: { status: "idle" },
    matchmakingPollController: null,
    matchmakingTimeoutHandle: null,
    matchmakingTimeoutMs: 120_000,
    matchmakingView: buildMatchmakingStatusView({ status: "idle" }),
    matchmakingJoinInFlight: false,
    lobbyLeaderboardEntries: [],
    lobbyLeaderboardStatus: "idle",
    lobbyLeaderboardError: null,
    lobbyAccountProfile,
    tutorialOverlay: null,
    tutorialProgressInFlight: false,
    lobbyShopProducts: [],
    lobbyShopLoading: false,
    lobbyShopStatus: "可用商品会在这里显示。",
    pendingShopProductId: null,
    seasonProgress: null,
    seasonProgressStatus: "赛季进度待同步。",
    dailyDungeonSummary: null,
    dailyDungeonStatus: "每日地城待同步。",
    dailyDungeonLoading: false,
    pendingDailyDungeonFloor: null,
    pendingDailyDungeonClaimRunId: null,
    activeSeasonalEvent: null,
    seasonalEventStatus: "赛季活动待同步。",
    gameplaySeasonalEventPanelOpen: false,
    pendingSeasonalEventBattleIds: new Set<string>(),
    pendingSeasonClaimTier: null,
    seasonPremiumPurchaseInFlight: false,
    dailyQuestClaimingId: null,
    mailboxClaimingMessageId: null,
    mailboxClaimAllInFlight: false,
    lobbyAccountReviewState: createCocosAccountReviewState(lobbyAccountProfile),
    lobbyAccountEpoch: 0,
    gameplayAccountRefreshInFlight: false,
    gameplayAccountReviewPanel: null,
    gameplayAccountReviewPanelOpen: false,
    gameplayBattlePassPanelOpen: false,
    gameplayDailyDungeonPanelOpen: false,
    gameplayEquipmentPanel: null,
    gameplayEquipmentPanelOpen: false,
    gameplayCampaignPanel: null,
    gameplayCampaignPanelOpen: false,
    gameplayCampaign: null,
    gameplayCampaignSelectedMissionId: null,
    gameplayCampaignActiveMissionId: null,
    gameplayCampaignDialogue: null,
    gameplayCampaignStatus: "战役面板待同步。",
    gameplayCampaignLoading: false,
    gameplayCampaignPendingAction: null,
    settingsPanel: null,
    settingsView: createDefaultCocosSettingsView(),
    supportTicketSubmittingCategory: null,
    activeAccountFlow: null,
    registrationDisplayName: "",
    registrationToken: "",
    registrationPassword: "",
    registrationDeliveryMode: "idle",
    registrationExpiresAt: "",
    wechatMinorProtectionSelection: "unknown",
    recoveryToken: "",
    recoveryPassword: "",
    recoveryDeliveryMode: "idle",
    recoveryExpiresAt: "",
    runtimePlatform,
    runtimeCapabilities: resolveCocosRuntimeCapabilities(runtimePlatform),
    loginRuntimeConfig: resolveCocosLoginRuntimeConfig(),
    loginProviders: resolveCocosLoginProviders({
      platform: runtimePlatform,
      capabilities: resolveCocosRuntimeCapabilities(runtimePlatform),
      config: resolveCocosLoginRuntimeConfig(),
      wx: (globalThis as { wx?: { login?: ((options: unknown) => void) | undefined } }).wx ?? null
    }),
    audioRuntime: createCocosAudioRuntime(cocosPresentationConfig.audio),
    pendingPixelSpriteGroups: new Set<"boot" | "battle">(),
    seenProfileNoticeEventIds: new Set<string>(),
    wechatShareStatus: "分享功能仅在微信小游戏可用。",
    wechatShareAvailable: false,
    runtimeMemoryNotice: "",
    diagnosticsConnectionStatus: "connecting",
    lastRoomUpdateSource: null,
    lastRoomUpdateReason: null,
    lastRoomUpdateAtMs: null,
    primaryClientTelemetry: [],
    analyticsSessionId: null,
    emittedExperimentExposureKeys: new Set<string>(),
    emittedShopOpenSessionId: null,
    clientPerfTelemetry: createClientPerfTelemetryMonitorState(),
    clientPerfRuntimeMetadata: {
      deviceModel: "unknown",
      wechatVersion: "unknown"
    },
    stopRuntimeMemoryWarnings: null,
    stopAssetLoadFailureSubscription: null,
    battlePresentation: createCocosBattlePresentationController(),
    lastBattleSettlementSnapshot: null,
    reportDialogOpen: false,
    reportSubmitting: false,
    reportStatusMessage: null,
    surrenderDialogOpen: false,
    surrenderSubmitting: false,
    surrenderStatusMessage: null,
    launchReferrerId: null,
    lastReferralClaimKey: null,
    lastAssetFailureNoticeKey: null,
    stopGlobalErrorBoundary: null
  });
}
