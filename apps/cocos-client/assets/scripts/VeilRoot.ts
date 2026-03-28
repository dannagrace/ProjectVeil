import { _decorator, Camera, Canvas, Component, EventMouse, EventTouch, input, Input, Layers, Node, sys, UITransform, view } from "cc";
import { getEquipmentDefinition, type EquipmentType } from "../../../../packages/shared/src/index.ts";
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
  clearCurrentCocosAuthSession,
  createFallbackCocosPlayerAccountProfile,
  createCocosGuestPlayerId,
  createCocosLobbyPreferences,
  loadCocosLobbyRooms,
  loadCocosPlayerAccountProfile,
  loginCocosGuestAuthSession,
  readPreferredCocosDisplayName,
  rememberPreferredCocosDisplayName,
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
import { type CocosWorldAction, predictPlayerWorldAction } from "./cocos-prediction.ts";
import { VeilBattleTransition } from "./VeilBattleTransition.ts";
import { VeilBattlePanel } from "./VeilBattlePanel.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";
import { buildTimelineEntriesFromUpdate } from "./cocos-ui-formatters.ts";
import { buildHeroProgressNotice, type HeroProgressNotice } from "./cocos-hero-progression.ts";
import { VeilHudPanel } from "./VeilHudPanel.ts";
import { VeilLobbyPanel } from "./VeilLobbyPanel.ts";
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
  buildCocosWechatSharePayload,
  syncCocosWechatShareBridge,
  type CocosWechatShareRuntimeLike
} from "./cocos-wechat-share.ts";
import { readStoredCocosAuthSession, resolveCocosLaunchIdentity, type CocosAuthProvider } from "./cocos-session-launch.ts";
import { VeilTimelinePanel } from "./VeilTimelinePanel.ts";
import { formatEquipmentActionReason, formatEquipmentSlotLabel } from "./cocos-hero-equipment.ts";
import { buildBattleEnterCopy, buildBattleExitCopy } from "./cocos-battle-transition-copy.ts";

const { ccclass, property } = _decorator;

const HUD_NODE_NAME = "ProjectVeilHud";
const MAP_NODE_NAME = "ProjectVeilMap";
const BATTLE_NODE_NAME = "ProjectVeilBattlePanel";
const TIMELINE_NODE_NAME = "ProjectVeilTimelinePanel";
const LOBBY_NODE_NAME = "ProjectVeilLobbyPanel";
const DEFAULT_MAP_WIDTH_TILES = 8;
const DEFAULT_MAP_HEIGHT_TILES = 8;

interface BattleResolvedEventLike {
  type: "battle.resolved";
  result: "attacker_victory" | "defender_victory";
  heroId: string;
  battleId: string;
  defenderHeroId?: string;
  [key: string]: unknown;
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
  private fogPulsePhase = 0;
  private hudActionBinding = false;
  private sessionEpoch = 0;
  private authToken: string | null = null;
  private authMode: "guest" | "account" = "guest";
  private authProvider: CocosAuthProvider = "guest";
  private loginId = "";
  private sessionSource: "remote" | "local" | "manual" | "none" = "none";
  private levelUpNotice: (HeroProgressNotice & { expiresAt: number }) | null = null;
  private showLobby = false;
  private lobbyRooms: CocosLobbyRoomSummary[] = [];
  private lobbyStatus = "请选择一个房间，或手动输入新的房间 ID。";
  private lobbyLoading = false;
  private lobbyEntering = false;
  private lobbyAccountProfile: CocosPlayerAccountProfile = createFallbackCocosPlayerAccountProfile("player-1", "test-room");
  private lobbyAccountEpoch = 0;
  private gameplayAccountRefreshInFlight = false;
  private runtimePlatform: CocosRuntimePlatform = "unknown";
  private runtimeCapabilities: CocosRuntimeCapabilities = resolveCocosRuntimeCapabilities("unknown");
  private loginRuntimeConfig: CocosLoginRuntimeConfig = resolveCocosLoginRuntimeConfig();
  private loginProviders: CocosLoginProviderDescriptor[] = [];
  private wechatShareStatus = "分享功能仅在微信小游戏可用。";
  private wechatShareAvailable = false;
  private runtimeMemoryNotice = "";
  private stopRuntimeMemoryWarnings: (() => void) | null = null;

  onLoad(): void {
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

    this.pushLog(`正在连接 ${this.remoteUrl} ...`);
    const replayed = VeilCocosSession.readStoredReplay(this.roomId, this.playerId);
    if (replayed) {
      this.applyReplayedSessionUpdate(replayed);
      this.pushLog("已回放本地缓存，等待房间实时同步。");
    }
    this.renderView();

    const sessionEpoch = this.bumpSessionEpoch();
    let nextSession: VeilCocosSession | null = null;
    try {
      nextSession = await VeilCocosSession.create(this.roomId, this.playerId, this.seed, this.createSessionOptions(sessionEpoch));
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
      await this.applySessionUpdate(await this.session.learnSkill(hero.id, skillId));
      this.pushLog("技能学习已结算。");
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
      this.renderView();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("战斗中无法调整装备。");
      this.predictionStatus = "战斗中无法调整装备。";
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
      await this.applySessionUpdate(await this.session.equipHeroItem(hero.id, slot, equipmentId));
      this.pushLog("装备已结算。");
    } catch (error) {
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
      this.renderView();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("战斗中无法调整装备。");
      this.predictionStatus = "战斗中无法调整装备。";
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
      await this.applySessionUpdate(await this.session.unequipHeroItem(hero.id, slot));
      this.pushLog("卸装已结算。");
    } catch (error) {
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
    lobbyTransform.setContentSize(Math.max(360, visibleSize.width - 48), Math.max(520, visibleSize.height - 52));
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
      onOpenConfigCenter: () => {
        this.openConfigCenter();
      },
      onLogout: () => {
        this.logoutAuthSession();
      },
      onJoinRoom: (roomId) => {
        void this.enterLobbyRoom(roomId);
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

    this.updateLayout();
    const lobbyNode = this.node.getChildByName(LOBBY_NODE_NAME);
    const hudNode = this.node.getChildByName(HUD_NODE_NAME);
    const mapNode = this.node.getChildByName(MAP_NODE_NAME);
    const battleNode = this.node.getChildByName(BATTLE_NODE_NAME);
    const timelineNode = this.node.getChildByName(TIMELINE_NODE_NAME);
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
        sessionSource: this.sessionSource,
        loading: this.lobbyLoading,
        entering: this.lobbyEntering,
        status: this.lobbyStatus,
        rooms: this.lobbyRooms
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
      levelUpNotice: this.levelUpNotice ? { title: this.levelUpNotice.title, detail: this.levelUpNotice.detail } : null
    });
    this.mapBoard?.render(this.lastUpdate);
    this.battlePanel?.render({
      update: this.lastUpdate,
      timelineEntries: this.timelineEntries,
      controlledCamp: this.controlledBattleCamp(),
      selectedTargetId: this.selectedBattleTargetId,
      actionPending: this.battleActionInFlight
    });
    this.timelinePanel?.render({
      entries: this.timelineEntries
    });
  }

  private formatLobbyVaultSummary(): string {
    const resources = this.lobbyAccountProfile.globalResources;
    return `全局仓库 金币 ${resources.gold} / 木材 ${resources.wood} / 矿石 ${resources.ore}`;
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
    const syncedSession = await syncCurrentCocosAuthSession(this.remoteUrl, {
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

    const profile = await loadCocosPlayerAccountProfile(this.remoteUrl, this.playerId, this.roomId, {
      storage,
      authSession: syncedSession
    });
    if (!this.isActiveLobbyAccountEpoch(requestEpoch)) {
      return;
    }

    this.lobbyAccountProfile = profile;
    if (profile.source === "remote") {
      this.displayName = profile.displayName;
      this.loginId = profile.loginId ?? this.loginId;
    }
    this.syncWechatShareBridge();
    this.renderView();
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
  }

  private handleHudActionInput(...args: unknown[]): void {
    if (this.showLobby) {
      return;
    }

    const event = args[0] as EventTouch | EventMouse | undefined;
    if (!event) {
      return;
    }

    const action = this.resolveHudActionAt(event.getUILocation().x, event.getUILocation().y);
    if (!action) {
      return;
    }

    if (action === "new-run") {
      this.inputDebug = "button new-run";
      void this.startNewRun();
      return;
    }

    if (action === "refresh") {
      this.inputDebug = "button refresh";
      void this.refreshSnapshot();
      return;
    }

    if (action === "return-lobby") {
      this.inputDebug = "button return-lobby";
      void this.returnToLobby();
      return;
    }

    this.inputDebug = "button end-day";
    void this.advanceDay();
  }

  private resolveHudActionAt(uiX: number, uiY: number): "new-run" | "refresh" | "end-day" | "return-lobby" | null {
    const visibleSize = view.getVisibleSize();
    const centeredX = uiX - visibleSize.width / 2;
    const centeredY = uiY - visibleSize.height / 2;
    const hudNode = this.node.getChildByName(HUD_NODE_NAME);
    const hudTransform = hudNode?.getComponent(UITransform) ?? null;
    if (!hudNode || !hudTransform) {
      return null;
    }

    const hudLocalX = centeredX - hudNode.position.x;
    const hudLocalY = centeredY - hudNode.position.y;

    if (
      hudLocalX < -hudTransform.width / 2 ||
      hudLocalX > hudTransform.width / 2 ||
      hudLocalY < -hudTransform.height / 2 ||
      hudLocalY > hudTransform.height / 2
    ) {
      return null;
    }

    const actionsCenterY = hudTransform.height / 2 - 118;
    const buttonWidth = Math.max(156, hudTransform.width - 36);
    const buttonHeight = 28;

    if (this.pointInRect(hudLocalX, hudLocalY, 0, actionsCenterY + 45, buttonWidth, buttonHeight)) {
      return "new-run";
    }

    if (this.pointInRect(hudLocalX, hudLocalY, 0, actionsCenterY + 15, buttonWidth, buttonHeight)) {
      return "refresh";
    }

    if (this.pointInRect(hudLocalX, hudLocalY, 0, actionsCenterY - 15, buttonWidth, buttonHeight)) {
      return "end-day";
    }

    if (this.pointInRect(hudLocalX, hudLocalY, 0, actionsCenterY - 45, buttonWidth, buttonHeight)) {
      return "return-lobby";
    }

    return null;
  }

  private pointInRect(x: number, y: number, centerX: number, centerY: number, width: number, height: number): boolean {
    return x >= centerX - width / 2 && x <= centerX + width / 2 && y >= centerY - height / 2 && y <= centerY + height / 2;
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
            : tile.building.kind === "attribute_shrine"
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
              : `预演占领矿场，改为每日产出 ${tile.building.income} ${formatResourceKindLabel(tile.building.resourceKind)}`
        );
        this.renderView();

        try {
          this.mapBoard?.playHeroAnimation("attack");
          await this.applySessionUpdate(
            tile.building.kind === "recruitment_post"
              ? await this.session.recruit(hero.id, tile.building.id)
              : tile.building.kind === "attribute_shrine"
                ? await this.session.visitBuilding(hero.id, tile.building.id)
                : await this.session.claimMine(hero.id, tile.building.id)
          );
          this.pushLog(
            tile.building.kind === "recruitment_post"
              ? "招募已结算。"
              : tile.building.kind === "attribute_shrine"
                ? "神殿访问已结算。"
                : "矿场占领已结算。"
          );
        } catch (error) {
          this.rollbackPrediction(
            error instanceof Error
              ? error.message
              : tile.building.kind === "recruitment_post"
                ? "招募失败。"
                : tile.building.kind === "attribute_shrine"
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
        await this.applySessionUpdate(await this.session.collect(hero.id, tile.position));
        this.pushLog("采集已结算。");
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
      this.pushLog(`地块 (${tile.position.x}, ${tile.position.y}) 当前不可达。`);
      this.mapBoard?.pulseTile(tile.position, 1.08, 0.18);
      this.mapBoard?.showTileFeedback(tile.position, "不可达", 0.6);
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
      await this.applySessionUpdate(await this.session.moveHero(hero.id, target));
      this.pushLog("移动已结算。");
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
    this.logLines = [`正在创建新房间 ${nextRoomId} ...`];
    this.renderView();

    try {
      freshSession = await VeilCocosSession.create(nextRoomId, this.playerId, nextSeed, this.createSessionOptions(nextSessionEpoch));
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
      const rooms = await loadCocosLobbyRooms(this.remoteUrl);
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
        const syncedSession = await syncCurrentCocosAuthSession(this.remoteUrl, {
          storage,
          session: readStoredCocosAuthSession(storage)
        });
        if (!syncedSession) {
          throw new Error("cocos_request_failed:401");
        }
        authSession = syncedSession;
      } else {
        authSession = await loginCocosGuestAuthSession(this.remoteUrl, preferences.playerId, displayName, {
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

      this.lobbyAccountProfile = createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName);
      this.renderView();
    } catch (error) {
      this.showLobby = true;
      if (error instanceof Error && error.message === "cocos_request_failed:401") {
        this.authToken = null;
        this.authMode = "guest";
        this.authProvider = "guest";
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
    if (!nextLoginId) {
      this.lobbyStatus = "请输入登录 ID 后再使用正式账号进入。";
      this.renderView();
      return;
    }

    const password = promptRef("输入账号口令", "");
    if (password == null) {
      return;
    }
    if (!password.trim()) {
      this.lobbyStatus = "请输入账号口令后再登录。";
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
      this.lobbyStatus =
        error instanceof Error && error.message === "cocos_request_failed:401"
          ? "登录 ID 或口令不正确，请检查后重试。"
          : error instanceof Error
            ? error.message
            : "account_login_failed";
      this.renderView();
    }
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
    this.showLobby = true;
    this.syncWechatShareBridge();
    this.lobbyStatus = "已返回大厅，可继续选房或创建新实例。";
    this.syncBrowserRoomQuery(null);
    this.renderView();
    await this.syncLobbyBootstrap();
  }

  private logoutAuthSession(): void {
    clearCurrentCocosAuthSession(this.readWebStorage());
    this.authToken = null;
    this.authMode = "guest";
    this.authProvider = "guest";
    this.loginId = "";
    this.sessionSource = "none";
    this.displayName = readPreferredCocosDisplayName(this.playerId, this.readWebStorage());
    this.lobbyAccountProfile = createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName);
    this.syncWechatShareBridge();
    this.lobbyStatus = "已退出当前会话，请重新选择游客身份或使用正式账号进入。";
    this.renderView();
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
    this.predictionStatus = "";
    this.inputDebug = "input waiting";
    this.timelineEntries = [];
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

    return error.message || fallback;
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
      this.lobbyAccountProfile = createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName);
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
    this.lobbyAccountProfile = createFallbackCocosPlayerAccountProfile(this.playerId, this.roomId, this.displayName);

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

  private isBattleResolvedEvent(event: SessionUpdate["events"][number]): event is BattleResolvedEventLike {
    return (
      event.type === "battle.resolved" &&
      typeof event.heroId === "string" &&
      (event.result === "attacker_victory" || event.result === "defender_victory") &&
      (event.defenderHeroId === undefined || typeof event.defenderHeroId === "string")
    );
  }

  private didCurrentPlayerWinBattle(event: BattleResolvedEventLike): boolean {
    const heroId = this.activeHero()?.id;
    if (!heroId) {
      return false;
    }

    if (event.result === "attacker_victory") {
      return event.heroId === heroId;
    }

    return event.defenderHeroId === heroId;
  }

  private handleConnectionEvent(event: ConnectionEvent): void {
    const label =
      event === "reconnecting"
        ? "连接已中断，正在尝试重连..."
        : event === "reconnected"
          ? "连接已恢复。"
          : "重连失败，正在尝试恢复房间快照...";
    this.pushLog(label);
    this.renderView();
  }

  private async actInBattle(action: BattleAction): Promise<void> {
    if (!this.session || this.battleActionInFlight) {
      return;
    }

    this.battleActionInFlight = true;
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
    this.renderView();

    try {
      if (action.type === "battle.attack" || (action.type === "battle.skill" && action.targetId && action.targetId !== action.unitId)) {
        this.mapBoard?.playHeroAnimation("attack");
      }

      await this.applySessionUpdate(await this.session.actInBattle(action));
    } catch (error) {
      this.pushLog(error instanceof Error ? error.message : "战斗操作失败。");
      this.mapBoard?.playHeroAnimation("hit");
    } finally {
      this.battleActionInFlight = false;
      this.renderView();
    }
  }

  private async applySessionUpdate(update: SessionUpdate): Promise<void> {
    const previousBattle = this.lastUpdate?.battle ?? null;
    const previousBattleId = previousBattle?.id ?? null;
    const nextBattleId = update.battle?.id ?? null;

    this.pendingPrediction = null;
    this.predictionStatus = "";
    this.lastUpdate = update;
    const eventEntries = buildTimelineEntriesFromUpdate(update);
    if (eventEntries.length > 0) {
      this.timelineEntries = collapseAdjacentEntries([...eventEntries, ...this.timelineEntries]).slice(0, 12);
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
      void this.refreshGameplayAccountProfile();
    }
    this.syncSelectedBattleTarget();
    this.playMapFeedbackForUpdate(update);
    this.maybeShowHeroProgressNotice(update);

    if (!previousBattleId && nextBattleId) {
      this.mapBoard?.playHeroAnimation("attack");
      await this.battleTransition?.playEnter(buildBattleEnterCopy(update.events));
    } else if (previousBattleId && !nextBattleId) {
      const resolvedEvent = update.events.find((event) => this.isBattleResolvedEvent(event));
      const didWin = resolvedEvent ? this.didCurrentPlayerWinBattle(resolvedEvent) : false;
      this.mapBoard?.playHeroAnimation(
        resolvedEvent ? (didWin ? "victory" : "defeat") : "idle"
      );
      await this.battleTransition?.playExit(buildBattleExitCopy(update.events, didWin));
    } else {
      this.mapBoard?.playHeroAnimation("idle");
    }

    this.syncWechatShareBridge();
    this.renderView();
  }

  private async refreshGameplayAccountProfile(): Promise<void> {
    if (this.gameplayAccountRefreshInFlight) {
      return;
    }

    this.gameplayAccountRefreshInFlight = true;
    try {
      this.lobbyAccountProfile = await loadCocosPlayerAccountProfile(this.remoteUrl, this.playerId, this.roomId, {
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
    this.playLevelUpSound();
  }

  private playLevelUpSound(): void {
    const audioContextCtor =
      (globalThis as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
    if (!audioContextCtor) {
      return;
    }

    try {
      const audioContext = new audioContextCtor();
      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(523.25, now);
      oscillator.frequency.linearRampToValueAtTime(659.25, now + 0.12);
      oscillator.frequency.linearRampToValueAtTime(783.99, now + 0.24);
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.34);
      oscillator.onended = () => {
        void audioContext.close().catch(() => undefined);
      };
    } catch {
      // Ignore audio failures in runtimes that block autoplay or lack Web Audio.
    }
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
    this.lastUpdate = {
      ...update,
      events: [],
      movementPlan: null
    };
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
