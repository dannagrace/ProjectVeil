import { _decorator, Camera, Canvas, Color, Component, EventMouse, EventTouch, Graphics, input, Input, Label, Layers, Node, sys, UITransform, view } from "cc";
import { getBuildingUpgradeConfig, getEquipmentDefinition, type EquipmentType } from "./project-shared/index.ts";
import {
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
} from "./VeilCocosSession.ts";
import {
  buildCocosAccountReviewPage,
  createCocosAccountReviewState,
  transitionCocosAccountReviewState,
  type CocosAccountReviewSection,
  type CocosAccountReviewState
} from "./cocos-account-review.ts";
import {
  confirmCocosAccountRegistration,
  confirmCocosPasswordRecovery,
  createFallbackCocosPlayerAccountProfile,
  deleteCurrentCocosPlayerAccount,
  createCocosGuestPlayerId,
  loadCocosBattleReplayHistoryPage,
  createCocosLobbyPreferences,
  loadCocosLobbyRooms,
  loadCocosPlayerAccountProfile,
  loadCocosPlayerAchievementProgress,
  loadCocosPlayerEventHistory,
  loadCocosPlayerProgressionSnapshot,
  loginCocosGuestAuthSession,
  logoutCurrentCocosAuthSession,
  postCocosPlayerReferral,
  readPreferredCocosDisplayName,
  rememberPreferredCocosDisplayName,
  requestCocosAccountRegistration,
  requestCocosPasswordRecovery,
  resolveCocosConfigCenterUrl,
  saveCocosLobbyPreferences,
  syncCurrentCocosAuthSession,
  type CocosLobbyRoomSummary,
  type CocosPlayerAccountProfile
} from "./cocos-lobby.ts";
import {
  loginWithCocosProvider,
  resolveCocosLoginProviders,
  resolveCocosLoginRuntimeConfig,
  type CocosLoginProviderDescriptor,
  type CocosLoginRuntimeConfig
} from "./cocos-login-provider.ts";
import { predictPlayerWorldAction as predictSharedPlayerWorldAction } from "./project-shared/map.ts";
import { type CocosWorldAction, predictPlayerWorldAction } from "./cocos-prediction.ts";
import { VeilBattleTransition } from "./VeilBattleTransition.ts";
import { VeilBattlePanel } from "./VeilBattlePanel.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";
import {
  buildTimelineEntriesFromUpdate,
  describeMoveAttemptFeedback,
  describeSessionActionOutcome,
  formatSessionActionReason,
  formatSessionSettlementReason,
  isSessionSettlementReason
} from "./cocos-ui-formatters.ts";
import { buildHeroProgressNotice, type HeroProgressNotice } from "./cocos-hero-progression.ts";
import { VeilHudPanel, type VeilHudRenderState } from "./VeilHudPanel.ts";
import { VeilLobbyPanel } from "./VeilLobbyPanel.ts";
import {
  startCocosMatchmakingStatusPolling,
  type CocosMatchmakingPollController
} from "./cocos-matchmaking.ts";
import {
  buildMatchmakingStatusView,
  type MatchmakingStatusView
} from "./cocos-matchmaking-status.ts";
import {
  buildCocosAccountLifecyclePanelView,
  type CocosAccountLifecycleDeliveryMode,
  type CocosAccountLifecycleDraft,
  type CocosAccountLifecycleKind
} from "./cocos-account-lifecycle.ts";
import { VeilMapBoard } from "./VeilMapBoard.ts";
import { buildMapFeedbackEntriesFromUpdate, buildObjectPulseEntriesFromUpdate } from "./cocos-map-visuals.ts";
import { getPlaceholderSpriteAssetUsageSummary } from "./cocos-placeholder-sprites.ts";
import {
  detectCocosRuntimePlatform,
  readCocosRuntimeLaunchSearch,
  resolveCocosRuntimeCapabilities,
  type CocosRuntimeCapabilities,
  type CocosRuntimePlatform
} from "./cocos-runtime-platform.ts";
import {
  bindCocosRuntimeMemoryWarning,
  formatCocosRuntimeMemoryStatus,
  readCocosRuntimeMemorySnapshot,
  triggerCocosRuntimeGc
} from "./cocos-runtime-memory.ts";
import {
  buildCocosProfileNotice,
  collectProfileNoticeEventIds,
  shouldRefreshGameplayAccountProfileForEvents
} from "./cocos-achievements.ts";
import {
  buildBattleResultShareSummary,
  buildShareCardPayload,
  copyTextToClipboard,
  readLaunchReferrerId,
  shouldOfferBattleResultShare,
  type WechatSharePayload
} from "./cocos-share-card.ts";
import {
  buildCocosWechatSharePayload,
  syncCocosWechatShareBridge,
  type CocosWechatShareRuntimeLike
} from "./cocos-wechat-share.ts";
import {
  clearStoredCocosAuthSession,
  readStoredCocosAuthSession,
  resolveCocosLaunchIdentity,
  type CocosAuthProvider
} from "./cocos-session-launch.ts";
import { VeilTimelinePanel } from "./VeilTimelinePanel.ts";
import { VeilProgressionPanel } from "./VeilProgressionPanel.ts";
import { VeilEquipmentPanel } from "./VeilEquipmentPanel.ts";
import { formatEquipmentActionReason, formatEquipmentSlotLabel } from "./cocos-hero-equipment.ts";
import { type CocosBattleFeedbackView } from "./cocos-battle-feedback.ts";
import {
  createCocosBattlePresentationController,
  type CocosBattlePresentationState
} from "./cocos-battle-presentation-controller.ts";
import { createCocosAudioRuntime } from "./cocos-audio-runtime.ts";
import { createCocosAudioAssetBridge } from "./cocos-audio-resources.ts";
import {
  applySettingsUpdate,
  CocosSettingsPanel,
  createDefaultCocosSettingsView,
  readPersistedCocosSettings,
  resolveCocosPrivacyPolicyUrl,
  writePersistedCocosSettings,
  type CocosSettingsPanelUpdate,
  type CocosSettingsPanelView
} from "./cocos-settings-panel.ts";
import { buildCocosRuntimeTriageSummaryLines } from "./cocos-runtime-diagnostics.ts";
import { cocosPresentationConfig } from "./cocos-presentation-config.ts";
import { cocosPresentationReadiness } from "./cocos-presentation-readiness.ts";
import { getPixelSpriteLoadStatus, loadPixelSpriteAssets } from "./cocos-pixel-sprites.ts";
import {
  appendPrimaryClientTelemetry,
  buildPrimaryClientTelemetryFromUpdate,
  createPrimaryClientTelemetryEvent
} from "./cocos-primary-client-telemetry.ts";
import {
  describeAccountAuthFailure,
  type PrimaryClientTelemetryEvent,
  type RuntimeDiagnosticsConnectionStatus,
  validateAccountLifecycleConfirm,
  validateAccountLifecycleRequest,
  validateAccountPassword,
  validatePrivacyConsentAccepted
} from "../../../../packages/shared/src/index.ts";

const { ccclass, property } = _decorator;

const HUD_NODE_NAME = "ProjectVeilHud";
const MAP_NODE_NAME = "ProjectVeilMap";
const BATTLE_NODE_NAME = "ProjectVeilBattlePanel";
const TIMELINE_NODE_NAME = "ProjectVeilTimelinePanel";
const LOBBY_NODE_NAME = "ProjectVeilLobbyPanel";
const ACCOUNT_REVIEW_PANEL_NODE_NAME = "ProjectVeilAccountReviewPanel";
const EQUIPMENT_PANEL_NODE_NAME = "ProjectVeilEquipmentPanel";
const SETTINGS_PANEL_NODE_NAME = "ProjectVeilSettingsPanel";
const SETTINGS_BUTTON_NODE_NAME = "ProjectVeilSettingsButton";
const DEFAULT_MAP_WIDTH_TILES = 8;
const DEFAULT_MAP_HEIGHT_TILES = 8;
const BATTLE_FEEDBACK_DURATION_MS = 2600;
const ACCOUNT_REVIEW_PAGE_SIZE = 3;

interface BattleSettlementSnapshot {
  label: string;
  detail: string;
  badge: string;
  tone: CocosBattleFeedbackView["tone"];
  summaryLines: string[];
}

interface VeilRootRuntime {
  createSession: typeof VeilCocosSession.create;
  loadLeaderboard: typeof VeilCocosSession.fetchLeaderboard;
  enqueueMatchmaking: typeof VeilCocosSession.enqueueForMatchmaking;
  getMatchmakingStatus: typeof VeilCocosSession.getMatchmakingStatus;
  cancelMatchmaking: typeof VeilCocosSession.cancelMatchmaking;
  startMatchmakingPolling: typeof startCocosMatchmakingStatusPolling;
  readStoredReplay: typeof VeilCocosSession.readStoredReplay;
  loadLobbyRooms: typeof loadCocosLobbyRooms;
  syncAuthSession: typeof syncCurrentCocosAuthSession;
  loadAccountProfile: typeof loadCocosPlayerAccountProfile;
  loadProgressionSnapshot: typeof loadCocosPlayerProgressionSnapshot;
  loadAchievementProgress: typeof loadCocosPlayerAchievementProgress;
  loadEventHistory: typeof loadCocosPlayerEventHistory;
  loadBattleReplayHistoryPage: typeof loadCocosBattleReplayHistoryPage;
  loginGuestAuthSession: typeof loginCocosGuestAuthSession;
  postPlayerReferral: typeof postCocosPlayerReferral;
  logoutAuthSession: typeof logoutCurrentCocosAuthSession;
  deletePlayerAccount: typeof deleteCurrentCocosPlayerAccount;
}

const defaultVeilRootRuntime: VeilRootRuntime = {
  createSession: (...args) => VeilCocosSession.create(...args),
  loadLeaderboard: (...args) => VeilCocosSession.fetchLeaderboard(...args),
  enqueueMatchmaking: (...args) => VeilCocosSession.enqueueForMatchmaking(...args),
  getMatchmakingStatus: (...args) => VeilCocosSession.getMatchmakingStatus(...args),
  cancelMatchmaking: (...args) => VeilCocosSession.cancelMatchmaking(...args),
  startMatchmakingPolling: (...args) => startCocosMatchmakingStatusPolling(...args),
  readStoredReplay: (...args) => VeilCocosSession.readStoredReplay(...args),
  loadLobbyRooms: (...args) => loadCocosLobbyRooms(...args),
  syncAuthSession: (...args) => syncCurrentCocosAuthSession(...args),
  loadAccountProfile: (...args) => loadCocosPlayerAccountProfile(...args),
  loadProgressionSnapshot: (...args) => loadCocosPlayerProgressionSnapshot(...args),
  loadAchievementProgress: (...args) => loadCocosPlayerAchievementProgress(...args),
  loadEventHistory: (...args) => loadCocosPlayerEventHistory(...args),
  loadBattleReplayHistoryPage: (...args) => loadCocosBattleReplayHistoryPage(...args),
  loginGuestAuthSession: (...args) => loginCocosGuestAuthSession(...args),
  postPlayerReferral: (...args) => postCocosPlayerReferral(...args),
  logoutAuthSession: (...args) => logoutCurrentCocosAuthSession(...args),
  deletePlayerAccount: (...args) => deleteCurrentCocosPlayerAccount(...args)
};

let testVeilRootRuntimeOverrides: Partial<VeilRootRuntime> | null = null;

function resolveVeilRootRuntime(): VeilRootRuntime {
  return {
    ...defaultVeilRootRuntime,
    ...testVeilRootRuntimeOverrides
  };
}

function formatHeroStatBonus(bonus: { attack: number; defense: number; power: number; knowledge: number }): string {
  return [
    bonus.attack > 0 ? `攻击 +${bonus.attack}` : "",
    bonus.defense > 0 ? `防御 +${bonus.defense}` : "",
    bonus.power > 0 ? `力量 +${bonus.power}` : "",
    bonus.knowledge > 0 ? `知识 +${bonus.knowledge}` : ""
  ]
    .filter(Boolean)
    .join(" / ");
}

function formatResourceKindLabel(kind: "gold" | "wood" | "ore"): string {
  return kind === "gold" ? "金币" : kind === "wood" ? "木材" : "矿石";
}

@ccclass("ProjectVeilRoot")
export class VeilRoot extends Component {
  @property
  roomId = "test-room";

  @property
  playerId = "player-1";

  @property
  displayName = "";

  @property
  seed = 1001;

  @property
  remoteUrl = "http://127.0.0.1:2567";

  @property
  autoConnect = true;

  @property
  tileSize = 84;

  @property
  fogPulseEnabled = true;

  @property
  fogPulseIntervalSeconds = 0.8;

  private hudPanel: VeilHudPanel | null = null;
  private mapBoard: VeilMapBoard | null = null;
  private battlePanel: VeilBattlePanel | null = null;
  private timelinePanel: VeilTimelinePanel | null = null;
  private lobbyPanel: VeilLobbyPanel | null = null;
  private battleTransition: VeilBattleTransition | null = null;
  private session: VeilCocosSession | null = null;
  private lastUpdate: SessionUpdate | null = null;
  private logLines: string[] = ["Cocos 主客户端已就绪。"];
  private timelineEntries: string[] = [];
  private moveInFlight = false;
  private battleActionInFlight = false;
  private predictionStatus = "";
  private inputDebug = "input waiting";
  private pendingPrediction: SessionUpdate | null = null;
  private selectedBattleTargetId: string | null = null;
  private selectedInteractionBuildingId: string | null = null;
  private battleFeedback: (CocosBattleFeedbackView & { expiresAt: number }) | null = null;
  private fogPulsePhase = 0;
  private hudActionBinding = false;
  private sessionEpoch = 0;
  private authToken: string | null = null;
  private authMode: "guest" | "account" = "guest";
  private authProvider: CocosAuthProvider = "guest";
  private loginId = "";
  private privacyConsentAccepted = false;
  private sessionSource: "remote" | "local" | "manual" | "none" = "none";
  private levelUpNotice: (HeroProgressNotice & { expiresAt: number }) | null = null;
  private achievementNotice: ({ title: string; detail: string; expiresAt: number } & { eventId: string }) | null = null;
  private showLobby = false;
  private lobbyRooms: CocosLobbyRoomSummary[] = [];
  private lobbyStatus = "请选择一个房间，或手动输入新的房间 ID。";
  private lobbyLoading = false;
  private lobbyEntering = false;
  private matchmakingStatus: MatchmakingStatusResponse = { status: "idle" };
  private matchmakingPollController: CocosMatchmakingPollController | null = null;
  private matchmakingTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private matchmakingTimeoutMs = 120_000;
  private matchmakingView: MatchmakingStatusView = buildMatchmakingStatusView({ status: "idle" });
  private matchmakingJoinInFlight = false;
  private lobbyLeaderboardEntries: LeaderboardEntry[] = [];
  private lobbyLeaderboardStatus: "idle" | "loading" | "ready" | "error" = "idle";
  private lobbyLeaderboardError: string | null = null;
  private lobbyAccountProfile: CocosPlayerAccountProfile = createFallbackCocosPlayerAccountProfile("player-1", "test-room");
  private lobbyAccountReviewState: CocosAccountReviewState = createCocosAccountReviewState(this.lobbyAccountProfile);
  private lobbyAccountEpoch = 0;
  private gameplayAccountRefreshInFlight = false;
  private gameplayAccountReviewPanel: VeilProgressionPanel | null = null;
  private gameplayAccountReviewPanelOpen = false;
  private gameplayEquipmentPanel: VeilEquipmentPanel | null = null;
  private gameplayEquipmentPanelOpen = false;
  private settingsPanel: CocosSettingsPanel | null = null;
  private settingsView: CocosSettingsPanelView = createDefaultCocosSettingsView();
  private activeAccountFlow: CocosAccountLifecycleKind | null = null;
  private registrationDisplayName = "";
  private registrationToken = "";
  private registrationPassword = "";
  private registrationDeliveryMode: CocosAccountLifecycleDeliveryMode = "idle";
  private registrationExpiresAt = "";
  private recoveryToken = "";
  private recoveryPassword = "";
  private recoveryDeliveryMode: CocosAccountLifecycleDeliveryMode = "idle";
  private recoveryExpiresAt = "";
  private runtimePlatform: CocosRuntimePlatform = "unknown";
  private runtimeCapabilities: CocosRuntimeCapabilities = resolveCocosRuntimeCapabilities("unknown");
  private loginRuntimeConfig: CocosLoginRuntimeConfig = resolveCocosLoginRuntimeConfig();
  private loginProviders: CocosLoginProviderDescriptor[] = [];
  private audioRuntime = createCocosAudioRuntime(cocosPresentationConfig.audio);
  private pendingPixelSpriteGroups = new Set<"boot" | "battle">();
  private seenProfileNoticeEventIds = new Set<string>();
  private wechatShareStatus = "分享功能仅在微信小游戏可用。";
  private wechatShareAvailable = false;
  private runtimeMemoryNotice = "";
  private diagnosticsConnectionStatus: RuntimeDiagnosticsConnectionStatus = "connecting";
  private lastRoomUpdateSource: string | null = null;
  private lastRoomUpdateReason: string | null = null;
  private lastRoomUpdateAtMs: number | null = null;
  private primaryClientTelemetry: PrimaryClientTelemetryEvent[] = [];
  private stopRuntimeMemoryWarnings: (() => void) | null = null;
  private battlePresentation = createCocosBattlePresentationController();
  private lastBattleSettlementSnapshot: BattleSettlementSnapshot | null = null;
  private reportDialogOpen = false;
  private reportSubmitting = false;
  private reportStatusMessage: string | null = null;
  private surrenderDialogOpen = false;
  private surrenderSubmitting = false;
  private surrenderStatusMessage: string | null = null;
  private launchReferrerId: string | null = null;
  private lastReferralClaimKey: string | null = null;

  onLoad(): void {
    this.audioRuntime.dispose();
    this.audioRuntime = createCocosAudioRuntime(cocosPresentationConfig.audio, {
      assetBridge: createCocosAudioAssetBridge(this.node),
      onStateChange: () => {
        this.renderView();
      }
    });
    this.hydrateRuntimePlatform();
    this.bindRuntimeMemoryWarnings();
    this.hydrateLaunchIdentity();
    this.hydrateSettings();
    this.syncWechatShareBridge();
    this.ensureUiCameraVisibility();
    this.ensureViewNodes();
    this.ensureHudActionBinding();
    this.renderView();
  }

  start(): void {
    if (this.fogPulseEnabled) {
      this.scheduleFogPulseTick();
    }

    if (this.showLobby) {
      void this.syncLobbyBootstrap();
      return;
    }

    if (this.autoConnect) {
      void this.connect();
    }
  }

  onDestroy(): void {
    this.unscheduleAllCallbacks();
    this.stopMatchmakingPolling();
    this.audioRuntime.dispose();
    this.stopRuntimeMemoryWarnings?.();
    this.stopRuntimeMemoryWarnings = null;
    if (this.hudActionBinding) {
      input.off(Input.EventType.TOUCH_END, this.handleHudActionInput, this);
      input.off(Input.EventType.MOUSE_UP, this.handleHudActionInput, this);
      this.hudActionBinding = false;
    }

    const currentSession = this.session;
    this.session = null;
    if (currentSession) {
      void currentSession.dispose();
    }
  }

  async connect(): Promise<void> {
    if (this.session) {
      this.pushLog("当前房间已经连接。");
      this.renderView();
      return;
    }

    this.diagnosticsConnectionStatus = "connecting";
    this.pushLog(`正在连接 ${this.remoteUrl} ...`);
    const replayed = resolveVeilRootRuntime().readStoredReplay(this.roomId, this.playerId);
    if (replayed) {
      this.applyReplayedSessionUpdate(replayed);
      this.pushLog("已回放本地缓存，等待房间实时同步。");
    }
    this.renderView();

    const sessionEpoch = this.bumpSessionEpoch();
    let nextSession: VeilCocosSession | null = null;
    try {
      nextSession = await resolveVeilRootRuntime().createSession(
        this.roomId,
        this.playerId,
        this.seed,
        this.createSessionOptions(sessionEpoch)
      );
      if (!this.isActiveSessionEpoch(sessionEpoch)) {
        await nextSession.dispose().catch(() => undefined);
        return;
      }

      this.session = nextSession;
      this.lastUpdate = await nextSession.snapshot();
      if (!this.isActiveSessionEpoch(sessionEpoch)) {
        await nextSession.dispose().catch(() => undefined);
        return;
      }

      this.pushLog("房间快照已加载，点击地块即可移动。");
      await this.applySessionUpdate(this.lastUpdate);
    } catch (error) {
      if (!this.isActiveSessionEpoch(sessionEpoch)) {
        if (nextSession) {
          await nextSession.dispose().catch(() => undefined);
        }
        return;
      }

      const failureMessage = this.describeSessionError(error, "连接房间失败。");
      this.pushLog(failureMessage);
      this.predictionStatus = failureMessage;
      if (this.session) {
        await this.session.dispose().catch(() => undefined);
        this.session = null;
      }
      this.renderView();
    }
  }

  async refreshSnapshot(): Promise<void> {
    if (!this.session) {
      await this.connect();
      return;
    }

    try {
      await this.applySessionUpdate(await this.session.snapshot());
      this.pushLog("房间快照已刷新。");
      this.renderView();
    } catch (error) {
      const failureMessage = this.describeSessionError(error, "Snapshot refresh failed.");
      this.pushLog(failureMessage);
      this.predictionStatus = failureMessage;
      this.renderView();
    }
  }

  async advanceDay(): Promise<void> {
    if (this.moveInFlight || this.battleActionInFlight) {
      return;
    }

    if (!this.session) {
      await this.connect();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("战斗中无法推进天数。");
      this.predictionStatus = "战斗中无法推进天数。";
      this.renderView();
      return;
    }

    this.predictionStatus = "正在推进到下一天...";
    this.moveInFlight = true;
    this.renderView();

    try {
      await this.applySessionUpdate(await this.session.endDay());
      this.pushLog("已推进到下一天。");
    } catch (error) {
      const failureMessage = this.describeSessionError(error, "推进天数失败。");
      this.pushLog(failureMessage);
      this.predictionStatus = failureMessage;
    } finally {
      this.moveInFlight = false;
    }

    this.renderView();
  }

  async learnHeroSkill(skillId: string): Promise<void> {
    if (this.moveInFlight || this.battleActionInFlight) {
      return;
    }

    if (!this.session) {
      await this.connect();
      return;
    }

    const hero = this.activeHero();
    if (!hero) {
      this.pushLog("当前快照里没有可控制的英雄。");
      this.renderView();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("战斗中无法调整技能树。");
      this.predictionStatus = "战斗中无法调整技能树。";
      this.renderView();
      return;
    }

    this.moveInFlight = true;
    this.predictionStatus = `正在学习技能 ${skillId}...`;
    this.pushLog(`正在为 ${hero.name} 学习技能 ${skillId}...`);
    this.renderView();

    try {
      const update = await this.session.learnSkill(hero.id, skillId);
      await this.applySessionUpdate(update);
      this.pushSessionActionOutcome(update, {
        successMessage: "技能学习已结算。",
        rejectedLabel: "技能学习"
      });
    } catch (error) {
      const failureMessage = this.describeSessionError(error, "技能学习失败。");
      this.pushLog(failureMessage);
      this.predictionStatus = failureMessage;
    } finally {
      this.moveInFlight = false;
    }

    this.renderView();
  }

  async equipHeroItem(slot: EquipmentType, equipmentId: string): Promise<void> {
    if (this.moveInFlight || this.battleActionInFlight) {
      return;
    }

    if (!this.session) {
      await this.connect();
      return;
    }

    const hero = this.activeHero();
    if (!hero) {
      this.pushLog("当前快照里没有可控制的英雄。");
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(), {
          category: "inventory",
          checkpoint: "equipment.equip.rejected",
          status: "blocked",
          detail: "Equip request ignored because no controlled hero is present.",
          reason: "no_controlled_hero"
        })
      );
      this.renderView();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("战斗中无法调整装备。");
      this.predictionStatus = "战斗中无法调整装备。";
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(hero.id), {
          category: "inventory",
          checkpoint: "equipment.equip.rejected",
          status: "blocked",
          detail: "Equip request rejected because the client is currently in battle.",
          reason: "in_battle"
        })
      );
      this.renderView();
      return;
    }

    const itemName = getEquipmentDefinition(equipmentId)?.name ?? equipmentId;
    this.moveInFlight = true;
    this.predictionStatus = `正在装备 ${itemName}...`;
    this.pushLog(`正在为 ${hero.name} 装备 ${itemName}...`);
    this.applyPrediction(
      {
        type: "hero.equip",
        heroId: hero.id,
        slot,
        equipmentId
      },
      `预演装备 ${itemName}`
    );
    this.renderView();

    try {
      const update = await this.session.equipHeroItem(hero.id, slot, equipmentId);
      await this.applySessionUpdate(update);
      this.pushSessionActionOutcome(update, {
        successMessage: "装备已结算。",
        rejectedLabel: "装备调整"
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "equip_failed";
      const detail = error instanceof Error ? formatEquipmentActionReason(error.message) : "装备失败。";
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(hero.id), {
          category: "inventory",
          checkpoint: "equipment.equip.rejected",
          status: "failure",
          detail,
          reason,
          slot,
          ...(equipmentId ? { equipmentId } : {})
        })
      );
      this.rollbackPrediction(error instanceof Error ? formatEquipmentActionReason(error.message) : "装备失败。");
    } finally {
      this.moveInFlight = false;
    }

    this.renderView();
  }

  async unequipHeroItem(slot: EquipmentType): Promise<void> {
    if (this.moveInFlight || this.battleActionInFlight) {
      return;
    }

    if (!this.session) {
      await this.connect();
      return;
    }

    const hero = this.activeHero();
    if (!hero) {
      this.pushLog("当前快照里没有可控制的英雄。");
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(), {
          category: "inventory",
          checkpoint: "equipment.unequip.rejected",
          status: "blocked",
          detail: "Unequip request ignored because no controlled hero is present.",
          reason: "no_controlled_hero"
        })
      );
      this.renderView();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("战斗中无法调整装备。");
      this.predictionStatus = "战斗中无法调整装备。";
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(hero.id), {
          category: "inventory",
          checkpoint: "equipment.unequip.rejected",
          status: "blocked",
          detail: "Unequip request rejected because the client is currently in battle.",
          reason: "in_battle"
        })
      );
      this.renderView();
      return;
    }

    const currentItemId =
      slot === "weapon"
        ? hero.loadout.equipment.weaponId
        : slot === "armor"
          ? hero.loadout.equipment.armorId
          : hero.loadout.equipment.accessoryId;
    const itemName = currentItemId ? getEquipmentDefinition(currentItemId)?.name ?? currentItemId : formatEquipmentSlotLabel(slot);
    this.moveInFlight = true;
    this.predictionStatus = `正在卸下 ${itemName}...`;
    this.pushLog(`正在为 ${hero.name} 卸下 ${itemName}...`);
    this.applyPrediction(
      {
        type: "hero.unequip",
        heroId: hero.id,
        slot
      },
      `预演卸下 ${itemName}`
    );
    this.renderView();

    try {
      const update = await this.session.unequipHeroItem(hero.id, slot);
      await this.applySessionUpdate(update);
      this.pushSessionActionOutcome(update, {
        successMessage: "卸装已结算。",
        rejectedLabel: "卸装"
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unequip_failed";
      const detail = error instanceof Error ? formatEquipmentActionReason(error.message) : "卸装失败。";
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(hero.id), {
          category: "inventory",
          checkpoint: "equipment.unequip.rejected",
          status: "failure",
          detail,
          reason,
          slot,
          ...(currentItemId ? { equipmentId: currentItemId } : {})
        })
      );
      this.rollbackPrediction(error instanceof Error ? formatEquipmentActionReason(error.message) : "卸装失败。");
    } finally {
      this.moveInFlight = false;
    }

    this.renderView();
  }

  private ensureViewNodes(): void {
    assignUiLayer(this.node);

    if (!this.node.getComponent(Canvas)) {
      this.node.addComponent(Canvas);
    }

    const rootTransform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const visibleSize = view.getVisibleSize();
    rootTransform.setContentSize(visibleSize.width, visibleSize.height);
    const { effectiveTileSize, hudWidth, rightWidth, mapWidth, hudHeight, battleHeight, timelineHeight } =
      this.computeLayoutMetrics();

    let hudNode = this.node.getChildByName(HUD_NODE_NAME);
    if (!hudNode) {
      hudNode = new Node(HUD_NODE_NAME);
      hudNode.parent = this.node;
    }
    assignUiLayer(hudNode);

    const hudTransform = hudNode.getComponent(UITransform) ?? hudNode.addComponent(UITransform);
    hudTransform.setContentSize(hudWidth, hudHeight);
    this.hudPanel = hudNode.getComponent(VeilHudPanel) ?? hudNode.addComponent(VeilHudPanel);
    this.hudPanel.configure({
      onNewRun: () => {
        void this.startNewRun();
      },
      onRefresh: () => {
        void this.refreshSnapshot();
      },
      onToggleSettings: () => {
        this.toggleSettingsPanel();
      },
      onToggleInventory: () => {
        this.toggleGameplayEquipmentPanel();
      },
      onToggleAchievements: () => {
        void this.openGameplayBattleReportCenter();
      },
      onToggleReport: () => {
        this.toggleReportDialog();
      },
      onToggleSurrender: () => {
        this.toggleSurrenderDialog();
      },
      onShareBattleResult: () => {
        void this.handleBattleResultShare();
      },
      onSubmitReport: (reason) => {
        void this.submitPlayerReport(reason);
      },
      onCancelReport: () => {
        this.closeReportDialog();
      },
      onConfirmSurrender: () => {
        void this.confirmSurrender();
      },
      onCancelSurrender: () => {
        this.closeSurrenderDialog();
      },
      onLearnSkill: (skillId) => {
        void this.learnHeroSkill(skillId);
      },
      onEquipItem: (slot, equipmentId) => {
        void this.equipHeroItem(slot, equipmentId);
      },
      onUnequipItem: (slot) => {
        void this.unequipHeroItem(slot);
      },
      onEndDay: () => {
        void this.advanceDay();
      },
      onReturnLobby: () => {
        void this.returnToLobby();
      }
    });

    let lobbyNode = this.node.getChildByName(LOBBY_NODE_NAME);
    if (!lobbyNode) {
      lobbyNode = new Node(LOBBY_NODE_NAME);
      lobbyNode.parent = this.node;
    }
    assignUiLayer(lobbyNode);
    const lobbyTransform = lobbyNode.getComponent(UITransform) ?? lobbyNode.addComponent(UITransform);
    lobbyTransform.setContentSize(Math.max(360, visibleSize.width - 48), Math.max(620, visibleSize.height - 52));
    this.lobbyPanel = lobbyNode.getComponent(VeilLobbyPanel) ?? lobbyNode.addComponent(VeilLobbyPanel);
    this.lobbyPanel.configure({
      onEditPlayerId: () => {
        this.promptForLobbyField("playerId");
      },
      onEditDisplayName: () => {
        this.promptForLobbyField("displayName");
      },
      onEditRoomId: () => {
        this.promptForLobbyField("roomId");
      },
      onEditLoginId: () => {
        this.promptForLobbyField("loginId");
      },
      onTogglePrivacyConsent: () => {
        this.togglePrivacyConsent();
      },
      onRefresh: () => {
        void this.syncLobbyBootstrap();
      },
      onEnterRoom: () => {
        void this.enterLobbyRoom();
      },
      onEnterMatchmaking: () => {
        void this.enterLobbyMatchmaking();
      },
      onCancelMatchmaking: () => {
        void this.cancelLobbyMatchmaking();
      },
      onLoginAccount: () => {
        void this.loginLobbyAccount();
      },
      onRegisterAccount: () => {
        this.openLobbyAccountFlow("registration");
      },
      onRecoverAccount: () => {
        this.openLobbyAccountFlow("recovery");
      },
      onEditAccountFlowField: (field) => {
        this.promptForAccountFlowField(field);
      },
      onRequestAccountFlow: () => {
        void this.requestActiveAccountFlow();
      },
      onConfirmAccountFlow: () => {
        void this.confirmActiveAccountFlow();
      },
      onCancelAccountFlow: () => {
        this.closeLobbyAccountFlow();
      },
      onOpenConfigCenter: () => {
        this.openConfigCenter();
      },
      onLogout: () => {
        this.logoutAuthSession();
      },
      onJoinRoom: (roomId) => {
        void this.enterLobbyRoom(roomId);
      },
      onToggleAccountReview: (open) => {
        if (open) {
          void this.refreshActiveAccountReviewSection();
        }
      },
      onSelectAccountReviewSection: (section) => {
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "section.selected",
          section
        });
        this.renderView();
        void this.refreshActiveAccountReviewSection();
      },
      onSelectAccountReviewPage: (section, page) => {
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "section.selected",
          section
        });
        this.renderView();
        void this.refreshAccountReviewPage(section, page);
      },
      onRetryAccountReviewSection: (section) => {
        void this.refreshActiveAccountReviewSection(section);
      },
      onSelectBattleReplayReview: (replayId) => {
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "battle-replay.selected",
          replayId
        });
        this.renderView();
      }
    });

    let mapRoot = this.node.getChildByName(MAP_NODE_NAME);
    if (!mapRoot) {
      mapRoot = new Node(MAP_NODE_NAME);
      mapRoot.parent = this.node;
    }
    assignUiLayer(mapRoot);

    const mapTransform = mapRoot.getComponent(UITransform) ?? mapRoot.addComponent(UITransform);
    mapTransform.setContentSize(mapWidth, Math.max(480, visibleSize.height - 48));

    this.mapBoard = mapRoot.getComponent(VeilMapBoard) ?? mapRoot.addComponent(VeilMapBoard);
    this.mapBoard.setFogPulsePhase(this.fogPulsePhase);
    this.mapBoard.configure({
      tileSize: effectiveTileSize,
      onTileSelected: (tile) => {
        void this.moveHeroToTile(tile);
      },
      onInputDebug: (message) => {
        this.inputDebug = message;
        this.renderView();
      }
    });

    let battleNode = this.node.getChildByName(BATTLE_NODE_NAME);
    if (!battleNode) {
      battleNode = new Node(BATTLE_NODE_NAME);
      battleNode.parent = this.node;
    }
    assignUiLayer(battleNode);

    const battleTransform = battleNode.getComponent(UITransform) ?? battleNode.addComponent(UITransform);
    battleTransform.setContentSize(rightWidth, battleHeight);
    this.battlePanel = battleNode.getComponent(VeilBattlePanel) ?? battleNode.addComponent(VeilBattlePanel);
    this.battlePanel.configure({
      onSelectTarget: (unitId) => {
        this.selectedBattleTargetId = unitId;
        this.renderView();
      },
      onAction: (action) => {
        void this.actInBattle(action);
      }
    });

    let timelineNode = this.node.getChildByName(TIMELINE_NODE_NAME);
    if (!timelineNode) {
      timelineNode = new Node(TIMELINE_NODE_NAME);
      timelineNode.parent = this.node;
    }
    assignUiLayer(timelineNode);

    const timelineTransform = timelineNode.getComponent(UITransform) ?? timelineNode.addComponent(UITransform);
    timelineTransform.setContentSize(rightWidth, timelineHeight);
    this.timelinePanel = timelineNode.getComponent(VeilTimelinePanel) ?? timelineNode.addComponent(VeilTimelinePanel);

    let accountReviewPanelNode = this.node.getChildByName(ACCOUNT_REVIEW_PANEL_NODE_NAME);
    if (!accountReviewPanelNode) {
      accountReviewPanelNode = new Node(ACCOUNT_REVIEW_PANEL_NODE_NAME);
      accountReviewPanelNode.parent = this.node;
    }
    assignUiLayer(accountReviewPanelNode);
    const accountReviewTransform = accountReviewPanelNode.getComponent(UITransform) ?? accountReviewPanelNode.addComponent(UITransform);
    accountReviewTransform.setContentSize(Math.max(320, Math.min(420, visibleSize.width - 56)), Math.max(360, visibleSize.height - 96));
    this.gameplayAccountReviewPanel =
      accountReviewPanelNode.getComponent(VeilProgressionPanel) ?? accountReviewPanelNode.addComponent(VeilProgressionPanel);
    this.gameplayAccountReviewPanel.configure({
      onClose: () => {
        void this.toggleGameplayAccountReviewPanel(false);
      },
      onSelectSection: (section) => {
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "section.selected",
          section
        });
        this.renderView();
        void this.refreshActiveAccountReviewSection();
      },
      onSelectPage: (section, page) => {
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "section.selected",
          section
        });
        this.renderView();
        void this.refreshAccountReviewPage(section, page);
      },
      onRetrySection: (section) => {
        void this.refreshActiveAccountReviewSection(section);
      }
    });

    let equipmentPanelNode = this.node.getChildByName(EQUIPMENT_PANEL_NODE_NAME);
    if (!equipmentPanelNode) {
      equipmentPanelNode = new Node(EQUIPMENT_PANEL_NODE_NAME);
      equipmentPanelNode.parent = this.node;
    }
    assignUiLayer(equipmentPanelNode);
    const equipmentPanelTransform = equipmentPanelNode.getComponent(UITransform) ?? equipmentPanelNode.addComponent(UITransform);
    equipmentPanelTransform.setContentSize(Math.max(360, Math.min(460, visibleSize.width - 56)), Math.max(420, visibleSize.height - 96));
    this.gameplayEquipmentPanel =
      equipmentPanelNode.getComponent(VeilEquipmentPanel) ?? equipmentPanelNode.addComponent(VeilEquipmentPanel);
    this.gameplayEquipmentPanel.configure({
      onClose: () => {
        this.toggleGameplayEquipmentPanel(false);
      },
      onEquipItem: (slot, equipmentId) => {
        void this.equipHeroItem(slot, equipmentId);
      },
      onUnequipItem: (slot) => {
        void this.unequipHeroItem(slot);
      }
    });

    let settingsPanelNode = this.node.getChildByName(SETTINGS_PANEL_NODE_NAME);
    if (!settingsPanelNode) {
      settingsPanelNode = new Node(SETTINGS_PANEL_NODE_NAME);
      settingsPanelNode.parent = this.node;
    }
    assignUiLayer(settingsPanelNode);
    const settingsPanelTransform = settingsPanelNode.getComponent(UITransform) ?? settingsPanelNode.addComponent(UITransform);
    settingsPanelTransform.setContentSize(Math.max(360, Math.min(460, visibleSize.width - 64)), Math.max(440, visibleSize.height - 96));
    this.settingsPanel = settingsPanelNode.getComponent(CocosSettingsPanel) ?? settingsPanelNode.addComponent(CocosSettingsPanel);
    this.settingsPanel.configure({
      onClose: () => {
        this.toggleSettingsPanel(false);
      },
      onUpdate: (update) => {
        this.updateSettings(update);
      },
      onLogout: () => {
        void this.handleSettingsLogout();
      },
      onDeleteAccount: () => {
        void this.handleSettingsDeleteAccount();
      },
      onWithdrawConsent: () => {
        void this.handleSettingsWithdrawConsent();
      },
      onOpenPrivacyPolicy: () => {
        this.openSettingsPrivacyPolicy();
      }
    });

    let settingsButtonNode = this.node.getChildByName(SETTINGS_BUTTON_NODE_NAME);
    if (!settingsButtonNode) {
      settingsButtonNode = new Node(SETTINGS_BUTTON_NODE_NAME);
      settingsButtonNode.parent = this.node;
    }
    assignUiLayer(settingsButtonNode);
    const settingsButtonTransform = settingsButtonNode.getComponent(UITransform) ?? settingsButtonNode.addComponent(UITransform);
    settingsButtonTransform.setContentSize(58, 58);

    this.battleTransition = this.node.getComponent(VeilBattleTransition) ?? this.node.addComponent(VeilBattleTransition);
    this.updateLayout();
  }

  private ensureUiCameraVisibility(): void {
    const sceneRoot = this.node.parent;
    if (!sceneRoot) {
      return;
    }

    const uiLayer = Layers.Enum.UI_2D;
    const cameraNode = sceneRoot.getChildByName("Main Camera");
    const camera = cameraNode?.getComponent(Camera) ?? null;
    if (camera) {
      camera.visibility |= uiLayer;
      camera.orthoHeight = Math.max(320, view.getVisibleSize().height / 2);
      camera.near = 0.1;
      camera.far = 4000;
    }
    if (cameraNode) {
      cameraNode.setPosition(0, 0, 1000);
      cameraNode.setRotationFromEuler(0, 0, 0);
    }
  }

  private ensureHudActionBinding(): void {
    if (this.hudActionBinding) {
      return;
    }

    input.on(Input.EventType.TOUCH_END, this.handleHudActionInput, this);
    input.on(Input.EventType.MOUSE_UP, this.handleHudActionInput, this);
    this.hudActionBinding = true;
  }

  private renderView(): void {
    if (this.levelUpNotice && this.levelUpNotice.expiresAt <= Date.now()) {
      this.levelUpNotice = null;
    }
    if (this.achievementNotice && this.achievementNotice.expiresAt <= Date.now()) {
      this.achievementNotice = null;
    }
    if (this.battleFeedback && this.battleFeedback.expiresAt <= Date.now()) {
      this.battleFeedback = null;
    }

    this.ensurePixelSpriteGroup("boot");
    if (this.lastUpdate?.battle) {
      this.ensurePixelSpriteGroup("battle");
    }

    this.syncMusicScene();

    this.updateLayout();
    const lobbyNode = this.node.getChildByName(LOBBY_NODE_NAME);
    const hudNode = this.node.getChildByName(HUD_NODE_NAME);
    const mapNode = this.node.getChildByName(MAP_NODE_NAME);
    const battleNode = this.node.getChildByName(BATTLE_NODE_NAME);
    const timelineNode = this.node.getChildByName(TIMELINE_NODE_NAME);
    const accountReviewPanelNode = this.node.getChildByName(ACCOUNT_REVIEW_PANEL_NODE_NAME);
    const equipmentPanelNode = this.node.getChildByName(EQUIPMENT_PANEL_NODE_NAME);
    const settingsPanelNode = this.node.getChildByName(SETTINGS_PANEL_NODE_NAME);
    const settingsButtonNode = this.node.getChildByName(SETTINGS_BUTTON_NODE_NAME);
    const showingGame = !this.showLobby;

    if (lobbyNode) {
      lobbyNode.active = this.showLobby;
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
      accountReviewPanelNode.active = showingGame && this.gameplayAccountReviewPanelOpen;
    }
    if (equipmentPanelNode) {
      equipmentPanelNode.active = showingGame && this.gameplayEquipmentPanelOpen;
    }
    if (settingsPanelNode) {
      settingsPanelNode.active = this.settingsView.open;
    }
    if (settingsButtonNode) {
      settingsButtonNode.active = true;
    }

    if (this.showLobby) {
      this.lobbyPanel?.render({
        playerId: this.playerId,
        displayName: this.displayName || this.playerId,
        roomId: this.roomId,
        authMode: this.authMode,
        loginId: this.loginId,
        privacyConsentAccepted: this.privacyConsentAccepted,
        loginHint: this.describeLobbyLoginHint(),
        loginActionLabel: this.primaryLoginProvider().label,
        shareHint: this.describeLobbyShareHint(),
        vaultSummary: this.formatLobbyVaultSummary(),
        account: this.lobbyAccountProfile,
        accountReview: buildCocosAccountReviewPage(this.lobbyAccountReviewState),
        battleReplayItems: this.lobbyAccountReviewState.battleReplays.items,
        battleReplaySectionStatus: this.lobbyAccountReviewState.battleReplays.status,
        battleReplaySectionError: this.lobbyAccountReviewState.battleReplays.errorMessage,
        selectedBattleReplayId: this.lobbyAccountReviewState.selectedBattleReplayId,
        leaderboardEntries: this.lobbyLeaderboardEntries,
        leaderboardStatus: this.lobbyLeaderboardStatus,
        leaderboardError: this.lobbyLeaderboardError,
        sessionSource: this.sessionSource,
        loading: this.lobbyLoading,
        entering: this.lobbyEntering,
        status: this.lobbyStatus,
        matchmaking: this.matchmakingView,
        matchmakingSearching: this.isMatchmakingActive(),
        matchmakingBusy: this.lobbyEntering || this.matchmakingJoinInFlight,
        rooms: this.lobbyRooms,
        accountFlow: this.buildActiveAccountFlowPanelView(),
        presentationReadiness: cocosPresentationReadiness
      });
      this.renderSettingsOverlay();
      return;
    }

    this.hudPanel?.render({
      roomId: this.roomId,
      playerId: this.playerId,
      displayName: this.displayName || this.playerId,
      account: this.lobbyAccountProfile,
      authMode: this.authMode,
      loginId: this.loginId,
      sessionSource: this.sessionSource,
      remoteUrl: this.remoteUrl,
      update: this.lastUpdate,
      moveInFlight: this.moveInFlight,
      predictionStatus: this.predictionStatus,
      sessionIndicators: this.buildHudSessionIndicators(),
      inputDebug: this.inputDebug,
      runtimeHealth: this.describeRuntimeMemoryHealth(),
      triageSummaryLines: buildCocosRuntimeTriageSummaryLines({
        devOnly: true,
        mode: this.lastUpdate?.battle ? "battle" : "world",
        roomId: this.roomId,
        playerId: this.playerId,
        connectionStatus: this.diagnosticsConnectionStatus,
        lastUpdateSource: this.lastRoomUpdateSource,
        lastUpdateReason: this.lastRoomUpdateReason,
        lastUpdateAt: this.lastRoomUpdateAtMs,
        update: this.lastUpdate,
        account: this.lobbyAccountProfile,
        timelineEntries: this.timelineEntries,
        logLines: this.logLines,
        predictionStatus: this.predictionStatus,
        recoverySummary: this.predictionStatus.includes("回放缓存状态") ? this.predictionStatus : null,
        primaryClientTelemetry: this.primaryClientTelemetry
      }),
      levelUpNotice: this.levelUpNotice ? { title: this.levelUpNotice.title, detail: this.levelUpNotice.detail } : null,
      achievementNotice: this.achievementNotice
        ? { title: this.achievementNotice.title, detail: this.achievementNotice.detail }
        : null,
      reporting: {
        open: this.reportDialogOpen,
        available: Boolean(this.resolveReportTarget()),
        targetLabel: this.resolveReportTarget()?.name ?? null,
        status: this.reportStatusMessage,
        submitting: this.reportSubmitting
      },
      surrendering: {
        open: this.surrenderDialogOpen,
        available: this.isSurrenderAvailable(),
        targetLabel: this.resolveSurrenderTarget()?.name ?? null,
        status: this.surrenderStatusMessage,
        submitting: this.surrenderSubmitting
      },
      sharing: {
        available: this.canShareLatestBattleResult()
      },
      interaction: this.buildHudInteractionState(),
      presentation: this.buildHudPresentationState()
    });
    this.renderSettingsOverlay();
    this.mapBoard?.render(this.lastUpdate);
    this.battlePanel?.render({
      update: this.lastUpdate,
      timelineEntries: this.timelineEntries,
      controlledCamp: this.controlledBattleCamp(),
      selectedTargetId: this.selectedBattleTargetId,
      actionPending: this.battleActionInFlight,
      feedback: this.battleFeedback,
      presentationState: this.battlePresentation.getState(),
      recovery: this.buildBattleSettlementRecoveryState()
    });
    this.timelinePanel?.render({
      entries: this.timelineEntries
    });
    this.renderGameplayEquipmentPanel();
    this.renderGameplayAccountReviewPanel();
  }

  private renderGameplayEquipmentPanel(): void {
    const panelNode = this.node.getChildByName(EQUIPMENT_PANEL_NODE_NAME);
    if (!panelNode) {
      return;
    }

    if (!this.gameplayEquipmentPanelOpen) {
      panelNode.active = false;
      return;
    }

    panelNode.active = true;
    this.gameplayEquipmentPanel?.render({
      hero: this.activeHero(),
      recentEventLog: this.lobbyAccountProfile.recentEventLog,
      recentSessionEvents: (this.lastUpdate?.events ?? []).filter(
        (event): event is Extract<NonNullable<SessionUpdate["events"]>[number], { type: "hero.equipmentFound" }> =>
          event.type === "hero.equipmentFound"
      )
    });
  }

  private renderGameplayAccountReviewPanel(): void {
    const panelNode = this.node.getChildByName(ACCOUNT_REVIEW_PANEL_NODE_NAME);
    if (!panelNode) {
      return;
    }

    if (!this.gameplayAccountReviewPanelOpen) {
      panelNode.active = false;
      return;
    }

    panelNode.active = true;
    this.gameplayAccountReviewPanel?.render({
      page: buildCocosAccountReviewPage(this.lobbyAccountReviewState)
    });
  }

  private formatLobbyVaultSummary(): string {
    const resources = this.lobbyAccountProfile.globalResources;
    return `全局仓库 金币 ${resources.gold} / 木材 ${resources.wood} / 矿石 ${resources.ore}`;
  }

  private ensurePixelSpriteGroup(group: "boot" | "battle"): void {
    const loadStatus = getPixelSpriteLoadStatus();
    if (loadStatus.loadedGroups.includes(group) || this.pendingPixelSpriteGroups.has(group)) {
      return;
    }

    this.pendingPixelSpriteGroups.add(group);
    void loadPixelSpriteAssets(group)
      .then(() => {
        this.pendingPixelSpriteGroups.delete(group);
        this.renderView();
      })
      .catch(() => {
        this.pendingPixelSpriteGroups.delete(group);
      });
  }

  private openConfigCenter(): void {
    const configCenterUrl = resolveCocosConfigCenterUrl(this.remoteUrl);
    if (this.runtimeCapabilities.configCenterAccess !== "external-window") {
      this.lobbyStatus = `当前${this.runtimePlatform === "wechat-game" ? "微信小游戏" : "运行"}环境不支持直接打开配置台，请在 H5 调试壳访问 ${configCenterUrl}`;
      this.renderView();
      return;
    }

    const openRef = globalThis.open;
    if (typeof openRef === "function") {
      openRef(configCenterUrl, "_blank", "noopener,noreferrer");
      this.lobbyStatus = "已在新窗口打开配置台。";
    } else {
      this.lobbyStatus = `当前运行环境无法直接打开配置台，请访问 ${configCenterUrl}`;
    }
    this.renderView();
  }

  private async syncLobbyBootstrap(): Promise<void> {
    await this.refreshLobbyRoomList();
    await this.refreshLobbyAccountProfile();
  }

  private async refreshLobbyAccountProfile(): Promise<void> {
    const storage = this.readWebStorage();
    const requestEpoch = this.bumpLobbyAccountEpoch();
    this.lobbyLeaderboardStatus = "loading";
    this.lobbyLeaderboardError = null;
    this.renderView();
    const storedSession = readStoredCocosAuthSession(storage);
    const activeSession = storedSession?.playerId === this.playerId ? storedSession : null;
    const syncedSession = await resolveVeilRootRuntime().syncAuthSession(this.remoteUrl, {
      storage,
      session: activeSession
    });
    if (!this.isActiveLobbyAccountEpoch(requestEpoch)) {
      return;
    }

    if (syncedSession) {
      this.authToken = syncedSession.token ?? null;
      this.authMode = syncedSession.authMode;
      this.authProvider = syncedSession.provider ?? "guest";
      this.loginId = syncedSession.loginId ?? "";
      this.sessionSource = syncedSession.source;
      this.playerId = syncedSession.playerId;
      this.displayName = syncedSession.displayName;
      await this.maybeClaimLaunchReferral(syncedSession);
    } else if (this.sessionSource !== "manual") {
      this.authToken = null;
      this.authMode = "guest";
      this.authProvider = "guest";
      this.loginId = "";
      this.sessionSource = "none";
    }

    const [profile, leaderboardResult] = await Promise.all([
      resolveVeilRootRuntime().loadAccountProfile(this.remoteUrl, this.playerId, this.roomId, {
        storage,
        authSession: syncedSession
      }),
      resolveVeilRootRuntime()
        .loadLeaderboard(this.remoteUrl, 50)
        .then((entries) => ({ ok: true as const, entries }))
        .catch((error: unknown) => ({ ok: false as const, error }))
    ]);
    if (!this.isActiveLobbyAccountEpoch(requestEpoch)) {
      return;
    }

    this.commitAccountProfile(profile, false);
    if (leaderboardResult.ok) {
      this.lobbyLeaderboardEntries = leaderboardResult.entries;
      this.lobbyLeaderboardStatus = "ready";
      this.lobbyLeaderboardError = null;
    } else {
      this.lobbyLeaderboardEntries = [];
      this.lobbyLeaderboardStatus = "error";
      this.lobbyLeaderboardError =
        leaderboardResult.error instanceof Error ? leaderboardResult.error.message : "leaderboard_unavailable";
    }
    if (profile.source === "remote") {
      this.displayName = profile.displayName;
      this.loginId = profile.loginId ?? this.loginId;
    }
    this.syncWechatShareBridge();
    this.renderView();
  }

  private async refreshActiveAccountReviewSection(section = this.lobbyAccountReviewState.activeSection): Promise<void> {
    if (section === "progression") {
      await this.refreshProgressionReview();
      return;
    }

    if (section === "achievements") {
      await this.refreshAchievementReview();
      return;
    }

    if (section === "event-history") {
      await this.refreshAccountReviewPage("event-history", this.lobbyAccountReviewState.eventHistory.page);
      return;
    }

    await this.refreshAccountReviewPage("battle-replays", this.lobbyAccountReviewState.battleReplays.page);
  }

  private async refreshProgressionReview(): Promise<void> {
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "section.loading",
      section: "progression"
    });
    this.renderView();

    try {
      const snapshot = await resolveVeilRootRuntime().loadProgressionSnapshot(this.remoteUrl, this.playerId, 6, {
        storage: this.readWebStorage(),
        authSession: this.currentLobbyAuthSession(),
        throwOnError: true
      });
      this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
        type: "progression.loaded",
        snapshot
      });
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(), {
          category: "progression",
          checkpoint: "review.loaded",
          status: "success",
          detail: `Progression review loaded with ${snapshot.recentEventLog.length} recent events.`,
          itemCount: snapshot.recentEventLog.length
        })
      );
    } catch (error) {
      const message = this.describeAccountReviewLoadError(error);
      this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
        type: "section.failed",
        section: "progression",
        message
      });
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(), {
          category: "progression",
          checkpoint: "review.failed",
          status: "failure",
          detail: message,
          reason: message
        })
      );
    }

    this.renderView();
  }

  private async refreshAchievementReview(): Promise<void> {
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "section.loading",
      section: "achievements"
    });
    this.renderView();

    try {
      const items = await resolveVeilRootRuntime().loadAchievementProgress(this.remoteUrl, this.playerId, undefined, {
        storage: this.readWebStorage(),
        authSession: this.currentLobbyAuthSession(),
        throwOnError: true
      });
      this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
        type: "achievements.loaded",
        items
      });
    } catch (error) {
      this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
        type: "section.failed",
        section: "achievements",
        message: this.describeAccountReviewLoadError(error)
      });
    }

    this.renderView();
  }

  private async toggleGameplayAccountReviewPanel(forceOpen?: boolean): Promise<void> {
    const nextOpen = forceOpen ?? !this.gameplayAccountReviewPanelOpen;
    this.gameplayAccountReviewPanelOpen = nextOpen;
    if (!nextOpen) {
      this.renderView();
      return;
    }

    this.renderView();
    await this.refreshActiveAccountReviewSection();
  }

  private toggleGameplayEquipmentPanel(forceOpen?: boolean): void {
    this.gameplayEquipmentPanelOpen = forceOpen ?? !this.gameplayEquipmentPanelOpen;
    this.renderView();
  }

  private resolveReportTarget(): { playerId: string; name: string } | null {
    const target = this.lastUpdate?.world.visibleHeroes.find((hero) => hero.playerId !== this.playerId) ?? null;
    return target ? { playerId: target.playerId, name: `${target.name} · ${target.playerId}` } : null;
  }

  private resolveSurrenderTarget(): { playerId: string; name: string } | null {
    const target = this.lastUpdate?.world.visibleHeroes.find((hero) => hero.playerId !== this.playerId) ?? null;
    return target ? { playerId: target.playerId, name: `${target.name} · ${target.playerId}` } : null;
  }

  private isSurrenderAvailable(): boolean {
    return Boolean(this.activeHero() && this.resolveSurrenderTarget() && !this.lastUpdate?.battle);
  }

  private toggleReportDialog(): void {
    if (this.reportSubmitting) {
      return;
    }

    const target = this.resolveReportTarget();
    if (!target) {
      this.reportDialogOpen = false;
      this.reportStatusMessage = "当前没有可举报的对手。";
      this.predictionStatus = this.reportStatusMessage;
      this.renderView();
      return;
    }

    this.reportDialogOpen = !this.reportDialogOpen;
    this.reportStatusMessage = this.reportDialogOpen ? `目标 ${target.name} · ${target.playerId}` : null;
    this.renderView();
  }

  private closeReportDialog(): void {
    if (this.reportSubmitting) {
      return;
    }

    this.reportDialogOpen = false;
    this.reportStatusMessage = null;
    this.renderView();
  }

  private toggleSurrenderDialog(): void {
    if (this.surrenderSubmitting) {
      return;
    }

    if (!this.isSurrenderAvailable()) {
      this.surrenderDialogOpen = false;
      this.surrenderStatusMessage = "当前不满足认输条件。";
      this.predictionStatus = this.surrenderStatusMessage;
      this.renderView();
      return;
    }

    const target = this.resolveSurrenderTarget();
    this.surrenderDialogOpen = !this.surrenderDialogOpen;
    this.surrenderStatusMessage = this.surrenderDialogOpen ? `认输后将判负给 ${target?.name ?? "当前对手"}。` : null;
    this.renderView();
  }

  private closeSurrenderDialog(): void {
    if (this.surrenderSubmitting) {
      return;
    }

    this.surrenderDialogOpen = false;
    this.surrenderStatusMessage = null;
    this.renderView();
  }

  private async submitPlayerReport(reason: PlayerReportReason): Promise<void> {
    const target = this.resolveReportTarget();
    if (!this.session || !target) {
      this.reportDialogOpen = false;
      this.reportStatusMessage = "当前没有可举报的对手。";
      this.renderView();
      return;
    }

    this.reportSubmitting = true;
    this.reportStatusMessage = `正在举报 ${target.name}...`;
    this.renderView();

    try {
      await this.session.reportPlayer(target.playerId, reason);
      this.reportDialogOpen = false;
      this.reportStatusMessage = `已提交举报：${target.name}`;
      this.predictionStatus = "举报已提交，等待管理员审核。";
      this.pushLog(`已举报 ${target.name}：${reason}`);
    } catch (error) {
      this.reportStatusMessage = error instanceof Error
        ? error.message === "duplicate_player_report"
          ? "同一场对局中已举报过该玩家。"
          : error.message === "report_target_unavailable"
            ? "目标玩家已不在当前对局中。"
            : error.message === "reporting_unavailable"
              ? "当前服务器未启用举报存储。"
              : error.message === "report_submit_failed"
                ? "举报提交失败。"
            : "举报提交失败。"
        : "举报提交失败。";
      this.predictionStatus = this.reportStatusMessage;
    } finally {
      this.reportSubmitting = false;
      this.renderView();
    }
  }

  private async confirmSurrender(): Promise<void> {
    if (!this.session) {
      await this.connect();
      return;
    }

    const hero = this.activeHero();
    const target = this.resolveSurrenderTarget();
    if (!hero || !target || this.lastUpdate?.battle) {
      this.surrenderDialogOpen = false;
      this.surrenderStatusMessage = "当前不满足认输条件。";
      this.predictionStatus = this.surrenderStatusMessage;
      this.renderView();
      return;
    }

    this.surrenderSubmitting = true;
    this.surrenderStatusMessage = `正在向 ${target.name} 提交认输...`;
    this.renderView();

    try {
      const update = await this.session.surrender(hero.id);
      await this.applySessionUpdate(update);
      if (update.reason && isSessionSettlementReason(update.reason)) {
        const message = formatSessionSettlementReason(update.reason, false);
        this.predictionStatus = message;
        this.pushLog(message);
      }
      this.surrenderDialogOpen = false;
      this.surrenderStatusMessage = "认输已提交。";
    } catch (error) {
      const failureMessage = this.describeSessionError(error, "认输失败。");
      this.surrenderStatusMessage = failureMessage;
      this.predictionStatus = failureMessage;
      this.pushLog(failureMessage);
    } finally {
      this.surrenderSubmitting = false;
      this.renderView();
    }
  }

  private async openGameplayBattleReportCenter(): Promise<void> {
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "section.selected",
      section: "battle-replays"
    });
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "battle-replay.selected",
      replayId: this.lobbyAccountProfile.battleReportCenter?.latestReportId ?? this.lobbyAccountReviewState.selectedBattleReplayId
    });
    await this.toggleGameplayAccountReviewPanel(true);
  }

  private async refreshAccountReviewPage(
    section: "battle-replays" | "event-history",
    page: number
  ): Promise<void> {
    const safePage = Math.max(0, Math.floor(page));
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "section.loading",
      section
    });
    this.renderView();

    try {
      if (section === "event-history") {
        const history = await resolveVeilRootRuntime().loadEventHistory(
          this.remoteUrl,
          this.playerId,
          {
            limit: ACCOUNT_REVIEW_PAGE_SIZE,
            offset: safePage * ACCOUNT_REVIEW_PAGE_SIZE
          },
          {
            storage: this.readWebStorage(),
            authSession: this.currentLobbyAuthSession(),
            throwOnError: true
          }
        );
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "event-history.loaded",
          items: history.items,
          page: Math.floor(history.offset / Math.max(1, history.limit)),
          pageSize: history.limit,
          total: history.total,
          hasMore: history.hasMore
        });
      } else {
        const history = await resolveVeilRootRuntime().loadBattleReplayHistoryPage(
          this.remoteUrl,
          this.playerId,
          {
            limit: ACCOUNT_REVIEW_PAGE_SIZE,
            offset: safePage * ACCOUNT_REVIEW_PAGE_SIZE
          },
          {
            storage: this.readWebStorage(),
            authSession: this.currentLobbyAuthSession(),
            throwOnError: true
          }
        );
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "battle-replays.loaded",
          items: history.items,
          page: Math.floor(history.offset / Math.max(1, history.limit)),
          pageSize: history.limit,
          hasMore: history.hasMore
        });
      }
    } catch (error) {
      this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
        type: "section.failed",
        section,
        message: this.describeAccountReviewLoadError(error)
      });
    }

    this.renderView();
  }

  private currentLobbyAuthSession(): {
    token: string;
    playerId: string;
    displayName: string;
    authMode: "guest" | "account";
    loginId?: string;
    source: "remote";
  } | null {
    if (!this.authToken) {
      return null;
    }

    return {
      token: this.authToken,
      playerId: this.playerId,
      displayName: this.displayName || this.playerId,
      authMode: this.authMode,
      ...(this.loginId ? { loginId: this.loginId } : {}),
      source: "remote"
    };
  }

  private describeAccountReviewLoadError(error: unknown): string {
    return error instanceof Error && error.message.trim() ? error.message : "网络暂不可用，请稍后重试。";
  }

  private computeLayoutMetrics(): {
    effectiveTileSize: number;
    hudWidth: number;
    rightWidth: number;
    mapWidth: number;
    hudHeight: number;
    battleHeight: number;
    timelineHeight: number;
  } {
    const visibleSize = view.getVisibleSize();
    const hudWidth = Math.max(228, Math.min(264, Math.floor(visibleSize.width * 0.215)));
    const rightWidth = Math.max(244, Math.min(276, Math.floor(visibleSize.width * 0.205)));
    const effectiveTileSize = this.computeEffectiveTileSize(hudWidth, rightWidth);
    const mapWidth = this.currentMapPixelWidth(effectiveTileSize);
    const hudHeight = Math.max(318, visibleSize.height - 52);
    const battleHeight = Math.max(132, Math.floor((visibleSize.height - 72) * 0.23));
    const timelineHeight = Math.max(226, visibleSize.height - battleHeight - 74);

    return {
      effectiveTileSize,
      hudWidth,
      rightWidth,
      mapWidth,
      hudHeight,
      battleHeight,
      timelineHeight
    };
  }

  private computeEffectiveTileSize(hudWidth: number, rightWidth: number): number {
    const visibleSize = view.getVisibleSize();
    const margin = 24;
    const widthTiles = this.lastUpdate?.world.map.width ?? DEFAULT_MAP_WIDTH_TILES;
    const heightTiles = this.lastUpdate?.world.map.height ?? DEFAULT_MAP_HEIGHT_TILES;
    const availableWidth = Math.max(240, visibleSize.width - hudWidth - rightWidth - margin * 4);
    const availableHeight = Math.max(320, visibleSize.height - margin * 2);
    const widthBound = Math.floor(availableWidth / widthTiles);
    const heightBound = Math.floor(availableHeight / heightTiles);
    return Math.max(36, Math.min(this.tileSize, widthBound, heightBound));
  }

  private currentMapPixelWidth(tileSize = this.tileSize): number {
    const widthTiles = this.lastUpdate?.world.map.width ?? DEFAULT_MAP_WIDTH_TILES;
    return widthTiles * tileSize;
  }

  private currentMapPixelHeight(tileSize = this.tileSize): number {
    const heightTiles = this.lastUpdate?.world.map.height ?? DEFAULT_MAP_HEIGHT_TILES;
    return heightTiles * tileSize;
  }

  private updateLayout(): void {
    const visibleSize = view.getVisibleSize();
    const margin = 24;
    const { effectiveTileSize, hudWidth, rightWidth, mapWidth, hudHeight, battleHeight, timelineHeight } =
      this.computeLayoutMetrics();
    const mapHeight = Math.max(this.currentMapPixelHeight(effectiveTileSize), visibleSize.height - margin * 2);

    const hudNode = this.node.getChildByName(HUD_NODE_NAME);
    const mapNode = this.node.getChildByName(MAP_NODE_NAME);
    const battleNode = this.node.getChildByName(BATTLE_NODE_NAME);
    const timelineNode = this.node.getChildByName(TIMELINE_NODE_NAME);
    const lobbyNode = this.node.getChildByName(LOBBY_NODE_NAME);
    const accountReviewPanelNode = this.node.getChildByName(ACCOUNT_REVIEW_PANEL_NODE_NAME);
    const equipmentPanelNode = this.node.getChildByName(EQUIPMENT_PANEL_NODE_NAME);
    const settingsPanelNode = this.node.getChildByName(SETTINGS_PANEL_NODE_NAME);
    const settingsButtonNode = this.node.getChildByName(SETTINGS_BUTTON_NODE_NAME);

    this.mapBoard?.configure({
      tileSize: effectiveTileSize,
      onTileSelected: (tile) => {
        void this.moveHeroToTile(tile);
      },
      onInputDebug: (message) => {
        this.inputDebug = message;
        this.renderView();
      }
    });

    if (hudNode) {
      const hudTransform = hudNode.getComponent(UITransform) ?? hudNode.addComponent(UITransform);
      hudTransform.setContentSize(hudWidth, hudHeight);
      hudNode.setPosition(-visibleSize.width / 2 + margin + hudWidth / 2, 56, 0);
      this.hudPanel?.configure({
        onNewRun: () => {
          void this.startNewRun();
        },
        onRefresh: () => {
          void this.refreshSnapshot();
        },
        onToggleSettings: () => {
          this.toggleSettingsPanel();
        },
        onToggleInventory: () => {
          this.toggleGameplayEquipmentPanel();
        },
        onToggleAchievements: () => {
          void this.openGameplayBattleReportCenter();
        },
        onToggleReport: () => {
          this.toggleReportDialog();
        },
        onToggleSurrender: () => {
          this.toggleSurrenderDialog();
        },
        onSubmitReport: (reason) => {
          void this.submitPlayerReport(reason);
        },
        onCancelReport: () => {
          this.closeReportDialog();
        },
        onConfirmSurrender: () => {
          void this.confirmSurrender();
        },
        onCancelSurrender: () => {
          this.closeSurrenderDialog();
        },
        onLearnSkill: (skillId) => {
          void this.learnHeroSkill(skillId);
        },
        onEquipItem: (slot, equipmentId) => {
          void this.equipHeroItem(slot, equipmentId);
        },
        onUnequipItem: (slot) => {
          void this.unequipHeroItem(slot);
        },
        onEndDay: () => {
          void this.advanceDay();
        },
        onReturnLobby: () => {
          void this.returnToLobby();
        },
        onInteractionAction: (actionId) => {
          const tile = this.selectedInteractionTile();
          if (!tile?.building) {
            return;
          }
          if (actionId === "recruit" || actionId === "visit" || actionId === "claim" || actionId === "upgrade") {
            void this.executeBuildingInteraction(tile, actionId);
          }
        }
      });
    }

    if (mapNode) {
      const mapTransform = mapNode.getComponent(UITransform) ?? mapNode.addComponent(UITransform);
      mapTransform.setContentSize(mapWidth, mapHeight);
      const mapLeft = -visibleSize.width / 2 + margin + hudWidth + margin;
      mapNode.setPosition(mapLeft + mapWidth / 2, 0, 0);
    }

    if (battleNode) {
      const battleTransform = battleNode.getComponent(UITransform) ?? battleNode.addComponent(UITransform);
      battleTransform.setContentSize(rightWidth, battleHeight);
      battleNode.setPosition(
        visibleSize.width / 2 - margin - rightWidth / 2,
        visibleSize.height / 2 - margin - battleHeight / 2 + 2,
        0
      );
    }

    if (timelineNode) {
      const timelineTransform = timelineNode.getComponent(UITransform) ?? timelineNode.addComponent(UITransform);
      timelineTransform.setContentSize(rightWidth, timelineHeight);
      timelineNode.setPosition(
        visibleSize.width / 2 - margin - rightWidth / 2,
        -visibleSize.height / 2 + margin + timelineHeight / 2 + 8,
        0
      );
    }

    if (lobbyNode) {
      const lobbyTransform = lobbyNode.getComponent(UITransform) ?? lobbyNode.addComponent(UITransform);
      lobbyTransform.setContentSize(Math.max(360, Math.min(860, visibleSize.width - 40)), Math.max(520, visibleSize.height - 48));
      lobbyNode.setPosition(0, 0, 0);
    }

    if (accountReviewPanelNode) {
      const accountReviewTransform =
        accountReviewPanelNode.getComponent(UITransform) ?? accountReviewPanelNode.addComponent(UITransform);
      accountReviewTransform.setContentSize(Math.max(320, Math.min(420, visibleSize.width - 56)), Math.max(360, visibleSize.height - 96));
      accountReviewPanelNode.setPosition(0, 0, 4);
    }

    if (equipmentPanelNode) {
      const equipmentPanelTransform =
        equipmentPanelNode.getComponent(UITransform) ?? equipmentPanelNode.addComponent(UITransform);
      equipmentPanelTransform.setContentSize(Math.max(360, Math.min(460, visibleSize.width - 56)), Math.max(420, visibleSize.height - 96));
      equipmentPanelNode.setPosition(0, 0, 4);
    }

    if (settingsPanelNode) {
      const settingsPanelTransform =
        settingsPanelNode.getComponent(UITransform) ?? settingsPanelNode.addComponent(UITransform);
      settingsPanelTransform.setContentSize(Math.max(360, Math.min(460, visibleSize.width - 64)), Math.max(440, visibleSize.height - 96));
      settingsPanelNode.setPosition(0, 0, 6);
    }

    if (settingsButtonNode) {
      const buttonTransform = settingsButtonNode.getComponent(UITransform) ?? settingsButtonNode.addComponent(UITransform);
      buttonTransform.setContentSize(58, 58);
      settingsButtonNode.setPosition(visibleSize.width / 2 - margin - 34, visibleSize.height / 2 - margin - 34, 7);
      this.renderSettingsButton();
    }
  }

  private handleHudActionInput(...args: unknown[]): void {
    this.audioRuntime.unlock();
    const event = args[0] as EventTouch | EventMouse | undefined;
    if (!event) {
      return;
    }

    const visibleSize = view.getVisibleSize();
    const centeredX = event.getUILocation().x - visibleSize.width / 2;
    const centeredY = event.getUILocation().y - visibleSize.height / 2;
    const settingsButtonNode = this.node.getChildByName(SETTINGS_BUTTON_NODE_NAME);
    if (this.pointInRootNode(centeredX, centeredY, settingsButtonNode)) {
      this.toggleSettingsPanel();
      this.inputDebug = "button settings-fab";
      return;
    }

    const settingsPanelNode = this.node.getChildByName(SETTINGS_PANEL_NODE_NAME);
    const settingsPanelTransform = settingsPanelNode?.getComponent(UITransform) ?? null;
    if (this.settingsView.open && settingsPanelNode && settingsPanelTransform) {
      const settingsLocalX = centeredX - settingsPanelNode.position.x;
      const settingsLocalY = centeredY - settingsPanelNode.position.y;
      if (
        settingsLocalX >= -settingsPanelTransform.width / 2
        && settingsLocalX <= settingsPanelTransform.width / 2
        && settingsLocalY >= -settingsPanelTransform.height / 2
        && settingsLocalY <= settingsPanelTransform.height / 2
      ) {
        const action = this.settingsPanel?.dispatchPointerUp(settingsLocalX, settingsLocalY) ?? null;
        if (action) {
          this.inputDebug = `button ${action}`;
        }
        return;
      }
    }

    if (this.showLobby) {
      return;
    }

    const hudNode = this.node.getChildByName(HUD_NODE_NAME);
    const hudTransform = hudNode?.getComponent(UITransform) ?? null;
    if (!hudNode || !hudTransform) {
      return;
    }

    const hudLocalX = centeredX - hudNode.position.x;
    const hudLocalY = centeredY - hudNode.position.y;
    if (
      hudLocalX < -hudTransform.width / 2 ||
      hudLocalX > hudTransform.width / 2 ||
      hudLocalY < -hudTransform.height / 2 ||
      hudLocalY > hudTransform.height / 2
    ) {
      return;
    }

    const action = this.hudPanel?.dispatchPointerUp(hudLocalX, hudLocalY) ?? null;
    if (!action) {
      return;
    }

    this.inputDebug = `button ${action}`;
  }

  private scheduleFogPulseTick(): void {
    this.scheduleOnce(() => {
      if (!this.fogPulseEnabled) {
        return;
      }

      this.fogPulsePhase = (this.fogPulsePhase + 1) % 2;
      this.mapBoard?.setFogPulsePhase(this.fogPulsePhase);
      if (this.lastUpdate) {
        this.mapBoard?.render(this.lastUpdate);
      }
      this.scheduleFogPulseTick();
    }, Math.max(0.2, this.fogPulseIntervalSeconds));
  }

  private pushLog(line: string): void {
    this.logLines.unshift(line);
    this.logLines = this.logLines.slice(0, 8);
  }

  private emitPrimaryClientTelemetry(event: PrimaryClientTelemetryEvent | PrimaryClientTelemetryEvent[] | null): void {
    this.primaryClientTelemetry = appendPrimaryClientTelemetry(this.primaryClientTelemetry, event);
  }

  private createTelemetryContext(heroId?: string | null): { roomId: string; playerId: string; heroId?: string } {
    return {
      roomId: this.roomId,
      playerId: this.playerId,
      ...(heroId ? { heroId } : {})
    };
  }

  private setBattleFeedback(feedback: CocosBattleFeedbackView | null, durationMs = BATTLE_FEEDBACK_DURATION_MS): void {
    if (!feedback) {
      return;
    }

    this.battleFeedback = {
      ...feedback,
      expiresAt: Date.now() + durationMs
    };
  }

  private activeHero(): HeroView | null {
    return this.lastUpdate?.world.ownHeroes[0] ?? null;
  }

  private controlledBattleCamp(): "attacker" | "defender" | null {
    const battle = this.lastUpdate?.battle;
    const heroId = this.activeHero()?.id;
    if (!battle || !heroId) {
      return null;
    }

    if (battle.worldHeroId === heroId) {
      return "attacker";
    }

    if (battle.defenderHeroId === heroId) {
      return "defender";
    }

    return null;
  }

  private opposingBattleCamp(camp: "attacker" | "defender" | null): "attacker" | "defender" | null {
    if (!camp) {
      return null;
    }

    return camp === "attacker" ? "defender" : "attacker";
  }

  private syncSelectedBattleTarget(): void {
    const battle = this.lastUpdate?.battle;
    const enemyCamp = this.opposingBattleCamp(this.controlledBattleCamp());
    if (!battle || !enemyCamp) {
      this.selectedBattleTargetId = null;
      return;
    }

    const targets = Object.values(battle.units).filter((unit) => unit.camp === enemyCamp && unit.count > 0);
    if (targets.length === 0) {
      this.selectedBattleTargetId = null;
      return;
    }

    if (!this.selectedBattleTargetId || !targets.some((target) => target.id === this.selectedBattleTargetId)) {
      this.selectedBattleTargetId = targets[0]?.id ?? null;
    }
  }

  private selectedInteractionTile(): PlayerTileView | null {
    const buildingId = this.selectedInteractionBuildingId;
    if (!buildingId) {
      return null;
    }

    return this.lastUpdate?.world.map.tiles.find((tile) => tile.building?.id === buildingId) ?? null;
  }

  private clearSelectedInteractionBuilding(): void {
    this.selectedInteractionBuildingId = null;
  }

  private formatUpgradeCostLabel(cost: { gold: number; wood: number; ore: number }): string {
    return [`金币 ${cost.gold}`, `木材 ${cost.wood}`, `矿石 ${cost.ore}`].join(" / ");
  }

  private buildHudInteractionState(): VeilHudRenderState["interaction"] {
    const hero = this.activeHero();
    const tile = this.selectedInteractionTile();
    const building = tile?.building;
    if (!hero || !tile || !building) {
      return null;
    }

    const heroDistance = Math.abs(hero.position.x - tile.position.x) + Math.abs(hero.position.y - tile.position.y);
    if (heroDistance > 1) {
      return null;
    }

    const actions: NonNullable<VeilHudRenderState["interaction"]>["actions"] = [];
    const tierLabel = `等级 ${building.tier}${building.maxTier ? `/${building.maxTier}` : ""}`;
    const trackId = building.kind === "recruitment_post" ? "castle" : building.kind === "resource_mine" ? "mine" : null;
    const maxTier = building.maxTier ?? (trackId === "castle" ? 3 : trackId === "mine" ? 2 : building.tier);
    const upgradeStep =
      building.kind === "recruitment_post" || building.kind === "resource_mine"
        ? getBuildingUpgradeConfig()[trackId!].find((step) => step.fromTier === building.tier) ?? null
        : null;

    if (heroDistance === 0) {
      if (building.kind === "recruitment_post") {
        actions.push({ id: "recruit", label: "招募部队" });
      } else if (building.kind === "attribute_shrine" || building.kind === "watchtower") {
        actions.push({ id: "visit", label: "访问建筑" });
      } else if (building.kind === "resource_mine") {
        actions.push({ id: "claim", label: "采集矿场" });
      }
    }

    if ((building.kind === "recruitment_post" || building.kind === "resource_mine") && building.ownerPlayerId === hero.playerId) {
      if (building.tier >= maxTier) {
        return {
          title: building.label,
          detail: `${tierLabel} · 已满级`,
          actions
        };
      }

      if (upgradeStep) {
        actions.push({ id: "upgrade", label: `升级建筑 · ${building.tier}→${upgradeStep.toTier}` });
        return {
          title: building.label,
          detail: `${tierLabel} · 升级花费 ${this.formatUpgradeCostLabel(upgradeStep.cost)}`,
          actions
        };
      }
    }

    return {
      title: building.label,
      detail:
        building.kind === "resource_mine"
          ? `${tierLabel} · ${formatResourceKindLabel(building.resourceKind)} +${building.income}`
          : building.kind === "recruitment_post"
            ? `${tierLabel} · 可招募 ${building.availableCount} 单位`
            : tierLabel,
      actions
    };
  }

  private async executeBuildingInteraction(tile: PlayerTileView, actionId: "recruit" | "visit" | "claim" | "upgrade"): Promise<void> {
    const hero = this.activeHero();
    const building = tile.building;
    if (!hero || !building || !this.session) {
      return;
    }

    this.moveInFlight = true;
    const predictionAction =
      actionId === "recruit"
        ? { type: "hero.recruit", heroId: hero.id, buildingId: building.id } as const
        : actionId === "visit"
          ? { type: "hero.visit", heroId: hero.id, buildingId: building.id } as const
          : actionId === "claim"
            ? { type: "hero.claimMine", heroId: hero.id, buildingId: building.id } as const
            : { type: "hero.upgradeBuilding", heroId: hero.id, buildingId: building.id } as const;
    const predictionLabel =
      actionId === "recruit"
        ? `预演招募 ${building.kind === "recruitment_post" ? building.availableCount : 0} 单位`
        : actionId === "visit"
          ? building.kind === "attribute_shrine"
            ? `预演获得 ${formatHeroStatBonus(building.bonus)}`
            : building.kind === "watchtower"
              ? `预演提高视野 ${building.visionBonus}`
              : "预演访问建筑"
          : actionId === "claim"
            ? building.kind === "resource_mine"
              ? `预演占领矿场，改为每日产出 ${building.income} ${formatResourceKindLabel(building.resourceKind)}`
              : "预演矿场采集"
            : "预演建筑升级";
    this.applyPrediction(predictionAction, predictionLabel);
    this.renderView();

    try {
      this.mapBoard?.playHeroAnimation("attack");
      const update =
        actionId === "recruit"
          ? await this.session.recruit(hero.id, building.id)
          : actionId === "visit"
            ? await this.session.visitBuilding(hero.id, building.id)
            : actionId === "claim"
              ? await this.session.claimMine(hero.id, building.id)
              : await this.session.upgradeBuilding(hero.id, building.id);
      this.clearSelectedInteractionBuilding();
      await this.applySessionUpdate(update);
      this.pushSessionActionOutcome(update, {
        successMessage:
          actionId === "recruit"
            ? "招募已结算。"
            : actionId === "visit"
              ? building.kind === "watchtower"
                ? "瞭望塔访问已结算。"
                : "建筑访问已结算。"
              : actionId === "claim"
                ? "矿场占领已结算。"
                : "建筑升级已结算。",
        rejectedLabel:
          actionId === "recruit"
            ? "招募"
            : actionId === "visit"
              ? "访问"
              : actionId === "claim"
                ? "矿场占领"
                : "建筑升级"
      });
    } catch (error) {
      this.rollbackPrediction(error instanceof Error ? error.message : `${actionId}失败。`);
    } finally {
      this.moveInFlight = false;
      this.renderView();
    }
  }

  private async moveHeroToTile(tile: PlayerTileView): Promise<void> {
    if (this.moveInFlight) {
      return;
    }

    if (!this.session) {
      await this.connect();
      return;
    }

    const hero = this.activeHero();
    if (!hero) {
      this.pushLog("当前快照里没有可控制的英雄。");
      this.renderView();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("当前正在战斗，暂时无法移动。");
      this.renderView();
      return;
    }

    const reachableTiles = await this.ensureReachableTiles(hero.id);
    const clickedCurrentTile = hero.position.x === tile.position.x && hero.position.y === tile.position.y;
    if (!clickedCurrentTile && tile.building) {
      const interactionDistance = Math.abs(hero.position.x - tile.position.x) + Math.abs(hero.position.y - tile.position.y);
      if (interactionDistance <= 1) {
        this.selectedInteractionBuildingId = tile.building.id;
        this.pushLog(`已选中 ${tile.building.label}，请在 HUD 中确认操作。`);
        this.mapBoard?.pulseObject(tile.position, 1.2, 0.24);
        this.renderView();
        return;
      }
    }

    if (clickedCurrentTile) {
      if (!tile.resource && !tile.building) {
        this.pushLog("英雄已经站在这里了。");
        this.mapBoard?.pulseTile(tile.position, 1.04, 0.14);
        this.mapBoard?.showTileFeedback(tile.position, "原地", 0.45);
        this.renderView();
        return;
      }

      if (tile.building) {
        this.selectedInteractionBuildingId = tile.building.id;
        this.pushLog(`已选中 ${tile.building.label}，请在 HUD 中确认操作。`);
        this.mapBoard?.pulseObject(tile.position, 1.2, 0.24);
        this.renderView();
        return;
      }

      const resource = tile.resource;
      if (!resource) {
        this.clearSelectedInteractionBuilding();
        this.pushLog("当前格子没有可采集资源。");
        this.renderView();
        return;
      }

      this.moveInFlight = true;
      const resourceLabel = resource.kind === "gold" ? "金币" : resource.kind === "wood" ? "木材" : resource.kind === "ore" ? "矿石" : resource.kind;
      this.pushLog(`正在采集 ${resourceLabel} +${resource.amount}`);
      this.mapBoard?.pulseTile(tile.position, 1.12, 0.22);
      this.mapBoard?.pulseObject(tile.position, 1.2, 0.24);
      this.applyPrediction(
        {
          type: "hero.collect",
          heroId: hero.id,
          position: tile.position
        },
        `预演采集 ${resourceLabel} +${resource.amount}`
      );
      this.renderView();

      try {
        this.mapBoard?.playHeroAnimation("attack");
        const update = await this.session.collect(hero.id, tile.position);
        await this.applySessionUpdate(update);
        this.pushSessionActionOutcome(update, {
          successMessage: "采集已结算。",
          rejectedLabel: "采集"
        });
      } catch (error) {
        this.rollbackPrediction(error instanceof Error ? error.message : "采集失败。");
      } finally {
        this.moveInFlight = false;
        this.renderView();
      }
      return;
    }

    this.clearSelectedInteractionBuilding();
    if (hero.move.remaining <= 0) {
      this.pushLog(`${hero.name} 今天已经没有移动力了。`);
      this.predictionStatus = "今天已经没有移动点了。";
      this.mapBoard?.pulseTile(hero.position, 1.06, 0.18);
      this.mapBoard?.showTileFeedback(hero.position, "耗尽", 0.7);
      this.renderView();
      return;
    }

    const target = reachableTiles.find((node) => node.x === tile.position.x && node.y === tile.position.y) ?? null;
    if (!target) {
      const movePrediction = this.lastUpdate
        ? predictSharedPlayerWorldAction(this.lastUpdate.world, {
            type: "hero.move",
            heroId: hero.id,
            destination: tile.position
          })
        : null;
      const moveFeedback = describeMoveAttemptFeedback(tile.position, movePrediction?.reason);
      this.pushLog(moveFeedback.message);
      if (movePrediction?.reason === "not_enough_move_points") {
        this.predictionStatus = moveFeedback.message;
      }
      this.mapBoard?.pulseTile(tile.position, 1.08, 0.18);
      this.mapBoard?.showTileFeedback(tile.position, moveFeedback.tileFeedback, 0.6);
      this.renderView();
      return;
    }

    this.moveInFlight = true;
    this.pushLog(`正在移动 ${hero.name} -> (${target.x}, ${target.y})`);
    this.mapBoard?.pulseTile(target, tile.occupant?.kind ? 1.1 : 1.06, 0.18);
    if (tile.resource || tile.occupant) {
      this.mapBoard?.pulseObject(target, tile.occupant?.kind ? 1.18 : 1.14, 0.22);
    }
    this.applyPrediction(
      {
        type: "hero.move",
        heroId: hero.id,
        destination: target
      },
      tile.occupant?.kind === "neutral" || tile.occupant?.kind === "hero"
        ? "正在预演遭遇..."
        : "正在预演移动..."
    );
    this.renderView();

    try {
      this.mapBoard?.playHeroAnimation("move");
      const update = await this.session.moveHero(hero.id, target);
      await this.applySessionUpdate(update);
      this.pushSessionActionOutcome(update, {
        successMessage: "移动已结算。",
        rejectedLabel: "移动"
      });
    } catch (error) {
      this.rollbackPrediction(error instanceof Error ? error.message : "移动失败。");
    } finally {
      this.moveInFlight = false;
      this.renderView();
    }
  }

  private async ensureReachableTiles(heroId: string): Promise<Vec2[]> {
    if (this.lastUpdate?.reachableTiles.length) {
      return this.lastUpdate.reachableTiles;
    }

    if (!this.session) {
      return [];
    }

    const reachableTiles = await this.session.listReachable(heroId);
    if (this.lastUpdate) {
      this.lastUpdate = {
        ...this.lastUpdate,
        reachableTiles
      };
    }

    return reachableTiles;
  }

  private async startNewRun(): Promise<void> {
    if (this.moveInFlight || this.battleActionInFlight) {
      return;
    }

    const previousSession = this.session;
    const previousSessionEpoch = this.sessionEpoch;
    const previousRoomId = this.roomId;
    const previousSeed = this.seed;
    const nextRoomId = `run-${Date.now().toString(36).slice(-6)}`;
    const nextSeed = this.seed + 1;
    let freshSession: VeilCocosSession | null = null;
    const nextSessionEpoch = this.bumpSessionEpoch();

    this.pendingPrediction = null;
    this.selectedBattleTargetId = null;
    this.moveInFlight = false;
    this.battleActionInFlight = false;
    this.predictionStatus = "正在开启新一局...";
    this.inputDebug = "input waiting";
    this.timelineEntries = [];
    this.primaryClientTelemetry = [];
    this.logLines = [`正在创建新房间 ${nextRoomId} ...`];
    this.renderView();

    try {
      freshSession = await resolveVeilRootRuntime().createSession(
        nextRoomId,
        this.playerId,
        nextSeed,
        this.createSessionOptions(nextSessionEpoch)
      );
      if (!this.isActiveSessionEpoch(nextSessionEpoch)) {
        await freshSession.dispose().catch(() => undefined);
        return;
      }

      const freshUpdate = await freshSession.snapshot();
      if (!this.isActiveSessionEpoch(nextSessionEpoch)) {
        await freshSession.dispose().catch(() => undefined);
        return;
      }

      this.session = freshSession;
      this.roomId = nextRoomId;
      this.seed = nextSeed;
      this.syncBrowserRoomQuery(nextRoomId);
      this.pushLog(`已进入新房间 ${nextRoomId}。`);
      await this.applySessionUpdate(freshUpdate);

      if (previousSession) {
        await previousSession.dispose().catch(() => undefined);
      }
      return;
    } catch (error) {
      if (freshSession) {
        await freshSession.dispose().catch(() => undefined);
      }
      this.sessionEpoch = previousSessionEpoch;
      this.session = previousSession;
      this.roomId = previousRoomId;
      this.seed = previousSeed;
      const failureMessage = this.describeSessionError(error, "开启新一局失败。");
      this.pushLog(failureMessage);
      this.predictionStatus = failureMessage;
      this.renderView();
    }
  }

  private async refreshLobbyRoomList(): Promise<void> {
    if (this.lobbyLoading || this.lobbyEntering) {
      return;
    }

    this.lobbyLoading = true;
    this.lobbyStatus = "正在刷新可加入房间...";
    this.renderView();

    try {
      const rooms = await resolveVeilRootRuntime().loadLobbyRooms(this.remoteUrl);
      this.lobbyRooms = rooms;
      this.lobbyStatus =
        rooms.length > 0
          ? `发现 ${rooms.length} 个活跃房间，可直接加入或继续创建新房间。`
          : "当前没有活跃房间，输入房间 ID 后点击“进入房间”即可创建新实例。";
    } catch {
      this.lobbyRooms = [];
      this.lobbyStatus = "Lobby 服务暂不可达；仍可直接输入房间 ID，进入时会自动尝试远端房间并在失败后回退本地模式。";
    } finally {
      this.lobbyLoading = false;
      this.renderView();
    }
  }

  private async enterLobbyRoom(roomIdOverride?: string): Promise<void> {
    if (this.lobbyEntering) {
      return;
    }

    if (this.isMatchmakingActive()) {
      this.lobbyStatus = "正在匹配中，请先取消当前队列。";
      this.renderView();
      return;
    }

    if (!this.ensurePrivacyConsentAccepted()) {
      return;
    }

    const storage = this.readWebStorage();
    const preferences = saveCocosLobbyPreferences(this.playerId, roomIdOverride ?? this.roomId, undefined, storage);
    const displayName = rememberPreferredCocosDisplayName(preferences.playerId, this.displayName || preferences.playerId, storage);
    this.playerId = preferences.playerId;
    this.roomId = preferences.roomId;
    this.displayName = displayName;
    this.lobbyEntering = true;
    this.lobbyStatus =
      this.authMode === "account" && this.authToken
        ? `正在使用账号 ${this.loginId || this.playerId} 进入房间 ${preferences.roomId}...`
        : `正在登录游客账号并进入房间 ${preferences.roomId}...`;
    this.renderView();

    try {
      let authSession: Awaited<ReturnType<typeof loginCocosGuestAuthSession>>;
      if (this.authMode === "account" && this.authToken) {
        const syncedSession = await resolveVeilRootRuntime().syncAuthSession(this.remoteUrl, {
          storage,
          session: readStoredCocosAuthSession(storage)
        });
        if (!syncedSession) {
          throw new Error("cocos_request_failed:401");
        }
        authSession = syncedSession;
      } else {
        authSession = await resolveVeilRootRuntime().loginGuestAuthSession(this.remoteUrl, preferences.playerId, displayName, {
          storage,
          privacyConsentAccepted: this.privacyConsentAccepted
        });
      }
      this.authToken = authSession.token ?? null;
      this.playerId = authSession.playerId;
      this.displayName = authSession.displayName;
      this.authMode = authSession.authMode;
      this.authProvider = authSession.provider ?? "guest";
      this.loginId = authSession.loginId ?? "";
      this.sessionSource = authSession.source;
      await this.maybeClaimLaunchReferral(authSession);
      saveCocosLobbyPreferences(authSession.playerId, preferences.roomId, undefined, storage);
      this.resetSessionViewport(`正在进入房间 ${preferences.roomId} ...`);
      this.showLobby = false;
      this.syncBrowserRoomQuery(preferences.roomId);
      this.syncWechatShareBridge();
      this.lobbyStatus =
        authSession.authMode === "account"
          ? `账号 ${authSession.loginId ?? authSession.playerId} 登录成功，正在进入房间 ${preferences.roomId}...`
          : authSession.source === "remote"
            ? `游客登录成功，正在进入房间 ${preferences.roomId}...`
            : `登录服务暂不可达，正在以本地游客档进入房间 ${preferences.roomId}...`;
      this.renderView();
      await this.connect();

      if (!this.session && !this.lastUpdate) {
        this.showLobby = true;
        this.lobbyStatus = "进入房间失败，请稍后重试或刷新房间列表。";
        this.renderView();
        return;
      }

      this.commitAccountProfile(
        createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName),
        false
      );
      this.renderView();
    } catch (error) {
      this.showLobby = true;
      if (error instanceof Error && error.message === "cocos_request_failed:401") {
        const storage = this.readWebStorage();
        if (storage) {
          clearStoredCocosAuthSession(storage);
        }
        this.authToken = null;
        this.authMode = "guest";
        this.authProvider = "guest";
        this.loginId = "";
        this.sessionSource = "none";
      }
      this.lobbyStatus =
        error instanceof Error && error.message === "cocos_request_failed:401"
          ? "账号会话已失效，请重新登录后再进入房间。"
          : error instanceof Error
            ? error.message
            : "enter_room_failed";
      this.renderView();
    } finally {
      this.lobbyEntering = false;
    }
  }

  private isMatchmakingActive(): boolean {
    return this.matchmakingStatus.status === "queued" || this.matchmakingJoinInFlight;
  }

  private updateMatchmakingStatus(status: MatchmakingStatusResponse, lobbyStatus?: string): void {
    this.matchmakingStatus = status;
    this.matchmakingView = buildMatchmakingStatusView(status);
    if (lobbyStatus) {
      this.lobbyStatus = lobbyStatus;
    }
  }

  private stopMatchmakingPolling(): void {
    this.matchmakingPollController?.stop();
    this.matchmakingPollController = null;
    if (this.matchmakingTimeoutHandle) {
      clearTimeout(this.matchmakingTimeoutHandle);
      this.matchmakingTimeoutHandle = null;
    }
  }

  private startMatchmakingPolling(): void {
    this.stopMatchmakingPolling();
    this.matchmakingPollController = resolveVeilRootRuntime().startMatchmakingPolling(
      this.remoteUrl,
      (status) => {
        void this.handleMatchmakingStatusUpdate(status);
      },
      {
        pollIntervalMs: 3000,
        stopOnMatched: true,
        authSession: this.authToken
          ? {
              token: this.authToken,
              playerId: this.playerId,
              displayName: this.displayName || this.playerId,
              authMode: this.authMode,
              ...(this.loginId ? { loginId: this.loginId } : {}),
              source: "remote"
            }
          : null
      }
    );
    this.matchmakingTimeoutHandle = setTimeout(() => {
      void this.handleMatchmakingTimeout();
    }, this.matchmakingTimeoutMs);
  }

  private async ensureMatchmakingAuthSession(): Promise<void> {
    const storage = this.readWebStorage();
    if (this.authMode === "account" && this.authToken) {
      const syncedSession = await resolveVeilRootRuntime().syncAuthSession(this.remoteUrl, {
        storage,
        session: readStoredCocosAuthSession(storage)
      });
      if (!syncedSession) {
        throw new Error("cocos_request_failed:401");
      }
      this.authToken = syncedSession.token ?? null;
      this.playerId = syncedSession.playerId;
      this.displayName = syncedSession.displayName;
      this.authMode = syncedSession.authMode;
      this.authProvider = syncedSession.provider ?? "account-password";
      this.loginId = syncedSession.loginId ?? "";
      this.sessionSource = syncedSession.source;
      await this.maybeClaimLaunchReferral(syncedSession);
      return;
    }

    const authSession = await resolveVeilRootRuntime().loginGuestAuthSession(
      this.remoteUrl,
      this.playerId,
      this.displayName || this.playerId,
      {
        storage,
        privacyConsentAccepted: this.privacyConsentAccepted
      }
    );
    this.authToken = authSession.token ?? null;
    this.playerId = authSession.playerId;
    this.displayName = authSession.displayName;
    this.authMode = authSession.authMode;
    this.authProvider = authSession.provider ?? "guest";
    this.loginId = authSession.loginId ?? "";
    this.sessionSource = authSession.source;
    await this.maybeClaimLaunchReferral(authSession);
  }

  private async enterLobbyMatchmaking(): Promise<void> {
    if (this.lobbyEntering || this.isMatchmakingActive()) {
      return;
    }

    if (!this.ensurePrivacyConsentAccepted()) {
      return;
    }

    this.lobbyEntering = true;
    this.updateMatchmakingStatus({ status: "idle" }, "正在进入 PVP 匹配队列...");
    this.renderView();

    try {
      await this.ensureMatchmakingAuthSession();
      const rating = this.lobbyAccountProfile.eloRating ?? 1000;
      const status = await resolveVeilRootRuntime().enqueueMatchmaking(this.remoteUrl, this.playerId, rating, {
        getDisplayName: () => this.displayName || this.playerId,
        getAuthToken: () => this.authToken
      });
      this.updateMatchmakingStatus(status, this.describeMatchmakingStatus(status));
      this.startMatchmakingPolling();
    } catch (error) {
      this.updateMatchmakingStatus({ status: "idle" });
      this.lobbyStatus = this.describeMatchmakingError(error);
    } finally {
      this.lobbyEntering = false;
      this.renderView();
    }
  }

  private async cancelLobbyMatchmaking(): Promise<void> {
    if (!this.isMatchmakingActive() || this.lobbyEntering) {
      return;
    }

    this.lobbyEntering = true;
    this.lobbyStatus = "正在取消 PVP 匹配...";
    this.renderView();

    try {
      await resolveVeilRootRuntime().cancelMatchmaking(this.remoteUrl, this.playerId, {
        getDisplayName: () => this.displayName || this.playerId,
        getAuthToken: () => this.authToken
      });
      this.stopMatchmakingPolling();
      this.updateMatchmakingStatus({ status: "idle" }, "已取消当前匹配队列。");
    } catch (error) {
      this.lobbyStatus = this.describeMatchmakingError(error);
    } finally {
      this.lobbyEntering = false;
      this.renderView();
    }
  }

  private async handleMatchmakingStatusUpdate(status: MatchmakingStatusResponse): Promise<void> {
    if (status.status === "idle") {
      this.stopMatchmakingPolling();
    }
    this.updateMatchmakingStatus(status, this.describeMatchmakingStatus(status));
    this.renderView();

    if (status.status === "matched" && !this.matchmakingJoinInFlight) {
      await this.enterMatchedRoom(status);
    }
  }

  private async handleMatchmakingTimeout(): Promise<void> {
    if (!this.isMatchmakingActive()) {
      return;
    }

    this.stopMatchmakingPolling();
    try {
      await resolveVeilRootRuntime().cancelMatchmaking(this.remoteUrl, this.playerId, {
        getDisplayName: () => this.displayName || this.playerId,
        getAuthToken: () => this.authToken
      });
    } catch {
      // Keep the timeout surfaced locally even if remote dequeue fails.
    }
    this.updateMatchmakingStatus({ status: "idle" }, "匹配超时，请稍后重试。");
    this.renderView();
  }

  private async enterMatchedRoom(status: Extract<MatchmakingStatusResponse, { status: "matched" }>): Promise<void> {
    this.matchmakingJoinInFlight = true;
    this.stopMatchmakingPolling();
    this.lobbyStatus = `匹配成功，正在进入房间 ${status.roomId}...`;
    this.renderView();

    try {
      this.roomId = status.roomId;
      this.seed = status.seedOverride;
      this.resetSessionViewport(`正在进入匹配房间 ${status.roomId} ...`);
      this.showLobby = false;
      this.syncBrowserRoomQuery(status.roomId);
      this.syncWechatShareBridge();
      await this.connect();
      if (!this.session && !this.lastUpdate) {
        throw new Error("enter_room_failed");
      }
      this.updateMatchmakingStatus({ status: "idle" }, `已进入匹配房间 ${status.roomId}。`);
    } catch (error) {
      this.showLobby = true;
      this.updateMatchmakingStatus({ status: "idle" }, this.describeMatchmakingError(error));
    } finally {
      this.matchmakingJoinInFlight = false;
      this.renderView();
    }
  }

  private describeMatchmakingStatus(status: MatchmakingStatusResponse): string {
    const view = buildMatchmakingStatusView(status);
    if (status.status === "queued") {
      return `${view.statusLabel} ${view.queuePositionLabel}，${view.waitEstimateLabel}`;
    }
    if (status.status === "matched") {
      return view.matchedLabel ? `${view.statusLabel} · ${view.matchedLabel}` : view.statusLabel;
    }
    return view.statusLabel;
  }

  private describeMatchmakingError(error: unknown): string {
    if (error instanceof Error && error.message === "cocos_request_failed:401") {
      return "匹配会话已失效，请重新登录后再试。";
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "matchmaking_failed";
  }

  private async loginLobbyAccount(): Promise<void> {
    if (this.lobbyEntering) {
      return;
    }

    const primaryProvider = this.primaryLoginProvider();
    if (!primaryProvider.available) {
      this.lobbyStatus = primaryProvider.message;
      this.renderView();
      return;
    }

    if (primaryProvider.id === "wechat-mini-game") {
      await this.loginLobbyWechatMiniGame();
      return;
    }

    const promptRef = globalThis.prompt;
    if (typeof promptRef !== "function") {
      this.lobbyStatus = "当前运行环境不支持弹出式输入，请先在浏览器调试壳完成账号登录，或复用已缓存会话。";
      this.renderView();
      return;
    }

    const nextLoginId = promptRef("输入登录 ID", this.loginId || "")?.trim();
    if (nextLoginId === undefined) {
      return;
    }
    const loginIdError = validateAccountLifecycleRequest("registration", nextLoginId);
    if (loginIdError) {
      this.lobbyStatus = loginIdError.message;
      this.renderView();
      return;
    }

    const password = promptRef("输入账号口令", "");
    if (password == null) {
      return;
    }
    const passwordError = validateAccountPassword(password, "password", "账号口令");
    if (passwordError) {
      this.lobbyStatus = passwordError.message;
      this.renderView();
      return;
    }

    if (!this.ensurePrivacyConsentAccepted()) {
      return;
    }

    const storage = this.readWebStorage();
    this.lobbyEntering = true;
    this.lobbyStatus = `正在使用账号 ${nextLoginId.toLowerCase()} 登录并进入房间 ${this.roomId}...`;
    this.renderView();

    try {
      const authSession = await loginWithCocosProvider(
        this.remoteUrl,
        {
          provider: "account-password",
          loginId: nextLoginId,
          password
        },
        {
          storage,
          privacyConsentAccepted: this.privacyConsentAccepted
        }
      );
      this.authToken = authSession.token ?? null;
      this.playerId = authSession.playerId;
      this.displayName = authSession.displayName;
      this.authMode = authSession.authMode;
      this.authProvider = authSession.provider ?? "account-password";
      this.loginId = authSession.loginId ?? nextLoginId.toLowerCase();
      this.sessionSource = authSession.source;
      this.syncWechatShareBridge();
      this.lobbyStatus = `账号 ${this.loginId} 登录成功，正在同步全局仓库并进入房间 ${this.roomId}...`;
      saveCocosLobbyPreferences(authSession.playerId, this.roomId, undefined, storage);
      this.renderView();
      await this.refreshLobbyAccountProfile();
      this.lobbyEntering = false;
      await this.enterLobbyRoom(this.roomId);
    } catch (error) {
      this.lobbyEntering = false;
      this.lobbyStatus = this.describeCocosAccountFlowError(error, "account_login_failed");
      this.renderView();
    }
  }

  private parseCocosRequestFailure(error: unknown): { status: number; code: string } | null {
    if (!(error instanceof Error)) {
      return null;
    }

    const matched = /^cocos_request_failed:(\d+):(.+)$/.exec(error.message);
    if (!matched) {
      return null;
    }

    return {
      status: Number(matched[1]),
      code: matched[2] ?? "unknown"
    };
  }

  private describeCocosAccountFlowError(
    error: unknown,
    fallback: string,
    options: {
      invalidTokenCode?: string;
    } = {}
  ): string {
    const failure = this.parseCocosRequestFailure(error);
    if (!failure) {
      return error instanceof Error ? error.message : fallback;
    }

    const message = describeAccountAuthFailure(failure, options);
    if (message) {
      return message;
    }

    return error instanceof Error ? error.message : fallback;
  }

  private ensurePrivacyConsentAccepted(): boolean {
    const privacyConsentError = validatePrivacyConsentAccepted(this.privacyConsentAccepted);
    if (!privacyConsentError) {
      return true;
    }

    this.lobbyStatus = privacyConsentError.message;
    this.renderView();
    return false;
  }

  private async registerLobbyAccount(): Promise<void> {
    this.openLobbyAccountFlow("registration");
  }

  private async recoverLobbyAccountPassword(): Promise<void> {
    this.openLobbyAccountFlow("recovery");
  }

  private async loginLobbyWechatMiniGame(): Promise<void> {
    if (!this.ensurePrivacyConsentAccepted()) {
      return;
    }

    const storage = this.readWebStorage();
    this.lobbyEntering = true;
    this.lobbyStatus = "正在调用 wx.login() 并交换小游戏会话...";
    this.renderView();

    try {
      const authSession = await loginWithCocosProvider(
        this.remoteUrl,
        {
          provider: "wechat-mini-game",
          playerId: this.playerId,
          displayName: this.displayName || this.playerId
        },
        {
          storage,
          wx: (globalThis as { wx?: { login?: ((options: unknown) => void) | undefined } }).wx ?? null,
          config: this.loginRuntimeConfig,
          authToken: this.authToken,
          privacyConsentAccepted: this.privacyConsentAccepted
        }
      );
      this.authToken = authSession.token ?? null;
      this.playerId = authSession.playerId;
      this.displayName = authSession.displayName;
      this.authMode = authSession.authMode;
      this.authProvider = authSession.provider ?? "wechat-mini-game";
      this.loginId = authSession.loginId ?? "";
      this.sessionSource = authSession.source;
      this.syncWechatShareBridge();
      this.lobbyStatus = "微信小游戏登录已连通，正在同步会话并进入房间...";
      saveCocosLobbyPreferences(authSession.playerId, this.roomId, undefined, storage);
      this.renderView();
      await this.refreshLobbyAccountProfile();
      this.lobbyEntering = false;
      await this.enterLobbyRoom(this.roomId);
    } catch (error) {
      this.lobbyEntering = false;
      this.lobbyStatus =
        error instanceof Error && error.message === "wechat_login_unavailable"
          ? "当前小游戏壳未暴露 wx.login()，且也未配置 mock code。"
          : error instanceof Error && error.message === "cocos_request_failed:501"
            ? "服务端已预留小游戏登录交换接口，但当前未启用。"
            : error instanceof Error && error.message === "cocos_request_failed:401"
              ? "小游戏登录 code 校验失败，请刷新后重试。"
              : error instanceof Error
                ? error.message
                : "wechat_login_failed";
      this.renderView();
    }
  }

  private primaryLoginProvider(): CocosLoginProviderDescriptor {
    return (
      this.loginProviders.find((provider) => provider.id === "wechat-mini-game" && provider.available) ??
      this.loginProviders.find((provider) => provider.id === "account-password") ?? {
        id: "account-password",
        label: this.authMode === "account" ? "账号进入" : "账号登录并进入",
        available: true,
        message: ""
      }
    );
  }

  private describeLobbyLoginHint(): string {
    const primaryProvider = this.primaryLoginProvider();
    if (primaryProvider.id === "wechat-mini-game") {
      return this.authProvider === "wechat-mini-game" ? "当前已使用小游戏登录脚手架会话" : primaryProvider.message;
    }

    return this.authMode === "account" ? "当前已处于正式账号模式" : "H5 绑定后的登录 ID 可以在这里直接进入";
  }

  private async returnToLobby(): Promise<void> {
    if (this.showLobby) {
      return;
    }

    const storage = this.readWebStorage();
    saveCocosLobbyPreferences(this.playerId, this.roomId, undefined, storage);
    this.displayName = rememberPreferredCocosDisplayName(this.playerId, this.displayName || this.playerId, storage);
    this.stopMatchmakingPolling();
    this.updateMatchmakingStatus({ status: "idle" });
    await this.disposeCurrentSession();
    this.resetSessionViewport("已返回 Cocos Lobby。");
    this.gameplayAccountReviewPanelOpen = false;
    this.gameplayEquipmentPanelOpen = false;
    this.showLobby = true;
    this.syncWechatShareBridge();
    this.lobbyStatus = "已返回大厅，可继续选房或创建新实例。";
    this.syncBrowserRoomQuery(null);
    this.renderView();
    await this.syncLobbyBootstrap();
  }

  private toggleSettingsPanel(open = !this.settingsView.open): void {
    this.settingsView = applySettingsUpdate(this.settingsView, {
      open,
      deleteAccountPending: false,
      withdrawConsentPending: false,
      statusMessage: open ? null : this.settingsView.statusMessage
    });
    this.renderView();
  }

  private updateSettings(update: CocosSettingsPanelUpdate): void {
    const resetPending = update.bgmVolume !== undefined || update.sfxVolume !== undefined || update.frameRateCap !== undefined;
    this.settingsView = applySettingsUpdate(this.settingsView, {
      ...update,
      ...(resetPending ? { deleteAccountPending: false, withdrawConsentPending: false } : {})
    });
    this.persistSettings();
    this.applyRuntimeSettings();
    this.renderView();
  }

  private openSettingsPrivacyPolicy(): void {
    const wxRuntime = (globalThis as {
      wx?: {
        openPrivacyContract?: (options?: { success?: () => void; fail?: (error?: unknown) => void }) => void;
      } | null;
    }).wx;
    if (wxRuntime?.openPrivacyContract) {
      wxRuntime.openPrivacyContract({
        success: () => {
          this.updateSettings({ statusMessage: "已打开微信隐私说明。" });
        },
        fail: () => {
          this.updateSettings({ statusMessage: `隐私说明入口 ${this.settingsView.privacyPolicyUrl}` });
        }
      });
      return;
    }

    const open = (globalThis as { open?: (url: string, target?: string) => void }).open;
    if (typeof open === "function") {
      open(this.settingsView.privacyPolicyUrl, "_blank");
      this.updateSettings({ statusMessage: `已打开隐私说明 ${this.settingsView.privacyPolicyUrl}` });
      return;
    }

    this.updateSettings({ statusMessage: `隐私说明 ${this.settingsView.privacyPolicyUrl}` });
  }

  private async handleSettingsLogout(): Promise<void> {
    this.updateSettings({ statusMessage: "正在退出当前会话..." });
    await this.logoutAuthSession();
    this.settingsView = applySettingsUpdate(this.settingsView, {
      open: false,
      deleteAccountPending: false,
      withdrawConsentPending: false,
      statusMessage: "已退出当前会话。"
    });
    this.renderView();
  }

  private async handleSettingsDeleteAccount(): Promise<void> {
    if (!this.settingsView.deleteAccountPending) {
      this.updateSettings({
        deleteAccountPending: true,
        withdrawConsentPending: false,
        statusMessage: "再次点击“删除账号”确认删除当前账号。"
      });
      return;
    }

    this.updateSettings({
      statusMessage: "正在删除当前账号并撤销会话...",
      deleteAccountPending: false
    });

    await this.deleteCurrentPlayerAccount();
  }

  private async handleSettingsWithdrawConsent(): Promise<void> {
    if (!this.settingsView.withdrawConsentPending) {
      this.updateSettings({
        withdrawConsentPending: true,
        deleteAccountPending: false,
        statusMessage: "再次点击“撤回同意”以清除本地同意状态并退出当前会话。"
      });
      return;
    }

    this.privacyConsentAccepted = false;
    this.updateSettings({
      withdrawConsentPending: false,
      statusMessage: "已撤回本地隐私同意，正在退出当前会话..."
    });
    await this.logoutAuthSession();
    this.settingsView = applySettingsUpdate(this.settingsView, {
      open: false,
      statusMessage: "已撤回本地隐私同意；下次进入前请重新确认隐私说明。"
    });
    this.renderView();
  }

  private async logoutAuthSession(): Promise<void> {
    this.stopMatchmakingPolling();
    this.updateMatchmakingStatus({ status: "idle" });
    await resolveVeilRootRuntime().logoutAuthSession(this.remoteUrl, {
      storage: this.readWebStorage()
    });
    this.authToken = null;
    this.authMode = "guest";
    this.authProvider = "guest";
    this.loginId = "";
    this.sessionSource = "none";
    this.displayName = readPreferredCocosDisplayName(this.playerId, this.readWebStorage());
    this.commitAccountProfile(createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName), false);
    this.syncWechatShareBridge();
    this.lobbyStatus = "已退出当前会话，请重新选择游客身份或使用正式账号进入。";
    this.renderView();
  }

  private async deleteCurrentPlayerAccount(): Promise<void> {
    this.stopMatchmakingPolling();
    this.updateMatchmakingStatus({ status: "idle" });
    await resolveVeilRootRuntime().deletePlayerAccount(this.remoteUrl, {
      storage: this.readWebStorage()
    });
    this.authToken = null;
    this.authMode = "guest";
    this.authProvider = "guest";
    this.loginId = "";
    this.sessionSource = "none";
    this.privacyConsentAccepted = false;
    this.displayName = readPreferredCocosDisplayName(this.playerId, this.readWebStorage());
    this.commitAccountProfile(createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName), false);
    await this.disposeCurrentSession();
    this.resetSessionViewport("账号已删除。");
    this.showLobby = true;
    this.lobbyStatus = "账号已删除，原会话已撤销。请重新确认隐私说明后再创建新档。";
    this.syncBrowserRoomQuery(null);
    this.settingsView = applySettingsUpdate(this.settingsView, {
      open: false,
      deleteAccountPending: false,
      withdrawConsentPending: false,
      statusMessage: "账号已删除。"
    });
    this.renderView();
    await this.syncLobbyBootstrap();
  }

  private buildActiveAccountFlowPanelView() {
    const draft = this.buildActiveAccountLifecycleDraft();
    if (!draft) {
      return null;
    }

    return buildCocosAccountLifecyclePanelView(draft);
  }

  private buildActiveAccountLifecycleDraft(): CocosAccountLifecycleDraft | null {
    if (!this.activeAccountFlow) {
      return null;
    }

    return this.activeAccountFlow === "registration"
      ? {
          kind: "registration",
          loginId: this.loginId,
          displayName: this.registrationDisplayName || this.displayName || this.loginId,
          token: this.registrationToken,
          password: this.registrationPassword,
          deliveryMode: this.registrationDeliveryMode,
          ...(this.registrationExpiresAt ? { expiresAt: this.registrationExpiresAt } : {})
        }
      : {
          kind: "recovery",
          loginId: this.loginId,
          displayName: "",
          token: this.recoveryToken,
          password: this.recoveryPassword,
          deliveryMode: this.recoveryDeliveryMode,
          ...(this.recoveryExpiresAt ? { expiresAt: this.recoveryExpiresAt } : {})
        };
  }

  private openLobbyAccountFlow(kind: CocosAccountLifecycleKind): void {
    this.activeAccountFlow = kind;
    this.loginId = this.loginId.trim().toLowerCase();
    if (kind === "registration" && !this.registrationDisplayName.trim()) {
      this.registrationDisplayName = this.displayName || this.loginId;
    }
    this.lobbyStatus =
      kind === "registration"
        ? "已打开正式注册面板。先申请注册令牌，再确认口令并进入房间。"
        : "已打开密码找回面板。先申请找回令牌，再确认新口令并进入房间。";
    this.renderView();
  }

  private closeLobbyAccountFlow(): void {
    this.activeAccountFlow = null;
    this.lobbyStatus = "已收起账号生命周期面板。";
    this.renderView();
  }

  private togglePrivacyConsent(): void {
    this.privacyConsentAccepted = !this.privacyConsentAccepted;
    this.lobbyStatus = this.privacyConsentAccepted ? "已同意隐私说明。" : "已取消隐私说明勾选。";
    this.renderView();
  }

  private promptForAccountFlowField(field: "loginId" | "displayName" | "token" | "password"): void {
    const promptRef = globalThis.prompt;
    if (typeof promptRef !== "function" || !this.activeAccountFlow) {
      this.lobbyStatus = "当前运行环境不支持弹出式输入，请改用浏览器调试壳填写流程字段。";
      this.renderView();
      return;
    }

    if (field === "loginId") {
      const nextValue = promptRef("输入登录 ID", this.loginId)?.trim();
      if (nextValue === undefined) {
        return;
      }
      this.loginId = nextValue.toLowerCase();
      this.lobbyStatus = this.loginId ? `已更新登录 ID 草稿为 ${this.loginId}。` : "已清空登录 ID 草稿。";
      this.renderView();
      return;
    }

    if (field === "displayName") {
      const nextValue = promptRef("输入注册昵称", this.registrationDisplayName || this.displayName || this.loginId);
      if (nextValue === null) {
        return;
      }
      this.registrationDisplayName = nextValue.trim();
      this.lobbyStatus = this.registrationDisplayName ? "已更新注册昵称草稿。" : "已清空注册昵称草稿。";
      this.renderView();
      return;
    }

    if (field === "token") {
      const nextValue = promptRef(
        this.activeAccountFlow === "registration" ? "输入注册令牌" : "输入找回令牌",
        this.activeAccountFlow === "registration" ? this.registrationToken : this.recoveryToken
      )?.trim();
      if (nextValue === undefined) {
        return;
      }
      if (this.activeAccountFlow === "registration") {
        this.registrationToken = nextValue;
      } else {
        this.recoveryToken = nextValue;
      }
      this.lobbyStatus = nextValue ? "已更新令牌草稿。" : "已清空令牌草稿。";
      this.renderView();
      return;
    }

    const nextValue = promptRef(
      this.activeAccountFlow === "registration" ? "输入注册口令（至少 6 位）" : "输入新的账号口令（至少 6 位）",
      ""
    );
    if (nextValue === null) {
      return;
    }
    if (this.activeAccountFlow === "registration") {
      this.registrationPassword = nextValue.trim();
    } else {
      this.recoveryPassword = nextValue.trim();
    }
    this.lobbyStatus = nextValue.trim() ? "已更新口令草稿。" : "已清空口令草稿。";
    this.renderView();
  }

  private async requestActiveAccountFlow(): Promise<void> {
    if (!this.activeAccountFlow || this.lobbyEntering) {
      return;
    }
    const loginId = this.loginId.trim().toLowerCase();
    const validationError = validateAccountLifecycleRequest(this.activeAccountFlow, loginId);
    if (validationError) {
      this.lobbyStatus = validationError.message;
      this.renderView();
      return;
    }

    this.loginId = loginId;
    this.lobbyEntering = true;
    this.lobbyStatus =
      this.activeAccountFlow === "registration"
        ? `正在为 ${loginId} 申请注册令牌...`
        : `正在为 ${loginId} 申请密码找回令牌...`;
    this.renderView();

    try {
      if (this.activeAccountFlow === "registration") {
        const requested = await requestCocosAccountRegistration(
          this.remoteUrl,
          loginId,
          this.registrationDisplayName || this.displayName || loginId
        );
        this.registrationToken = requested.registrationToken ?? this.registrationToken;
        this.registrationExpiresAt = requested.expiresAt ?? "";
        this.registrationDeliveryMode = requested.registrationToken ? "dev-token" : "external";
        this.lobbyStatus = requested.registrationToken
          ? `注册令牌已生成，可直接确认注册。令牌：${requested.registrationToken}${requested.expiresAt ? `；过期时间：${requested.expiresAt}` : ""}`
          : `注册申请已受理，请从外部渠道获取令牌${requested.expiresAt ? `；过期时间：${requested.expiresAt}` : ""}。`;
      } else {
        const requested = await requestCocosPasswordRecovery(this.remoteUrl, loginId);
        this.recoveryToken = requested.recoveryToken ?? this.recoveryToken;
        this.recoveryExpiresAt = requested.expiresAt ?? "";
        this.recoveryDeliveryMode = requested.recoveryToken ? "dev-token" : "external";
        this.lobbyStatus = requested.recoveryToken
          ? `找回令牌已生成，可直接确认重置。令牌：${requested.recoveryToken}${requested.expiresAt ? `；过期时间：${requested.expiresAt}` : ""}`
          : `找回申请已受理，请从外部渠道获取令牌${requested.expiresAt ? `；过期时间：${requested.expiresAt}` : ""}。`;
      }
    } catch (error) {
      this.lobbyStatus =
        this.activeAccountFlow === "registration"
          ? this.describeCocosAccountFlowError(error, "account_registration_request_failed")
          : this.describeCocosAccountFlowError(error, "password_recovery_request_failed");
    } finally {
      this.lobbyEntering = false;
      this.renderView();
    }
  }

  private async confirmActiveAccountFlow(): Promise<void> {
    if (!this.activeAccountFlow || this.lobbyEntering) {
      return;
    }
    const loginId = this.loginId.trim().toLowerCase();
    this.loginId = loginId;
    const validationError = validateAccountLifecycleConfirm(this.activeAccountFlow, {
      loginId,
      token: this.activeAccountFlow === "registration" ? this.registrationToken : this.recoveryToken,
      password: this.activeAccountFlow === "registration" ? this.registrationPassword : this.recoveryPassword,
      privacyConsentAccepted: this.privacyConsentAccepted
    });
    if (validationError) {
      this.lobbyStatus = validationError.message;
      this.renderView();
      return;
    }

    if (this.activeAccountFlow === "registration") {
      await this.confirmLobbyAccountRegistration(loginId);
      return;
    }

    await this.confirmLobbyAccountRecovery(loginId);
  }

  private async confirmLobbyAccountRegistration(loginId: string): Promise<void> {
    this.lobbyEntering = true;
    this.lobbyStatus = `正在确认正式注册 ${loginId} 并进入房间 ${this.roomId}...`;
    this.renderView();

    try {
      const storage = this.readWebStorage();
      const authSession = await confirmCocosAccountRegistration(
        this.remoteUrl,
        loginId,
        this.registrationToken,
        this.registrationPassword,
        {
          storage,
          privacyConsentAccepted: this.privacyConsentAccepted
        }
      );
      this.authToken = authSession.token ?? null;
      this.playerId = authSession.playerId;
      this.displayName = authSession.displayName;
      this.authMode = authSession.authMode;
      this.authProvider = authSession.provider ?? "account-password";
      this.loginId = authSession.loginId ?? loginId;
      this.sessionSource = authSession.source;
      this.registrationToken = "";
      this.registrationPassword = "";
      this.registrationDeliveryMode = "idle";
      this.registrationExpiresAt = "";
      this.activeAccountFlow = null;
      this.syncWechatShareBridge();
      this.lobbyStatus = `正式账号注册成功，正在同步全局仓库并进入房间 ${this.roomId}...`;
      saveCocosLobbyPreferences(authSession.playerId, this.roomId, undefined, storage);
      this.renderView();
      await this.refreshLobbyAccountProfile();
      this.lobbyEntering = false;
      await this.enterLobbyRoom(this.roomId);
    } catch (error) {
      this.lobbyEntering = false;
      this.lobbyStatus = this.describeCocosAccountFlowError(error, "account_registration_failed", {
        invalidTokenCode: "invalid_registration_token"
      });
      this.renderView();
    }
  }

  private async confirmLobbyAccountRecovery(loginId: string): Promise<void> {
    this.lobbyEntering = true;
    this.lobbyStatus = `正在重置 ${loginId} 的口令并进入房间 ${this.roomId}...`;
    this.renderView();

    try {
      await confirmCocosPasswordRecovery(this.remoteUrl, loginId, this.recoveryToken, this.recoveryPassword);
      const storage = this.readWebStorage();
      const authSession = await loginWithCocosProvider(
        this.remoteUrl,
        {
          provider: "account-password",
          loginId,
          password: this.recoveryPassword
        },
        {
          storage,
          privacyConsentAccepted: this.privacyConsentAccepted
        }
      );
      this.authToken = authSession.token ?? null;
      this.playerId = authSession.playerId;
      this.displayName = authSession.displayName;
      this.authMode = authSession.authMode;
      this.authProvider = authSession.provider ?? "account-password";
      this.loginId = authSession.loginId ?? loginId;
      this.sessionSource = authSession.source;
      this.recoveryToken = "";
      this.recoveryPassword = "";
      this.recoveryDeliveryMode = "idle";
      this.recoveryExpiresAt = "";
      this.activeAccountFlow = null;
      this.syncWechatShareBridge();
      this.lobbyStatus = `口令重置成功，正在同步全局仓库并进入房间 ${this.roomId}...`;
      saveCocosLobbyPreferences(authSession.playerId, this.roomId, undefined, storage);
      this.renderView();
      await this.refreshLobbyAccountProfile();
      this.lobbyEntering = false;
      await this.enterLobbyRoom(this.roomId);
    } catch (error) {
      this.lobbyEntering = false;
      this.lobbyStatus = this.describeCocosAccountFlowError(error, "password_recovery_failed", {
        invalidTokenCode: "invalid_recovery_token"
      });
      this.renderView();
    }
  }

  private promptForLobbyField(field: "playerId" | "displayName" | "roomId" | "loginId"): void {
    const promptRef = globalThis.prompt;
    if (typeof promptRef !== "function") {
      this.lobbyStatus = "当前运行环境不支持弹出式输入，请改用 URL 参数、已缓存会话或浏览器调试壳。";
      this.renderView();
      return;
    }

    const storage = this.readWebStorage();
    if (field === "playerId") {
      const previousSuggestedName = readPreferredCocosDisplayName(this.playerId, storage);
      const nextValue = promptRef("输入游客 playerId", this.playerId)?.trim();
      if (nextValue === undefined) {
        return;
      }

      const nextPlayerId = nextValue || createCocosGuestPlayerId();
      const storedSession = readStoredCocosAuthSession(storage);
      this.playerId = nextPlayerId;
      if (!this.displayName.trim() || this.displayName === previousSuggestedName) {
        this.displayName =
          storedSession?.playerId === nextPlayerId ? storedSession.displayName : readPreferredCocosDisplayName(nextPlayerId, storage);
      }
      this.authToken = storedSession?.playerId === nextPlayerId ? storedSession.token ?? null : null;
      this.authMode = storedSession?.playerId === nextPlayerId ? storedSession.authMode : "guest";
      this.authProvider = storedSession?.playerId === nextPlayerId ? storedSession.provider ?? "guest" : "guest";
      this.loginId = storedSession?.playerId === nextPlayerId ? storedSession.loginId ?? "" : "";
      this.sessionSource = storedSession?.playerId === nextPlayerId ? storedSession.source : "manual";
      this.syncWechatShareBridge();
      this.lobbyStatus = `已切换游客身份草稿为 ${nextPlayerId}。`;
      this.renderView();
      void this.refreshLobbyAccountProfile();
      return;
    }

    if (field === "displayName") {
      const nextValue = promptRef("输入展示昵称", this.displayName || this.playerId);
      if (nextValue === null) {
        return;
      }

      this.displayName = rememberPreferredCocosDisplayName(this.playerId, nextValue, storage);
      this.syncWechatShareBridge();
      this.lobbyStatus = "昵称草稿已更新。";
      this.renderView();
      void this.refreshLobbyAccountProfile();
      return;
    }

    if (field === "loginId") {
      const nextValue = promptRef("输入登录 ID", this.loginId)?.trim();
      if (nextValue === undefined) {
        return;
      }

      this.loginId = nextValue.toLowerCase();
      this.lobbyStatus = this.loginId ? `已更新登录 ID 草稿为 ${this.loginId}。` : "已清空登录 ID 草稿。";
      this.renderView();
      return;
    }

    const nextValue = promptRef("输入房间 ID", this.roomId)?.trim();
    if (nextValue === undefined || nextValue.length === 0) {
      return;
    }

    this.roomId = nextValue;
    this.syncWechatShareBridge();
    this.lobbyStatus = `已将目标房间切换为 ${nextValue}。`;
    this.renderView();
    void this.refreshLobbyAccountProfile();
  }

  private async disposeCurrentSession(): Promise<void> {
    this.bumpSessionEpoch();
    this.stopMatchmakingPolling();
    const currentSession = this.session;
    this.session = null;
    if (currentSession) {
      await currentSession.dispose().catch(() => undefined);
    }
  }

  private resetSessionViewport(logLine: string): void {
    this.lastUpdate = null;
    this.pendingPrediction = null;
    this.selectedBattleTargetId = null;
    this.moveInFlight = false;
    this.battleActionInFlight = false;
    this.battleFeedback = null;
    this.battlePresentation.reset();
    this.predictionStatus = "";
    this.inputDebug = "input waiting";
    this.timelineEntries = [];
    this.primaryClientTelemetry = [];
    this.logLines = [logLine];
  }

  private describeSessionError(error: unknown, fallback: string): string {
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

  private pushSessionActionOutcome(
    update: SessionUpdate,
    options: {
      successMessage: string;
      rejectedLabel: string;
    }
  ): void {
    const outcome = describeSessionActionOutcome(update, options);
    this.pushLog(outcome.message);
    if (!outcome.accepted) {
      this.predictionStatus = outcome.message;
      this.mapBoard?.playHeroAnimation("hit");
    }
  }

  private bumpSessionEpoch(): number {
    this.sessionEpoch += 1;
    return this.sessionEpoch;
  }

  private bumpLobbyAccountEpoch(): number {
    this.lobbyAccountEpoch += 1;
    return this.lobbyAccountEpoch;
  }

  private isActiveSessionEpoch(epoch: number): boolean {
    return epoch === this.sessionEpoch;
  }

  private isActiveLobbyAccountEpoch(epoch: number): boolean {
    return epoch === this.lobbyAccountEpoch;
  }

  private createSessionOptions(epoch: number): VeilCocosSessionOptions {
    return {
      remoteUrl: this.remoteUrl,
      getDisplayName: () => this.displayName || this.playerId,
      getAuthToken: () => this.authToken,
      onPushUpdate: (update) => {
        if (!this.isActiveSessionEpoch(epoch)) {
          return;
        }

        this.pushLog("已收到房间推送更新。");
        void this.applySessionUpdate(update);
      },
      onConnectionEvent: (event) => {
        if (!this.isActiveSessionEpoch(epoch)) {
          return;
        }

        this.handleConnectionEvent(event);
      }
    };
  }

  private hydrateRuntimePlatform(): void {
    this.runtimePlatform = detectCocosRuntimePlatform(globalThis as {
      location?: Location;
      history?: History;
      wx?: {
        getLaunchOptionsSync?: () => { query?: Record<string, unknown> | null } | null | undefined;
        login?: ((options: unknown) => void) | undefined;
      };
    });
    this.runtimeCapabilities = resolveCocosRuntimeCapabilities(this.runtimePlatform);
    this.loginRuntimeConfig = resolveCocosLoginRuntimeConfig(globalThis as never);
    this.loginProviders = resolveCocosLoginProviders({
      platform: this.runtimePlatform,
      capabilities: this.runtimeCapabilities,
      config: this.loginRuntimeConfig,
      wx: (globalThis as { wx?: { login?: ((options: unknown) => void) | undefined } }).wx ?? null
    });

    if (this.runtimePlatform === "wechat-game") {
      this.pushLog("已识别微信小游戏运行时，启动参数将改读 wx.getLaunchOptionsSync().query。");
      const wechatProvider = this.loginProviders.find((provider) => provider.id === "wechat-mini-game");
      if (wechatProvider) {
        this.pushLog(`小游戏登录状态：${wechatProvider.message}`);
      }
    }
  }

  private bindRuntimeMemoryWarnings(): void {
    this.stopRuntimeMemoryWarnings?.();
    this.stopRuntimeMemoryWarnings = bindCocosRuntimeMemoryWarning((event) => {
      const gcTriggered = triggerCocosRuntimeGc();
      this.runtimeMemoryNotice =
        event.level != null
          ? `收到内存告警 L${event.level}${gcTriggered ? "，已请求 GC" : ""}`
          : `收到内存告警${gcTriggered ? "，已请求 GC" : ""}`;
      this.pushLog(this.runtimeMemoryNotice);
      this.renderView();
    });
  }

  private describeRuntimeMemoryHealth(): string {
    const snapshot = readCocosRuntimeMemorySnapshot();
    const summary = formatCocosRuntimeMemoryStatus(snapshot, getPlaceholderSpriteAssetUsageSummary());
    return this.runtimeMemoryNotice ? `${summary} · ${this.runtimeMemoryNotice}` : summary;
  }

  private hydrateLaunchIdentity(): void {
    this.stopMatchmakingPolling();
    this.updateMatchmakingStatus({ status: "idle" });
    const storage = this.readWebStorage();
    const launchIdentity = resolveCocosLaunchIdentity({
      defaultRoomId: this.roomId,
      defaultPlayerId: this.playerId,
      defaultDisplayName: this.displayName,
      search: this.readLaunchSearch(),
      storedSession: readStoredCocosAuthSession(storage)
    });
    this.launchReferrerId = readLaunchReferrerId(this.readLaunchSearch());

    if (launchIdentity.shouldOpenLobby) {
      const storedSession = readStoredCocosAuthSession(storage);
      const lobbyPreferences = createCocosLobbyPreferences(
        {
          ...(storedSession?.playerId ? { playerId: storedSession.playerId } : {}),
          ...(this.roomId !== "test-room" ? { roomId: this.roomId } : {})
        },
        undefined,
        storage
      );
      this.roomId = lobbyPreferences.roomId;
      this.playerId = storedSession?.playerId ?? lobbyPreferences.playerId;
      this.displayName =
        storedSession?.playerId === this.playerId
          ? storedSession.displayName
          : readPreferredCocosDisplayName(this.playerId, storage);
      this.authToken = storedSession?.playerId === this.playerId ? storedSession.token ?? null : null;
      this.authMode = storedSession?.playerId === this.playerId ? storedSession.authMode : "guest";
      this.authProvider = storedSession?.playerId === this.playerId ? storedSession.provider ?? "guest" : "guest";
      this.loginId = storedSession?.playerId === this.playerId ? storedSession.loginId ?? "" : "";
      this.sessionSource = storedSession?.playerId === this.playerId ? storedSession.source : "none";
      this.commitAccountProfile(createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName), false);
      this.showLobby = true;
      this.autoConnect = false;
      this.lobbyStatus = storedSession
        ? `已恢复${storedSession.source === "remote" ? "云端" : "本地"}${storedSession.authMode === "account" ? "正式账号" : "游客"}会话，可直接选房或继续修改房间。`
        : this.runtimePlatform === "wechat-game"
          ? "微信小游戏启动参数适配已就绪；当前仍走游客/账号会话，后续可在此处接入 wx.login()。"
          : "请选择一个房间，或输入新的房间 ID 后直接开局。";
      this.pushLog("Cocos Lobby 已待命。");
      return;
    }

    this.roomId = launchIdentity.roomId;
    this.playerId = launchIdentity.playerId;
    this.displayName = launchIdentity.displayName;
    this.authMode = launchIdentity.authMode;
    this.authProvider = launchIdentity.authProvider;
    this.loginId = launchIdentity.loginId ?? "";
    this.authToken = launchIdentity.authToken;
    this.sessionSource = launchIdentity.sessionSource;
    this.commitAccountProfile(createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName), false);

    if (launchIdentity.usedStoredSession) {
      this.pushLog(
        `已复用${launchIdentity.sessionSource === "remote" ? "云端" : "本地"}${launchIdentity.authMode === "account" ? "正式账号" : "游客"}会话 ${launchIdentity.playerId}。`
      );
      return;
    }

    if (launchIdentity.roomId !== "test-room") {
      this.pushLog(`已从启动参数载入房间 ${launchIdentity.roomId}。`);
    }
  }

  private latestShareableBattleReplay() {
    const replay = this.lobbyAccountProfile?.recentBattleReplays?.[0] ?? null;
    if (!shouldOfferBattleResultShare(replay)) {
      return null;
    }
    if (!this.lastBattleSettlementSnapshot || this.lastBattleSettlementSnapshot.tone !== "victory") {
      return null;
    }
    return replay;
  }

  private canShareLatestBattleResult(): boolean {
    return Boolean(this.latestShareableBattleReplay());
  }

  private async handleBattleResultShare(): Promise<void> {
    const replay = this.latestShareableBattleReplay();
    if (!replay) {
      this.predictionStatus = "当前没有可分享的 PVP 胜利战报。";
      this.renderView();
      return;
    }

    if (this.runtimePlatform === "wechat-game") {
      const payload = buildShareCardPayload(replay, this.displayName || this.playerId);
      const wxRuntime = (globalThis as {
        wx?: {
          shareAppMessage?: (sharePayload: WechatSharePayload) => void;
        } | null;
      }).wx;
      if (typeof wxRuntime?.shareAppMessage === "function") {
        wxRuntime.shareAppMessage(payload);
        this.predictionStatus = "已拉起微信分享面板。";
      } else {
        this.predictionStatus = "当前微信小游戏环境未提供 shareAppMessage。";
      }
      this.renderView();
      return;
    }

    const copied = await copyTextToClipboard(buildBattleResultShareSummary(replay, this.displayName || this.playerId));
    this.predictionStatus = copied ? "已复制战绩摘要，可直接粘贴分享。" : "当前 H5 运行环境不支持剪贴板复制。";
    this.renderView();
  }

  private async maybeClaimLaunchReferral(authSession: {
    playerId: string;
    displayName: string;
    authMode: "guest" | "account";
    provider?: string;
    loginId?: string;
    token?: string;
    source: "remote" | "local";
  }): Promise<void> {
    const referrerId = this.launchReferrerId?.trim() ?? "";
    if (!referrerId || authSession.source !== "remote" || !authSession.token) {
      return;
    }

    const claimKey = `${referrerId}:${authSession.playerId}`;
    if (this.lastReferralClaimKey === claimKey) {
      return;
    }

    try {
      const result = await resolveVeilRootRuntime().postPlayerReferral(
        this.remoteUrl,
        { referrerId },
        {
          storage: this.readWebStorage(),
          authSession: {
            token: authSession.token,
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            authMode: authSession.authMode,
            ...(authSession.provider ? { provider: authSession.provider as never } : {}),
            ...(authSession.loginId ? { loginId: authSession.loginId } : {}),
            source: "remote"
          }
        }
      );
      this.lastReferralClaimKey = claimKey;
      if (result.claimed) {
        this.pushLog(`已完成推荐奖励绑定：邀请人 ${referrerId} 与新玩家 ${authSession.playerId} 各获得 20 宝石。`);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "cocos_request_failed:409:referral_already_claimed") {
        this.lastReferralClaimKey = claimKey;
        return;
      }
      throw error;
    }
  }

  private readLaunchSearch(): string {
    return readCocosRuntimeLaunchSearch(globalThis as {
      location?: Pick<Location, "search"> | null;
      wx?: { getLaunchOptionsSync?: () => { query?: Record<string, unknown> | null } | null | undefined };
    });
  }

  private describeLobbyShareHint(): string {
    return `分享：${this.wechatShareStatus}`;
  }

  private hydrateSettings(): void {
    const wxRuntime = (globalThis as { wx?: unknown }).wx as { getStorageSync?: (key: string) => unknown } | null | undefined;
    const persisted = readPersistedCocosSettings({
      localStorage: this.readWebStorage(),
      ...(wxRuntime ? { wx: wxRuntime } : {})
    });
    this.settingsView = applySettingsUpdate(this.settingsView, {
      ...persisted,
      privacyPolicyUrl: resolveCocosPrivacyPolicyUrl(globalThis.location)
    });
    this.applyRuntimeSettings();
  }

  private applyRuntimeSettings(): void {
    this.audioRuntime.setBgmVolume(this.settingsView.bgmVolume);
    this.audioRuntime.setSfxVolume(this.settingsView.sfxVolume);
    const gameRuntime = (globalThis as {
      game?: {
        frameRate?: number;
        setFrameRate?: (value: number) => void;
      };
    }).game;
    if (typeof gameRuntime?.setFrameRate === "function") {
      gameRuntime.setFrameRate(this.settingsView.frameRateCap);
    } else {
      const fallbackRuntime = (gameRuntime ?? (globalThis as { frameRate?: number })) as { frameRate?: number };
      fallbackRuntime.frameRate = this.settingsView.frameRateCap;
    }
  }

  private persistSettings(): void {
    const wxRuntime = (globalThis as { wx?: unknown }).wx as { setStorageSync?: (key: string, value: string) => void } | null | undefined;
    writePersistedCocosSettings(
      {
        bgmVolume: this.settingsView.bgmVolume,
        sfxVolume: this.settingsView.sfxVolume,
        frameRateCap: this.settingsView.frameRateCap
      },
      {
        localStorage: this.readWebStorage(),
        ...(wxRuntime ? { wx: wxRuntime } : {})
      }
    );
  }

  private buildSettingsView(): CocosSettingsPanelView {
    return applySettingsUpdate(this.settingsView, {
      displayName: this.displayName || this.playerId,
      loginId: this.loginId,
      authMode: this.authMode,
      privacyConsentAccepted: this.privacyConsentAccepted,
      privacyPolicyUrl: resolveCocosPrivacyPolicyUrl(globalThis.location)
    });
  }

  private renderSettingsOverlay(): void {
    this.settingsView = this.buildSettingsView();
    this.settingsPanel?.render(this.settingsView);
    this.renderSettingsButton();
  }

  private renderSettingsButton(): void {
    const buttonNode = this.node.getChildByName(SETTINGS_BUTTON_NODE_NAME);
    if (!buttonNode) {
      return;
    }

    assignUiLayer(buttonNode);
    const transform = buttonNode.getComponent(UITransform) ?? buttonNode.addComponent(UITransform);
    const width = transform.width || 58;
    const height = transform.height || 58;
    const graphics = buttonNode.getComponent(Graphics) ?? buttonNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = this.settingsView.open ? new Color(108, 88, 54, 244) : new Color(52, 68, 92, 236);
    graphics.strokeColor = this.settingsView.open ? new Color(244, 225, 180, 164) : new Color(226, 236, 248, 96);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 16);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 18);
    graphics.roundRect(-width / 2 + 10, height / 2 - 14, width - 20, 4, 2);
    graphics.fill();

    const labelNode = buttonNode.getChildByName("Label") ?? new Node("Label");
    labelNode.parent = buttonNode;
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 8, height - 8);
    labelNode.setPosition(0, 0, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = "⚙";
    label.fontSize = 26;
    label.lineHeight = 28;
    label.horizontalAlign = 1;
    label.verticalAlign = 1;
    label.enableWrapText = false;
    label.color = new Color(244, 247, 252, 255);
  }

  private syncWechatShareBridge(immediate = false) {
    const payload = buildCocosWechatSharePayload({
      roomId: this.roomId,
      inviterPlayerId: this.playerId,
      displayName: this.displayName || this.playerId,
      scene: this.showLobby ? "lobby" : this.lastUpdate?.battle ? "battle" : "world",
      day: this.lastUpdate?.world.meta.day ?? null,
      battleLabel: this.lastUpdate?.battle ? "当前战斗" : null
    });

    if (this.runtimePlatform !== "wechat-game") {
      this.wechatShareAvailable = false;
      this.wechatShareStatus = "分享功能仅在微信小游戏可用。";
      return {
        available: false,
        menuEnabled: false,
        handlerRegistered: false,
        canShareDirectly: false,
        immediateShared: false,
        payload,
        message: this.wechatShareStatus
      };
    }

    const result = syncCocosWechatShareBridge(
      (globalThis as { wx?: CocosWechatShareRuntimeLike | null }).wx ?? null,
      payload,
      immediate ? { immediate: true } : undefined
    );
    this.wechatShareAvailable = result.available;
    this.wechatShareStatus = result.message;
    return result;
  }

  private readWebStorage(): Storage | null {
    const webStorage = (sys as unknown as { localStorage?: Storage }).localStorage;
    return webStorage ?? null;
  }

  private pointInRootNode(centeredX: number, centeredY: number, node: Node | null): boolean {
    if (!node || !node.active) {
      return false;
    }

    const transform = node.getComponent(UITransform) ?? null;
    if (!transform) {
      return false;
    }

    return (
      centeredX >= node.position.x - transform.width / 2
      && centeredX <= node.position.x + transform.width / 2
      && centeredY >= node.position.y - transform.height / 2
      && centeredY <= node.position.y + transform.height / 2
    );
  }

  private syncBrowserRoomQuery(roomId: string | null): void {
    if (!this.runtimeCapabilities.supportsBrowserHistory) {
      return;
    }

    const historyRef = globalThis.history;
    const locationRef = globalThis.location;
    if (!historyRef?.replaceState || !locationRef?.href) {
      return;
    }

    const nextUrl = new URL(locationRef.href);
    if (roomId?.trim()) {
      nextUrl.searchParams.set("roomId", roomId.trim());
      nextUrl.searchParams.delete("playerId");
      nextUrl.searchParams.delete("displayName");
    } else {
      nextUrl.search = "";
    }

    historyRef.replaceState(null, "", nextUrl.toString());
  }

  private handleConnectionEvent(event: ConnectionEvent): void {
    this.diagnosticsConnectionStatus =
      event === "reconnecting" ? "reconnecting" : event === "reconnected" ? "connected" : "reconnect_failed";
    const activePvpBattle = Boolean(this.lastUpdate?.battle?.defenderHeroId);
    const label =
      event === "reconnecting"
        ? activePvpBattle
          ? "PVP 遭遇连接已中断，正在尝试重连..."
          : "连接已中断，正在尝试重连..."
        : event === "reconnected"
          ? activePvpBattle
            ? "PVP 遭遇连接已恢复。"
            : "连接已恢复。"
          : activePvpBattle
            ? "PVP 遭遇重连失败，正在尝试恢复房间快照..."
            : "重连失败，正在尝试恢复房间快照...";
    if (this.showLobby) {
      this.lobbyStatus = label;
    }
    this.pushLog(label);
    this.renderView();
  }

  private async actInBattle(action: BattleAction): Promise<void> {
    if (!this.session || this.battleActionInFlight) {
      return;
    }

    this.battleActionInFlight = true;
    const actionPresentation = this.battlePresentation.previewAction(action, this.lastUpdate?.battle ?? null);
    const skillName =
      action.type === "battle.skill"
        ? this.lastUpdate?.battle?.units[action.unitId]?.skills?.find((skill) => skill.id === action.skillId)?.name ?? action.skillId
        : null;
    const actionLabel =
      action.type === "battle.attack"
        ? "攻击"
        : action.type === "battle.wait"
          ? "等待"
          : action.type === "battle.defend"
            ? "防御"
            : skillName ?? "技能";
    this.pushLog(`战斗指令：${actionLabel}`);
    this.emitPrimaryClientTelemetry(
      createPrimaryClientTelemetryEvent(this.createTelemetryContext(this.activeHero()?.id ?? null), {
        category: "combat",
        checkpoint: "command.submitted",
        status: "info",
        detail: `Battle command submitted: ${actionLabel}.`,
        ...(this.lastUpdate?.battle?.id ? { battleId: this.lastUpdate.battle.id } : {})
      })
    );
    this.setBattleFeedback(actionPresentation.feedback);
    if (actionPresentation.cue) {
      this.audioRuntime.playCue(actionPresentation.cue);
    }
    this.renderView();

    try {
      if (actionPresentation.animation !== "idle") {
        this.mapBoard?.playHeroAnimation(actionPresentation.animation);
      }

      const update = await this.session.actInBattle(action);
      await this.applySessionUpdate(update);
      if (update.reason) {
        this.pushSessionActionOutcome(update, {
          successMessage: "战斗指令已结算。",
          rejectedLabel: "战斗指令"
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "battle_action_failed";
      const detail = error instanceof Error ? error.message : "战斗操作失败。";
      this.pushLog(detail);
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(this.activeHero()?.id ?? null), {
          category: "combat",
          checkpoint: "command.rejected",
          status: "failure",
          detail,
          reason,
          ...(this.lastUpdate?.battle?.id ? { battleId: this.lastUpdate.battle.id } : {})
        })
      );
      this.mapBoard?.playHeroAnimation("hit");
    } finally {
      this.battleActionInFlight = false;
      this.renderView();
    }
  }

  private async applySessionUpdate(update: SessionUpdate): Promise<void> {
    const previousBattle = this.lastUpdate?.battle ?? null;
    const heroId = this.activeHero()?.id ?? null;
    const presentation = this.battlePresentation.applyUpdate(previousBattle, update, heroId);
    this.captureBattleSettlementSnapshot(update, presentation.state);

    this.pendingPrediction = null;
    this.predictionStatus = "";
    this.surrenderDialogOpen = false;
    this.surrenderStatusMessage = null;
    this.diagnosticsConnectionStatus = "connected";
    this.lastRoomUpdateSource = "session";
    this.lastRoomUpdateReason = update.reason ?? "snapshot";
    this.lastRoomUpdateAtMs = Date.now();
    this.lastUpdate = update;
    const eventEntries = buildTimelineEntriesFromUpdate(update);
    if (eventEntries.length > 0) {
      this.timelineEntries = collapseAdjacentEntries([...eventEntries, ...this.timelineEntries]).slice(0, 12);
    }
    this.emitPrimaryClientTelemetry(
      buildPrimaryClientTelemetryFromUpdate(update, this.createTelemetryContext(heroId))
    );
    if (shouldRefreshGameplayAccountProfileForEvents(update.events.map((event) => event.type))) {
      void this.refreshGameplayAccountProfile();
    }
    this.syncSelectedBattleTarget();
    this.playMapFeedbackForUpdate(update);
    this.maybeShowHeroProgressNotice(update);
    this.setBattleFeedback(presentation.feedback, presentation.feedbackDurationMs ?? BATTLE_FEEDBACK_DURATION_MS);
    if (presentation.cue) {
      this.audioRuntime.playCue(presentation.cue);
    }
    this.mapBoard?.playHeroAnimation(presentation.animation);

    if (update.reason && isSessionSettlementReason(update.reason)) {
      this.predictionStatus = formatSessionSettlementReason(update.reason, !this.surrenderSubmitting);
    }

    if (presentation.transition?.kind === "enter") {
      await this.battleTransition?.playEnter(presentation.transition.copy);
    } else if (presentation.transition?.kind === "exit") {
      await this.battleTransition?.playExit(presentation.transition.copy);
    }

    this.syncWechatShareBridge();
    this.renderView();
  }

  private async refreshGameplayAccountProfile(): Promise<void> {
    if (this.gameplayAccountRefreshInFlight) {
      return;
    }

    if (this.sessionSource !== "remote") {
      return;
    }

    this.gameplayAccountRefreshInFlight = true;
    try {
      const profile = await resolveVeilRootRuntime().loadAccountProfile(this.remoteUrl, this.playerId, this.roomId, {
        storage: this.readWebStorage(),
        authSession: this.authToken
          ? {
              token: this.authToken,
              playerId: this.playerId,
              displayName: this.displayName || this.playerId,
              authMode: this.authMode,
              ...(this.loginId ? { loginId: this.loginId } : {}),
              source: "remote"
            }
          : null
      });
      this.commitAccountProfile(profile, true);
      this.renderView();
    } finally {
      this.gameplayAccountRefreshInFlight = false;
    }
  }

  private maybeShowHeroProgressNotice(update: SessionUpdate): void {
    const heroId = update.world.ownHeroes[0]?.id ?? null;
    const notice = buildHeroProgressNotice(update, heroId);
    if (!notice) {
      return;
    }

    this.levelUpNotice = {
      ...notice,
      expiresAt: Date.now() + 5000
    };
    this.pushLog(`${notice.title}。${notice.detail}`);
    this.mapBoard?.playHeroAnimation("victory");
    this.audioRuntime.playCue("level_up");
  }

  private commitAccountProfile(profile: CocosPlayerAccountProfile, allowAchievementNotice: boolean): void {
    if (profile.playerId !== this.lobbyAccountProfile.playerId) {
      this.seenProfileNoticeEventIds.clear();
    }

    if (allowAchievementNotice) {
      const notice = buildCocosProfileNotice(profile.recentEventLog, this.seenProfileNoticeEventIds);
      if (notice) {
        this.achievementNotice = {
          ...notice,
          expiresAt: Date.now() + 4000
        };
        this.pushLog(`${notice.title}：${notice.detail}`);
      }
    }

    for (const eventId of collectProfileNoticeEventIds(profile.recentEventLog)) {
      this.seenProfileNoticeEventIds.add(eventId);
    }

    this.lobbyAccountProfile = profile;
    this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
      type: "account.synced",
      account: profile
    });
  }

  private playMapFeedbackForUpdate(update: SessionUpdate): void {
    const heroId = update.world.ownHeroes[0]?.id;
    if (!heroId) {
      return;
    }

    for (const entry of buildMapFeedbackEntriesFromUpdate(update, heroId)) {
      this.mapBoard?.showTileFeedback(entry.position, entry.text, entry.durationSeconds);
    }

    for (const entry of buildObjectPulseEntriesFromUpdate(update, heroId)) {
      this.mapBoard?.pulseObject(entry.position, entry.scale, entry.durationSeconds);
    }
  }

  private applyReplayedSessionUpdate(update: SessionUpdate): void {
    this.pendingPrediction = null;
    this.predictionStatus = "已回放缓存状态，等待房间同步...";
    this.lastRoomUpdateSource = "replay";
    this.lastRoomUpdateReason = "cached_snapshot";
    this.lastRoomUpdateAtMs = Date.now();
    this.lastUpdate = {
      ...update,
      events: [],
      movementPlan: null
    };
    this.renderView();
  }

  private buildBattleSettlementRecoveryState(): {
    title: string;
    detail: string;
    badge: string;
    tone: CocosBattleFeedbackView["tone"];
    summaryLines: string[];
  } | null {
    if (!this.lastBattleSettlementSnapshot || this.lastUpdate?.battle) {
      return null;
    }

    const recoverySummaryLines = [
      `最近结算：${this.lastBattleSettlementSnapshot.label}`,
      ...this.lastBattleSettlementSnapshot.summaryLines
    ];

    if (this.diagnosticsConnectionStatus === "reconnecting") {
      return {
        title: "结算恢复中",
        detail: "已保留最近一次结算摘要，正在等待权威房间确认奖励、战利品与英雄同步；不会重复发放奖励。",
        badge: "RECOVER",
        tone: "neutral",
        summaryLines: recoverySummaryLines
      };
    }

    if (this.lastRoomUpdateSource === "replay" && this.lastRoomUpdateReason === "cached_snapshot") {
      return {
        title: "结算快照回放中",
        detail: "当前面板正在展示本地缓存的结算快照，等待服务端权威状态完成覆盖。",
        badge: "REPLAY",
        tone: "neutral",
        summaryLines: recoverySummaryLines
      };
    }

    if (this.diagnosticsConnectionStatus === "reconnect_failed") {
      return {
        title: "结算快照回补中",
        detail: "重连失败后已转入快照回补；当前结算摘要仅作恢复提示，最终奖励与装备状态仍以服务端快照为准。",
        badge: "FALLBACK",
        tone: "neutral",
        summaryLines: recoverySummaryLines
      };
    }

    if (this.lastUpdate?.reason?.includes("reconnect.restore")) {
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

  private captureBattleSettlementSnapshot(
    update: SessionUpdate,
    presentationState: CocosBattlePresentationState
  ): void {
    if (update.battle) {
      this.lastBattleSettlementSnapshot = null;
      return;
    }

    if (presentationState.phase === "resolution") {
      this.lastBattleSettlementSnapshot = {
        label: presentationState.label,
        detail: presentationState.detail,
        badge: presentationState.badge,
        tone: presentationState.tone,
        summaryLines: presentationState.summaryLines
      };
    }
  }

  private buildHudSessionIndicators(): VeilHudRenderState["sessionIndicators"] {
    const indicators: VeilHudRenderState["sessionIndicators"] = [];
    const replayingCachedSnapshot =
      this.lastRoomUpdateSource === "replay" && this.lastRoomUpdateReason === "cached_snapshot";
    const activePvpBattle = this.lastUpdate?.battle?.defenderHeroId
      ? {
          sessionId: `${this.lastUpdate.world.meta.roomId}/${this.lastUpdate.battle.id}`
        }
      : null;

    if (this.diagnosticsConnectionStatus === "reconnecting") {
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

    if (this.diagnosticsConnectionStatus === "reconnect_failed") {
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

  private applyPrediction(action: CocosWorldAction, status: string): void {
    if (!this.lastUpdate) {
      return;
    }

    const prediction = predictPlayerWorldAction(this.lastUpdate.world, action);
    if (prediction.reason) {
      return;
    }

    if (!this.pendingPrediction) {
      this.pendingPrediction = cloneSessionUpdate(this.lastUpdate);
    }

    this.lastUpdate = {
      ...this.lastUpdate,
      world: prediction.world,
      movementPlan: prediction.movementPlan,
      reachableTiles: prediction.reachableTiles
    };
    this.predictionStatus = status;
  }

  private rollbackPrediction(reason?: string): void {
    if (this.pendingPrediction) {
      this.lastUpdate = this.pendingPrediction;
      this.pendingPrediction = null;
    }

    this.predictionStatus = "";
    if (reason) {
      this.pushLog(reason);
      this.mapBoard?.playHeroAnimation("hit");
    }

    this.renderView();
  }

  private syncMusicScene(): void {
    if (this.showLobby) {
      this.audioRuntime.setScene(null);
      return;
    }

    if (this.lastUpdate?.battle) {
      this.audioRuntime.setScene("battle");
      return;
    }

    this.audioRuntime.setScene(this.lastUpdate?.world ? "explore" : null);
  }

  private buildHudPresentationState(): VeilHudRenderState["presentation"] {
    return {
      audio: this.audioRuntime.getState(),
      pixelAssets: getPixelSpriteLoadStatus(),
      readiness: cocosPresentationReadiness
    };
  }

}

export function setVeilRootRuntimeForTests(runtime: Partial<VeilRootRuntime>): void {
  // Tests only replace transport/persistence edges here so the VeilRoot boot,
  // reconnect, and handoff orchestration still runs through the production code.
  testVeilRootRuntimeOverrides = {
    ...testVeilRootRuntimeOverrides,
    ...runtime
  };
}

export function resetVeilRootRuntimeForTests(): void {
  testVeilRootRuntimeOverrides = null;
}

function cloneSessionUpdate(update: SessionUpdate): SessionUpdate {
  return JSON.parse(JSON.stringify(update)) as SessionUpdate;
}

function collapseAdjacentEntries(entries: string[]): string[] {
  const collapsed: string[] = [];
  for (const entry of entries) {
    if (collapsed[collapsed.length - 1] === entry) {
      continue;
    }
    collapsed.push(entry);
  }
  return collapsed;
}
