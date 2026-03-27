import { _decorator, Color, Component, Graphics, Label, Node, Tween, UIOpacity, UITransform, tween, v3, view } from "cc";
import { assignUiLayer } from "./cocos-ui-layer.ts";
import type { BattleTransitionCopy } from "./cocos-battle-transition-copy.ts";

const { ccclass, property } = _decorator;

const OVERLAY_NODE_NAME = "ProjectVeilBattleOverlay";
const PANEL_NODE_NAME = "ProjectVeilBattleOverlayPanel";
const BADGE_NODE_NAME = "ProjectVeilBattleOverlayBadge";
const TITLE_NODE_NAME = "ProjectVeilBattleOverlayTitle";
const SUBTITLE_NODE_NAME = "ProjectVeilBattleOverlaySubtitle";
const H_ALIGN_CENTER = 1;
const V_ALIGN_MIDDLE = 1;
const V_ALIGN_TOP = 0;

@ccclass("ProjectVeilBattleTransition")
export class VeilBattleTransition extends Component {
  @property
  enterDuration = 0.55;

  @property
  exitDuration = 0.45;

  private overlayNode: Node | null = null;
  private overlayOpacity: UIOpacity | null = null;
  private overlayGraphics: Graphics | null = null;
  private panelNode: Node | null = null;
  private panelGraphics: Graphics | null = null;
  private badgeLabel: Label | null = null;
  private titleLabel: Label | null = null;
  private subtitleLabel: Label | null = null;
  private sequenceToken = 0;

  onLoad(): void {
    this.ensureOverlay();
    if (this.overlayNode) {
      this.overlayNode.active = false;
    }
  }

  async playEnter(copy?: BattleTransitionCopy): Promise<void> {
    await this.runSequence(
      copy ?? {
        badge: "ENCOUNTER",
        title: "遭遇战",
        subtitle: "切入战斗场景",
        tone: "enter"
      },
      this.enterDuration
    );
  }

  async playExit(copy?: BattleTransitionCopy): Promise<void> {
    await this.runSequence(
      copy ?? {
        badge: "VICTORY",
        title: "战斗胜利",
        subtitle: "返回世界地图",
        tone: "victory"
      },
      this.exitDuration
    );
  }

  private async runSequence(copy: BattleTransitionCopy, duration: number): Promise<void> {
    this.ensureOverlay();
    if (
      !this.overlayNode ||
      !this.overlayOpacity ||
      !this.panelNode ||
      !this.badgeLabel ||
      !this.titleLabel ||
      !this.subtitleLabel
    ) {
      return;
    }

    const token = ++this.sequenceToken;
    Tween.stopAllByTarget(this.overlayOpacity);
    Tween.stopAllByTarget(this.panelNode);
    this.syncOverlayChrome(copy);
    this.overlayNode.active = true;
    this.overlayOpacity.opacity = 0;
    this.panelNode.setScale(0.92, 0.92, 1);
    this.panelNode.setPosition(0, 10, 0);
    this.badgeLabel.string = copy.badge;
    this.titleLabel.string = copy.title;
    this.subtitleLabel.string = copy.subtitle;

    tween(this.overlayOpacity)
      .to(Math.max(0.12, duration * 0.22), { opacity: 255 })
      .delay(Math.max(0.08, duration * 0.4))
      .to(Math.max(0.1, duration * 0.24), { opacity: 0 })
      .start();

    tween(this.panelNode)
      .to(Math.max(0.12, duration * 0.24), { scale: v3(1.02, 1.02, 1), position: v3(0, 0, 0) })
      .to(Math.max(0.08, duration * 0.14), { scale: v3(1, 1, 1), position: v3(0, -2, 0) })
      .delay(Math.max(0.08, duration * 0.28))
      .to(Math.max(0.1, duration * 0.18), { scale: v3(0.97, 0.97, 1), position: v3(0, -10, 0) })
      .start();

    await new Promise<void>((resolve) => {
      this.scheduleOnce(() => {
        if (token === this.sequenceToken && this.overlayNode) {
          this.overlayNode.active = false;
        }
        resolve();
      }, duration);
    });
  }

  private ensureOverlay(): void {
    if (
      this.overlayNode &&
      this.overlayOpacity &&
      this.overlayGraphics &&
      this.panelNode &&
      this.panelGraphics &&
      this.badgeLabel &&
      this.titleLabel &&
      this.subtitleLabel
    ) {
      return;
    }

    let overlayNode = this.node.getChildByName(OVERLAY_NODE_NAME);
    if (!overlayNode) {
      overlayNode = new Node(OVERLAY_NODE_NAME);
      overlayNode.parent = this.node;
    }
    assignUiLayer(overlayNode);

    const transform = overlayNode.getComponent(UITransform) ?? overlayNode.addComponent(UITransform);
    const visibleSize = view.getVisibleSize();
    transform.setContentSize(visibleSize.width, visibleSize.height);
    const opacity = overlayNode.getComponent(UIOpacity) ?? overlayNode.addComponent(UIOpacity);
    const graphics = overlayNode.getComponent(Graphics) ?? overlayNode.addComponent(Graphics);

    let panelNode = overlayNode.getChildByName(PANEL_NODE_NAME);
    if (!panelNode) {
      panelNode = new Node(PANEL_NODE_NAME);
      panelNode.parent = overlayNode;
    }
    assignUiLayer(panelNode);
    const panelTransform = panelNode.getComponent(UITransform) ?? panelNode.addComponent(UITransform);
    panelTransform.setContentSize(Math.min(420, visibleSize.width * 0.72), 180);
    const panelGraphics = panelNode.getComponent(Graphics) ?? panelNode.addComponent(Graphics);

    const badgeLabel = this.ensureLabelNode(panelNode, BADGE_NODE_NAME, 15, 18, 180, 22, 66, 6, V_ALIGN_MIDDLE);
    badgeLabel.node.setPosition(0, 54, 1);
    const titleLabel = this.ensureLabelNode(panelNode, TITLE_NODE_NAME, 32, 40, panelTransform.width - 36, 54, 0, 12);
    titleLabel.node.setPosition(0, 8, 1);
    const subtitleLabel = this.ensureLabelNode(
      panelNode,
      SUBTITLE_NODE_NAME,
      16,
      20,
      panelTransform.width - 52,
      48,
      0,
      -52,
      V_ALIGN_TOP
    );
    subtitleLabel.node.setPosition(0, -46, 1);

    this.overlayNode = overlayNode;
    this.overlayOpacity = opacity;
    this.overlayGraphics = graphics;
    this.panelNode = panelNode;
    this.panelGraphics = panelGraphics;
    this.badgeLabel = badgeLabel;
    this.titleLabel = titleLabel;
    this.subtitleLabel = subtitleLabel;
    this.syncOverlayChrome({
      badge: "ENCOUNTER",
      title: "遭遇战",
      subtitle: "切入战斗场景",
      tone: "enter"
    });
  }

  private ensureLabelNode(
    parent: Node,
    name: string,
    fontSize: number,
    lineHeight: number,
    width: number,
    height: number,
    x: number,
    y: number,
    verticalAlign = V_ALIGN_MIDDLE
  ): Label {
    let labelNode = parent.getChildByName(name);
    if (!labelNode) {
      labelNode = new Node(name);
      labelNode.parent = parent;
    }
    assignUiLayer(labelNode);
    const transform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    transform.setContentSize(width, height);
    labelNode.setPosition(x, y, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.fontSize = fontSize;
    label.lineHeight = lineHeight;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = verticalAlign;
    label.enableWrapText = true;
    label.string = "";
    return label;
  }

  private syncOverlayChrome(copy: BattleTransitionCopy): void {
    if (!this.overlayNode || !this.overlayGraphics || !this.panelNode || !this.panelGraphics || !this.badgeLabel) {
      return;
    }

    const visibleSize = view.getVisibleSize();
    const overlayTransform = this.overlayNode.getComponent(UITransform) ?? this.overlayNode.addComponent(UITransform);
    overlayTransform.setContentSize(visibleSize.width, visibleSize.height);
    const panelTransform = this.panelNode.getComponent(UITransform) ?? this.panelNode.addComponent(UITransform);
    panelTransform.setContentSize(Math.min(420, visibleSize.width * 0.72), 180);

    const accent =
      copy.tone === "victory"
        ? new Color(126, 182, 118, 255)
        : copy.tone === "defeat"
          ? new Color(196, 114, 86, 255)
          : new Color(112, 146, 204, 255);
    const softAccent = new Color(accent.r, accent.g, accent.b, 78);
    const bg = new Color(copy.tone === "defeat" ? 26 : 18, 22, 32, 238);

    this.overlayGraphics.clear();
    this.overlayGraphics.fillColor = new Color(bg.r, bg.g, bg.b, 212);
    this.overlayGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    this.overlayGraphics.fill();
    this.overlayGraphics.fillColor = softAccent;
    this.overlayGraphics.rect(-visibleSize.width / 2, visibleSize.height / 2 - 18, visibleSize.width, 6);
    this.overlayGraphics.fill();
    this.overlayGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2 + 12, visibleSize.width, 4);
    this.overlayGraphics.fill();

    const width = panelTransform.width;
    const height = panelTransform.height;
    this.panelGraphics.clear();
    this.panelGraphics.fillColor = new Color(20, 28, 42, 236);
    this.panelGraphics.strokeColor = new Color(accent.r, accent.g, accent.b, 166);
    this.panelGraphics.lineWidth = 3;
    this.panelGraphics.roundRect(-width / 2, -height / 2, width, height, 22);
    this.panelGraphics.fill();
    this.panelGraphics.stroke();
    this.panelGraphics.fillColor = new Color(accent.r, accent.g, accent.b, 36);
    this.panelGraphics.roundRect(-width / 2 + 10, height / 2 - 34, width - 20, 18, 10);
    this.panelGraphics.fill();
    this.panelGraphics.fillColor = new Color(255, 255, 255, 18);
    this.panelGraphics.roundRect(-width / 2 + 22, height / 2 - 54, width - 44, 4, 2);
    this.panelGraphics.fill();
    this.panelGraphics.fillColor = new Color(accent.r, accent.g, accent.b, 98);
    this.panelGraphics.roundRect(-width / 2 + 24, height / 2 - 52, Math.min(132, width * 0.36), 4, 2);
    this.panelGraphics.fill();

    this.badgeLabel.color = new Color(accent.r, accent.g, accent.b, 255);
    if (this.titleLabel) {
      this.titleLabel.color = new Color(245, 248, 252, 255);
    }
    if (this.subtitleLabel) {
      this.subtitleLabel.color = new Color(214, 224, 236, 232);
    }
  }
}
