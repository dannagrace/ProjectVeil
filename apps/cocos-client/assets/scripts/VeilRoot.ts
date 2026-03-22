import { _decorator, Camera, Canvas, Component, EventMouse, EventTouch, input, Input, Layers, Node, UITransform, view } from "cc";
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
import { predictPlayerWorldAction } from "./cocos-prediction.ts";
import { VeilBattleTransition } from "./VeilBattleTransition.ts";
import { VeilBattlePanel } from "./VeilBattlePanel.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";
import { buildTimelineEntriesFromUpdate } from "./cocos-ui-formatters.ts";
import { VeilHudPanel } from "./VeilHudPanel.ts";
import { VeilMapBoard } from "./VeilMapBoard.ts";
import { buildMapFeedbackEntriesFromUpdate, buildObjectPulseEntriesFromUpdate } from "./cocos-map-visuals.ts";
import { VeilTimelinePanel } from "./VeilTimelinePanel.ts";

const { ccclass, property } = _decorator;

const HUD_NODE_NAME = "ProjectVeilHud";
const MAP_NODE_NAME = "ProjectVeilMap";
const BATTLE_NODE_NAME = "ProjectVeilBattlePanel";
const TIMELINE_NODE_NAME = "ProjectVeilTimelinePanel";
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

@ccclass("ProjectVeilRoot")
export class VeilRoot extends Component {
  @property
  roomId = "test-room";

  @property
  playerId = "player-1";

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
  private battleTransition: VeilBattleTransition | null = null;
  private session: VeilCocosSession | null = null;
  private lastUpdate: SessionUpdate | null = null;
  private logLines: string[] = ["Cocos 原型已就绪。"];
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

  onLoad(): void {
    this.ensureUiCameraVisibility();
    this.ensureViewNodes();
    this.ensureHudActionBinding();
    this.renderView();
  }

  start(): void {
    if (this.fogPulseEnabled) {
      this.scheduleFogPulseTick();
    }

    if (this.autoConnect) {
      void this.connect();
    }
  }

  onDestroy(): void {
    this.unscheduleAllCallbacks();
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
    this.updateLayout();
    this.hudPanel?.render({
      roomId: this.roomId,
      playerId: this.playerId,
      remoteUrl: this.remoteUrl,
      update: this.lastUpdate,
      moveInFlight: this.moveInFlight,
      predictionStatus: this.predictionStatus,
      inputDebug: this.inputDebug
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
    const hudWidth = Math.max(240, Math.min(320, Math.floor(visibleSize.width * 0.24)));
    const rightWidth = Math.max(240, Math.min(320, Math.floor(visibleSize.width * 0.24)));
    const effectiveTileSize = this.computeEffectiveTileSize(hudWidth, rightWidth);
    const mapWidth = this.currentMapPixelWidth(effectiveTileSize);
    const hudHeight = Math.max(320, visibleSize.height - 48);
    const battleHeight = Math.max(220, Math.floor((visibleSize.height - 72) * 0.42));
    const timelineHeight = Math.max(220, visibleSize.height - battleHeight - 72);

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
      hudNode.setPosition(-visibleSize.width / 2 + margin + hudWidth / 2, 42, 0);
      this.hudPanel?.configure({
        onNewRun: () => {
          void this.startNewRun();
        },
        onRefresh: () => {
          void this.refreshSnapshot();
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
        visibleSize.height / 2 - margin - battleHeight / 2,
        0
      );
    }

    if (timelineNode) {
      const timelineTransform = timelineNode.getComponent(UITransform) ?? timelineNode.addComponent(UITransform);
      timelineTransform.setContentSize(rightWidth, timelineHeight);
      timelineNode.setPosition(
        visibleSize.width / 2 - margin - rightWidth / 2,
        -visibleSize.height / 2 + margin + timelineHeight / 2,
        0
      );
    }
  }

  private handleHudActionInput(...args: unknown[]): void {
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

    this.inputDebug = "button refresh";
    void this.refreshSnapshot();
  }

  private resolveHudActionAt(uiX: number, uiY: number): "new-run" | "refresh" | null {
    const visibleSize = view.getVisibleSize();
    const centeredX = uiX - visibleSize.width / 2;
    const centeredY = uiY - visibleSize.height / 2;
    const hudNode = this.node.getChildByName(HUD_NODE_NAME);
    const hudTransform = hudNode?.getComponent(UITransform) ?? null;
    const actionsNode = hudNode?.getChildByName("HudActions") ?? null;
    if (!hudNode || !hudTransform || !actionsNode) {
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

    const actionsLocalX = hudLocalX - actionsNode.position.x;
    const actionsLocalY = hudLocalY - actionsNode.position.y;

    const newRunNode = actionsNode.getChildByName("HudNewRun");
    if (newRunNode) {
      const transform = newRunNode.getComponent(UITransform) ?? newRunNode.addComponent(UITransform);
      if (
        this.pointInRect(
          actionsLocalX,
          actionsLocalY,
          newRunNode.position.x,
          newRunNode.position.y,
          transform.width + 36,
          transform.height + 96
        )
      ) {
        return "new-run";
      }
    }

    const refreshNode = actionsNode.getChildByName("HudRefresh");
    if (refreshNode) {
      const transform = refreshNode.getComponent(UITransform) ?? refreshNode.addComponent(UITransform);
      if (
        this.pointInRect(
          actionsLocalX,
          actionsLocalY,
          refreshNode.position.x,
          refreshNode.position.y,
          transform.width + 36,
          transform.height + 96
        )
      ) {
        return "refresh";
      }
    }

    const buttonBandTop = hudTransform.height / 2 - 86;
    const buttonBandBottom = hudTransform.height / 2 - 206;
    if (hudLocalY <= buttonBandTop && hudLocalY >= buttonBandBottom) {
      return hudLocalY >= actionsNode.position.y ? "new-run" : "refresh";
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
      if (!tile.resource) {
        this.pushLog("英雄已经站在这里了。");
        this.mapBoard?.pulseTile(tile.position, 1.04, 0.14);
        this.mapBoard?.showTileFeedback(tile.position, "原地", 0.45);
        this.renderView();
        return;
      }

      this.moveInFlight = true;
      const resourceLabel =
        tile.resource.kind === "gold" ? "金币" : tile.resource.kind === "wood" ? "木材" : tile.resource.kind === "ore" ? "矿石" : tile.resource.kind;
      this.pushLog(`正在采集 ${resourceLabel} +${tile.resource.amount}`);
      this.mapBoard?.pulseTile(tile.position, 1.12, 0.22);
      this.mapBoard?.pulseObject(tile.position, 1.2, 0.24);
      this.applyPrediction(
        {
          type: "hero.collect",
          heroId: hero.id,
          position: tile.position
        },
        `预演采集 ${resourceLabel} +${tile.resource.amount}`
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

  private isActiveSessionEpoch(epoch: number): boolean {
    return epoch === this.sessionEpoch;
  }

  private createSessionOptions(epoch: number): VeilCocosSessionOptions {
    return {
      remoteUrl: this.remoteUrl,
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
    const actionLabel =
      action.type === "battle.attack" ? "攻击" : action.type === "battle.wait" ? "等待" : "防御";
    this.pushLog(`战斗指令：${actionLabel}`);
    this.renderView();

    try {
      if (action.type === "battle.attack") {
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
    this.syncSelectedBattleTarget();
    this.playMapFeedbackForUpdate(update);

    if (!previousBattleId && nextBattleId) {
      this.mapBoard?.playHeroAnimation("attack");
      await this.battleTransition?.playEnter();
    } else if (previousBattleId && !nextBattleId) {
      const resolvedEvent = update.events.find((event) => this.isBattleResolvedEvent(event));
      this.mapBoard?.playHeroAnimation(
        resolvedEvent ? (this.didCurrentPlayerWinBattle(resolvedEvent) ? "victory" : "defeat") : "idle"
      );
      await this.battleTransition?.playExit(true);
    } else {
      this.mapBoard?.playHeroAnimation("idle");
    }

    this.renderView();
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

  private applyPrediction(
    action:
      | {
          type: "hero.move";
          heroId: string;
          destination: Vec2;
        }
      | {
          type: "hero.collect";
          heroId: string;
          position: Vec2;
        },
    status: string
  ): void {
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
