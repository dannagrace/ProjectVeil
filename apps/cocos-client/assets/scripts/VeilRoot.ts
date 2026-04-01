import { _decorator, Camera, Canvas, Color, Component, EventMouse, EventTouch, Graphics, input, Input, Label, Layers, Node, sys, UITransform, view } from "cc";
import { getEquipmentDefinition, type EquipmentType } from "./project-shared/index.ts";
import {
  type BattleAction,
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
  formatSessionActionReason
} from "./cocos-ui-formatters.ts";
import { buildHeroProgressNotice, type HeroProgressNotice } from "./cocos-hero-progression.ts";
import { VeilHudPanel, type VeilHudRenderState } from "./VeilHudPanel.ts";
import { VeilLobbyPanel } from "./VeilLobbyPanel.ts";
import {
  buildCocosAccountLifecyclePanelView,
  type CocosAccountLifecycleDeliveryMode,
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
  buildCocosAchievementUnlockNotice,
  collectAchievementUnlockEventIds,
  shouldRefreshGameplayAccountProfileForEvents
} from "./cocos-achievements.ts";
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
import { formatEquipmentActionReason, formatEquipmentSlotLabel } from "./cocos-hero-equipment.ts";
import { type CocosBattleFeedbackView } from "./cocos-battle-feedback.ts";
import { createCocosBattlePresentationController } from "./cocos-battle-presentation-controller.ts";
import { createCocosAudioRuntime } from "./cocos-audio-runtime.ts";
import { createCocosAudioAssetBridge } from "./cocos-audio-resources.ts";
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
  validateAccountPassword
} from "../../../../packages/shared/src/index.ts";

const { ccclass, property } = _decorator;

const HUD_NODE_NAME = "ProjectVeilHud";
const MAP_NODE_NAME = "ProjectVeilMap";
const BATTLE_NODE_NAME = "ProjectVeilBattlePanel";
const TIMELINE_NODE_NAME = "ProjectVeilTimelinePanel";
const LOBBY_NODE_NAME = "ProjectVeilLobbyPanel";
const ACCOUNT_REVIEW_PANEL_NODE_NAME = "ProjectVeilAccountReviewPanel";
const DEFAULT_MAP_WIDTH_TILES = 8;
const DEFAULT_MAP_HEIGHT_TILES = 8;
const BATTLE_FEEDBACK_DURATION_MS = 2600;
const ACCOUNT_REVIEW_PAGE_SIZE = 3;

interface VeilRootRuntime {
  createSession: typeof VeilCocosSession.create;
  readStoredReplay: typeof VeilCocosSession.readStoredReplay;
  loadLobbyRooms: typeof loadCocosLobbyRooms;
  syncAuthSession: typeof syncCurrentCocosAuthSession;
  loadAccountProfile: typeof loadCocosPlayerAccountProfile;
  loadProgressionSnapshot: typeof loadCocosPlayerProgressionSnapshot;
  loadAchievementProgress: typeof loadCocosPlayerAchievementProgress;
  loadEventHistory: typeof loadCocosPlayerEventHistory;
  loadBattleReplayHistoryPage: typeof loadCocosBattleReplayHistoryPage;
  loginGuestAuthSession: typeof loginCocosGuestAuthSession;
}

const defaultVeilRootRuntime: VeilRootRuntime = {
  createSession: (...args) => VeilCocosSession.create(...args),
  readStoredReplay: (...args) => VeilCocosSession.readStoredReplay(...args),
  loadLobbyRooms: (...args) => loadCocosLobbyRooms(...args),
  syncAuthSession: (...args) => syncCurrentCocosAuthSession(...args),
  loadAccountProfile: (...args) => loadCocosPlayerAccountProfile(...args),
  loadProgressionSnapshot: (...args) => loadCocosPlayerProgressionSnapshot(...args),
  loadAchievementProgress: (...args) => loadCocosPlayerAchievementProgress(...args),
  loadEventHistory: (...args) => loadCocosPlayerEventHistory(...args),
  loadBattleReplayHistoryPage: (...args) => loadCocosBattleReplayHistoryPage(...args),
  loginGuestAuthSession: (...args) => loginCocosGuestAuthSession(...args)
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
  private battleFeedback: (CocosBattleFeedbackView & { expiresAt: number }) | null = null;
  private fogPulsePhase = 0;
  private hudActionBinding = false;
  private sessionEpoch = 0;
  private authToken: string | null = null;
  private authMode: "guest" | "account" = "guest";
  private authProvider: CocosAuthProvider = "guest";
  private loginId = "";
  private sessionSource: "remote" | "local" | "manual" | "none" = "none";
  private levelUpNotice: (HeroProgressNotice & { expiresAt: number }) | null = null;
  private achievementNotice: ({ title: string; detail: string; expiresAt: number } & { eventId: string }) | null = null;
  private showLobby = false;
  private lobbyRooms: CocosLobbyRoomSummary[] = [];
  private lobbyStatus = "请选择一个房间，或手动输入新的房间 ID。";
  private lobbyLoading = false;
  private lobbyEntering = false;
  private lobbyAccountProfile: CocosPlayerAccountProfile = createFallbackCocosPlayerAccountProfile("player-1", "test-room");
  private lobbyAccountReviewState: CocosAccountReviewState = createCocosAccountReviewState(this.lobbyAccountProfile);
  private lobbyAccountEpoch = 0;
  private gameplayAccountRefreshInFlight = false;
  private gameplayAccountReviewPanel: VeilProgressionPanel | null = null;
  private gameplayAccountReviewPanelOpen = false;
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
  private seenAchievementUnlockEventIds = new Set<string>();
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
      onToggleAchievements: () => {
        void this.toggleGameplayAccountReviewPanel();
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
      onRefresh: () => {
        void this.refreshLobbyRoomList();
      },
      onEnterRoom: () => {
        void this.enterLobbyRoom();
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

    if (this.showLobby) {
      this.lobbyPanel?.render({
        playerId: this.playerId,
        displayName: this.displayName || this.playerId,
        roomId: this.roomId,
        authMode: this.authMode,
        loginId: this.loginId,
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
        sessionSource: this.sessionSource,
        loading: this.lobbyLoading,
        entering: this.lobbyEntering,
        status: this.lobbyStatus,
        rooms: this.lobbyRooms,
        accountFlow: this.buildActiveAccountFlowPanelView(),
        presentationReadiness: cocosPresentationReadiness
      });
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
      presentation: this.buildHudPresentationState()
    });
    this.mapBoard?.render(this.lastUpdate);
    this.battlePanel?.render({
      update: this.lastUpdate,
      timelineEntries: this.timelineEntries,
      controlledCamp: this.controlledBattleCamp(),
      selectedTargetId: this.selectedBattleTargetId,
      actionPending: this.battleActionInFlight,
      feedback: this.battleFeedback,
      presentationState: this.battlePresentation.getState()
    });
    this.timelinePanel?.render({
      entries: this.timelineEntries
    });
    this.renderGameplayAccountReviewPanel();
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
    } else if (this.sessionSource !== "manual") {
      this.authToken = null;
      this.authMode = "guest";
      this.authProvider = "guest";
      this.loginId = "";
      this.sessionSource = "none";
    }

    const profile = await resolveVeilRootRuntime().loadAccountProfile(this.remoteUrl, this.playerId, this.roomId, {
      storage,
      authSession: syncedSession
    });
    if (!this.isActiveLobbyAccountEpoch(requestEpoch)) {
      return;
    }

    this.commitAccountProfile(profile, false);
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
        onToggleAchievements: () => {
          void this.toggleGameplayAccountReviewPanel();
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
  }

  private handleHudActionInput(...args: unknown[]): void {
    this.audioRuntime.unlock();
    if (this.showLobby) {
      return;
    }

    const event = args[0] as EventTouch | EventMouse | undefined;
    if (!event) {
      return;
    }

    const visibleSize = view.getVisibleSize();
    const centeredX = event.getUILocation().x - visibleSize.width / 2;
    const centeredY = event.getUILocation().y - visibleSize.height / 2;
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
    if (clickedCurrentTile) {
      if (!tile.resource && !tile.building) {
        this.pushLog("英雄已经站在这里了。");
        this.mapBoard?.pulseTile(tile.position, 1.04, 0.14);
        this.mapBoard?.showTileFeedback(tile.position, "原地", 0.45);
        this.renderView();
        return;
      }

      if (tile.building) {
        this.moveInFlight = true;
        this.pushLog(`正在访问 ${tile.building.label}...`);
        this.mapBoard?.pulseTile(tile.position, 1.12, 0.22);
        this.mapBoard?.pulseObject(tile.position, 1.2, 0.24);
        this.applyPrediction(
          tile.building.kind === "recruitment_post"
            ? {
                type: "hero.recruit",
                heroId: hero.id,
                buildingId: tile.building.id
              }
            : tile.building.kind === "attribute_shrine" || tile.building.kind === "watchtower"
              ? {
                  type: "hero.visit",
                  heroId: hero.id,
                  buildingId: tile.building.id
                }
              : {
                  type: "hero.claimMine",
                  heroId: hero.id,
                  buildingId: tile.building.id
                },
          tile.building.kind === "recruitment_post"
            ? `预演招募 ${tile.building.availableCount} 单位`
            : tile.building.kind === "attribute_shrine"
              ? `预演获得 ${formatHeroStatBonus(tile.building.bonus)}`
              : tile.building.kind === "watchtower"
                ? `预演提高视野 ${tile.building.visionBonus}`
              : `预演占领矿场，改为每日产出 ${tile.building.income} ${formatResourceKindLabel(tile.building.resourceKind)}`
        );
        this.renderView();

        try {
          this.mapBoard?.playHeroAnimation("attack");
          const update =
            tile.building.kind === "recruitment_post"
              ? await this.session.recruit(hero.id, tile.building.id)
              : tile.building.kind === "attribute_shrine" || tile.building.kind === "watchtower"
                ? await this.session.visitBuilding(hero.id, tile.building.id)
                : await this.session.claimMine(hero.id, tile.building.id);
          await this.applySessionUpdate(update);
          this.pushSessionActionOutcome(update, {
            successMessage:
              tile.building.kind === "recruitment_post"
                ? "招募已结算。"
                : tile.building.kind === "attribute_shrine"
                  ? "神殿访问已结算。"
                  : tile.building.kind === "watchtower"
                    ? "瞭望塔访问已结算。"
                  : "矿场占领已结算。",
            rejectedLabel:
              tile.building.kind === "recruitment_post"
                ? "招募"
                : tile.building.kind === "attribute_shrine"
                  ? "神殿访问"
                  : tile.building.kind === "watchtower"
                    ? "瞭望塔访问"
                  : "矿场占领"
          });
        } catch (error) {
          this.rollbackPrediction(
            error instanceof Error
              ? error.message
              : tile.building.kind === "recruitment_post"
                ? "招募失败。"
                : tile.building.kind === "attribute_shrine" || tile.building.kind === "watchtower"
                  ? "访问失败。"
                  : "占领失败。"
          );
        } finally {
          this.moveInFlight = false;
          this.renderView();
        }
        return;
      }

      const resource = tile.resource;
      if (!resource) {
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
          storage
        });
      }
      this.authToken = authSession.token ?? null;
      this.playerId = authSession.playerId;
      this.displayName = authSession.displayName;
      this.authMode = authSession.authMode;
      this.authProvider = authSession.provider ?? "guest";
      this.loginId = authSession.loginId ?? "";
      this.sessionSource = authSession.source;
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
        { storage }
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

  private async registerLobbyAccount(): Promise<void> {
    this.openLobbyAccountFlow("registration");
  }

  private async recoverLobbyAccountPassword(): Promise<void> {
    this.openLobbyAccountFlow("recovery");
  }

  private async loginLobbyWechatMiniGame(): Promise<void> {
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
          authToken: this.authToken
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
    await this.disposeCurrentSession();
    this.resetSessionViewport("已返回 Cocos Lobby。");
    this.gameplayAccountReviewPanelOpen = false;
    this.showLobby = true;
    this.syncWechatShareBridge();
    this.lobbyStatus = "已返回大厅，可继续选房或创建新实例。";
    this.syncBrowserRoomQuery(null);
    this.renderView();
    await this.syncLobbyBootstrap();
  }

  private async logoutAuthSession(): Promise<void> {
    await logoutCurrentCocosAuthSession(this.remoteUrl, {
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

  private buildActiveAccountFlowPanelView() {
    if (!this.activeAccountFlow) {
      return null;
    }

    return buildCocosAccountLifecyclePanelView(
      this.activeAccountFlow === "registration"
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
          }
    );
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
      password: this.activeAccountFlow === "registration" ? this.registrationPassword : this.recoveryPassword
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
        { storage }
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
        { storage }
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
    const storage = this.readWebStorage();
    const launchIdentity = resolveCocosLaunchIdentity({
      defaultRoomId: this.roomId,
      defaultPlayerId: this.playerId,
      defaultDisplayName: this.displayName,
      search: this.readLaunchSearch(),
      storedSession: readStoredCocosAuthSession(storage)
    });

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

  private readLaunchSearch(): string {
    return readCocosRuntimeLaunchSearch(globalThis as {
      location?: Pick<Location, "search"> | null;
      wx?: { getLaunchOptionsSync?: () => { query?: Record<string, unknown> | null } | null | undefined };
    });
  }

  private describeLobbyShareHint(): string {
    return `分享：${this.wechatShareStatus}`;
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
    const label =
      event === "reconnecting"
        ? "连接已中断，正在尝试重连..."
        : event === "reconnected"
          ? "连接已恢复。"
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

    this.pendingPrediction = null;
    this.predictionStatus = "";
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
      this.seenAchievementUnlockEventIds.clear();
    }

    if (allowAchievementNotice) {
      const notice = buildCocosAchievementUnlockNotice(profile.recentEventLog, this.seenAchievementUnlockEventIds);
      if (notice) {
        this.achievementNotice = {
          ...notice,
          expiresAt: Date.now() + 4000
        };
        this.pushLog(`${notice.title}：${notice.detail}`);
      }
    }

    for (const eventId of collectAchievementUnlockEventIds(profile.recentEventLog)) {
      this.seenAchievementUnlockEventIds.add(eventId);
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
    this.battlePresentation.reset();
    this.renderView();
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
