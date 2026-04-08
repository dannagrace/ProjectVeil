import { _decorator, Color, Component, Graphics, Label, Node, Sprite, UIOpacity, UITransform } from "cc";
import { resolveBattlePanelUnitVisual } from "./cocos-battle-unit-visuals.ts";
import {
  buildBattlePanelViewModel,
  type BattlePanelActionView,
  type BattlePanelInput,
  type BattleCamp,
  type BattlePanelPhaseBannerView,
  type BattlePanelStageView
} from "./cocos-battle-panel-model.ts";
import type { CocosBattleFeedbackTone } from "./project-shared/index.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";
import type { BattleAction } from "./VeilCocosSession.ts";
import { getPixelSpriteAssets, loadPixelSpriteAssets } from "./cocos-pixel-sprites.ts";

const { ccclass } = _decorator;

const PANEL_WIDTH = 272;
const PANEL_PADDING = 16;
const PANEL_CONTENT_WIDTH = PANEL_WIDTH - PANEL_PADDING * 2;
const H_ALIGN_LEFT = 0;
const H_ALIGN_CENTER = 1;
const V_ALIGN_TOP = 0;
const V_ALIGN_CENTER = 1;
const OVERFLOW_RESIZE_HEIGHT = 3;
const PANEL_BG = new Color(16, 22, 33, 198);
const PANEL_BORDER = new Color(231, 240, 248, 78);
const PANEL_INNER = new Color(43, 56, 77, 84);
const PANEL_ACCENT = new Color(210, 117, 88, 255);
const PANEL_ACCENT_SOFT = new Color(235, 163, 128, 96);
const IDLE_SUMMARY_FILL = new Color(49, 58, 81, 156);
const IDLE_TIPS_FILL = new Color(36, 47, 66, 136);
const TARGET_NODE_PREFIX = "BattleTarget";
const ACTION_NODE_PREFIX = "BattleAction";
const ORDER_ITEM_PREFIX = "BattleOrderItem";
const FRIENDLY_ITEM_PREFIX = "BattleFriendlyItem";
const TITLE_NODE_NAME = "BattleTitle";
const FEEDBACK_NODE_NAME = "BattleFeedback";
const SUMMARY_NODE_NAME = "BattleSummary";
const ORDER_NODE_NAME = "BattleOrder";
const FRIENDLY_NODE_NAME = "BattleFriendly";
const ENEMY_HEADER_NODE_NAME = "BattleEnemyHeader";
const ACTION_HEADER_NODE_NAME = "BattleActionHeader";
const HEADER_ICON_NODE_NAME = "BattleHeaderIcon";
const WATERMARK_NODE_NAME = "BattleWatermark";
const IDLE_HINT_NODE_NAME = "BattleIdleHint";
const IDLE_BADGE_NODE_NAME = "BattleIdleBadge";
const SECTION_CARD_PREFIX = "BattleSectionCard";
const STAGE_BANNER_NODE_NAME = "BattleStageBanner";
const PHASE_BANNER_NODE_NAME = "BattlePhaseBanner";
const PHASE_TRACKER_NODE_NAME = "BattlePhaseTracker";
const BADGE_BACKGROUND_SUFFIX = "-Background";
const UNIT_ART_SIZE = 34;
const UNIT_FRAME_SIZE = 38;
const UNIT_BADGE_SIZE = 10;
const UNIT_ART_CENTER_X = -PANEL_CONTENT_WIDTH / 2 + 30;
const UNIT_TEXT_WIDTH = PANEL_CONTENT_WIDTH - 126;
const UNIT_TEXT_CENTER_X = -8;

interface BattleUnitVisualNodes {
  portraitNode: Node;
  portraitSprite: Sprite;
  portraitOpacity: UIOpacity;
  frameNode: Node;
  frameSprite: Sprite;
  frameOpacity: UIOpacity;
  factionNode: Node;
  factionSprite: Sprite;
  factionOpacity: UIOpacity;
  rarityNode: Node;
  raritySprite: Sprite;
  rarityOpacity: UIOpacity;
  interactionNode: Node;
  interactionSprite: Sprite;
  interactionOpacity: UIOpacity;
}

interface BattleStageBannerNodes {
  node: Node;
  title: Label;
  meta: Label;
  badge: Label;
  terrainNode: Node;
  terrainSprite: Sprite;
  terrainOpacity: UIOpacity;
}

interface BattlePhaseBannerNodes {
  node: Node;
  title: Label;
  meta: Label;
  badge: Label;
}

interface BattlePhaseTrackerNodes {
  node: Node;
  title: Label;
  meta: Label;
}

export interface VeilBattlePanelState extends BattlePanelInput {}

export interface VeilBattlePanelOptions {
  onSelectTarget?: (unitId: string) => void;
  onAction?: (action: BattleAction) => void;
}

@ccclass("ProjectVeilBattlePanel")
export class VeilBattlePanel extends Component {
  private titleLabel: Label | null = null;
  private feedbackLabel: Label | null = null;
  private summaryLabel: Label | null = null;
  private orderLabel: Label | null = null;
  private friendlyLabel: Label | null = null;
  private enemyHeaderLabel: Label | null = null;
  private actionHeaderLabel: Label | null = null;
  private idleHintLabel: Label | null = null;
  private idleBadgeLabel: Label | null = null;
  private readonly targetNodes = new Map<string, { node: Node; title: Label; meta: Label; badge: Label; visuals: BattleUnitVisualNodes }>();
  private readonly actionNodes = new Map<string, { node: Node; title: Label; meta: Label }>();
  private readonly orderItemNodes = new Map<string, { node: Node; title: Label; meta: Label; badge: Label; visuals: BattleUnitVisualNodes }>();
  private readonly friendlyItemNodes = new Map<string, { node: Node; title: Label; meta: Label; badge: Label; visuals: BattleUnitVisualNodes }>();
  private headerIconSprite: Sprite | null = null;
  private headerIconOpacity: UIOpacity | null = null;
  private stageBanner: BattleStageBannerNodes | null = null;
  private phaseBanner: BattlePhaseBannerNodes | null = null;
  private phaseTracker: BattlePhaseTrackerNodes | null = null;
  private currentState: VeilBattlePanelState | null = null;
  private activePhaseBanner: BattlePanelPhaseBannerView | null = null;
  private phaseBannerTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private phaseBannerExpiresAtMs = 0;
  private requestedIcons = false;
  private requestedStageTerrain = false;
  private onSelectTarget: ((unitId: string) => void) | undefined;
  private onAction: ((action: BattleAction) => void) | undefined;

  configure(options: VeilBattlePanelOptions): void {
    assignUiLayer(this.node);
    this.onSelectTarget = options.onSelectTarget;
    this.onAction = options.onAction;
  }

  onDestroy(): void {
    if (this.phaseBannerTimeoutId) {
      clearTimeout(this.phaseBannerTimeoutId);
      this.phaseBannerTimeoutId = null;
    }
  }

  render(state: VeilBattlePanelState): void {
    this.currentState = state;
    this.cleanupLegacyNodes();
    const model = buildBattlePanelViewModel(state);
    this.syncHeaderIcon();
    this.syncChrome();
    this.ensureSectionLabels();
    this.sanitizePassiveLabels();
    this.syncWatermark(model.idle);
    this.clearSectionCards();

    const panelHeight = this.node.getComponent(UITransform)?.height ?? 320;
    let cursorY = panelHeight / 2 - 42;
    cursorY = this.renderTextBlock(this.titleLabel, [model.title], cursorY, 16, 20, 12);
    this.tightenTitleLayout();

    if (model.idle) {
      this.hideStageBanner();
      this.hidePhaseBanner();
      this.hidePhaseTracker();
      cursorY = this.renderBattleFeedback(model.feedback, cursorY - 4);
      cursorY = this.renderCardTextBlock(
        this.summaryLabel,
        "IdleSummary",
        model.summaryLines.length > 0 ? model.summaryLines : ["当前没有战斗。", "继续探索即可触发遭遇。"],
        cursorY - 4,
        12,
        16,
        0,
        IDLE_SUMMARY_FILL
      );
      const idleBadge = model.feedback?.badge ?? (model.summaryLines[0] === "当前没有战斗。" ? "" : "IDLE");
      this.syncIdleBadge(!model.feedback && Boolean(idleBadge), this.summaryLabel?.node.position.y ?? 0, idleBadge);
      this.hideSection(this.idleHintLabel);
      this.hideSection(this.orderLabel);
      this.hideSection(this.friendlyLabel);
      this.hideSection(this.enemyHeaderLabel);
      this.hideSection(this.actionHeaderLabel);
      this.hideOrderItems();
      this.hideFriendlyItems();
      this.hideTargetNodes();
      this.hideActionNodes();
      return;
    }

    this.syncIdleBadge(false, 0, "");
    cursorY = this.renderBattleFeedback(model.feedback, cursorY - 4);
    cursorY = this.renderPhaseBanner(model.phaseBanner, cursorY - 2);
    cursorY = this.renderStageBanner(model.stage, cursorY - 2);
    cursorY = this.renderPhaseTracker(model.bossPhaseTracker, cursorY - 2);
    cursorY = this.renderCardTextBlock(this.summaryLabel, "Summary", model.summaryLines, cursorY, 14, 18, 14);
    cursorY = this.renderTextBlock(this.orderLabel, ["行动顺序"], cursorY, 14, 18, 6);
    cursorY = this.renderOrderItems(model.orderItems, cursorY);
    cursorY = this.renderTextBlock(this.friendlyLabel, ["我方单位"], cursorY, 14, 18, 6);
    cursorY = this.renderFriendlyItems(model.friendlyItems, cursorY);
    cursorY = this.renderTextBlock(this.enemyHeaderLabel, ["目标选择"], cursorY, 14, 18, 6);
    cursorY = this.renderTargetNodes(model.enemyTargets, cursorY);
    cursorY = this.renderTextBlock(this.actionHeaderLabel, ["战斗指令"], cursorY, 14, 18, 6);
    this.hideSection(this.idleHintLabel);
    this.renderActionNodes(model.actions, cursorY);
  }

  private cleanupLegacyNodes(): void {
    const allowedNames = new Set<string>([
      TITLE_NODE_NAME,
      FEEDBACK_NODE_NAME,
      SUMMARY_NODE_NAME,
      ORDER_NODE_NAME,
      FRIENDLY_NODE_NAME,
      ENEMY_HEADER_NODE_NAME,
      ACTION_HEADER_NODE_NAME,
      STAGE_BANNER_NODE_NAME,
      PHASE_BANNER_NODE_NAME,
      PHASE_TRACKER_NODE_NAME,
      HEADER_ICON_NODE_NAME,
      WATERMARK_NODE_NAME,
      IDLE_HINT_NODE_NAME,
      IDLE_BADGE_NODE_NAME
    ]);
    const childNodes = (this.node as unknown as { children?: Node[] }).children ?? [];
    for (const child of childNodes) {
      const keep =
        allowedNames.has(child.name)
        || child.name.startsWith(TARGET_NODE_PREFIX)
        || child.name.startsWith(ACTION_NODE_PREFIX)
        || child.name.startsWith(ORDER_ITEM_PREFIX)
        || child.name.startsWith(FRIENDLY_ITEM_PREFIX)
        || child.name.startsWith(`${SECTION_CARD_PREFIX}-`);
      if (!keep) {
        child.destroy();
      }
    }
  }

  private clearSectionCards(): void {
    const childNodes = (this.node as unknown as { children?: Node[] }).children ?? [];
    for (const child of childNodes) {
      if (child.name.startsWith(`${SECTION_CARD_PREFIX}-`)) {
        child.destroy();
      }
    }
  }

  private ensureSectionLabels(): void {
    this.titleLabel = this.ensureLabelNode(TITLE_NODE_NAME, 20, 24, 32);
    this.feedbackLabel = this.ensureLabelNode(FEEDBACK_NODE_NAME, 13, 17, 42);
    this.summaryLabel = this.ensureLabelNode(SUMMARY_NODE_NAME, 15, 19, 72);
    this.orderLabel = this.ensureLabelNode(ORDER_NODE_NAME, 14, 18, 88);
    this.friendlyLabel = this.ensureLabelNode(FRIENDLY_NODE_NAME, 14, 18, 72);
    this.enemyHeaderLabel = this.ensureLabelNode(ENEMY_HEADER_NODE_NAME, 14, 18, 18);
    this.actionHeaderLabel = this.ensureLabelNode(ACTION_HEADER_NODE_NAME, 14, 18, 18);
    this.idleHintLabel = this.ensureLabelNode(IDLE_HINT_NODE_NAME, 12, 16, 28);
    this.idleBadgeLabel = this.ensureLabelNode(IDLE_BADGE_NODE_NAME, 11, 14, 16);
  }

  private sanitizePassiveLabels(): void {
    const passiveLabels = [
      this.titleLabel,
      this.feedbackLabel,
      this.summaryLabel,
      this.orderLabel,
      this.friendlyLabel,
      this.enemyHeaderLabel,
      this.actionHeaderLabel,
      this.idleHintLabel
    ];
    for (const label of passiveLabels) {
      const node = label?.node;
      if (!node) {
        continue;
      }
      const legacyGraphics = node.getComponent(Graphics);
      if (legacyGraphics) {
        node.removeComponent(legacyGraphics);
      }
    }
  }

  private renderTextBlock(
    label: Label | null,
    lines: string[],
    topY: number,
    fontSize: number,
    lineHeight: number,
    bottomGap: number
  ): number {
    if (!label) {
      return topY;
    }

    label.node.active = true;
    label.fontSize = fontSize;
    label.lineHeight = lineHeight;
    label.string = lines.join("\n");
    const height = Math.max(lineHeight, lines.length * lineHeight);
    const transform = label.node.getComponent(UITransform) ?? label.node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, height);
    label.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, topY - height / 2, 0);
    return topY - height - bottomGap;
  }

  private renderCardTextBlock(
    label: Label | null,
    cardName: string,
    lines: string[],
    topY: number,
    fontSize: number,
    lineHeight: number,
    bottomGap: number,
    fillColor: Color = new Color(33, 46, 66, 138)
  ): number {
    const nextY = this.renderTextBlock(label, lines, topY, fontSize, lineHeight, bottomGap);
    if (!label) {
      return nextY;
    }

    const transform = label.node.getComponent(UITransform) ?? label.node.addComponent(UITransform);
    this.renderSectionCard(cardName, label.node.position.y, transform.height + 22, fillColor);
    return nextY;
  }

  private renderBattleFeedback(
    feedback: {
      title: string;
      detail: string;
      badge: string;
      tone: CocosBattleFeedbackTone;
    } | null,
    topY: number
  ): number {
    if (!feedback) {
      this.hideSection(this.feedbackLabel);
      this.syncIdleBadge(false, 0, "");
      return topY;
    }

    const nextY = this.renderCardTextBlock(
      this.feedbackLabel,
      "Feedback",
      [feedback.title, feedback.detail],
      topY,
      13,
      17,
      10,
      fillColorForFeedbackTone(feedback.tone)
    );
    if (this.feedbackLabel) {
      this.syncIdleBadge(true, this.feedbackLabel.node.position.y + 11, feedback.badge);
    }
    return nextY;
  }

  private tightenTitleLayout(): void {
    if (!this.titleLabel) {
      return;
    }

    const transform = this.titleLabel.node.getComponent(UITransform) ?? this.titleLabel.node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH - 34, transform.height);
    this.titleLabel.node.setPosition(
      -PANEL_WIDTH / 2 + PANEL_PADDING + (PANEL_CONTENT_WIDTH - 34) / 2 + 18,
      this.titleLabel.node.position.y,
      0
    );
  }

  private renderTargetNodes(
    targets: Array<{
      id: string;
      label: string;
      title: string;
      meta: string;
      badge: string;
      selected: boolean;
      selectable: boolean;
    }>,
    topY: number
  ): number {
    const rowHeight = 54;
    const gap = 10;
    const used = new Set<string>();
    let cursorY = topY;

    if (targets.length === 0) {
      const emptyTarget = this.ensureTargetNode("empty");
      emptyTarget.node.active = true;
      emptyTarget.title.string = "暂无敌方目标";
      emptyTarget.meta.string = "等待新的敌方单位出现";
      emptyTarget.badge.string = "空";
      const transform = emptyTarget.node.getComponent(UITransform) ?? emptyTarget.node.addComponent(UITransform);
      transform.setContentSize(PANEL_CONTENT_WIDTH, rowHeight);
      emptyTarget.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, cursorY - rowHeight / 2, 0);
      this.styleTargetNode(emptyTarget.node, emptyTarget.title, emptyTarget.meta, emptyTarget.badge, false, false);
      used.add("empty");
      cursorY -= rowHeight + gap;
    } else {
      targets.forEach((target) => {
        const targetNode = this.ensureTargetNode(target.id);
        targetNode.node.active = true;
        targetNode.title.string = target.title;
        targetNode.meta.string = target.meta;
        targetNode.badge.string = target.badge;
        const transform = targetNode.node.getComponent(UITransform) ?? targetNode.node.addComponent(UITransform);
        transform.setContentSize(PANEL_CONTENT_WIDTH, rowHeight);
        targetNode.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, cursorY - rowHeight / 2, 0);
        this.styleTargetNode(targetNode.node, targetNode.title, targetNode.meta, targetNode.badge, target.selected, target.selectable);
        this.syncUnitVisualNodes(targetNode.visuals, target.id, { selected: target.selected, active: false });
        used.add(target.id);
        cursorY -= rowHeight + gap;
      });
    }

    const contentHeight = Math.max(52, topY - cursorY + 12);
    this.renderSectionCard("Targets", topY - contentHeight / 2 + 12, contentHeight, new Color(39, 51, 72, 142));

    for (const [key, targetNode] of this.targetNodes) {
      if (!used.has(key)) {
        targetNode.node.active = false;
      }
    }

    return cursorY - 8;
  }

  private renderActionNodes(actions: BattlePanelActionView[], topY: number): void {
    const rowHeight = 48;
    const gap = 10;
    const used = new Set<string>();
    let cursorY = topY;

    actions.forEach((entry) => {
      const actionNode = this.ensureActionNode(entry.key);
      actionNode.node.active = true;
      actionNode.title.string = entry.label;
      actionNode.meta.string = entry.subtitle;
      const transform = actionNode.node.getComponent(UITransform) ?? actionNode.node.addComponent(UITransform);
      transform.setContentSize(PANEL_CONTENT_WIDTH, rowHeight);
      actionNode.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, cursorY - rowHeight / 2, 0);
      actionNode.node.off(Node.EventType.TOUCH_END);
      actionNode.node.on(
        Node.EventType.TOUCH_END,
        () => {
          if (entry.action) {
            this.onAction?.(entry.action);
          }
        },
        this
      );
      this.styleActionNode(actionNode.node, actionNode.title, actionNode.meta, entry);
      used.add(entry.key);
      cursorY -= rowHeight + gap;
    });

    const contentHeight = Math.max(48, topY - cursorY + 12);
    this.renderSectionCard("Actions", topY - contentHeight / 2 + 12, contentHeight, new Color(36, 48, 66, 142));

    for (const [key, actionNode] of this.actionNodes) {
      if (!used.has(key)) {
        actionNode.node.active = false;
      }
    }
  }

  private renderOrderItems(
    items: Array<{
      id: string;
      title: string;
      meta: string;
      badge: string;
      active: boolean;
    }>,
    topY: number
  ): number {
    const rowHeight = 48;
    const gap = 8;
    const used = new Set<string>();
    let cursorY = topY;

    if (items.length === 0) {
      const emptyItem = this.ensureOrderItemNode("empty");
      emptyItem.node.active = true;
      emptyItem.title.string = "等待行动顺序";
      emptyItem.meta.string = "进入战斗后显示单位队列";
      emptyItem.badge.string = "--";
      const transform = emptyItem.node.getComponent(UITransform) ?? emptyItem.node.addComponent(UITransform);
      transform.setContentSize(PANEL_CONTENT_WIDTH, rowHeight);
      emptyItem.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, cursorY - rowHeight / 2, 0);
      this.styleRosterNode(emptyItem.node, emptyItem.title, emptyItem.meta, emptyItem.badge, false, new Color(90, 109, 148, 170));
      used.add("empty");
      cursorY -= rowHeight + gap;
    } else {
      for (const item of items) {
        const itemNode = this.ensureOrderItemNode(item.id);
        itemNode.node.active = true;
        itemNode.title.string = item.title;
        itemNode.meta.string = item.meta;
        itemNode.badge.string = item.badge;
        const transform = itemNode.node.getComponent(UITransform) ?? itemNode.node.addComponent(UITransform);
        transform.setContentSize(PANEL_CONTENT_WIDTH, rowHeight);
        itemNode.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, cursorY - rowHeight / 2, 0);
        this.styleRosterNode(
          itemNode.node,
          itemNode.title,
          itemNode.meta,
          itemNode.badge,
          item.active,
          item.active ? new Color(234, 183, 124, 220) : new Color(98, 121, 164, 176)
        );
        this.syncUnitVisualNodes(itemNode.visuals, item.id, { selected: false, active: item.active });
        used.add(item.id);
        cursorY -= rowHeight + gap;
      }
    }

    const contentHeight = Math.max(46, topY - cursorY + 10);
    this.renderSectionCard("OrderItems", topY - contentHeight / 2 + 12, contentHeight, new Color(34, 47, 68, 138));

    for (const [key, itemNode] of this.orderItemNodes) {
      if (!used.has(key)) {
        itemNode.node.active = false;
      }
    }

    return cursorY - 6;
  }

  private renderFriendlyItems(
    items: Array<{
      id: string;
      title: string;
      meta: string;
      badge: string;
    }>,
    topY: number
  ): number {
    const rowHeight = 50;
    const gap = 8;
    const used = new Set<string>();
    let cursorY = topY;

    if (items.length === 0) {
      const emptyItem = this.ensureFriendlyItemNode("empty");
      emptyItem.node.active = true;
      emptyItem.title.string = "暂无我方单位";
      emptyItem.meta.string = "等待战斗单位入场";
      emptyItem.badge.string = "--";
      const transform = emptyItem.node.getComponent(UITransform) ?? emptyItem.node.addComponent(UITransform);
      transform.setContentSize(PANEL_CONTENT_WIDTH, rowHeight);
      emptyItem.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, cursorY - rowHeight / 2, 0);
      this.styleRosterNode(emptyItem.node, emptyItem.title, emptyItem.meta, emptyItem.badge, false, new Color(102, 126, 166, 164));
      used.add("empty");
      cursorY -= rowHeight + gap;
    } else {
      for (const item of items) {
        const itemNode = this.ensureFriendlyItemNode(item.id);
        itemNode.node.active = true;
        itemNode.title.string = item.title;
        itemNode.meta.string = item.meta;
        itemNode.badge.string = item.badge;
        const transform = itemNode.node.getComponent(UITransform) ?? itemNode.node.addComponent(UITransform);
        transform.setContentSize(PANEL_CONTENT_WIDTH, rowHeight);
        itemNode.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, cursorY - rowHeight / 2, 0);
        this.styleRosterNode(itemNode.node, itemNode.title, itemNode.meta, itemNode.badge, false, badgeAccentForFriendly(item.badge));
        this.syncUnitVisualNodes(itemNode.visuals, item.id, { selected: false, active: false });
        used.add(item.id);
        cursorY -= rowHeight + gap;
      }
    }

    const contentHeight = Math.max(48, topY - cursorY + 10);
    this.renderSectionCard("FriendlyItems", topY - contentHeight / 2 + 12, contentHeight, new Color(35, 48, 70, 134));

    for (const [key, itemNode] of this.friendlyItemNodes) {
      if (!used.has(key)) {
        itemNode.node.active = false;
      }
    }

    return cursorY - 6;
  }

  private hideSection(label: Label | null): void {
    if (label) {
      label.string = "";
      label.node.active = false;
    }
  }

  private hideTargetNodes(): void {
    for (const targetNode of this.targetNodes.values()) {
      targetNode.node.active = false;
    }
  }

  private hideActionNodes(): void {
    for (const actionNode of this.actionNodes.values()) {
      actionNode.node.active = false;
    }
  }

  private hideOrderItems(): void {
    for (const itemNode of this.orderItemNodes.values()) {
      itemNode.node.active = false;
    }
  }

  private hideFriendlyItems(): void {
    for (const itemNode of this.friendlyItemNodes.values()) {
      itemNode.node.active = false;
    }
  }

  private syncChrome(): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const graphics = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    const width = transform.width || PANEL_WIDTH;
    const height = transform.height || 320;
    graphics.clear();
    graphics.fillColor = PANEL_BG;
    graphics.strokeColor = PANEL_BORDER;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 20);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = PANEL_INNER;
    graphics.roundRect(-width / 2 + 12, height / 2 - 24, width - 24, 10, 8);
    graphics.fill();
    graphics.fillColor = PANEL_ACCENT;
    graphics.roundRect(-width / 2 + 18, height / 2 - 22, Math.min(98, width * 0.3), 6, 5);
    graphics.fill();
    graphics.fillColor = PANEL_ACCENT_SOFT;
    graphics.roundRect(-width / 2 + 18, height / 2 - 40, Math.min(68, width * 0.2), 5, 4);
    graphics.fill();
  }

  private syncHeaderIcon(): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    let iconNode = this.node.getChildByName(HEADER_ICON_NODE_NAME);
    if (!iconNode) {
      iconNode = new Node(HEADER_ICON_NODE_NAME);
      iconNode.parent = this.node;
    }
    assignUiLayer(iconNode);
    const iconTransform = iconNode.getComponent(UITransform) ?? iconNode.addComponent(UITransform);
    iconTransform.setContentSize(26, 26);
    iconNode.setPosition(-transform.width / 2 + 46, transform.height / 2 - 72, 1);
    this.headerIconSprite = iconNode.getComponent(Sprite) ?? iconNode.addComponent(Sprite);
    this.headerIconOpacity = iconNode.getComponent(UIOpacity) ?? iconNode.addComponent(UIOpacity);

    const frame = getPixelSpriteAssets()?.icons.battle ?? null;
    if (!frame) {
      iconNode.active = false;
      if (!this.requestedIcons) {
        this.requestedIcons = true;
        void loadPixelSpriteAssets("battle").finally(() => {
          this.requestedIcons = false;
          if (this.currentState) {
            this.render(this.currentState);
          }
        });
      }
      return;
    }

    iconNode.active = true;
    this.headerIconSprite.spriteFrame = frame;
    this.headerIconOpacity.opacity = 255;
  }

  private syncWatermark(idle: boolean): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    let watermarkNode = this.node.getChildByName(WATERMARK_NODE_NAME);
    if (!watermarkNode) {
      watermarkNode = new Node(WATERMARK_NODE_NAME);
      watermarkNode.parent = this.node;
    }
    assignUiLayer(watermarkNode);
    const watermarkTransform = watermarkNode.getComponent(UITransform) ?? watermarkNode.addComponent(UITransform);
    watermarkTransform.setContentSize(idle ? 92 : 84, idle ? 92 : 84);
    watermarkNode.setPosition(transform.width / 2 - 72, -24, 0.2);
    const watermarkSprite = watermarkNode.getComponent(Sprite) ?? watermarkNode.addComponent(Sprite);
    const watermarkOpacity = watermarkNode.getComponent(UIOpacity) ?? watermarkNode.addComponent(UIOpacity);
    const frame = getPixelSpriteAssets()?.icons.battle ?? null;

    if (!frame) {
      watermarkNode.active = false;
      return;
    }

    watermarkNode.active = idle;
    watermarkSprite.spriteFrame = frame;
    watermarkOpacity.opacity = idle ? 18 : 0;
  }

  private renderStageBanner(stage: BattlePanelStageView | null, topY: number): number {
    if (!stage) {
      this.hideStageBanner();
      return topY;
    }

    const banner = this.ensureStageBanner();
    const height = 56;
    const gap = 10;
    const transform = banner.node.getComponent(UITransform) ?? banner.node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, height);
    banner.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, topY - height / 2, 0.35);
    banner.node.active = true;
    banner.title.string = stage.title;
    banner.meta.string = stage.subtitle;
    banner.badge.string = stage.badge;

    const terrainFrame = this.resolveStageTerrainFrame(stage.terrain);
    this.setVisualNodeFrame(banner.terrainNode, banner.terrainSprite, banner.terrainOpacity, terrainFrame, 255);
    this.styleStageBanner(banner.node, banner.title, banner.meta, banner.badge, stage.terrain);
    return topY - height - gap;
  }

  private renderPhaseBanner(banner: BattlePanelPhaseBannerView | null, topY: number): number {
    if (banner && banner.key !== this.activePhaseBanner?.key) {
      this.activePhaseBanner = banner;
      this.phaseBannerExpiresAtMs = Date.now() + 2000;
      if (this.phaseBannerTimeoutId) {
        clearTimeout(this.phaseBannerTimeoutId);
      }
      this.phaseBannerTimeoutId = setTimeout(() => {
        this.phaseBannerTimeoutId = null;
        if (this.currentState) {
          this.render(this.currentState);
        }
      }, 2000);
    }

    if (!this.activePhaseBanner || Date.now() >= this.phaseBannerExpiresAtMs) {
      this.hidePhaseBanner();
      return topY;
    }

    const phaseBanner = this.ensurePhaseBanner();
    const height = 60;
    const gap = 10;
    const transform = phaseBanner.node.getComponent(UITransform) ?? phaseBanner.node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, height);
    phaseBanner.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, topY - height / 2, 0.38);
    phaseBanner.node.active = true;
    phaseBanner.title.string = this.activePhaseBanner.title;
    phaseBanner.meta.string = this.activePhaseBanner.detail;
    phaseBanner.badge.string = this.activePhaseBanner.badge;
    this.stylePhaseBanner(phaseBanner.node, phaseBanner.title, phaseBanner.meta, phaseBanner.badge);
    return topY - height - gap;
  }

  private renderPhaseTracker(
    tracker: {
      title: string;
      detail: string;
      markers: Array<{ label: string; thresholdPercent: number; active: boolean; reached: boolean }>;
    } | null,
    topY: number
  ): number {
    if (!tracker) {
      this.hidePhaseTracker();
      return topY;
    }

    const phaseTracker = this.ensurePhaseTracker();
    const height = 54;
    const gap = 10;
    const transform = phaseTracker.node.getComponent(UITransform) ?? phaseTracker.node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, height);
    phaseTracker.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, topY - height / 2, 0.34);
    phaseTracker.node.active = true;
    phaseTracker.title.string = tracker.title;
    phaseTracker.meta.string = tracker.detail;
    this.stylePhaseTracker(phaseTracker.node, phaseTracker.title, phaseTracker.meta, tracker.markers);
    return topY - height - gap;
  }

  private hideStageBanner(): void {
    if (!this.stageBanner) {
      return;
    }

    this.stageBanner.node.active = false;
    this.stageBanner.title.string = "";
    this.stageBanner.meta.string = "";
    this.stageBanner.badge.string = "";
    this.setVisualNodeFrame(
      this.stageBanner.terrainNode,
      this.stageBanner.terrainSprite,
      this.stageBanner.terrainOpacity,
      null,
      0
    );
  }

  private hidePhaseBanner(): void {
    if (!this.phaseBanner) {
      return;
    }

    this.phaseBanner.node.active = false;
    this.phaseBanner.title.string = "";
    this.phaseBanner.meta.string = "";
    this.phaseBanner.badge.string = "";
  }

  private hidePhaseTracker(): void {
    if (!this.phaseTracker) {
      return;
    }

    this.phaseTracker.node.active = false;
    this.phaseTracker.title.string = "";
    this.phaseTracker.meta.string = "";
  }

  private ensureStageBanner(): BattleStageBannerNodes {
    if (this.stageBanner) {
      return this.stageBanner;
    }

    const node = new Node(STAGE_BANNER_NODE_NAME);
    node.parent = this.node;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, 56);

    const terrainNode = new Node(`${STAGE_BANNER_NODE_NAME}-terrain`);
    terrainNode.parent = node;
    assignUiLayer(terrainNode);
    const terrainTransform = terrainNode.getComponent(UITransform) ?? terrainNode.addComponent(UITransform);
    terrainTransform.setContentSize(34, 34);
    terrainNode.setPosition(-PANEL_CONTENT_WIDTH / 2 + 28, 0, 1);
    const terrainSprite = terrainNode.getComponent(Sprite) ?? terrainNode.addComponent(Sprite);
    const terrainOpacity = terrainNode.getComponent(UIOpacity) ?? terrainNode.addComponent(UIOpacity);

    const titleNode = new Node(`${STAGE_BANNER_NODE_NAME}-title`);
    titleNode.parent = node;
    assignUiLayer(titleNode);
    const titleTransform = titleNode.getComponent(UITransform) ?? titleNode.addComponent(UITransform);
    titleTransform.setContentSize(PANEL_CONTENT_WIDTH - 118, 18);
    titleNode.setPosition(-8, 11, 1);
    const title = titleNode.getComponent(Label) ?? titleNode.addComponent(Label);
    title.fontSize = 13;
    title.lineHeight = 16;
    title.horizontalAlign = H_ALIGN_LEFT;
    title.verticalAlign = V_ALIGN_CENTER;
    title.overflow = OVERFLOW_RESIZE_HEIGHT;
    title.enableWrapText = false;
    title.string = "";

    const metaNode = new Node(`${STAGE_BANNER_NODE_NAME}-meta`);
    metaNode.parent = node;
    assignUiLayer(metaNode);
    const metaTransform = metaNode.getComponent(UITransform) ?? metaNode.addComponent(UITransform);
    metaTransform.setContentSize(PANEL_CONTENT_WIDTH - 118, 16);
    metaNode.setPosition(-8, -11, 1);
    const meta = metaNode.getComponent(Label) ?? metaNode.addComponent(Label);
    meta.fontSize = 10;
    meta.lineHeight = 12;
    meta.horizontalAlign = H_ALIGN_LEFT;
    meta.verticalAlign = V_ALIGN_CENTER;
    meta.overflow = OVERFLOW_RESIZE_HEIGHT;
    meta.enableWrapText = false;
    meta.string = "";

    const badgeNode = new Node(`${STAGE_BANNER_NODE_NAME}-badge`);
    badgeNode.parent = node;
    assignUiLayer(badgeNode);
    const badgeTransform = badgeNode.getComponent(UITransform) ?? badgeNode.addComponent(UITransform);
    badgeTransform.setContentSize(44, 20);
    badgeNode.setPosition(PANEL_CONTENT_WIDTH / 2 - 34, 0, 1);
    const badge = badgeNode.getComponent(Label) ?? badgeNode.addComponent(Label);
    badge.fontSize = 10;
    badge.lineHeight = 12;
    badge.horizontalAlign = H_ALIGN_CENTER;
    badge.verticalAlign = V_ALIGN_CENTER;
    badge.overflow = OVERFLOW_RESIZE_HEIGHT;
    badge.enableWrapText = false;
    badge.string = "";

    this.stageBanner = {
      node,
      title,
      meta,
      badge,
      terrainNode,
      terrainSprite,
      terrainOpacity
    };
    return this.stageBanner;
  }

  private ensurePhaseBanner(): BattlePhaseBannerNodes {
    if (this.phaseBanner) {
      return this.phaseBanner;
    }

    const node = new Node(PHASE_BANNER_NODE_NAME);
    node.parent = this.node;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, 60);

    const titleNode = new Node(`${PHASE_BANNER_NODE_NAME}-title`);
    titleNode.parent = node;
    assignUiLayer(titleNode);
    const titleTransform = titleNode.getComponent(UITransform) ?? titleNode.addComponent(UITransform);
    titleTransform.setContentSize(PANEL_CONTENT_WIDTH - 86, 18);
    titleNode.setPosition(-20, 12, 1);
    const title = titleNode.getComponent(Label) ?? titleNode.addComponent(Label);
    title.fontSize = 13;
    title.lineHeight = 16;
    title.horizontalAlign = H_ALIGN_LEFT;
    title.verticalAlign = V_ALIGN_CENTER;
    title.overflow = OVERFLOW_RESIZE_HEIGHT;
    title.enableWrapText = false;
    title.string = "";

    const metaNode = new Node(`${PHASE_BANNER_NODE_NAME}-meta`);
    metaNode.parent = node;
    assignUiLayer(metaNode);
    const metaTransform = metaNode.getComponent(UITransform) ?? metaNode.addComponent(UITransform);
    metaTransform.setContentSize(PANEL_CONTENT_WIDTH - 34, 16);
    metaNode.setPosition(0, -12, 1);
    const meta = metaNode.getComponent(Label) ?? metaNode.addComponent(Label);
    meta.fontSize = 10;
    meta.lineHeight = 12;
    meta.horizontalAlign = H_ALIGN_LEFT;
    meta.verticalAlign = V_ALIGN_CENTER;
    meta.overflow = OVERFLOW_RESIZE_HEIGHT;
    meta.enableWrapText = false;
    meta.string = "";

    const badgeNode = new Node(`${PHASE_BANNER_NODE_NAME}-badge`);
    badgeNode.parent = node;
    assignUiLayer(badgeNode);
    const badgeTransform = badgeNode.getComponent(UITransform) ?? badgeNode.addComponent(UITransform);
    badgeTransform.setContentSize(38, 22);
    badgeNode.setPosition(PANEL_CONTENT_WIDTH / 2 - 30, 12, 1);
    const badge = badgeNode.getComponent(Label) ?? badgeNode.addComponent(Label);
    badge.fontSize = 10;
    badge.lineHeight = 12;
    badge.horizontalAlign = H_ALIGN_CENTER;
    badge.verticalAlign = V_ALIGN_CENTER;
    badge.overflow = OVERFLOW_RESIZE_HEIGHT;
    badge.enableWrapText = false;
    badge.string = "";

    this.phaseBanner = {
      node,
      title,
      meta,
      badge
    };
    return this.phaseBanner;
  }

  private ensurePhaseTracker(): BattlePhaseTrackerNodes {
    if (this.phaseTracker) {
      return this.phaseTracker;
    }

    const node = new Node(PHASE_TRACKER_NODE_NAME);
    node.parent = this.node;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, 54);

    const titleNode = new Node(`${PHASE_TRACKER_NODE_NAME}-title`);
    titleNode.parent = node;
    assignUiLayer(titleNode);
    const titleTransform = titleNode.getComponent(UITransform) ?? titleNode.addComponent(UITransform);
    titleTransform.setContentSize(PANEL_CONTENT_WIDTH - 24, 18);
    titleNode.setPosition(0, 12, 1);
    const title = titleNode.getComponent(Label) ?? titleNode.addComponent(Label);
    title.fontSize = 12;
    title.lineHeight = 14;
    title.horizontalAlign = H_ALIGN_LEFT;
    title.verticalAlign = V_ALIGN_CENTER;
    title.overflow = OVERFLOW_RESIZE_HEIGHT;
    title.enableWrapText = false;
    title.string = "";

    const metaNode = new Node(`${PHASE_TRACKER_NODE_NAME}-meta`);
    metaNode.parent = node;
    assignUiLayer(metaNode);
    const metaTransform = metaNode.getComponent(UITransform) ?? metaNode.addComponent(UITransform);
    metaTransform.setContentSize(PANEL_CONTENT_WIDTH - 24, 16);
    metaNode.setPosition(0, -12, 1);
    const meta = metaNode.getComponent(Label) ?? metaNode.addComponent(Label);
    meta.fontSize = 10;
    meta.lineHeight = 12;
    meta.horizontalAlign = H_ALIGN_LEFT;
    meta.verticalAlign = V_ALIGN_CENTER;
    meta.overflow = OVERFLOW_RESIZE_HEIGHT;
    meta.enableWrapText = false;
    meta.string = "";

    this.phaseTracker = {
      node,
      title,
      meta
    };
    return this.phaseTracker;
  }

  private resolveStageTerrainFrame(terrain: BattlePanelStageView["terrain"]): Sprite["spriteFrame"] {
    const terrainFrames = getPixelSpriteAssets()?.tiles[terrain] ?? [];
    const frame = terrainFrames.find((entry) => Boolean(entry)) ?? null;
    if (!frame && !this.requestedStageTerrain) {
      this.requestedStageTerrain = true;
      void loadPixelSpriteAssets("boot")
        .then(() => {
          this.requestedStageTerrain = false;
          if (this.currentState) {
            this.render(this.currentState);
          }
        })
        .catch(() => {
          this.requestedStageTerrain = false;
        });
    }
    return frame;
  }

  private styleStageBanner(
    node: Node,
    title: Label,
    meta: Label,
    badge: Label,
    terrain: BattlePanelStageView["terrain"]
  ): void {
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const width = transform.width;
    const height = transform.height;
    const accent = accentForTerrain(terrain);
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(34, 47, 68, 154);
    graphics.strokeColor = new Color(accent.r, accent.g, accent.b, 170);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 14);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(accent.r, accent.g, accent.b, 86);
    graphics.roundRect(-width / 2 + 12, -height / 2 + 10, 6, height - 20, 3);
    graphics.fill();
    graphics.fillColor = new Color(255, 255, 255, 14);
    graphics.roundRect(-width / 2 + 12, height / 2 - 16, width - 24, 5, 3);
    graphics.fill();
    title.color = new Color(245, 249, 253, 255);
    meta.color = new Color(201, 214, 229, 220);
    badge.color = new Color(36, 28, 14, 255);
    this.styleBadgeNode(badge.node, new Color(accent.r, accent.g, accent.b, 224));
  }

  private stylePhaseBanner(node: Node, title: Label, meta: Label, badge: Label): void {
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const width = transform.width;
    const height = transform.height;
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(78, 34, 26, 214);
    graphics.strokeColor = new Color(244, 176, 113, 240);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 16);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 244, 221, 30);
    graphics.roundRect(-width / 2 + 10, height / 2 - 16, width - 20, 5, 3);
    graphics.fill();
    title.color = new Color(255, 238, 214, 255);
    meta.color = new Color(255, 221, 188, 224);
    badge.color = new Color(69, 34, 17, 255);
    this.styleBadgeNode(badge.node, new Color(245, 184, 116, 236));
  }

  private stylePhaseTracker(
    node: Node,
    title: Label,
    meta: Label,
    markers: Array<{ label: string; thresholdPercent: number; active: boolean; reached: boolean }>
  ): void {
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const width = transform.width;
    const height = transform.height;
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(34, 42, 58, 152);
    graphics.strokeColor = new Color(143, 166, 196, 136);
    graphics.lineWidth = 1.5;
    graphics.roundRect(-width / 2, -height / 2, width, height, 12);
    graphics.fill();
    graphics.stroke();
    const stripY = height / 2 - 22;
    graphics.fillColor = new Color(73, 87, 110, 168);
    graphics.roundRect(-width / 2 + 12, stripY - 4, width - 24, 8, 4);
    graphics.fill();
    const stripWidth = width - 24;
    markers.forEach((marker) => {
      const markerX = -width / 2 + 12 + stripWidth * (1 - marker.thresholdPercent / 100);
      graphics.fillColor = marker.active
        ? new Color(240, 188, 109, 255)
        : marker.reached
          ? new Color(173, 206, 235, 224)
          : new Color(103, 115, 136, 192);
      graphics.roundRect(markerX - 2, stripY - 7, 4, 14, 2);
      graphics.fill();
    });
    title.color = new Color(232, 239, 247, 255);
    meta.color = new Color(193, 205, 221, 224);
  }

  private ensureLabelNode(name: string, fontSize: number, lineHeight: number, height: number): Label {
    const existingNode = this.node.getChildByName(name);
    const node = existingNode ?? new Node(name);
    if (!existingNode) {
      node.parent = this.node;
    }
    assignUiLayer(node);

    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, height);
    const label = node.getComponent(Label) ?? node.addComponent(Label);
    label.fontSize = fontSize;
    label.lineHeight = lineHeight;
    label.horizontalAlign = H_ALIGN_LEFT;
    label.verticalAlign = V_ALIGN_TOP;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.enableWrapText = true;
    label.string = "";
    return label;
  }

  private ensureTargetNode(unitId: string): { node: Node; title: Label; meta: Label; badge: Label; visuals: BattleUnitVisualNodes } {
    const existing = this.targetNodes.get(unitId);
    if (existing) {
      return existing;
    }

    const node = new Node(`${TARGET_NODE_PREFIX}-${unitId}`);
    node.parent = this.node;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, 54);

    const titleNode = new Node(`${node.name}-title`);
    titleNode.parent = node;
    assignUiLayer(titleNode);
    const titleTransform = titleNode.getComponent(UITransform) ?? titleNode.addComponent(UITransform);
    titleTransform.setContentSize(UNIT_TEXT_WIDTH, 18);
    titleNode.setPosition(UNIT_TEXT_CENTER_X, 10, 1);
    const title = titleNode.getComponent(Label) ?? titleNode.addComponent(Label);
    title.fontSize = 13;
    title.lineHeight = 16;
    title.horizontalAlign = H_ALIGN_LEFT;
    title.verticalAlign = V_ALIGN_CENTER;
    title.overflow = OVERFLOW_RESIZE_HEIGHT;
    title.enableWrapText = false;
    title.string = "";

    const metaNode = new Node(`${node.name}-meta`);
    metaNode.parent = node;
    assignUiLayer(metaNode);
    const metaTransform = metaNode.getComponent(UITransform) ?? metaNode.addComponent(UITransform);
    metaTransform.setContentSize(UNIT_TEXT_WIDTH, 16);
    metaNode.setPosition(UNIT_TEXT_CENTER_X, -12, 1);
    const meta = metaNode.getComponent(Label) ?? metaNode.addComponent(Label);
    meta.fontSize = 11;
    meta.lineHeight = 14;
    meta.horizontalAlign = H_ALIGN_LEFT;
    meta.verticalAlign = V_ALIGN_CENTER;
    meta.overflow = OVERFLOW_RESIZE_HEIGHT;
    meta.enableWrapText = false;
    meta.string = "";

    const badgeNode = new Node(`${node.name}-badge`);
    badgeNode.parent = node;
    assignUiLayer(badgeNode);
    const badgeTransform = badgeNode.getComponent(UITransform) ?? badgeNode.addComponent(UITransform);
    badgeTransform.setContentSize(58, 18);
    badgeNode.setPosition(PANEL_CONTENT_WIDTH / 2 - 44, 0, 1);
    const badge = badgeNode.getComponent(Label) ?? badgeNode.addComponent(Label);
    badge.fontSize = 10;
    badge.lineHeight = 12;
    badge.horizontalAlign = H_ALIGN_CENTER;
    badge.verticalAlign = V_ALIGN_CENTER;
    badge.overflow = OVERFLOW_RESIZE_HEIGHT;
    badge.enableWrapText = false;
    badge.string = "";
    node.on(
      Node.EventType.TOUCH_END,
      () => {
        if (unitId !== "empty") {
          this.onSelectTarget?.(unitId);
        }
      },
      this
    );

    const visuals = this.createUnitVisualNodes(node, `${node.name}-visual`);
    const created = { node, title, meta, badge, visuals };
    this.targetNodes.set(unitId, created);
    return created;
  }

  private ensureActionNode(key: string): { node: Node; title: Label; meta: Label } {
    const existing = this.actionNodes.get(key);
    if (existing) {
      return existing;
    }

    const node = new Node(`${ACTION_NODE_PREFIX}-${key}`);
    node.parent = this.node;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, 48);

    const titleNode = new Node(`${node.name}-title`);
    titleNode.parent = node;
    assignUiLayer(titleNode);
    const titleTransform = titleNode.getComponent(UITransform) ?? titleNode.addComponent(UITransform);
    titleTransform.setContentSize(PANEL_CONTENT_WIDTH - 40, 18);
    titleNode.setPosition(0, 10, 1);
    const title = titleNode.getComponent(Label) ?? titleNode.addComponent(Label);
    title.fontSize = 13;
    title.lineHeight = 16;
    title.horizontalAlign = H_ALIGN_CENTER;
    title.verticalAlign = V_ALIGN_CENTER;
    title.overflow = OVERFLOW_RESIZE_HEIGHT;
    title.enableWrapText = false;
    title.string = "";

    const metaNode = new Node(`${node.name}-meta`);
    metaNode.parent = node;
    assignUiLayer(metaNode);
    const metaTransform = metaNode.getComponent(UITransform) ?? metaNode.addComponent(UITransform);
    metaTransform.setContentSize(PANEL_CONTENT_WIDTH - 48, 14);
    metaNode.setPosition(0, -11, 1);
    const meta = metaNode.getComponent(Label) ?? metaNode.addComponent(Label);
    meta.fontSize = 10;
    meta.lineHeight = 12;
    meta.horizontalAlign = H_ALIGN_CENTER;
    meta.verticalAlign = V_ALIGN_CENTER;
    meta.overflow = OVERFLOW_RESIZE_HEIGHT;
    meta.enableWrapText = false;
    meta.string = "";

    const created = { node, title, meta };
    this.actionNodes.set(key, created);
    return created;
  }

  private ensureOrderItemNode(id: string): { node: Node; title: Label; meta: Label; badge: Label; visuals: BattleUnitVisualNodes } {
    const existing = this.orderItemNodes.get(id);
    if (existing) {
      return existing;
    }

    const created = this.createRosterNode(`${ORDER_ITEM_PREFIX}-${id}`);
    this.orderItemNodes.set(id, created);
    return created;
  }

  private ensureFriendlyItemNode(id: string): { node: Node; title: Label; meta: Label; badge: Label; visuals: BattleUnitVisualNodes } {
    const existing = this.friendlyItemNodes.get(id);
    if (existing) {
      return existing;
    }

    const created = this.createRosterNode(`${FRIENDLY_ITEM_PREFIX}-${id}`);
    this.friendlyItemNodes.set(id, created);
    return created;
  }

  private createRosterNode(name: string): { node: Node; title: Label; meta: Label; badge: Label; visuals: BattleUnitVisualNodes } {
    const node = new Node(name);
    node.parent = this.node;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, 50);

    const titleNode = new Node(`${name}-title`);
    titleNode.parent = node;
    assignUiLayer(titleNode);
    const titleTransform = titleNode.getComponent(UITransform) ?? titleNode.addComponent(UITransform);
    titleTransform.setContentSize(UNIT_TEXT_WIDTH, 18);
    titleNode.setPosition(UNIT_TEXT_CENTER_X, 10, 1);
    const title = titleNode.getComponent(Label) ?? titleNode.addComponent(Label);
    title.fontSize = 13;
    title.lineHeight = 16;
    title.horizontalAlign = H_ALIGN_LEFT;
    title.verticalAlign = V_ALIGN_CENTER;
    title.overflow = OVERFLOW_RESIZE_HEIGHT;
    title.enableWrapText = false;
    title.string = "";

    const metaNode = new Node(`${name}-meta`);
    metaNode.parent = node;
    assignUiLayer(metaNode);
    const metaTransform = metaNode.getComponent(UITransform) ?? metaNode.addComponent(UITransform);
    metaTransform.setContentSize(UNIT_TEXT_WIDTH, 16);
    metaNode.setPosition(UNIT_TEXT_CENTER_X, -12, 1);
    const meta = metaNode.getComponent(Label) ?? metaNode.addComponent(Label);
    meta.fontSize = 11;
    meta.lineHeight = 14;
    meta.horizontalAlign = H_ALIGN_LEFT;
    meta.verticalAlign = V_ALIGN_CENTER;
    meta.overflow = OVERFLOW_RESIZE_HEIGHT;
    meta.enableWrapText = false;
    meta.string = "";

    const badgeNode = new Node(`${name}-badge`);
    badgeNode.parent = node;
    assignUiLayer(badgeNode);
    const badgeTransform = badgeNode.getComponent(UITransform) ?? badgeNode.addComponent(UITransform);
    badgeTransform.setContentSize(58, 18);
    badgeNode.setPosition(PANEL_CONTENT_WIDTH / 2 - 44, 0, 1);
    const badge = badgeNode.getComponent(Label) ?? badgeNode.addComponent(Label);
    badge.fontSize = 10;
    badge.lineHeight = 12;
    badge.horizontalAlign = H_ALIGN_CENTER;
    badge.verticalAlign = V_ALIGN_CENTER;
    badge.overflow = OVERFLOW_RESIZE_HEIGHT;
    badge.enableWrapText = false;
    badge.string = "";

    const visuals = this.createUnitVisualNodes(node, `${name}-visual`);
    return { node, title, meta, badge, visuals };
  }

  private createUnitVisualNodes(parent: Node, prefix: string): BattleUnitVisualNodes {
    const portraitNode = new Node(`${prefix}-portrait`);
    portraitNode.parent = parent;
    assignUiLayer(portraitNode);
    const portraitTransform = portraitNode.getComponent(UITransform) ?? portraitNode.addComponent(UITransform);
    portraitTransform.setContentSize(UNIT_ART_SIZE, UNIT_ART_SIZE);
    portraitNode.setPosition(UNIT_ART_CENTER_X, 0, 1);
    const portraitSprite = portraitNode.getComponent(Sprite) ?? portraitNode.addComponent(Sprite);
    const portraitOpacity = portraitNode.getComponent(UIOpacity) ?? portraitNode.addComponent(UIOpacity);

    const frameNode = new Node(`${prefix}-frame`);
    frameNode.parent = parent;
    assignUiLayer(frameNode);
    const frameTransform = frameNode.getComponent(UITransform) ?? frameNode.addComponent(UITransform);
    frameTransform.setContentSize(UNIT_FRAME_SIZE, UNIT_FRAME_SIZE);
    frameNode.setPosition(UNIT_ART_CENTER_X, 0, 1.1);
    const frameSprite = frameNode.getComponent(Sprite) ?? frameNode.addComponent(Sprite);
    const frameOpacity = frameNode.getComponent(UIOpacity) ?? frameNode.addComponent(UIOpacity);

    const factionNode = this.createUnitBadgeSpriteNode(parent, `${prefix}-faction`, UNIT_ART_CENTER_X - 11, 11);
    const rarityNode = this.createUnitBadgeSpriteNode(parent, `${prefix}-rarity`, UNIT_ART_CENTER_X + 11, 11);
    const interactionNode = this.createUnitBadgeSpriteNode(parent, `${prefix}-interaction`, UNIT_ART_CENTER_X + 11, -11);

    return {
      portraitNode,
      portraitSprite,
      portraitOpacity,
      frameNode,
      frameSprite,
      frameOpacity,
      factionNode: factionNode.node,
      factionSprite: factionNode.sprite,
      factionOpacity: factionNode.opacity,
      rarityNode: rarityNode.node,
      raritySprite: rarityNode.sprite,
      rarityOpacity: rarityNode.opacity,
      interactionNode: interactionNode.node,
      interactionSprite: interactionNode.sprite,
      interactionOpacity: interactionNode.opacity
    };
  }

  private createUnitBadgeSpriteNode(
    parent: Node,
    name: string,
    x: number,
    y: number
  ): { node: Node; sprite: Sprite; opacity: UIOpacity } {
    const node = new Node(name);
    node.parent = parent;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(UNIT_BADGE_SIZE, UNIT_BADGE_SIZE);
    node.setPosition(x, y, 1.2);
    const sprite = node.getComponent(Sprite) ?? node.addComponent(Sprite);
    const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    return { node, sprite, opacity };
  }

  private syncUnitVisualNodes(
    visuals: BattleUnitVisualNodes,
    unitId: string,
    options: {
      selected: boolean;
      active: boolean;
    }
  ): void {
    const unit = unitId === "empty" ? null : this.currentState?.update?.battle?.units[unitId] ?? null;
    const assets = getPixelSpriteAssets();
    if (!unit || !assets) {
      this.setVisualNodeFrame(visuals.portraitNode, visuals.portraitSprite, visuals.portraitOpacity, null, 0);
      this.setVisualNodeFrame(visuals.frameNode, visuals.frameSprite, visuals.frameOpacity, null, 0);
      this.setVisualNodeFrame(visuals.factionNode, visuals.factionSprite, visuals.factionOpacity, null, 0);
      this.setVisualNodeFrame(visuals.rarityNode, visuals.raritySprite, visuals.rarityOpacity, null, 0);
      this.setVisualNodeFrame(visuals.interactionNode, visuals.interactionSprite, visuals.interactionOpacity, null, 0);
      return;
    }

    const descriptor = resolveBattlePanelUnitVisual(unit.templateId, {
      selected: options.selected,
      active: options.active,
      damaged: unit.currentHp < unit.maxHp
    });
    const unitSprites = assets.units[descriptor.templateId];
    this.setVisualNodeFrame(
      visuals.portraitNode,
      visuals.portraitSprite,
      visuals.portraitOpacity,
      unitSprites?.[descriptor.portraitState] ?? null,
      255
    );
    this.setVisualNodeFrame(visuals.frameNode, visuals.frameSprite, visuals.frameOpacity, unitSprites?.frame ?? null, 255);
    this.setVisualNodeFrame(
      visuals.factionNode,
      visuals.factionSprite,
      visuals.factionOpacity,
      descriptor.faction ? assets.badges.factions[descriptor.faction] ?? null : null,
      255
    );
    this.setVisualNodeFrame(
      visuals.rarityNode,
      visuals.raritySprite,
      visuals.rarityOpacity,
      assets.badges.rarities[descriptor.rarity] ?? null,
      255
    );
    this.setVisualNodeFrame(
      visuals.interactionNode,
      visuals.interactionSprite,
      visuals.interactionOpacity,
      assets.badges.interactions[descriptor.interaction] ?? null,
      255
    );
  }

  private setVisualNodeFrame(
    node: Node,
    sprite: Sprite,
    opacity: UIOpacity,
    frame: Sprite["spriteFrame"],
    alpha: number
  ): void {
    node.active = Boolean(frame);
    if (!frame) {
      sprite.spriteFrame = null;
      opacity.opacity = 0;
      return;
    }
    sprite.spriteFrame = frame;
    opacity.opacity = alpha;
  }

  private renderSectionCard(name: string, centerY: number, height: number, fillColor: Color = new Color(33, 46, 66, 138)): void {
    const nodeName = `${SECTION_CARD_PREFIX}-${name}`;
    let node = this.node.getChildByName(nodeName);
    if (!node) {
      node = new Node(nodeName);
      node.parent = this.node;
    }
    assignUiLayer(node);
    node.active = true;
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, height);
    node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, centerY, 0.2);
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = fillColor;
    graphics.strokeColor = new Color(226, 236, 248, 40);
    graphics.lineWidth = 2;
    graphics.roundRect(-PANEL_CONTENT_WIDTH / 2, -height / 2, PANEL_CONTENT_WIDTH, height, 14);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 14);
    graphics.roundRect(-PANEL_CONTENT_WIDTH / 2 + 10, height / 2 - 16, PANEL_CONTENT_WIDTH - 20, 6, 4);
    graphics.fill();
    graphics.fillColor = accentForSection(name);
    graphics.roundRect(-PANEL_CONTENT_WIDTH / 2 + 12, height / 2 - 14, Math.min(84, PANEL_CONTENT_WIDTH * 0.34), 3, 2);
    graphics.fill();
    if (name === "IdleTips") {
      graphics.fillColor = new Color(255, 255, 255, 12);
      graphics.roundRect(-PANEL_CONTENT_WIDTH / 2 + 12, 0, 5, height - 30, 3);
      graphics.fill();
      for (let index = 0; index < 3; index += 1) {
        const bulletY = height / 2 - 34 - index * 18;
        graphics.fillColor = new Color(235, 163, 128, 164);
        graphics.circle(-PANEL_CONTENT_WIDTH / 2 + 22, bulletY, 2.5);
        graphics.fill();
      }
    }
  }

  private syncIdleBadge(active: boolean, centerY: number, text: string): void {
    if (!this.idleBadgeLabel) {
      return;
    }

    this.idleBadgeLabel.node.active = active;
    if (!active) {
      this.idleBadgeLabel.string = "";
      return;
    }

    const label = this.idleBadgeLabel;
    label.string = text;
    label.fontSize = 11;
    label.lineHeight = 14;
    label.horizontalAlign = H_ALIGN_LEFT;
    label.verticalAlign = V_ALIGN_CENTER;
    label.enableWrapText = false;

    const transform = label.node.getComponent(UITransform) ?? label.node.addComponent(UITransform);
    transform.setContentSize(64, 18);
    label.node.setPosition(PANEL_WIDTH / 2 - PANEL_PADDING - 40, centerY, 1);

    const graphics = this.ensureBadgeBackgroundGraphics(label.node);
    graphics.clear();
    graphics.fillColor = new Color(210, 117, 88, 38);
    graphics.strokeColor = new Color(233, 181, 142, 126);
    graphics.lineWidth = 2;
    graphics.roundRect(-32, -9, 64, 18, 9);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 18);
    graphics.roundRect(-24, 2, 48, 4, 3);
    graphics.fill();
  }

  private ensureBadgeBackgroundGraphics(node: Node): Graphics {
    const legacyGraphics = node.getComponent(Graphics);
    if (legacyGraphics) {
      node.removeComponent(legacyGraphics);
    }

    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const backgroundNodeName = `${node.name}${BADGE_BACKGROUND_SUFFIX}`;
    let backgroundNode = node.getChildByName(backgroundNodeName);
    if (!backgroundNode) {
      backgroundNode = new Node(backgroundNodeName);
      backgroundNode.parent = node;
    }
    assignUiLayer(backgroundNode);
    backgroundNode.setPosition(0, 0, -0.1);
    const backgroundTransform = backgroundNode.getComponent(UITransform) ?? backgroundNode.addComponent(UITransform);
    backgroundTransform.setContentSize(transform.width, transform.height);
    return backgroundNode.getComponent(Graphics) ?? backgroundNode.addComponent(Graphics);
  }

  private styleTargetNode(node: Node, title: Label, meta: Label, badge: Label, selected: boolean, selectable: boolean): void {
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const width = transform.width;
    const height = transform.height;
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = selected
      ? new Color(83, 101, 142, 168)
      : selectable
        ? new Color(33, 45, 64, 156)
        : new Color(30, 40, 57, 122);
    graphics.strokeColor = selected
      ? new Color(238, 225, 175, 156)
      : new Color(221, 233, 247, 58);
    graphics.lineWidth = selected ? 3 : 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 12);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, selected ? 20 : 10);
    graphics.roundRect(-width / 2 + 10, height / 2 - 14, width - 20, 5, 3);
    graphics.fill();
    graphics.fillColor = selected ? new Color(245, 217, 146, 206) : new Color(117, 139, 188, selectable ? 112 : 48);
    graphics.roundRect(-width / 2 + 10, height / 2 - 19, 5, height - 20, 3);
    graphics.fill();
    title.color = selected ? new Color(250, 246, 226, 255) : new Color(236, 243, 250, selectable ? 255 : 170);
    meta.color = selected ? new Color(236, 222, 188, 255) : new Color(198, 210, 225, selectable ? 220 : 132);
    badge.color = selected ? new Color(76, 51, 22, 255) : new Color(233, 240, 248, selectable ? 220 : 128);
    this.styleBadgeNode(badge.node, selected ? new Color(240, 209, 132, 255) : new Color(82, 98, 136, selectable ? 186 : 90));
  }

  private styleActionNode(node: Node, title: Label, meta: Label, action: BattlePanelActionView): void {
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const width = transform.width;
    const height = transform.height;
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    const accent =
      action.key === "attack"
        ? new Color(194, 102, 83, 236)
        : action.key === "wait"
          ? new Color(117, 139, 188, 236)
          : new Color(102, 162, 124, 236);
    graphics.clear();
    graphics.fillColor = action.enabled
      ? new Color(accent.r, accent.g, accent.b, 52)
      : new Color(38, 49, 68, 132);
    graphics.strokeColor = action.enabled
      ? new Color(accent.r, accent.g, accent.b, 160)
      : new Color(221, 232, 244, 54);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 12);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, action.enabled ? 18 : 10);
    graphics.roundRect(-width / 2 + 12, height / 2 - 16, width - 24, 5, 3);
    graphics.fill();
    graphics.fillColor = action.enabled ? new Color(accent.r, accent.g, accent.b, 126) : new Color(74, 86, 110, 82);
    graphics.roundRect(-width / 2 + 12, height / 2 - 18, width - 24, 4, 3);
    graphics.fill();
    title.color = action.enabled ? new Color(246, 249, 252, 255) : new Color(201, 211, 223, 140);
    meta.color = action.enabled ? new Color(224, 232, 240, 210) : new Color(182, 192, 208, 104);
  }

  private styleBadgeNode(node: Node, fillColor: Color): void {
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const width = transform.width;
    const height = transform.height;
    const graphics = this.ensureBadgeBackgroundGraphics(node);
    graphics.clear();
    graphics.fillColor = fillColor;
    graphics.strokeColor = new Color(245, 247, 250, 70);
    graphics.lineWidth = 1.5;
    graphics.roundRect(-width / 2, -height / 2, width, height, 8);
    graphics.fill();
    graphics.stroke();
  }

  private styleRosterNode(
    node: Node,
    title: Label,
    meta: Label,
    badge: Label,
    active: boolean,
    badgeFill: Color
  ): void {
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const width = transform.width;
    const height = transform.height;
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = active ? new Color(71, 87, 122, 166) : new Color(32, 44, 63, 150);
    graphics.strokeColor = active ? new Color(243, 219, 155, 148) : new Color(221, 233, 247, 50);
    graphics.lineWidth = active ? 3 : 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 12);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, active ? 18 : 10);
    graphics.roundRect(-width / 2 + 10, height / 2 - 14, width - 20, 5, 3);
    graphics.fill();
    graphics.fillColor = active ? new Color(238, 195, 116, 178) : new Color(108, 129, 170, 112);
    graphics.roundRect(-width / 2 + 10, height / 2 - 18, 5, height - 20, 3);
    graphics.fill();
    title.color = active ? new Color(250, 246, 226, 255) : new Color(236, 243, 250, 244);
    meta.color = active ? new Color(236, 222, 188, 255) : new Color(194, 207, 224, 214);
    badge.color = active ? new Color(61, 44, 20, 255) : new Color(236, 241, 248, 224);
    this.styleBadgeNode(badge.node, badgeFill);
  }
}

export type { BattleCamp };

function badgeAccentForFriendly(badge: string): Color {
  if (badge === "防御") {
    return new Color(100, 160, 124, 196);
  }
  if (badge === "已反击") {
    return new Color(188, 115, 98, 204);
  }
  return new Color(102, 126, 166, 176);
}

function accentForTerrain(terrain: BattlePanelStageView["terrain"]): Color {
  if (terrain === "grass") {
    return new Color(118, 178, 122, 255);
  }
  if (terrain === "dirt") {
    return new Color(182, 132, 92, 255);
  }
  if (terrain === "sand") {
    return new Color(217, 188, 120, 255);
  }
  if (terrain === "water") {
    return new Color(103, 158, 214, 255);
  }
  return new Color(168, 170, 184, 255);
}

function accentForSection(name: string): Color {
  if (name.includes("Idle")) {
    return new Color(210, 117, 88, 156);
  }
  if (name.includes("Targets")) {
    return new Color(223, 191, 128, 144);
  }
  if (name.includes("Actions")) {
    return new Color(133, 170, 224, 144);
  }
  if (name.includes("Friendly")) {
    return new Color(119, 170, 129, 144);
  }
  if (name.includes("Order")) {
    return new Color(181, 151, 97, 144);
  }
  return new Color(235, 163, 128, 132);
}

function fillColorForFeedbackTone(tone: CocosBattleFeedbackTone): Color {
  if (tone === "victory") {
    return new Color(74, 108, 72, 168);
  }
  if (tone === "defeat") {
    return new Color(112, 58, 58, 170);
  }
  if (tone === "skill") {
    return new Color(66, 76, 120, 168);
  }
  if (tone === "hit") {
    return new Color(111, 76, 62, 170);
  }
  if (tone === "action") {
    return new Color(74, 88, 110, 162);
  }
  return new Color(54, 64, 84, 154);
}
