export { _decorator, Camera, Canvas, Color, Component, EventMouse, EventTouch, Graphics, input, Input, Label, Layers, Node, sys, UITransform, view } from "cc";
export { getBuildingUpgradeConfig, getEquipmentDefinition, type EquipmentType } from "../project-shared/index.ts";
export {
  type BattleAction,
  type LeaderboardEntry,
  type MatchmakingStatusResponse,
  type PlayerReportReason,
  VeilCocosSession,
  type VeilCocosSessionOptions,
  type ConnectionEvent,
  type HeroView,
  type PlayerTileView,
  type SessionUpdate,
  type Vec2
} from "../VeilCocosSession.ts";
export { createCocosAccountReviewState, transitionCocosAccountReviewState, type CocosAccountReviewSection, type CocosAccountReviewState } from "../cocos-account-review.ts";
export {
  loadCocosCampaignSummary,
  claimCocosDailyQuest,
  claimAllCocosMailboxMessages,
  claimCocosMailboxMessage,
  submitCocosSupportTicket,
  type CocosCampaignSummary,
  type CocosLaunchAnnouncement,
  type CocosMaintenanceModeSnapshot,
  confirmCocosAccountRegistration,
  confirmCocosPasswordRecovery,
  createFallbackCocosPlayerAccountProfile,
  deleteCurrentCocosPlayerAccount,
  createCocosGuestPlayerId,
  loadCocosAnnouncements,
  loadCocosBattleReplayHistoryPage,
  createCocosLobbyPreferences,
  loadCocosLobbyRooms,
  loadCocosMaintenanceMode,
  loadCocosPlayerAccountProfile,
  loadCocosPlayerAchievementProgress,
  loadCocosPlayerEventHistory,
  loadCocosPlayerProgressionSnapshot,
  loginCocosGuestAuthSession,
  loginCocosWechatAuthSession,
  logoutCurrentCocosAuthSession,
  postCocosPlayerReferral,
  readPreferredCocosDisplayName,
  rememberPreferredCocosDisplayName,
  requestCocosWechatSubscribeConsent,
  requestCocosAccountRegistration,
  requestCocosPasswordRecovery,
  resolveCocosConfigCenterUrl,
  saveCocosLobbyPreferences,
  submitCocosSeasonalEventProgress,
  syncCurrentCocosAuthSession,
  updateCocosTutorialProgress,
  type CocosLobbyRoomSummary,
  type CocosPlayerAccountProfile,
  type CocosSeasonalEvent
} from "../cocos-lobby.ts";
export {
  loginWithCocosProvider,
  resolveCocosLoginProviders,
  resolveCocosLoginRuntimeConfig,
  type CocosLoginProviderDescriptor,
  type CocosLoginRuntimeConfig
} from "../cocos-login-provider.ts";
export { predictPlayerWorldAction as predictSharedPlayerWorldAction } from "../project-shared/map.ts";
export { type CocosWorldAction, predictPlayerWorldAction } from "../cocos-prediction.ts";
export { VeilBattleTransition } from "../VeilBattleTransition.ts";
export { VeilBattlePanel } from "../VeilBattlePanel.ts";
export { assignUiLayer } from "../cocos-ui-layer.ts";
export {
  buildTimelineEntriesFromUpdate,
  describeMoveAttemptFeedback,
  describeSessionActionOutcome,
  formatSessionActionReason,
  formatSessionSettlementReason,
  isSessionSettlementReason
} from "../cocos-ui-formatters.ts";
export { buildHeroProgressNotice, type HeroProgressNotice } from "../cocos-hero-progression.ts";
export { VeilHudPanel, type VeilHudRenderState } from "../VeilHudPanel.ts";
export { VeilLobbyPanel } from "../VeilLobbyPanel.ts";
export {
  startCocosMatchmakingStatusPolling,
  type CocosMatchmakingPollController
} from "../cocos-matchmaking.ts";
export {
  buildMatchmakingStatusView,
  type MatchmakingStatusView
} from "../cocos-matchmaking-status.ts";
export {
  buildCocosAccountLifecyclePanelView,
  type CocosAccountLifecycleDeliveryMode,
  type CocosAccountLifecycleDraft,
  type CocosAccountLifecycleKind,
  type CocosAccountLifecyclePanelView
} from "../cocos-account-lifecycle.ts";
export {
  buildCocosAccountRegistrationPanelView,
  type CocosAccountRegistrationPanelView,
  type CocosWechatMinorProtectionSelection
} from "../cocos-account-registration.ts";
export { VeilMapBoard } from "../VeilMapBoard.ts";
export { buildMapFeedbackEntriesFromUpdate, buildObjectPulseEntriesFromUpdate } from "../cocos-map-visuals.ts";
export { getPlaceholderSpriteAssetUsageSummary } from "../cocos-placeholder-sprites.ts";
export {
  detectCocosRuntimePlatform,
  readCocosRuntimeLaunchSearch,
  resolveCocosRuntimeCapabilities,
  type CocosRuntimeCapabilities,
  type CocosRuntimePlatform
} from "../cocos-runtime-platform.ts";
export {
  bindCocosRuntimeMemoryWarning,
  formatCocosRuntimeMemoryStatus,
  readCocosRuntimeMemorySnapshot,
  triggerCocosRuntimeGc
} from "../cocos-runtime-memory.ts";
export {
  buildCocosProfileNotice,
  collectProfileNoticeEventIds,
  shouldRefreshGameplayAccountProfileForEvents
} from "../cocos-achievements.ts";
export {
  readLaunchReferrerId,
  shareBattleResultForRuntime,
  shouldOfferBattleResultShare,
  type WechatSharePayload
} from "../cocos-share-card.ts";
export {
  buildCocosWechatSharePayload,
  syncCocosWechatShareBridge,
  type CocosWechatShareRuntimeLike
} from "../cocos-wechat-share.ts";
export {
  readCocosWechatFriendCloudEntries,
  syncCocosWechatFriendCloudStorage
} from "../cocos-wechat-social.ts";
export {
  clearStoredCocosAuthSession,
  readStoredCocosAuthSession,
  resolveCocosLaunchIdentity,
  type CocosAuthProvider
} from "../cocos-session-launch.ts";
export { type ShopProduct } from "../cocos-shop-panel.ts";
export { resolveCocosClientVersion } from "../cocos-client-version.ts";
export {
  type CocosDailyDungeonSummary,
  type CocosSeasonProgress
} from "../cocos-progression-panel.ts";
export { VeilTimelinePanel } from "../VeilTimelinePanel.ts";
export { VeilProgressionPanel } from "../VeilProgressionPanel.ts";
export { VeilEquipmentPanel } from "../VeilEquipmentPanel.ts";
export { VeilCampaignPanel } from "../VeilCampaignPanel.ts";
export { VeilTutorialOverlay, type TutorialOverlayView } from "../VeilTutorialOverlay.ts";
export { formatEquipmentActionReason, formatEquipmentSlotLabel } from "../cocos-hero-equipment.ts";
export { type CocosBattleFeedbackView } from "../cocos-battle-feedback.ts";
export {
  createCocosBattlePresentationController,
  type CocosBattlePresentationState
} from "../cocos-battle-presentation-controller.ts";
export { createCocosAudioRuntime } from "../cocos-audio-runtime.ts";
export {
  setAssetLoadFailureReporter,
  subscribeAssetLoadFailures,
  type AssetLoadFailureEvent
} from "../cocos-asset-load-resilience.ts";
export { createCocosAudioAssetBridge } from "../cocos-audio-resources.ts";
export {
  CocosSettingsPanel
} from "../cocos-settings-panel.ts";
export {
  applySettingsUpdate,
  createDefaultCocosSettingsView,
  readPersistedCocosSettings,
  resolveCocosPrivacyPolicyUrl,
  writePersistedCocosSettings,
  type CocosSettingsPanelUpdate,
  type CocosSettingsPanelView
} from "../cocos-settings-panel-model.ts";
export { cocosPresentationConfig } from "../cocos-presentation-config.ts";
export { getPixelSpriteLoadStatus, loadPixelSpriteAssets } from "../cocos-pixel-sprites.ts";
export { type CocosCampaignDialogueState } from "../cocos-campaign-panel.ts";
export {
  buildPrimaryClientTelemetryFromUpdate,
  createPrimaryClientTelemetryEvent,
  type ClientAnalyticsContext
} from "../cocos-primary-client-telemetry.ts";
export {
  createClientPerfTelemetryMonitorState,
  evaluateClientPerfTelemetry,
  readClientPerfRuntimeMetadata,
  recordClientPerfFrame,
  type ClientPerfRuntimeMetadata
} from "../cocos-client-perf-telemetry.ts";
export { describeAccountAuthFailure, type PrimaryClientTelemetryEvent, type RuntimeDiagnosticsConnectionStatus, type StructuredErrorCode, validateAccountLifecycleConfirm, validateAccountLifecycleRequest, validateAccountPassword, validatePrivacyConsentAccepted } from "@veil/shared/platform";
export type { TutorialProgressAction } from "@veil/shared/protocol";
export {
  createCocosWechatPaymentOrder,
  requestCocosWechatPayment,
  verifyCocosWechatPayment,
  type CocosWechatPaymentRuntimeLike
} from "../cocos-wechat-payment.ts";
export { normalizeTutorialStep } from "@veil/shared/progression";
