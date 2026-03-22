import { _decorator, Color, Component, Graphics, Label, Node, Sprite, UIOpacity, UITransform } from "cc";
import { getPlaceholderSpriteAssets, loadPlaceholderSpriteAssets } from "./cocos-placeholder-sprites.ts";
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

  render(state: VeilTimelinePanelState): void {
    this.currentState = state;
    this.cleanupLegacyNodes();
    this.syncChrome();
    this.syncHeaderIcon();
    const label = this.ensureLabel();
    const lines = ["时间线"];
    this.syncWatermark(state.entries.length === 0);

    if (state.entries.length === 0) {
      lines.push("等待房间动态...");
      label.string = lines.join("\n");
      return;
    }

    lines.push(...state.entries.slice(0, 5).map((entry) => `• ${entry}`));
    label.string = lines.join("\n");
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

    const frame = getPlaceholderSpriteAssets()?.icons.timeline ?? null;
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
    const frame = getPlaceholderSpriteAssets()?.icons.timeline ?? null;
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
      if (!allowedNames.has(child.name)) {
        child.destroy();
      }
    }
  }
}
