import { _decorator, Color, Component, Graphics, Label, Node, Sprite, UIOpacity, UITransform } from "cc";
import { getPixelSpriteAssets, loadPixelSpriteAssets } from "./cocos-pixel-sprites.ts";
import {
  getPlaceholderSpriteAssets,
  loadPlaceholderSpriteAssets,
  releasePlaceholderSpriteAssets,
  retainPlaceholderSpriteAssets
} from "./cocos-placeholder-sprites.ts";
import {
  buildTimelinePanelView,
  type TimelineEntryView
} from "./cocos-timeline-panel-model.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";

const { ccclass } = _decorator;
const H_ALIGN_LEFT = 0;
const V_ALIGN_TOP = 0;
const OVERFLOW_RESIZE_HEIGHT = 3;
const PANEL_BG = new Color(16, 22, 33, 198);
const PANEL_BORDER = new Color(231, 240, 248, 78);
const PANEL_INNER = new Color(43, 56, 77, 84);
const PANEL_ACCENT = new Color(118, 174, 215, 255);
const PANEL_ACCENT_SOFT = new Color(186, 223, 247, 92);
const CONTENT_NODE_NAME = "TimelineContent";
const HEADER_ICON_NODE_NAME = "TimelineHeaderIcon";
const WATERMARK_NODE_NAME = "TimelineWatermark";
const ENTRY_PREFIX = "TimelineEntry";

export interface VeilTimelinePanelState {
  entries: string[];
}

@ccclass("ProjectVeilTimelinePanel")
export class VeilTimelinePanel extends Component {
  private label: Label | null = null;
  private headerIconSprite: Sprite | null = null;
  private headerIconOpacity: UIOpacity | null = null;
  private currentState: VeilTimelinePanelState | null = null;
  private requestedIcons = false;
  private readonly entryNodes = new Map<string, { node: Node; label: Label }>();
  private placeholderAssetsRetained = false;

  render(state: VeilTimelinePanelState): void {
    this.currentState = state;
    const view = buildTimelinePanelView(state.entries);
    this.syncPlaceholderAssets(state.entries.length > 0);
    this.cleanupLegacyNodes();
    this.syncChrome();
    this.syncHeaderIcon();
    const label = this.ensureLabel();
    const lines = [...view.headerLines];
    this.syncWatermark(state.entries.length === 0);

    if (view.empty) {
      this.hideEntryNodes();
      lines.push("等待房间动态...");
      label.string = lines.join("\n");
      return;
    }

    label.string = lines.join("\n");
    this.renderEntries(view.entries);
  }

  onDestroy(): void {
    if (this.placeholderAssetsRetained) {
      releasePlaceholderSpriteAssets("timeline");
      this.placeholderAssetsRetained = false;
    }
  }

  private ensureLabel(): Label {
    let contentNode = this.node.getChildByName(CONTENT_NODE_NAME);
    if (!contentNode) {
      contentNode = new Node(CONTENT_NODE_NAME);
      contentNode.parent = this.node;
    }

    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const contentTransform = contentNode.getComponent(UITransform) ?? contentNode.addComponent(UITransform);
    contentTransform.setContentSize(Math.max(120, transform.width - 40), Math.max(120, transform.height - 40));
    contentNode.setPosition(-transform.width / 2 + contentTransform.width / 2 + 20, transform.height / 2 - contentTransform.height / 2 - 20, 1);

    if (this.label) {
      return this.label;
    }

    const label = contentNode.getComponent(Label) ?? contentNode.addComponent(Label);
    label.fontSize = 16;
    label.lineHeight = 22;
    label.horizontalAlign = H_ALIGN_LEFT;
    label.verticalAlign = V_ALIGN_TOP;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.enableWrapText = true;
    this.label = label;
    return label;
  }

  private syncChrome(): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const graphics = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    const width = transform.width || 280;
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
    graphics.roundRect(-width / 2 + 18, height / 2 - 22, Math.min(104, width * 0.32), 6, 5);
    graphics.fill();
    graphics.fillColor = PANEL_ACCENT_SOFT;
    graphics.roundRect(-width / 2 + 18, height / 2 - 40, Math.min(72, width * 0.2), 5, 4);
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

    const frame = getPixelSpriteAssets()?.icons.timeline ?? null;
    if (!frame) {
      iconNode.active = false;
      if (!this.requestedIcons && this.placeholderAssetsRetained) {
        this.requestedIcons = true;
        void Promise.allSettled([loadPixelSpriteAssets("boot"), loadPlaceholderSpriteAssets("timeline")]).then(() => {
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

  private retainPlaceholderAssets(): void {
    if (this.placeholderAssetsRetained) {
      return;
    }

    this.placeholderAssetsRetained = true;
    void retainPlaceholderSpriteAssets("timeline").catch(() => {
      this.placeholderAssetsRetained = false;
    });
  }

  private syncPlaceholderAssets(enabled: boolean): void {
    if (enabled) {
      this.retainPlaceholderAssets();
      return;
    }

    if (!this.placeholderAssetsRetained) {
      return;
    }

    releasePlaceholderSpriteAssets("timeline");
    this.placeholderAssetsRetained = false;
  }

  private syncWatermark(show: boolean): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    let watermarkNode = this.node.getChildByName(WATERMARK_NODE_NAME);
    if (!watermarkNode) {
      watermarkNode = new Node(WATERMARK_NODE_NAME);
      watermarkNode.parent = this.node;
    }
    assignUiLayer(watermarkNode);
    const watermarkTransform = watermarkNode.getComponent(UITransform) ?? watermarkNode.addComponent(UITransform);
    watermarkTransform.setContentSize(92, 92);
    watermarkNode.setPosition(transform.width / 2 - 68, -36, 0.2);
    const watermarkSprite = watermarkNode.getComponent(Sprite) ?? watermarkNode.addComponent(Sprite);
    const watermarkOpacity = watermarkNode.getComponent(UIOpacity) ?? watermarkNode.addComponent(UIOpacity);
    watermarkNode.active = show;
    if (!show) {
      return;
    }
    const frame = getPixelSpriteAssets()?.icons.timeline ?? null;
    if (!frame) {
      watermarkNode.active = false;
      return;
    }
    watermarkSprite.spriteFrame = frame;
    watermarkOpacity.opacity = 14;
  }

  private cleanupLegacyNodes(): void {
    const allowedNames = new Set<string>([CONTENT_NODE_NAME, HEADER_ICON_NODE_NAME, WATERMARK_NODE_NAME]);
    const childNodes = (this.node as unknown as { children?: Node[] }).children ?? [];
    for (const child of childNodes) {
      if (!allowedNames.has(child.name) && !child.name.startsWith(ENTRY_PREFIX)) {
        child.destroy();
      }
    }
  }

  private renderEntries(entries: TimelineEntryView[]): void {
    const used = new Set<string>();
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const entryWidth = Math.max(124, transform.width - 34);
    const rowHeight = 44;
    const gap = 8;
    let cursorY = transform.height / 2 - 92;

    entries.forEach((view, index) => {
      const key = `${ENTRY_PREFIX}-${index}`;
      const entryNode = this.ensureEntryNode(key);
      const rowTransform = entryNode.node.getComponent(UITransform) ?? entryNode.node.addComponent(UITransform);
      rowTransform.setContentSize(entryWidth, rowHeight);
      entryNode.node.setPosition(-transform.width / 2 + entryWidth / 2 + 20, cursorY - rowHeight / 2, 0.5);
      entryNode.node.active = true;
      entryNode.label.string = view.body;
      this.styleEntryNode(entryNode.node, entryNode.label, view);
      used.add(key);
      cursorY -= rowHeight + gap;
    });

    for (const [key, entryNode] of this.entryNodes) {
      if (!used.has(key)) {
        entryNode.node.active = false;
      }
    }
  }

  private ensureEntryNode(name: string): { node: Node; label: Label } {
    const existing = this.entryNodes.get(name);
    if (existing) {
      return existing;
    }

    const node = new Node(name);
    node.parent = this.node;
    assignUiLayer(node);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(220, 44);

    const labelNode = new Node(`${name}-Label`);
    labelNode.parent = node;
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(180, 30);
    labelNode.setPosition(0, 0, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.fontSize = 11;
    label.lineHeight = 15;
    label.horizontalAlign = H_ALIGN_LEFT;
    label.verticalAlign = V_ALIGN_TOP;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.enableWrapText = true;
    label.string = "";

    const created = { node, label };
    this.entryNodes.set(name, created);
    return created;
  }

  private styleEntryNode(node: Node, label: Label, entry: TimelineEntryView): void {
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    const width = transform.width;
    const height = transform.height;
    const isSystem = entry.tone === "system";
    const accent = isSystem ? new Color(114, 144, 184, 220) : new Color(118, 174, 215, 220);
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(accent.r, accent.g, accent.b, isSystem ? 28 : 36);
    graphics.strokeColor = new Color(accent.r, accent.g, accent.b, isSystem ? 92 : 118);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 12);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 14);
    graphics.roundRect(-width / 2 + 12, height / 2 - 12, width - 24, 4, 3);
    graphics.fill();
    graphics.fillColor = new Color(accent.r, accent.g, accent.b, 148);
    graphics.roundRect(-width / 2 + 12, height / 2 - 16, Math.min(68, width * 0.24), 4, 3);
    graphics.fill();

    let badgeNode = node.getChildByName("Badge");
    if (!badgeNode) {
      badgeNode = new Node("Badge");
      badgeNode.parent = node;
    }
    assignUiLayer(badgeNode);
    const badgeTransform = badgeNode.getComponent(UITransform) ?? badgeNode.addComponent(UITransform);
    badgeTransform.setContentSize(34, 16);
    badgeNode.setPosition(-width / 2 + 28, 0, 1);
    const badgeGraphics = badgeNode.getComponent(Graphics) ?? badgeNode.addComponent(Graphics);
    badgeGraphics.clear();
    badgeGraphics.fillColor = new Color(accent.r, accent.g, accent.b, 148);
    badgeGraphics.strokeColor = new Color(243, 247, 252, 48);
    badgeGraphics.lineWidth = 1.5;
    badgeGraphics.roundRect(-17, -8, 34, 16, 7);
    badgeGraphics.fill();
    badgeGraphics.stroke();

    let badgeLabelNode = badgeNode.getChildByName("Label");
    if (!badgeLabelNode) {
      badgeLabelNode = new Node("Label");
      badgeLabelNode.parent = badgeNode;
    }
    assignUiLayer(badgeLabelNode);
    const badgeLabelTransform = badgeLabelNode.getComponent(UITransform) ?? badgeLabelNode.addComponent(UITransform);
    badgeLabelTransform.setContentSize(30, 12);
    badgeLabelNode.setPosition(0, 0, 1);
    const badgeLabel = badgeLabelNode.getComponent(Label) ?? badgeLabelNode.addComponent(Label);
    badgeLabel.string = entry.badge;
    badgeLabel.fontSize = 9;
    badgeLabel.lineHeight = 10;
    badgeLabel.horizontalAlign = H_ALIGN_LEFT;
    badgeLabel.verticalAlign = V_ALIGN_TOP;
    badgeLabel.overflow = OVERFLOW_RESIZE_HEIGHT;
    badgeLabel.enableWrapText = false;
    badgeLabel.color = new Color(246, 250, 253, 255);

    const labelTransform = label.node.getComponent(UITransform) ?? label.node.addComponent(UITransform);
    labelTransform.setContentSize(width - 62, 30);
    label.node.setPosition(12, 0, 1);
    label.color = new Color(242, 247, 252, 255);
  }

  private hideEntryNodes(): void {
    for (const entryNode of this.entryNodes.values()) {
      entryNode.node.active = false;
    }
  }
}
