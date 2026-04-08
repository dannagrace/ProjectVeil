import { _decorator, Color, Component, EventMouse, EventTouch, Graphics, input, Input, Label, Node, Sprite, SpriteFrame, UIOpacity, UITransform, v3, view } from "cc";
import type { PlayerTileView, SessionUpdate, Vec2 } from "./VeilCocosSession.ts";
import { buildFogTileStyle, createTileLookup, FOG_TILE_STATES, fogEdgeMarkerForTile, resolveFogTileFrameKey } from "./cocos-map-visuals.ts";
import { resolveCocosTileMarkerVisual, type CocosTileMarkerVisual } from "./cocos-object-visuals.ts";
import { VeilFogOverlay } from "./VeilFogOverlay.ts";
import { VeilTilemapRenderer } from "./VeilTilemapRenderer.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";
import type { UnitAnimationState } from "./unit-animation-config.ts";
import { VeilUnitAnimator } from "./VeilUnitAnimator.ts";
import { getPixelSpriteAssets, loadPixelSpriteAssets } from "./cocos-pixel-sprites.ts";
import { resolveUnitAnimationProfile } from "./cocos-presentation-config.ts";
import {
  getPlaceholderSpriteAssets,
  loadPlaceholderSpriteAssets,
  releasePlaceholderSpriteAssets,
  retainPlaceholderSpriteAssets
} from "./cocos-placeholder-sprites.ts";

const { ccclass, property } = _decorator;

const TILE_NODE_PREFIX = "Tile";
const HERO_NODE_NAME = "ProjectVeilHero";
const FEEDBACK_NODE_PREFIX = "TileFeedback";
const OBJECT_NODE_PREFIX = "TileObject";
const FOG_OVERLAY_NODE_NAME = "FogOverlay";
const INPUT_OVERLAY_NODE_NAME = "MapInputOverlay";
const EMPTY_STATE_NODE_NAME = "MapEmptyState";
const DEFAULT_MAP_WIDTH_TILES = 8;
const DEFAULT_MAP_HEIGHT_TILES = 8;
const MAP_BG = new Color(18, 28, 42, 194);
const MAP_INNER_BG = new Color(62, 82, 108, 42);
const MAP_BORDER = new Color(220, 232, 245, 78);
const MAP_ACCENT = new Color(171, 206, 243, 104);
const TILE_FRAME = new Color(20, 28, 40, 224);
const TILE_FRAME_DARK = new Color(12, 18, 27, 236);
const REACHABLE_GLOW = new Color(255, 223, 146, 172);
const HERO_BADGE_BG = new Color(44, 61, 86, 255);
const HERO_BADGE_INNER = new Color(91, 126, 174, 255);
const HERO_BADGE_BORDER = new Color(255, 214, 132, 224);
const HERO_LABEL = new Color(249, 245, 233, 255);
const FEEDBACK_BG = new Color(255, 223, 146, 224);
const FEEDBACK_TEXT = new Color(48, 28, 12, 255);

interface VeilMapBoardOptions {
  tileSize: number;
  onTileSelected?: (tile: PlayerTileView) => void;
  onInputDebug?: (message: string) => void;
}

interface ObjectSpriteNodeView {
  node: Node;
  sprite: Sprite;
  spriteOpacity: UIOpacity;
}

interface ObjectMarkerNodeView extends ObjectSpriteNodeView {
  label: Label;
  graphics: Graphics;
  spriteNode: Node;
  factionBadge: ObjectSpriteNodeView;
  rarityBadge: ObjectSpriteNodeView;
  interactionBadge: ObjectSpriteNodeView;
}

interface TileNodeView {
  node: Node;
  label: Label;
  fogOverlay: VeilFogOverlay;
  graphics: Graphics;
  spriteNode: Node;
  sprite: Sprite;
  spriteOpacity: UIOpacity;
}

interface FeedbackNodeView {
  node: Node;
  label: Label;
  graphics: Graphics;
}

@ccclass("ProjectVeilMapBoard")
export class VeilMapBoard extends Component {
  @property
  tileSize = 84;

  private fogPulsePhase = 0;
  private heroNode: Node | null = null;
  private inputOverlayNode: Node | null = null;
  private emptyStateNode: Node | null = null;
  private emptyStateLabel: Label | null = null;
  private heroIconNode: Node | null = null;
  private heroIconSprite: Sprite | null = null;
  private heroIconOpacity: UIOpacity | null = null;
  private heroLabel: Label | null = null;
  private heroAnimator: VeilUnitAnimator | null = null;
  private tilemapRenderer: VeilTilemapRenderer | null = null;
  private currentUpdate: SessionUpdate | null = null;
  private onTileSelected: ((tile: PlayerTileView) => void) | undefined;
  private readonly tileNodes = new Map<string, TileNodeView>();
  private readonly objectNodes = new Map<string, ObjectMarkerNodeView>();
  private readonly feedbackNodes = new Map<string, FeedbackNodeView>();
  private readonly activeFeedback = new Map<string, { text: string; expiresAt: number }>();
  private readonly tilePulseTokens = new Map<string, number>();
  private readonly objectPulseTokens = new Map<string, number>();
  private boardTouchBound = false;
  private globalPointerBound = false;
  private onInputDebug: ((message: string) => void) | undefined;
  private lastSelectedKey = "";
  private lastSelectedAt = 0;
  private placeholderAssetsRetained = false;

  configure(options: VeilMapBoardOptions): void {
    assignUiLayer(this.node);
    this.tileSize = options.tileSize;
    this.onTileSelected = options.onTileSelected;
    this.onInputDebug = options.onInputDebug;
    this.ensureBoardTouchBinding();
    this.ensureGlobalPointerBinding();
    this.ensureHeroNode();
    this.tilemapRenderer = this.node.getComponent(VeilTilemapRenderer) ?? this.node.addComponent(VeilTilemapRenderer);
    void loadPixelSpriteAssets("boot").then(() => {
      if (this.currentUpdate) {
        this.render(this.currentUpdate);
      }
    });
  }

  render(update: SessionUpdate | null): void {
    this.currentUpdate = update;
    if (!update?.world) {
      this.releasePlaceholderAssets();
      this.node.active = true;
      this.ensureHeroNode();
      this.tilemapRenderer = this.node.getComponent(VeilTilemapRenderer) ?? this.node.addComponent(VeilTilemapRenderer);
      const width = DEFAULT_MAP_WIDTH_TILES * this.tileSize;
      const height = DEFAULT_MAP_HEIGHT_TILES * this.tileSize;
      const mapTransform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
      mapTransform.setContentSize(width, height);
      this.syncChrome(width, height);
      this.hideMapContent();
      this.renderEmptyState(width, height, "等待房间状态...\n若长时间无响应，请检查本地开发服务。");
      this.hideFeedbackNodes();
      return;
    }

    this.node.active = true;
    this.retainPlaceholderAssets();
    this.ensureHeroNode();
    this.tilemapRenderer = this.node.getComponent(VeilTilemapRenderer) ?? this.node.addComponent(VeilTilemapRenderer);

    const world = update.world;
    const width = world.map.width * this.tileSize;
    const height = world.map.height * this.tileSize;
    const mapTransform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    mapTransform.setContentSize(width, height);
    this.syncChrome(width, height);
    this.hideEmptyState();
    this.ensureInputOverlay(width, height);

    const usesTilemapRenderer =
      this.tilemapRenderer?.syncTiles(world.map.tiles, {
        activeHeroPosition: this.activeHero()?.position ?? null,
        fogPulsePhase: this.fogPulsePhase,
        reachableKeys: new Set((update.reachableTiles ?? []).map((node) => this.tileKey(node)))
      }) ?? false;
    const tileLookup = createTileLookup(world.map.tiles);
    const fogOverlayFrameLookup = this.buildFogOverlayFrameLookup();

    const usedKeys = new Set<string>();
    world.map.tiles.forEach((tile) => {
      const key = this.tileKey(tile.position);
      usedKeys.add(key);
      const tileView = this.ensureTileNode(tile);
      const tileTransform = tileView.node.getComponent(UITransform) ?? tileView.node.addComponent(UITransform);
      tileTransform.setContentSize(this.tileSize - 6, this.tileSize - 6);
      tileView.node.active = true;
      tileView.node.setPosition(
        tile.position.x * this.tileSize - width / 2 + this.tileSize / 2,
        height / 2 - tile.position.y * this.tileSize - this.tileSize / 2,
        0
      );
      tileView.label.fontSize = Math.max(8, Math.floor(this.tileSize * 0.16));
      tileView.label.lineHeight = Math.max(10, Math.floor(this.tileSize * 0.18));
      const isReachable = Boolean(this.currentUpdate?.reachableTiles.some((node) => node.x === tile.position.x && node.y === tile.position.y));
      const isHeroTile = Boolean(this.activeHero() && this.activeHero()!.position.x === tile.position.x && this.activeHero()!.position.y === tile.position.y);
      this.syncTileSprite(tileView, tile, usesTilemapRenderer);
      this.paintTileChrome(tileView.graphics, tile, isReachable, isHeroTile);
      tileView.label.string = usesTilemapRenderer ? "" : this.tileText(tile, tileLookup, isReachable, isHeroTile);
      tileView.fogOverlay.configure(this.tileSize, fogOverlayFrameLookup);
      tileView.fogOverlay.render(buildFogTileStyle(tile, tileLookup), true);
      this.renderObjectMarker(tile, width, height, usesTilemapRenderer);
    });

    for (const [key, tileNode] of this.tileNodes) {
      if (!usedKeys.has(key)) {
        tileNode.node.active = false;
      }
    }

    for (const [key, objectNode] of this.objectNodes) {
      if (!usedKeys.has(key)) {
        objectNode.node.active = false;
      }
    }

    if (!usesTilemapRenderer) {
      this.tilemapRenderer?.clear();
    }

    this.renderHeroMarker(width, height);
    this.renderFeedbackNodes(width, height);
    this.bringInputOverlayToFront();
  }

  playHeroAnimation(state: UnitAnimationState): void {
    this.ensureHeroNode();
    this.heroAnimator?.play(state);
  }

  showTileFeedback(position: Vec2, text: string, durationSeconds = 0.85): void {
    const key = this.tileKey(position);
    const expiresAt = Date.now() + durationSeconds * 1000;
    this.activeFeedback.set(key, { text, expiresAt });

    const feedbackNode = this.ensureFeedbackNode(key);
    feedbackNode.node.active = true;
    feedbackNode.label.string = text;
    this.scheduleOnce(() => {
      const current = this.activeFeedback.get(key);
      if (current && current.expiresAt === expiresAt) {
        this.activeFeedback.delete(key);
        const node = this.feedbackNodes.get(key);
        if (node) {
          node.node.active = false;
        }
      }
    }, durationSeconds);
  }

  pulseTile(position: Vec2, scale = 1.08, durationSeconds = 0.18): void {
    const key = this.tileKey(position);
    const tileNode = this.tileNodes.get(key);
    if (!tileNode) {
      return;
    }

    const token = (this.tilePulseTokens.get(key) ?? 0) + 1;
    this.tilePulseTokens.set(key, token);
    tileNode.node.setScale(scale, scale, 1);

    this.scheduleOnce(() => {
      if (this.tilePulseTokens.get(key) !== token) {
        return;
      }

      tileNode.node.setScale(1, 1, 1);
    }, durationSeconds);
  }

  pulseObject(position: Vec2, scale = 1.16, durationSeconds = 0.2): void {
    const key = this.tileKey(position);
    const objectNode = this.objectNodes.get(key);
    if (!objectNode) {
      return;
    }

    const token = (this.objectPulseTokens.get(key) ?? 0) + 1;
    this.objectPulseTokens.set(key, token);
    objectNode.node.setScale(scale, scale, 1);

    this.scheduleOnce(() => {
      if (this.objectPulseTokens.get(key) !== token) {
        return;
      }

      objectNode.node.setScale(1, 1, 1);
    }, durationSeconds);
  }

  setFogPulsePhase(phase: number): void {
    this.fogPulsePhase = phase;
  }

  private activeHero() {
    return this.currentUpdate?.world.ownHeroes[0] ?? null;
  }

  private ensureHeroNode(): void {
    if (!this.heroNode) {
      let heroNode = this.node.getChildByName(HERO_NODE_NAME);
      if (!heroNode) {
        heroNode = new Node(HERO_NODE_NAME);
        heroNode.parent = this.node;
      }
      assignUiLayer(heroNode);

      const heroTransform = heroNode.getComponent(UITransform) ?? heroNode.addComponent(UITransform);
      heroTransform.setContentSize(this.tileSize - 12, this.tileSize - 12);

      let heroIconNode = heroNode.getChildByName("HeroIcon");
      if (!heroIconNode) {
        heroIconNode = new Node("HeroIcon");
        heroIconNode.parent = heroNode;
      }
      assignUiLayer(heroIconNode);
      const heroIconTransform = heroIconNode.getComponent(UITransform) ?? heroIconNode.addComponent(UITransform);
      heroIconTransform.setContentSize(Math.max(34, Math.floor(this.tileSize * 0.68)), Math.max(34, Math.floor(this.tileSize * 0.68)));
      heroIconNode.setPosition(0, Math.floor(this.tileSize * 0.05), 0.2);
      const heroIconSprite = heroIconNode.getComponent(Sprite) ?? heroIconNode.addComponent(Sprite);
      const heroIconOpacity = heroIconNode.getComponent(UIOpacity) ?? heroIconNode.addComponent(UIOpacity);

      let heroLabelNode = heroNode.getChildByName("HeroLabel");
      if (!heroLabelNode) {
        heroLabelNode = new Node("HeroLabel");
        heroLabelNode.parent = heroNode;
      }
      assignUiLayer(heroLabelNode);
      const heroLabelTransform = heroLabelNode.getComponent(UITransform) ?? heroLabelNode.addComponent(UITransform);
      heroLabelTransform.setContentSize(Math.max(24, Math.floor(this.tileSize * 0.34)), Math.max(16, Math.floor(this.tileSize * 0.18)));
      heroLabelNode.setPosition(0, -Math.floor(this.tileSize * 0.29), 0.3);
      const heroLabel = heroLabelNode.getComponent(Label) ?? heroLabelNode.addComponent(Label);
      heroLabel.fontSize = 10;
      heroLabel.lineHeight = 12;
      heroLabel.color = HERO_LABEL;
      heroLabel.string = "LV 1";
      const heroAnimator = heroNode.getComponent(VeilUnitAnimator) ?? heroNode.addComponent(VeilUnitAnimator);
      heroAnimator.applyProfile(resolveUnitAnimationProfile("hero_guard_basic"), "hero_guard_basic");

      this.heroNode = heroNode;
      this.heroIconNode = heroIconNode;
      this.heroIconSprite = heroIconSprite;
      this.heroIconOpacity = heroIconOpacity;
      this.heroLabel = heroLabel;
      this.heroAnimator = heroAnimator;
      return;
    }

    const heroTransform = this.heroNode.getComponent(UITransform) ?? this.heroNode.addComponent(UITransform);
    heroTransform.setContentSize(this.tileSize - 12, this.tileSize - 12);
    this.heroIconNode = this.heroNode.getChildByName("HeroIcon");
    if (this.heroIconNode) {
      const heroIconTransform = this.heroIconNode.getComponent(UITransform) ?? this.heroIconNode.addComponent(UITransform);
      heroIconTransform.setContentSize(Math.max(34, Math.floor(this.tileSize * 0.68)), Math.max(34, Math.floor(this.tileSize * 0.68)));
      this.heroIconNode.setPosition(0, Math.floor(this.tileSize * 0.05), 0.2);
      this.heroIconSprite = this.heroIconNode.getComponent(Sprite) ?? this.heroIconNode.addComponent(Sprite);
      this.heroIconOpacity = this.heroIconNode.getComponent(UIOpacity) ?? this.heroIconNode.addComponent(UIOpacity);
    }
    if (this.heroLabel) {
      const labelNode = this.heroLabel.node;
      const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
      labelTransform.setContentSize(Math.max(24, Math.floor(this.tileSize * 0.34)), Math.max(16, Math.floor(this.tileSize * 0.18)));
      labelNode.setPosition(0, -Math.floor(this.tileSize * 0.29), 0.3);
      this.heroLabel.fontSize = Math.max(10, Math.floor(this.tileSize * 0.13));
      this.heroLabel.lineHeight = Math.max(12, Math.floor(this.tileSize * 0.15));
      this.heroLabel.color = HERO_LABEL;
    }
  }

  private ensureTileNode(tile: PlayerTileView): TileNodeView {
    const key = this.tileKey(tile.position);
    const existing = this.tileNodes.get(key);
    if (existing) {
      return existing;
    }

    const tileNode = new Node(`${TILE_NODE_PREFIX}-${key}`);
    tileNode.parent = this.node;
    assignUiLayer(tileNode);
    const transform = tileNode.getComponent(UITransform) ?? tileNode.addComponent(UITransform);
    transform.setContentSize(this.tileSize - 8, this.tileSize - 8);

    let spriteNode = tileNode.getChildByName("TileSprite");
    if (!spriteNode) {
      spriteNode = new Node("TileSprite");
      spriteNode.parent = tileNode;
    }
    assignUiLayer(spriteNode);
    const spriteTransform = spriteNode.getComponent(UITransform) ?? spriteNode.addComponent(UITransform);
    spriteTransform.setContentSize(this.tileSize - 10, this.tileSize - 10);
    spriteNode.setPosition(0, 0, -0.1);
    const sprite = spriteNode.getComponent(Sprite) ?? spriteNode.addComponent(Sprite);
    const spriteOpacity = spriteNode.getComponent(UIOpacity) ?? spriteNode.addComponent(UIOpacity);

    let labelNode = tileNode.getChildByName("TileLabel");
    if (!labelNode) {
      labelNode = new Node("TileLabel");
      labelNode.parent = tileNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(this.tileSize - 16, this.tileSize - 16);
    labelNode.setPosition(0, 0, 0.2);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.fontSize = 14;
    label.lineHeight = 16;
    label.string = "";
    label.color = new Color(255, 249, 233, 208);
    const graphics = tileNode.getComponent(Graphics) ?? tileNode.addComponent(Graphics);

    let fogOverlayNode = tileNode.getChildByName(FOG_OVERLAY_NODE_NAME);
    if (!fogOverlayNode) {
      fogOverlayNode = new Node(FOG_OVERLAY_NODE_NAME);
      fogOverlayNode.parent = tileNode;
    }
    assignUiLayer(fogOverlayNode);
    const fogOverlay = fogOverlayNode.getComponent(VeilFogOverlay) ?? fogOverlayNode.addComponent(VeilFogOverlay);
    fogOverlay.configure(this.tileSize, new Map<string, SpriteFrame | null>());

    const created = { node: tileNode, label, fogOverlay, graphics, spriteNode, sprite, spriteOpacity };
    this.tileNodes.set(key, created);
    this.bindTileSelection(tileNode, tile.position);
    this.bindTileSelection(spriteNode, tile.position);
    tileNode.setScale(1, 1, 1);
    return created;
  }

  private tileText(
    tile: PlayerTileView,
    tileLookup: Map<string, PlayerTileView>,
    isReachable: boolean,
    isHeroTile: boolean
  ): string {
    const fogMarker = fogEdgeMarkerForTile(tile, tileLookup, this.fogPulsePhase);

    if (tile.fog === "hidden") {
      return "";
    }

    if (isHeroTile) {
      return "";
    }

    if (isReachable) {
      return "";
    }

    if (tile.fog === "explored" && (fogMarker === ":" || fogMarker === ";")) {
      return "";
    }

    return "";
  }

  private tileKey(position: Vec2): string {
    return `${position.x}-${position.y}`;
  }

  private findTile(position: Vec2): PlayerTileView | null {
    return this.currentUpdate?.world.map.tiles.find((tile) => tile.position.x === position.x && tile.position.y === position.y) ?? null;
  }

  private ensureBoardTouchBinding(): void {
    if (this.boardTouchBound) {
      return;
    }

    const handler = (...args: unknown[]) => {
      this.handleBoardTouch(args[0] as EventTouch | EventMouse | undefined);
    };

    this.node.on(Node.EventType.TOUCH_START, handler, this);
    this.node.on(Node.EventType.MOUSE_DOWN, handler, this);
    this.node.on(Node.EventType.TOUCH_END, handler, this);
    this.node.on(Node.EventType.MOUSE_UP, handler, this);
    this.boardTouchBound = true;
  }

  private ensureInputOverlay(width: number, height: number): void {
    if (!this.inputOverlayNode) {
      let overlay = this.node.getChildByName(INPUT_OVERLAY_NODE_NAME);
      if (!overlay) {
        overlay = new Node(INPUT_OVERLAY_NODE_NAME);
        overlay.parent = this.node;
      }
      assignUiLayer(overlay);
      overlay.on(
        Node.EventType.TOUCH_START,
        (...args: unknown[]) => {
          this.handleBoardTouch(args[0] as EventTouch | EventMouse | undefined);
        },
        this
      );
      overlay.on(
        Node.EventType.MOUSE_DOWN,
        (...args: unknown[]) => {
          this.handleBoardTouch(args[0] as EventTouch | EventMouse | undefined);
        },
        this
      );
      overlay.on(
        Node.EventType.TOUCH_END,
        (...args: unknown[]) => {
          this.handleBoardTouch(args[0] as EventTouch | EventMouse | undefined);
        },
        this
      );
      overlay.on(
        Node.EventType.MOUSE_UP,
        (...args: unknown[]) => {
          this.handleBoardTouch(args[0] as EventTouch | EventMouse | undefined);
        },
        this
      );
      this.inputOverlayNode = overlay;
    }

    const overlayTransform = this.inputOverlayNode.getComponent(UITransform) ?? this.inputOverlayNode.addComponent(UITransform);
    overlayTransform.setContentSize(width, height);
    this.inputOverlayNode.setPosition(0, 0, 9);
    this.inputOverlayNode.active = true;
  }

  private ensureEmptyStateNode(): void {
    if (!this.emptyStateNode) {
      let emptyNode = this.node.getChildByName(EMPTY_STATE_NODE_NAME);
      if (!emptyNode) {
        emptyNode = new Node(EMPTY_STATE_NODE_NAME);
        emptyNode.parent = this.node;
      }
      assignUiLayer(emptyNode);
      const transform = emptyNode.getComponent(UITransform) ?? emptyNode.addComponent(UITransform);
      transform.setContentSize(this.tileSize * 6, this.tileSize * 2);
      const label = emptyNode.getComponent(Label) ?? emptyNode.addComponent(Label);
      label.fontSize = Math.max(14, Math.floor(this.tileSize * 0.22));
      label.lineHeight = Math.max(20, Math.floor(this.tileSize * 0.3));
      label.color = new Color(232, 239, 247, 212);
      label.string = "";
      this.emptyStateNode = emptyNode;
      this.emptyStateLabel = label;
    }
  }

  private renderEmptyState(width: number, height: number, message: string): void {
    this.ensureEmptyStateNode();
    if (!this.emptyStateNode || !this.emptyStateLabel) {
      return;
    }

    const transform = this.emptyStateNode.getComponent(UITransform) ?? this.emptyStateNode.addComponent(UITransform);
    transform.setContentSize(Math.max(this.tileSize * 5.6, width - 72), Math.max(this.tileSize * 1.9, 128));
    this.emptyStateNode.setPosition(0, 0, 8);
    this.emptyStateNode.active = true;
    this.emptyStateLabel.fontSize = Math.max(16, Math.floor(this.tileSize * 0.22));
    this.emptyStateLabel.lineHeight = Math.max(24, Math.floor(this.tileSize * 0.32));
    this.emptyStateLabel.string = message;
  }

  private hideEmptyState(): void {
    if (this.emptyStateNode) {
      this.emptyStateNode.active = false;
    }
  }

  private hideMapContent(): void {
    for (const tileNode of this.tileNodes.values()) {
      tileNode.node.active = false;
    }

    for (const objectNode of this.objectNodes.values()) {
      objectNode.node.active = false;
    }

    this.tilemapRenderer?.clear();
    if (this.heroNode) {
      this.heroNode.active = false;
    }
    if (this.inputOverlayNode) {
      this.inputOverlayNode.active = false;
    }
  }

  private bringInputOverlayToFront(): void {
    if (!this.inputOverlayNode || this.inputOverlayNode.parent !== this.node) {
      return;
    }

    this.inputOverlayNode.parent = null;
    this.inputOverlayNode.parent = this.node;
    assignUiLayer(this.inputOverlayNode);
    this.inputOverlayNode.setPosition(0, 0, 20);
  }

  private ensureGlobalPointerBinding(): void {
    if (this.globalPointerBound) {
      return;
    }

    input.on(Input.EventType.TOUCH_START, this.handleGlobalPointerEvent, this);
    input.on(Input.EventType.MOUSE_DOWN, this.handleGlobalPointerEvent, this);
    input.on(Input.EventType.TOUCH_END, this.handleGlobalPointerEvent, this);
    input.on(Input.EventType.MOUSE_UP, this.handleGlobalPointerEvent, this);
    this.globalPointerBound = true;
  }

  onDestroy(): void {
    if (this.boardTouchBound) {
      this.node.off(Node.EventType.TOUCH_START);
      this.node.off(Node.EventType.MOUSE_DOWN);
      this.node.off(Node.EventType.TOUCH_END);
      this.node.off(Node.EventType.MOUSE_UP);
      this.boardTouchBound = false;
    }

    if (this.globalPointerBound) {
      input.off(Input.EventType.TOUCH_START, this.handleGlobalPointerEvent, this);
      input.off(Input.EventType.MOUSE_DOWN, this.handleGlobalPointerEvent, this);
      input.off(Input.EventType.TOUCH_END, this.handleGlobalPointerEvent, this);
      input.off(Input.EventType.MOUSE_UP, this.handleGlobalPointerEvent, this);
      this.globalPointerBound = false;
    }

    if (this.placeholderAssetsRetained) {
      this.releasePlaceholderAssets();
    }
  }

  private retainPlaceholderAssets(): void {
    if (this.placeholderAssetsRetained) {
      return;
    }

    this.placeholderAssetsRetained = true;
    void retainPlaceholderSpriteAssets("map").then(() => {
      if (this.currentUpdate) {
        this.render(this.currentUpdate);
      }
    }).catch(() => {
      this.placeholderAssetsRetained = false;
    });
  }

  private releasePlaceholderAssets(): void {
    if (!this.placeholderAssetsRetained) {
      return;
    }

    releasePlaceholderSpriteAssets("map");
    this.placeholderAssetsRetained = false;
  }

  private buildFogOverlayFrameLookup(): Map<string, SpriteFrame | null> {
    const lookup = new Map<string, SpriteFrame | null>();
    const assets = getPlaceholderSpriteAssets();
    if (!assets) {
      return lookup;
    }

    for (const fogState of FOG_TILE_STATES) {
      const frames = assets.fogMasks[fogState];
      for (let featherMask = 0; featherMask < frames.length; featherMask += 1) {
        lookup.set(resolveFogTileFrameKey(fogState, featherMask), frames[featherMask] ?? null);
      }
    }

    return lookup;
  }

  private handleBoardTouch(event: EventTouch | EventMouse | undefined): void {
    this.selectTileFromPointer(event);
  }

  private handleGlobalPointerEvent(...args: unknown[]): void {
    this.selectTileFromPointer(args[0] as EventTouch | EventMouse | undefined);
  }

  private selectTileFromPointer(event: EventTouch | EventMouse | undefined): void {
    if (!this.currentUpdate?.world || !this.onTileSelected || !event) {
      return;
    }

    const uiPoint = event.getUILocation();
    const visibleSize = view.getVisibleSize();
    const boardPosition = this.node.position ?? v3();
    const centeredX = uiPoint.x - visibleSize.width / 2;
    const centeredY = uiPoint.y - visibleSize.height / 2;
    const localX = centeredX - boardPosition.x;
    const localY = centeredY - boardPosition.y;
    const mapWidth = this.currentUpdate.world.map.width * this.tileSize;
    const mapHeight = this.currentUpdate.world.map.height * this.tileSize;

    if (
      localX < -mapWidth / 2 ||
      localX > mapWidth / 2 ||
      localY < -mapHeight / 2 ||
      localY > mapHeight / 2
    ) {
      return;
    }

    const tileX = Math.floor((localX + mapWidth / 2) / this.tileSize);
    const tileY = Math.floor((mapHeight / 2 - localY) / this.tileSize);
    this.onInputDebug?.(
      `input ui(${Math.round(uiPoint.x)},${Math.round(uiPoint.y)}) center(${Math.round(centeredX)},${Math.round(centeredY)}) node(${Math.round(boardPosition.x)},${Math.round(boardPosition.y)}) local(${Math.round(localX)},${Math.round(localY)}) tile(${tileX},${tileY})`
    );

    if (
      tileX < 0 ||
      tileY < 0 ||
      tileX >= this.currentUpdate.world.map.width ||
      tileY >= this.currentUpdate.world.map.height
    ) {
      return;
    }

    const tile = this.findTile({ x: tileX, y: tileY });
    this.selectTile(tile);
  }

  private bindTileSelection(node: Node, position: Vec2): void {
    const handler = () => {
      this.selectTile(this.findTile(position));
    };

    node.on(Node.EventType.TOUCH_START, handler, this);
    node.on(Node.EventType.MOUSE_DOWN, handler, this);
    node.on(Node.EventType.TOUCH_END, handler, this);
    node.on(Node.EventType.MOUSE_UP, handler, this);
  }

  private selectTile(tile: PlayerTileView | null): void {
    if (!tile || !this.onTileSelected) {
      return;
    }

    const key = this.tileKey(tile.position);
    const now = Date.now();
    if (this.lastSelectedKey === key && now - this.lastSelectedAt < 120) {
      return;
    }
    this.lastSelectedKey = key;
    this.lastSelectedAt = now;

    this.pulseTile(tile.position, 1.05, 0.16);
    this.showTileFeedback(tile.position, "TAP", 0.45);
    this.onInputDebug?.(`selected tile (${tile.position.x},${tile.position.y})`);
    this.onTileSelected(tile);
  }

  private renderHeroMarker(width: number, height: number): void {
    if (!this.heroNode || !this.heroLabel) {
      return;
    }

    const hero = this.activeHero();
    if (!hero) {
      this.heroNode.active = false;
      return;
    }

    this.heroNode.active = true;
    this.heroAnimator?.applyProfile(resolveUnitAnimationProfile(hero.armyTemplateId), hero.armyTemplateId);
    this.heroNode.setPosition(
      hero.position.x * this.tileSize - width / 2 + this.tileSize / 2,
      height / 2 - hero.position.y * this.tileSize - this.tileSize / 2,
      1
    );
    this.paintHeroBadge();
    const usesPixelFallback = this.heroAnimator?.hasPixelFallback(hero.armyTemplateId) ?? false;
    const heroIcon = usesPixelFallback ? null : getPixelSpriteAssets()?.icons.hero ?? null;
    if (this.heroIconNode && this.heroIconSprite && this.heroIconOpacity) {
      this.heroIconNode.active = usesPixelFallback || Boolean(heroIcon);
      if (heroIcon) {
        this.heroIconSprite.spriteFrame = heroIcon;
      }
      this.heroIconOpacity.opacity = usesPixelFallback || heroIcon ? 255 : 0;
    }
    this.heroLabel.string = heroIcon ? `Lv ${hero.progression.level}` : `${hero.name}\nLV ${hero.progression.level}`;
  }

  private renderObjectMarker(tile: PlayerTileView, width: number, height: number, usesTilemapRenderer: boolean): void {
    const hero = this.activeHero();
    const isOwnHeroTile = Boolean(hero && hero.position.x === tile.position.x && hero.position.y === tile.position.y);
    const markerVisual = resolveCocosTileMarkerVisual(tile);
    const key = this.tileKey(tile.position);

    if (!markerVisual || tile.fog === "hidden" || isOwnHeroTile) {
      const node = this.objectNodes.get(key);
      if (node) {
        node.node.active = false;
      }
      return;
    }

    const objectNode = this.ensureObjectNode(key);
    objectNode.node.active = true;
    objectNode.label.fontSize = usesTilemapRenderer ? Math.max(8, Math.floor(this.tileSize * 0.12)) : Math.max(8, Math.floor(this.tileSize * 0.11));
    objectNode.label.lineHeight = usesTilemapRenderer ? Math.max(10, Math.floor(this.tileSize * 0.14)) : Math.max(10, Math.floor(this.tileSize * 0.13));
    const labelTransform = objectNode.label.node.getComponent(UITransform) ?? objectNode.label.node.addComponent(UITransform);
    const transform = objectNode.node.getComponent(UITransform) ?? objectNode.node.addComponent(UITransform);
    const chipSize = Math.max(36, Math.floor(this.tileSize * 0.58));
    transform.setContentSize(chipSize, chipSize);
    labelTransform.setContentSize(chipSize - 10, Math.max(16, Math.floor(chipSize * 0.34)));
    objectNode.label.node.setPosition(0, 0, 0.2);
    const spriteTransform = objectNode.spriteNode.getComponent(UITransform) ?? objectNode.spriteNode.addComponent(UITransform);
    spriteTransform.setContentSize(Math.max(20, Math.floor(chipSize * 0.54)), Math.max(20, Math.floor(chipSize * 0.54)));
    objectNode.spriteNode.setPosition(0, 1, 0.1);
    this.layoutObjectBadgeNodes(objectNode, chipSize);
    this.paintObjectChip(objectNode.graphics, markerVisual);
    const hasPixelAssets = Boolean(getPixelSpriteAssets());
    const hasSpriteFrame = this.syncObjectSprite(
      { node: objectNode.spriteNode, sprite: objectNode.sprite, spriteOpacity: objectNode.spriteOpacity },
      markerVisual
    );
    this.syncObjectBadges(objectNode, markerVisual);
    objectNode.label.string = hasSpriteFrame || (!hasPixelAssets && markerVisual.iconKey !== null) ? "" : markerVisual.fallbackLabel;
    objectNode.node.setPosition(
      tile.position.x * this.tileSize - width / 2 + this.tileSize * 0.28,
      height / 2 - tile.position.y * this.tileSize - this.tileSize * 0.28,
      usesTilemapRenderer ? 1 : 0.5
    );
  }

  private syncTileSprite(
    tileView: { spriteNode: Node; sprite: Sprite; spriteOpacity: UIOpacity },
    tile: PlayerTileView,
    usesTilemapRenderer: boolean
  ): void {
    if (usesTilemapRenderer) {
      tileView.spriteNode.active = false;
      return;
    }

    const assets = getPixelSpriteAssets();
    const frame = this.resolveTileSpriteFrame(tile, assets);
    if (!frame) {
      tileView.spriteNode.active = false;
      return;
    }

    tileView.spriteNode.active = true;
    tileView.sprite.spriteFrame = frame;
    tileView.spriteOpacity.opacity = tile.fog === "hidden" ? 70 : tile.fog === "explored" ? 154 : 255;
  }

  private resolveTileSpriteFrame(
    tile: PlayerTileView,
    assets: ReturnType<typeof getPixelSpriteAssets>
  ) {
    if (!assets) {
      return null;
    }

    const variant = this.tileVariant(tile.position);

    if (tile.fog === "hidden") {
      return this.pickVariant(assets.tiles.hidden, variant);
    }

    switch (tile.terrain) {
      case "grass":
        return this.pickVariant(assets.tiles.grass, variant);
      case "dirt":
        return this.pickVariant(assets.tiles.dirt, variant);
      case "sand":
        return this.pickVariant(assets.tiles.sand, variant);
      case "water":
        return this.pickVariant(assets.tiles.water, variant);
      default:
        return this.pickVariant(assets.tiles.unknown, variant);
    }
  }

  private syncObjectSprite(objectNode: ObjectSpriteNodeView, markerVisual: CocosTileMarkerVisual): boolean {
    const assets = getPixelSpriteAssets();
    const frame = this.resolveObjectSpriteFrame(markerVisual, assets);
    if (!frame) {
      objectNode.node.active = false;
      return false;
    }

    objectNode.node.active = true;
    objectNode.sprite.spriteFrame = frame;
    objectNode.spriteOpacity.opacity = 255;
    return true;
  }

  private resolveObjectSpriteFrame(
    markerVisual: CocosTileMarkerVisual,
    assets: ReturnType<typeof getPixelSpriteAssets>
  ) {
    if (!assets) {
      return null;
    }

    switch (markerVisual.iconKey) {
      case "wood":
        return assets.icons.wood;
      case "gold":
        return assets.icons.gold;
      case "ore":
        return assets.icons.ore;
      case "neutral":
        return assets.icons.neutral;
      case "hero":
        return assets.icons.hero;
      case "recruitment":
        return assets.icons.recruitment;
      case "shrine":
        return assets.icons.shrine;
      case "mine":
        return assets.icons.mine;
      default:
        return null;
    }
  }

  private syncObjectBadges(objectNode: ObjectMarkerNodeView, markerVisual: CocosTileMarkerVisual): void {
    const assets = getPixelSpriteAssets();
    this.syncObjectBadge(
      objectNode.factionBadge,
      markerVisual.faction ? assets?.badges.factions[markerVisual.faction] ?? null : null
    );
    this.syncObjectBadge(objectNode.rarityBadge, assets?.badges.rarities[markerVisual.rarity] ?? null);
    this.syncObjectBadge(objectNode.interactionBadge, assets?.badges.interactions[markerVisual.interactionType] ?? null);
  }

  private syncObjectBadge(badgeNode: ObjectSpriteNodeView, frame: SpriteFrame | null): void {
    badgeNode.node.active = Boolean(frame);
    badgeNode.sprite.spriteFrame = frame;
    badgeNode.spriteOpacity.opacity = frame ? 255 : 0;
  }

  private pickVariant<T>(variants: Array<T | null>, variant: number): T | null {
    if (variants.length === 0) {
      return null;
    }

    return variants[variant % variants.length] ?? variants.find((entry) => entry !== null) ?? null;
  }

  private ensureFeedbackNode(key: string): FeedbackNodeView {
    const existing = this.feedbackNodes.get(key);
    if (existing) {
      return existing;
    }

    const node = new Node(`${FEEDBACK_NODE_PREFIX}-${key}`);
    node.parent = this.node;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(this.tileSize, 20);

    let labelNode = node.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = node;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(this.tileSize - 8, 18);
    labelNode.setPosition(0, 0, 0.2);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.fontSize = 14;
    label.lineHeight = 16;
    label.string = "";
    label.color = FEEDBACK_TEXT;
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);

    const created = { node, label, graphics };
    this.feedbackNodes.set(key, created);
    return created;
  }

  private ensureObjectNode(key: string): ObjectMarkerNodeView {
    const existing = this.objectNodes.get(key);
    if (existing) {
      return existing;
    }

    const node = new Node(`${OBJECT_NODE_PREFIX}-${key}`);
    node.parent = this.node;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(this.tileSize - 6, 26);

    let labelNode = node.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = node;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(this.tileSize - 12, 18);
    labelNode.setPosition(0, 0, 0.2);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.fontSize = 10;
    label.lineHeight = 12;
    label.string = "";
    label.color = new Color(255, 250, 240, 255);
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);

    const spriteNode = new Node(`Sprite-${key}`);
    spriteNode.parent = node;
    assignUiLayer(spriteNode);
    const spriteTransform = spriteNode.getComponent(UITransform) ?? spriteNode.addComponent(UITransform);
    spriteTransform.setContentSize(22, 22);
    spriteNode.setPosition(0, 0, 0.1);
    const sprite = spriteNode.getComponent(Sprite) ?? spriteNode.addComponent(Sprite);
    const spriteOpacity = spriteNode.getComponent(UIOpacity) ?? spriteNode.addComponent(UIOpacity);

    const factionBadge = this.createObjectBadgeNode(node, `FactionBadge-${key}`);
    const rarityBadge = this.createObjectBadgeNode(node, `RarityBadge-${key}`);
    const interactionBadge = this.createObjectBadgeNode(node, `InteractionBadge-${key}`);

    const created = {
      node,
      label,
      graphics,
      spriteNode,
      sprite,
      spriteOpacity,
      factionBadge,
      rarityBadge,
      interactionBadge
    };
    this.objectNodes.set(key, created);
    this.bindTileSelection(node, this.positionFromKey(key));
    this.bindTileSelection(spriteNode, this.positionFromKey(key));
    return created;
  }

  private createObjectBadgeNode(parent: Node, name: string): ObjectSpriteNodeView {
    const node = new Node(name);
    node.parent = parent;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(12, 12);
    const sprite = node.getComponent(Sprite) ?? node.addComponent(Sprite);
    const spriteOpacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    node.active = false;
    return { node, sprite, spriteOpacity };
  }

  private layoutObjectBadgeNodes(objectNode: ObjectMarkerNodeView, chipSize: number): void {
    const badgeSize = Math.max(10, Math.floor(chipSize * 0.3));
    this.setObjectBadgeLayout(objectNode.factionBadge, -chipSize * 0.24, chipSize * 0.22, badgeSize);
    this.setObjectBadgeLayout(objectNode.rarityBadge, chipSize * 0.24, chipSize * 0.22, badgeSize);
    this.setObjectBadgeLayout(objectNode.interactionBadge, 0, -chipSize * 0.24, badgeSize);
  }

  private setObjectBadgeLayout(badgeNode: ObjectSpriteNodeView, x: number, y: number, size: number): void {
    const transform = badgeNode.node.getComponent(UITransform) ?? badgeNode.node.addComponent(UITransform);
    transform.setContentSize(size, size);
    badgeNode.node.setPosition(x, y, 0.2);
  }

  private renderFeedbackNodes(width: number, height: number): void {
    const now = Date.now();
    const usedKeys = new Set<string>();

    for (const [key, feedback] of this.activeFeedback) {
      if (feedback.expiresAt <= now) {
        this.activeFeedback.delete(key);
        continue;
      }

      const position = this.positionFromKey(key);
      const node = this.ensureFeedbackNode(key);
      node.node.active = true;
      node.label.string = feedback.text;
      this.paintFeedbackChip(node.graphics);
      node.node.setPosition(
        position.x * this.tileSize - width / 2 + this.tileSize / 2,
        height / 2 - position.y * this.tileSize - this.tileSize * 0.18,
        2
      );
      usedKeys.add(key);
    }

    for (const [key, feedbackNode] of this.feedbackNodes) {
      if (!usedKeys.has(key)) {
        feedbackNode.node.active = false;
      }
    }
  }

  private hideFeedbackNodes(): void {
    for (const feedbackNode of this.feedbackNodes.values()) {
      feedbackNode.node.active = false;
    }
  }

  private positionFromKey(key: string): Vec2 {
    const parts = key.split("-");
    const x = Number(parts[0] ?? 0);
    const y = Number(parts[1] ?? 0);
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0
    };
  }

  private syncChrome(width: number, height: number): void {
    const graphics = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = MAP_BG;
    graphics.strokeColor = MAP_BORDER;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2 - 14, -height / 2 - 14, width + 28, height + 28, 18);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = MAP_INNER_BG;
    graphics.roundRect(-width / 2 - 4, height / 2 - 20, width + 8, 10, 8);
    graphics.fill();
    graphics.fillColor = MAP_ACCENT;
    graphics.roundRect(-width / 2 + 22, height / 2 - 19, Math.max(96, width * 0.24), 8, 6);
    graphics.fill();
    graphics.fillColor = new Color(255, 255, 255, 12);
    graphics.roundRect(-width / 2 + 12, height / 2 - 52, width - 24, 16, 8);
    graphics.fill();
    graphics.fillColor = new Color(9, 13, 20, 26);
    graphics.roundRect(-width / 2 + 8, -height / 2 + 10, width - 16, height - 26, 14);
    graphics.fill();
  }

  private paintTileChrome(graphics: Graphics, tile: PlayerTileView, isReachable: boolean, isHeroTile: boolean): void {
    const width = this.tileSize - 6;
    const height = this.tileSize - 6;
    const radius = Math.max(8, Math.floor(this.tileSize * 0.16));
    const palette = this.resolveTilePalette(tile, isReachable, isHeroTile);
    const usesPlaceholderSprite = Boolean(getPixelSpriteAssets());

    graphics.clear();

    if (tile.fog === "hidden") {
      graphics.fillColor = new Color(palette.base.r, palette.base.g, palette.base.b, usesPlaceholderSprite ? 10 : 28);
      graphics.roundRect(-width / 2 + 12, -height / 2 + 12, width - 24, height - 24, Math.max(12, radius + 2));
      graphics.fill();
      this.paintTerrainMotif(graphics, tile, palette, width, height);
      return;
    }

    const shadowAlpha = tile.fog === "explored" ? 112 : 156;
    graphics.fillColor = new Color(8, 12, 18, shadowAlpha);
    graphics.roundRect(-width / 2 + 2, -height / 2 - 1, width - 2, height, radius + 2);
    graphics.fill();

    graphics.fillColor = this.tone(TILE_FRAME_DARK, tile.fog === "explored" ? 6 : 16, tile.fog === "explored" ? 202 : 232);
    graphics.roundRect(-width / 2, -height / 2, width, height, radius + 1);
    graphics.fill();

    graphics.fillColor = this.tone(TILE_FRAME, tile.fog === "explored" ? -6 : 8, tile.fog === "explored" ? 214 : 244);
    graphics.roundRect(-width / 2 + 2, -height / 2 + 2, width - 4, height - 4, radius);
    graphics.fill();

    if (!usesPlaceholderSprite) {
      graphics.fillColor = palette.base;
      graphics.roundRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10, Math.max(7, radius - 2));
      graphics.fill();
    }
    graphics.fillColor = new Color(255, 255, 255, usesPlaceholderSprite ? (tile.fog === "explored" ? 10 : 20) : tile.fog === "explored" ? 20 : 34);
    graphics.roundRect(-width / 2 + 10, height / 2 - Math.max(18, Math.floor(this.tileSize * 0.22)), width - 20, Math.max(7, Math.floor(this.tileSize * 0.08)), 6);
    graphics.fill();

    if (!usesPlaceholderSprite) {
      this.paintTerrainMotif(graphics, tile, palette, width, height);
    }

    graphics.strokeColor = new Color(palette.accent.r, palette.accent.g, palette.accent.b, tile.fog === "explored" ? 38 : 92);
    graphics.lineWidth = 1.25;
    graphics.roundRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10, Math.max(7, radius - 2));
    graphics.stroke();

    if (isReachable) {
      graphics.strokeColor = REACHABLE_GLOW;
      graphics.lineWidth = 2;
      graphics.roundRect(-width / 2 + 4, -height / 2 + 4, width - 8, height - 8, Math.max(7, radius - 2));
      graphics.stroke();
    }

    if (isHeroTile) {
      graphics.strokeColor = HERO_BADGE_BORDER;
      graphics.lineWidth = 2;
      graphics.roundRect(-width / 2 + 2, -height / 2 + 2, width - 4, height - 4, Math.max(7, radius - 1));
      graphics.stroke();
    }
  }

  private paintHeroBadge(): void {
    if (!this.heroNode) {
      return;
    }

    const width = this.tileSize - 12;
    const height = this.tileSize - 12;
    const graphics = this.heroNode.getComponent(Graphics) ?? this.heroNode.addComponent(Graphics);
    const radius = Math.max(10, Math.floor(this.tileSize * 0.22));
    graphics.clear();
    graphics.fillColor = new Color(8, 12, 18, 132);
    graphics.roundRect(-width / 2 + 2, -height / 2 - 2, width - 2, height, radius + 2);
    graphics.fill();
    graphics.fillColor = new Color(HERO_BADGE_BORDER.r, HERO_BADGE_BORDER.g, HERO_BADGE_BORDER.b, 236);
    graphics.roundRect(-width / 2, -height / 2, width, height, radius + 2);
    graphics.fill();
    graphics.fillColor = new Color(255, 246, 208, 88);
    graphics.roundRect(-width / 2 + 5, height / 2 - Math.max(18, Math.floor(this.tileSize * 0.24)), width - 10, Math.max(8, Math.floor(this.tileSize * 0.08)), 6);
    graphics.fill();
    graphics.fillColor = HERO_BADGE_BG;
    graphics.roundRect(-width / 2 + 3, -height / 2 + 3, width - 6, height - 6, Math.max(8, radius));
    graphics.fill();
    graphics.fillColor = new Color(HERO_BADGE_INNER.r, HERO_BADGE_INNER.g, HERO_BADGE_INNER.b, 142);
    graphics.roundRect(-width / 2 + 7, -height / 2 + 7, width - 14, height - 20, Math.max(8, radius - 1));
    graphics.fill();
    graphics.fillColor = new Color(255, 223, 146, 118);
    graphics.circle(0, Math.floor(this.tileSize * 0.05), Math.max(20, Math.floor(this.tileSize * 0.27)));
    graphics.fill();
    graphics.fillColor = new Color(255, 245, 214, 54);
    graphics.circle(0, Math.floor(this.tileSize * 0.05), Math.max(24, Math.floor(this.tileSize * 0.32)));
    graphics.fill();
  }

  private paintObjectChip(graphics: Graphics, markerVisual: CocosTileMarkerVisual): void {
    const theme = this.resolveMarkerPalette(markerVisual);
    const transform = graphics.node.getComponent(UITransform) ?? graphics.node.addComponent(UITransform);
    const width = transform.width || 30;
    const height = transform.height || 18;

    graphics.clear();
    graphics.fillColor = theme.shadow;
    graphics.roundRect(-width / 2, -height / 2, width, height, Math.max(8, Math.floor(height / 2)));
    graphics.fill();
    graphics.fillColor = theme.base;
    graphics.roundRect(-width / 2 + 1, -height / 2 + 1, width - 2, height - 2, Math.max(7, Math.floor(height / 2) - 1));
    graphics.fill();
    graphics.fillColor = theme.gloss;
    graphics.roundRect(-width / 2 + 4, height / 2 - Math.max(7, Math.floor(height * 0.45)), width - 8, Math.max(4, Math.floor(height * 0.22)), 4);
    graphics.fill();
    graphics.strokeColor = new Color(255, 247, 232, 84);
    graphics.lineWidth = 1.2;
    graphics.roundRect(-width / 2 + 1, -height / 2 + 1, width - 2, height - 2, Math.max(7, Math.floor(height / 2) - 1));
    graphics.stroke();
    if (!getPixelSpriteAssets() && markerVisual.iconKey) {
      this.paintObjectIcon(graphics, markerVisual.iconKey, width, height);
    }
  }

  private paintFeedbackChip(graphics: Graphics): void {
    const transform = graphics.node.getComponent(UITransform) ?? graphics.node.addComponent(UITransform);
    const width = transform.width || this.tileSize;
    const height = transform.height || 20;

    graphics.clear();
    graphics.fillColor = new Color(52, 30, 14, 112);
    graphics.roundRect(-width / 2, -height / 2, width, height, Math.max(10, Math.floor(height / 2)));
    graphics.fill();
    graphics.fillColor = FEEDBACK_BG;
    graphics.roundRect(-width / 2 + 1, -height / 2 + 1, width - 2, height - 2, Math.max(9, Math.floor(height / 2) - 1));
    graphics.fill();
  }

  private resolveTilePalette(
    tile: PlayerTileView,
    isReachable: boolean,
    isHeroTile: boolean
  ): { base: Color; inset: Color; accent: Color; detail: Color } {
    const visibleBase =
      tile.terrain === "grass"
        ? new Color(124, 171, 109, 255)
        : tile.terrain === "dirt"
          ? new Color(171, 122, 85, 255)
          : tile.terrain === "sand"
            ? new Color(191, 165, 108, 255)
            : tile.terrain === "water"
              ? new Color(88, 131, 176, 255)
              : new Color(112, 124, 140, 255);

    const visibleInset =
      tile.terrain === "grass"
        ? new Color(188, 225, 153, 255)
        : tile.terrain === "dirt"
          ? new Color(224, 166, 119, 255)
          : tile.terrain === "sand"
            ? new Color(236, 208, 146, 255)
            : tile.terrain === "water"
              ? new Color(138, 185, 228, 255)
              : new Color(162, 180, 198, 255);
    const visibleAccent =
      tile.terrain === "grass"
        ? new Color(205, 232, 165, 255)
        : tile.terrain === "dirt"
          ? new Color(230, 179, 132, 255)
          : tile.terrain === "sand"
            ? new Color(246, 221, 166, 255)
            : tile.terrain === "water"
              ? new Color(188, 225, 252, 255)
              : new Color(193, 209, 228, 255);
    const visibleDetail =
      tile.terrain === "grass"
        ? new Color(72, 102, 63, 255)
        : tile.terrain === "dirt"
          ? new Color(105, 72, 48, 255)
          : tile.terrain === "sand"
            ? new Color(146, 119, 73, 255)
            : tile.terrain === "water"
              ? new Color(52, 86, 121, 255)
              : new Color(80, 92, 108, 255);

    if (tile.fog === "hidden") {
      return {
        base: this.tone(visibleBase, -58, 58),
        inset: this.tone(visibleInset, -74, 44),
        accent: this.tone(visibleAccent, -92, 26),
        detail: this.tone(visibleDetail, -22, 34)
      };
    }

    if (tile.fog === "explored") {
      return {
        base: this.tone(visibleBase, -12, 218),
        inset: this.tone(visibleInset, -18, 172),
        accent: this.tone(visibleAccent, -26, 118),
        detail: this.tone(visibleDetail, -8, 144)
      };
    }

    if (isHeroTile) {
      return {
        base: this.tone(visibleBase, 8, 255),
        inset: this.tone(visibleInset, 18, 255),
        accent: this.tone(visibleAccent, 12, 255),
        detail: this.tone(visibleDetail, 6, 255)
      };
    }

    if (isReachable) {
      return {
        base: this.tone(visibleBase, 12, 255),
        inset: this.tone(visibleInset, 18, 255),
        accent: this.tone(visibleAccent, 12, 255),
        detail: this.tone(visibleDetail, 4, 255)
      };
    }

    return {
      base: visibleBase,
      inset: visibleInset,
      accent: visibleAccent,
      detail: visibleDetail
    };
  }

  private resolveMarkerPalette(markerVisual: CocosTileMarkerVisual): { shadow: Color; base: Color; gloss: Color } {
    if (markerVisual.iconKey === "wood") {
      return {
        shadow: new Color(38, 26, 17, 140),
        base: new Color(126, 94, 59, 255),
        gloss: new Color(182, 140, 92, 255)
      };
    }

    if (markerVisual.iconKey === "gold") {
      return {
        shadow: new Color(53, 36, 12, 140),
        base: new Color(180, 137, 44, 255),
        gloss: new Color(226, 189, 95, 255)
      };
    }

    if (markerVisual.iconKey === "ore") {
      return {
        shadow: new Color(30, 33, 40, 140),
        base: new Color(108, 119, 137, 255),
        gloss: new Color(166, 180, 198, 255)
      };
    }

    if (markerVisual.iconKey === "neutral") {
      return {
        shadow: new Color(63, 24, 24, 140),
        base: new Color(150, 58, 58, 255),
        gloss: new Color(206, 97, 87, 255)
      };
    }

    if (markerVisual.iconKey === "hero") {
      return {
        shadow: new Color(58, 23, 27, 140),
        base: new Color(165, 74, 70, 255),
        gloss: new Color(222, 118, 97, 255)
      };
    }

    if (markerVisual.faction === "crown") {
      return {
        shadow: new Color(24, 36, 51, 140),
        base: new Color(79, 108, 142, 255),
        gloss: new Color(132, 170, 214, 255)
      };
    }

    if (markerVisual.interactionType === "pickup") {
      return {
        shadow: new Color(27, 40, 34, 140),
        base: new Color(78, 129, 96, 255),
        gloss: new Color(132, 186, 150, 255)
      };
    }

    return {
      shadow: new Color(24, 36, 51, 140),
      base: new Color(79, 108, 142, 255),
      gloss: new Color(132, 170, 214, 255)
    };
  }

  private paintTerrainMotif(
    graphics: Graphics,
    tile: PlayerTileView,
    palette: { base: Color; inset: Color; accent: Color; detail: Color },
    width: number,
    height: number
  ): void {
    const innerWidth = width - 8;
    const innerHeight = height - 8;
    const left = -innerWidth / 2;
    const bottom = -innerHeight / 2;
    const top = innerHeight / 2;

    graphics.fillColor = palette.inset;
    graphics.roundRect(left + 6, top - Math.max(16, Math.floor(this.tileSize * 0.24)), innerWidth - 12, Math.max(8, Math.floor(this.tileSize * 0.1)), 6);
    graphics.fill();

    if (tile.fog === "hidden") {
      const variant = this.tileVariant(tile.position);
      graphics.fillColor = new Color(palette.detail.r, palette.detail.g, palette.detail.b, 64);
      graphics.circle(left + innerWidth * (0.26 + variant * 0.04), bottom + innerHeight * 0.54, Math.max(10, this.tileSize * 0.14));
      graphics.circle(left + innerWidth * (0.46 + variant * 0.02), bottom + innerHeight * 0.46, Math.max(13, this.tileSize * 0.18));
      graphics.circle(left + innerWidth * (0.66 - variant * 0.03), bottom + innerHeight * 0.56, Math.max(9, this.tileSize * 0.13));
      graphics.fill();
      graphics.fillColor = new Color(palette.inset.r, palette.inset.g, palette.inset.b, 28);
      graphics.roundRect(left + 14, bottom + innerHeight * (0.22 + variant * 0.04), innerWidth - 28, Math.max(7, this.tileSize * 0.08), 6);
      graphics.fill();
      return;
    }

    if (tile.terrain === "grass") {
      graphics.fillColor = palette.detail;
      graphics.roundRect(left + 7, bottom + 7, innerWidth - 14, Math.max(16, Math.floor(innerHeight * 0.34)), 9);
      graphics.fill();
      graphics.fillColor = palette.inset;
      graphics.circle(left + innerWidth * 0.24, bottom + innerHeight * 0.4, Math.max(11, this.tileSize * 0.16));
      graphics.circle(left + innerWidth * 0.52, bottom + innerHeight * 0.28, Math.max(14, this.tileSize * 0.22));
      graphics.circle(left + innerWidth * 0.8, bottom + innerHeight * 0.4, Math.max(12, this.tileSize * 0.18));
      graphics.fill();
      graphics.fillColor = palette.accent;
      graphics.circle(left + innerWidth * 0.22, bottom + innerHeight * 0.72, Math.max(6, this.tileSize * 0.09));
      graphics.circle(left + innerWidth * 0.4, bottom + innerHeight * 0.8, Math.max(5, this.tileSize * 0.07));
      graphics.circle(left + innerWidth * 0.72, bottom + innerHeight * 0.76, Math.max(7, this.tileSize * 0.1));
      graphics.fill();
      return;
    }

    if (tile.terrain === "dirt") {
      graphics.fillColor = palette.detail;
      graphics.roundRect(left + 7, bottom + 7, innerWidth - 14, Math.max(14, Math.floor(innerHeight * 0.32)), 8);
      graphics.fill();
      graphics.fillColor = palette.inset;
      graphics.circle(left + innerWidth * 0.3, bottom + innerHeight * 0.34, Math.max(14, this.tileSize * 0.21));
      graphics.circle(left + innerWidth * 0.68, bottom + innerHeight * 0.34, Math.max(16, this.tileSize * 0.24));
      graphics.fill();
      graphics.fillColor = palette.accent;
      graphics.circle(left + innerWidth * 0.22, bottom + innerHeight * 0.66, Math.max(6, this.tileSize * 0.09));
      graphics.circle(left + innerWidth * 0.48, bottom + innerHeight * 0.8, Math.max(7, this.tileSize * 0.11));
      graphics.circle(left + innerWidth * 0.76, bottom + innerHeight * 0.72, Math.max(6, this.tileSize * 0.09));
      graphics.fill();
      return;
    }

    if (tile.terrain === "sand") {
      graphics.fillColor = palette.detail;
      graphics.roundRect(left + 7, bottom + 8, innerWidth - 14, Math.max(11, Math.floor(innerHeight * 0.24)), 8);
      graphics.fill();
      graphics.fillColor = palette.inset;
      graphics.roundRect(left + 8, bottom + innerHeight * 0.32, innerWidth - 16, Math.max(8, this.tileSize * 0.1), 5);
      graphics.roundRect(left + 14, bottom + innerHeight * 0.48, innerWidth - 28, Math.max(7, this.tileSize * 0.09), 5);
      graphics.roundRect(left + 10, bottom + innerHeight * 0.66, innerWidth - 20, Math.max(7, this.tileSize * 0.09), 5);
      graphics.fill();
      graphics.fillColor = palette.accent;
      graphics.roundRect(left + 18, bottom + innerHeight * 0.76, innerWidth * 0.32, Math.max(6, this.tileSize * 0.07), 4);
      graphics.fill();
      return;
    }

    if (tile.terrain === "water") {
      graphics.fillColor = palette.detail;
      graphics.roundRect(left + 6, bottom + 8, innerWidth - 12, innerHeight - 16, 10);
      graphics.fill();
      graphics.fillColor = palette.inset;
      graphics.roundRect(left + 10, bottom + innerHeight * 0.28, innerWidth - 20, Math.max(8, this.tileSize * 0.09), 5);
      graphics.roundRect(left + 18, bottom + innerHeight * 0.48, innerWidth - 36, Math.max(8, this.tileSize * 0.09), 5);
      graphics.roundRect(left + 12, bottom + innerHeight * 0.68, innerWidth - 24, Math.max(8, this.tileSize * 0.09), 5);
      graphics.fill();
      graphics.fillColor = palette.accent;
      graphics.roundRect(left + 18, bottom + innerHeight * 0.76, innerWidth * 0.28, Math.max(6, this.tileSize * 0.07), 4);
      graphics.fill();
      return;
    }

    graphics.fillColor = palette.detail;
    graphics.roundRect(left + 8, bottom + 8, innerWidth - 16, innerHeight - 16, 9);
    graphics.fill();
    graphics.fillColor = palette.inset;
    graphics.circle(left + innerWidth * 0.3, bottom + innerHeight * 0.64, Math.max(9, this.tileSize * 0.14));
    graphics.circle(left + innerWidth * 0.64, bottom + innerHeight * 0.38, Math.max(11, this.tileSize * 0.16));
    graphics.fill();
  }

  private paintObjectIcon(
    graphics: Graphics,
    iconKey: CocosTileMarkerVisual["iconKey"],
    width: number,
    height: number
  ): void {
    if (iconKey === "wood") {
      graphics.fillColor = new Color(245, 229, 202, 255);
      graphics.roundRect(-width * 0.22, -height * 0.05, width * 0.44, height * 0.14, 3);
      graphics.roundRect(-width * 0.24, -height * 0.22, width * 0.48, height * 0.14, 3);
      graphics.fill();
      return;
    }

    if (iconKey === "gold") {
      graphics.fillColor = new Color(252, 232, 137, 255);
      graphics.circle(0, 0, Math.min(width, height) * 0.18);
      graphics.fill();
      graphics.fillColor = new Color(255, 248, 218, 255);
      graphics.circle(width * 0.05, height * 0.05, Math.min(width, height) * 0.07);
      graphics.fill();
      return;
    }

    if (iconKey === "ore") {
      graphics.fillColor = new Color(225, 233, 242, 255);
      graphics.circle(-width * 0.1, -height * 0.02, Math.min(width, height) * 0.12);
      graphics.circle(width * 0.08, height * 0.04, Math.min(width, height) * 0.1);
      graphics.circle(width * 0.02, -height * 0.12, Math.min(width, height) * 0.09);
      graphics.fill();
      return;
    }

    if (iconKey === "neutral") {
      graphics.fillColor = new Color(255, 233, 223, 255);
      graphics.roundRect(-width * 0.07, -height * 0.18, width * 0.14, height * 0.38, 3);
      graphics.fill();
      graphics.fillColor = new Color(255, 196, 172, 255);
      graphics.roundRect(0, height * 0.02, width * 0.16, height * 0.18, 3);
      graphics.fill();
      return;
    }

    if (iconKey === "hero") {
      graphics.fillColor = new Color(255, 237, 201, 255);
      graphics.circle(-width * 0.12, height * 0.02, Math.min(width, height) * 0.08);
      graphics.circle(0, height * 0.1, Math.min(width, height) * 0.09);
      graphics.circle(width * 0.12, height * 0.02, Math.min(width, height) * 0.08);
      graphics.roundRect(-width * 0.18, -height * 0.18, width * 0.36, height * 0.12, 3);
      graphics.fill();
      return;
    }

    graphics.fillColor = new Color(238, 246, 255, 255);
    graphics.roundRect(-width * 0.12, -height * 0.12, width * 0.24, height * 0.24, 4);
    graphics.fill();
  }

  private tileVariant(position: Vec2): number {
    return Math.abs(position.x * 17 + position.y * 31) % 3;
  }

  private tone(color: Color, delta: number, alpha = color.a): Color {
    return new Color(
      this.clampByte(color.r + delta),
      this.clampByte(color.g + delta),
      this.clampByte(color.b + delta),
      alpha
    );
  }

  private clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
  }
}
