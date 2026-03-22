import { _decorator, Color, Component, Graphics, Label, Node, Sprite, UIOpacity, UITransform } from "cc";
import {
  buildBattlePanelViewModel,
  type BattlePanelActionView,
  type BattlePanelInput,
  type BattleCamp
} from "./cocos-battle-panel-model.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";
import type { BattleAction } from "./VeilCocosSession.ts";
import { getPlaceholderSpriteAssets, loadPlaceholderSpriteAssets } from "./cocos-placeholder-sprites.ts";

const { ccclass } = _decorator;

const PANEL_WIDTH = 280;
const PANEL_PADDING = 16;
const PANEL_CONTENT_WIDTH = PANEL_WIDTH - PANEL_PADDING * 2;
const H_ALIGN_LEFT = 0;
const V_ALIGN_TOP = 0;
const V_ALIGN_CENTER = 1;
const OVERFLOW_RESIZE_HEIGHT = 3;
const PANEL_BG = new Color(16, 22, 33, 198);
const PANEL_BORDER = new Color(231, 240, 248, 78);
const PANEL_INNER = new Color(43, 56, 77, 84);
const PANEL_ACCENT = new Color(210, 117, 88, 255);
const PANEL_ACCENT_SOFT = new Color(235, 163, 128, 96);
const TARGET_NODE_PREFIX = "BattleTarget";
const ACTION_NODE_PREFIX = "BattleAction";
const TITLE_NODE_NAME = "BattleTitle";
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

export interface VeilBattlePanelState extends BattlePanelInput {}

export interface VeilBattlePanelOptions {
  onSelectTarget?: (unitId: string) => void;
  onAction?: (action: BattleAction) => void;
}

@ccclass("ProjectVeilBattlePanel")
export class VeilBattlePanel extends Component {
  private titleLabel: Label | null = null;
  private summaryLabel: Label | null = null;
  private orderLabel: Label | null = null;
  private friendlyLabel: Label | null = null;
  private enemyHeaderLabel: Label | null = null;
  private actionHeaderLabel: Label | null = null;
  private idleHintLabel: Label | null = null;
  private idleBadgeLabel: Label | null = null;
  private readonly targetNodes = new Map<string, { node: Node; label: Label }>();
  private readonly actionNodes = new Map<string, { node: Node; label: Label }>();
  private headerIconSprite: Sprite | null = null;
  private headerIconOpacity: UIOpacity | null = null;
  private currentState: VeilBattlePanelState | null = null;
  private requestedIcons = false;
  private onSelectTarget: ((unitId: string) => void) | undefined;
  private onAction: ((action: BattleAction) => void) | undefined;

  configure(options: VeilBattlePanelOptions): void {
    assignUiLayer(this.node);
    this.onSelectTarget = options.onSelectTarget;
    this.onAction = options.onAction;
  }

  render(state: VeilBattlePanelState): void {
    this.currentState = state;
    this.cleanupLegacyNodes();
    this.syncHeaderIcon();
    const model = buildBattlePanelViewModel(state);
    this.syncChrome();
    this.ensureSectionLabels();
    this.syncWatermark(model.idle);
    this.clearSectionCards();

    const panelHeight = this.node.getComponent(UITransform)?.height ?? 320;
    let cursorY = panelHeight / 2 - 44;
    cursorY = this.renderTextBlock(this.titleLabel, [model.title], cursorY, 16, 20, 12);

    if (model.idle) {
      this.hideSection(this.summaryLabel);
      this.syncIdleBadge(true, panelHeight / 2 - 76, "遭遇待命");
      cursorY = this.renderTextBlock(
        this.idleHintLabel,
        ["当前没有战斗。", "", "继续探索地图", "即可触发战斗"],
        cursorY - 6,
        14,
        19,
        0
      );
      const idleHeight = Math.max(128, panelHeight / 2 - cursorY + 28);
      this.renderSectionCard("Idle", cursorY + idleHeight / 2 - 10, idleHeight, new Color(41, 52, 72, 138));
      this.hideSection(this.orderLabel);
      this.hideSection(this.friendlyLabel);
      this.hideSection(this.enemyHeaderLabel);
      this.hideSection(this.actionHeaderLabel);
      this.hideTargetNodes();
      this.hideActionNodes();
      return;
    }

    this.syncIdleBadge(false, 0, "");
    cursorY = this.renderCardTextBlock(this.summaryLabel, "Summary", model.summaryLines, cursorY, 14, 18, 14);
    cursorY = this.renderCardTextBlock(this.orderLabel, "Order", model.orderLines, cursorY, 14, 18, 12);
    cursorY = this.renderCardTextBlock(this.friendlyLabel, "Friendly", model.friendlyLines, cursorY, 14, 18, 12);
    cursorY = this.renderTextBlock(this.enemyHeaderLabel, ["目标选择"], cursorY, 14, 18, 6);
    cursorY = this.renderTargetNodes(model.enemyTargets, cursorY);
    cursorY = this.renderTextBlock(this.actionHeaderLabel, ["战斗指令"], cursorY, 14, 18, 6);
    this.hideSection(this.idleHintLabel);
    this.renderActionNodes(model.actions, cursorY);
  }

  private cleanupLegacyNodes(): void {
    const allowedNames = new Set<string>([
      TITLE_NODE_NAME,
      SUMMARY_NODE_NAME,
      ORDER_NODE_NAME,
      FRIENDLY_NODE_NAME,
      ENEMY_HEADER_NODE_NAME,
      ACTION_HEADER_NODE_NAME,
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
    this.summaryLabel = this.ensureLabelNode(SUMMARY_NODE_NAME, 15, 19, 88);
    this.orderLabel = this.ensureLabelNode(ORDER_NODE_NAME, 14, 18, 88);
    this.friendlyLabel = this.ensureLabelNode(FRIENDLY_NODE_NAME, 14, 18, 72);
    this.enemyHeaderLabel = this.ensureLabelNode(ENEMY_HEADER_NODE_NAME, 14, 18, 18);
    this.actionHeaderLabel = this.ensureLabelNode(ACTION_HEADER_NODE_NAME, 14, 18, 18);
    this.idleHintLabel = this.ensureLabelNode(IDLE_HINT_NODE_NAME, 13, 18, 40);
    this.idleBadgeLabel = this.ensureLabelNode(IDLE_BADGE_NODE_NAME, 11, 14, 16);
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
    bottomGap: number
  ): number {
    const nextY = this.renderTextBlock(label, lines, topY, fontSize, lineHeight, bottomGap);
    if (!label) {
      return nextY;
    }

    const transform = label.node.getComponent(UITransform) ?? label.node.addComponent(UITransform);
    this.renderSectionCard(cardName, label.node.position.y, transform.height + 22);
    return nextY;
  }

  private renderTargetNodes(
    targets: Array<{
      id: string;
      label: string;
      selected: boolean;
      selectable: boolean;
    }>,
    topY: number
  ): number {
    const rowHeight = 22;
    const gap = 4;
    const used = new Set<string>();
    let cursorY = topY;

    if (targets.length === 0) {
      const emptyTarget = this.ensureTargetNode("empty");
      emptyTarget.node.active = true;
      emptyTarget.label.string = "  暂无敌方目标";
      const transform = emptyTarget.node.getComponent(UITransform) ?? emptyTarget.node.addComponent(UITransform);
      transform.setContentSize(PANEL_CONTENT_WIDTH, rowHeight);
      emptyTarget.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, cursorY - rowHeight / 2, 0);
      used.add("empty");
      cursorY -= rowHeight + gap;
    } else {
      targets.forEach((target) => {
        const targetNode = this.ensureTargetNode(target.id);
        targetNode.node.active = true;
        targetNode.label.string = target.label;
        const transform = targetNode.node.getComponent(UITransform) ?? targetNode.node.addComponent(UITransform);
        transform.setContentSize(PANEL_CONTENT_WIDTH, rowHeight);
        targetNode.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + PANEL_CONTENT_WIDTH / 2, cursorY - rowHeight / 2, 0);
        used.add(target.id);
        cursorY -= rowHeight + gap;
      });
    }

    const contentHeight = Math.max(36, topY - cursorY + 8);
    this.renderSectionCard("Targets", topY - contentHeight / 2 + 10, contentHeight);

    for (const [key, targetNode] of this.targetNodes) {
      if (!used.has(key)) {
        targetNode.node.active = false;
      }
    }

    return cursorY - 8;
  }

  private renderActionNodes(actions: BattlePanelActionView[], topY: number): void {
    const rowHeight = 22;
    const gap = 4;
    const used = new Set<string>();
    let cursorY = topY;

    actions.forEach((entry) => {
      const actionNode = this.ensureActionNode(entry.key);
      actionNode.node.active = true;
      actionNode.label.string = `${entry.enabled ? "[tap]" : "[--]"} ${entry.label}`;
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
      used.add(entry.key);
      cursorY -= rowHeight + gap;
    });

    const contentHeight = Math.max(36, topY - cursorY + 8);
    this.renderSectionCard("Actions", topY - contentHeight / 2 + 10, contentHeight);

    for (const [key, actionNode] of this.actionNodes) {
      if (!used.has(key)) {
        actionNode.node.active = false;
      }
    }
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

    const frame = getPlaceholderSpriteAssets()?.icons.battle ?? null;
    if (!frame) {
      iconNode.active = false;
      if (!this.requestedIcons) {
        this.requestedIcons = true;
        void loadPlaceholderSpriteAssets().then(() => {
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
    const frame = getPlaceholderSpriteAssets()?.icons.battle ?? null;

    if (!frame) {
      watermarkNode.active = false;
      return;
    }

    watermarkNode.active = idle;
    watermarkSprite.spriteFrame = frame;
    watermarkOpacity.opacity = idle ? 18 : 0;
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

  private ensureTargetNode(unitId: string): { node: Node; label: Label } {
    const existing = this.targetNodes.get(unitId);
    if (existing) {
      return existing;
    }

    const node = new Node(`${TARGET_NODE_PREFIX}-${unitId}`);
    node.parent = this.node;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, 22);
    const label = node.getComponent(Label) ?? node.addComponent(Label);
    label.fontSize = 14;
    label.lineHeight = 18;
    label.horizontalAlign = H_ALIGN_LEFT;
    label.verticalAlign = V_ALIGN_CENTER;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.enableWrapText = true;
    label.string = "";
    node.on(
      Node.EventType.TOUCH_END,
      () => {
        if (unitId !== "empty") {
          this.onSelectTarget?.(unitId);
        }
      },
      this
    );

    const created = { node, label };
    this.targetNodes.set(unitId, created);
    return created;
  }

  private ensureActionNode(key: string): { node: Node; label: Label } {
    const existing = this.actionNodes.get(key);
    if (existing) {
      return existing;
    }

    const node = new Node(`${ACTION_NODE_PREFIX}-${key}`);
    node.parent = this.node;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(PANEL_CONTENT_WIDTH, 22);
    const label = node.getComponent(Label) ?? node.addComponent(Label);
    label.fontSize = 14;
    label.lineHeight = 18;
    label.horizontalAlign = H_ALIGN_LEFT;
    label.verticalAlign = V_ALIGN_CENTER;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.enableWrapText = true;
    label.string = "";

    const created = { node, label };
    this.actionNodes.set(key, created);
    return created;
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
    transform.setContentSize(96, 18);
    label.node.setPosition(-PANEL_WIDTH / 2 + PANEL_PADDING + 54, centerY, 1);

    const graphics = label.node.getComponent(Graphics) ?? label.node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(210, 117, 88, 38);
    graphics.strokeColor = new Color(233, 181, 142, 126);
    graphics.lineWidth = 2;
    graphics.roundRect(-48, -9, 96, 18, 9);
    graphics.fill();
    graphics.stroke();
  }
}

export type { BattleCamp };
