import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from "cc";
import { type CocosAccountReviewPage, type CocosAccountReviewSection } from "./cocos-account-review.ts";
import { type CocosBattlePassPanelView } from "./cocos-progression-panel.ts";
import { assignUiLayer } from "./cocos-ui-layer.ts";

const { ccclass } = _decorator;
const H_ALIGN_LEFT = 0;
const H_ALIGN_CENTER = 1;
const V_ALIGN_TOP = 0;
const V_ALIGN_MIDDLE = 1;
const OVERFLOW_RESIZE_HEIGHT = 3;
const PANEL_BG = new Color(16, 22, 31, 238);
const PANEL_BORDER = new Color(238, 230, 198, 118);
const PANEL_INNER = new Color(255, 248, 214, 18);
const TAB_IDLE_FILL = new Color(88, 104, 72, 220);
const TAB_ACTIVE_FILL = new Color(106, 136, 88, 230);
const ACTION_FILL = new Color(62, 84, 116, 224);
const NEGATIVE_FILL = new Color(112, 72, 64, 220);
const CARD_FILL = new Color(34, 46, 64, 186);
const CARD_HIGHLIGHT_FILL = new Color(56, 74, 102, 208);
const MUTED_FILL = new Color(28, 38, 52, 168);
const FREE_TRACK_FILL = new Color(64, 96, 76, 216);
const PREMIUM_TRACK_FILL = new Color(132, 104, 44, 226);

export type VeilProgressionPanelRenderState =
  | {
      page: CocosAccountReviewPage;
    }
  | {
      battlePass: CocosBattlePassPanelView;
    };

export interface VeilProgressionPanelOptions {
  onClose?: () => void;
  onSelectSection?: (section: CocosAccountReviewSection) => void;
  onSelectPage?: (section: "battle-replays" | "event-history", page: number) => void;
  onRetrySection?: (section: CocosAccountReviewSection) => void;
  onClaimTier?: (tier: number) => void;
  onPurchasePremium?: () => void;
}

interface PanelButtonTone {
  fill: Color;
  stroke: Color;
}

function isPagedSection(section: CocosAccountReviewSection): section is "battle-replays" | "event-history" {
  return section === "battle-replays" || section === "event-history";
}

@ccclass("ProjectVeilProgressionPanel")
export class VeilProgressionPanel extends Component {
  private currentState: VeilProgressionPanelRenderState | null = null;
  private onClose: (() => void) | undefined;
  private onSelectSection: ((section: CocosAccountReviewSection) => void) | undefined;
  private onSelectPage: ((section: "battle-replays" | "event-history", page: number) => void) | undefined;
  private onRetrySection: ((section: CocosAccountReviewSection) => void) | undefined;
  private onClaimTier: ((tier: number) => void) | undefined;
  private onPurchasePremium: (() => void) | undefined;

  configure(options: VeilProgressionPanelOptions): void {
    this.onClose = options.onClose;
    this.onSelectSection = options.onSelectSection;
    this.onSelectPage = options.onSelectPage;
    this.onRetrySection = options.onRetrySection;
    this.onClaimTier = options.onClaimTier;
    this.onPurchasePremium = options.onPurchasePremium;
  }

  render(state: VeilProgressionPanelRenderState): void {
    this.currentState = state;
    if ("battlePass" in state) {
      this.renderBattlePass(state.battlePass);
      return;
    }

    this.node.active = true;
    this.hideBattlePassNodes();
    this.renderAccountReview(state.page);
  }

  private renderAccountReview(page: CocosAccountReviewPage): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const width = transform.width || 380;
    const height = transform.height || 440;
    const contentWidth = width - 30;
    const centerX = 0;
    const pagedSection = isPagedSection(page.section) ? page.section : null;
    let cursorY = height / 2 - 16;

    this.syncChrome(width, height);

    cursorY = this.renderCard(
      "ProgressionHeader",
      centerX,
      cursorY,
      contentWidth,
      80,
      [page.title, page.subtitle, `当前页 ${page.pageLabel}`],
      {
        fill: CARD_HIGHLIGHT_FILL,
        stroke: new Color(244, 236, 208, 82)
      },
      null,
      15,
      18
    );

    const tabWidth = Math.floor((contentWidth - 18) / Math.max(1, page.tabs.length));
    const tabStartX = centerX - contentWidth / 2 + tabWidth / 2;
    page.tabs.forEach((tab, index) => {
      this.renderButton(
        `ProgressionTab-${tab.section}`,
        tabStartX + index * (tabWidth + 6),
        cursorY - 14,
        tabWidth,
        26,
        `${tab.label} ${tab.count}`,
        tab.section === page.section
          ? {
              fill: TAB_ACTIVE_FILL,
              stroke: new Color(230, 244, 222, 116)
            }
          : {
              fill: TAB_IDLE_FILL,
              stroke: new Color(232, 238, 220, 88)
            },
        () => this.onSelectSection?.(tab.section)
      );
    });

    this.renderButton(
      "ProgressionClose",
      centerX + contentWidth / 2 - 42,
      height / 2 - 18,
      72,
      24,
      "关闭",
      {
        fill: NEGATIVE_FILL,
        stroke: new Color(244, 226, 214, 114)
      },
      this.onClose ?? null
    );

    this.renderButton(
      "ProgressionPrev",
      centerX - contentWidth / 4 - 4,
      cursorY - 48,
      Math.floor((contentWidth - 8) / 2),
      24,
      "上一页",
      {
        fill: ACTION_FILL,
        stroke: new Color(224, 236, 248, 108)
      },
      page.hasPreviousPage && pagedSection ? () => this.onSelectPage?.(pagedSection, page.page - 1) : null
    );

    this.renderButton(
      "ProgressionNext",
      centerX + contentWidth / 4 + 4,
      cursorY - 48,
      Math.floor((contentWidth - 8) / 2),
      24,
      "下一页",
      {
        fill: ACTION_FILL,
        stroke: new Color(224, 236, 248, 108)
      },
      page.hasNextPage && pagedSection ? () => this.onSelectPage?.(pagedSection, page.page + 1) : null
    );

    this.renderButton(
      "ProgressionRetry",
      centerX,
      cursorY - 78,
      contentWidth,
      22,
      "重新同步当前面板",
      {
        fill: ACTION_FILL,
        stroke: new Color(224, 236, 248, 108)
      },
      page.showRetry ? () => this.onRetrySection?.(page.section) : null
    );

    let cardsTop = cursorY - 100;
    if (page.banner) {
      cardsTop = this.renderCard(
        "ProgressionBanner",
        centerX,
        cardsTop,
        contentWidth,
        62,
        [page.banner.title, page.banner.detail],
        page.banner.tone === "negative"
          ? {
              fill: NEGATIVE_FILL,
              stroke: new Color(248, 228, 220, 112)
            }
          : {
              fill: CARD_HIGHLIGHT_FILL,
              stroke: new Color(236, 242, 250, 86)
            },
        null,
        13,
        16
      );
    } else {
      const bannerNode = this.node.getChildByName("ProgressionBanner");
      if (bannerNode) {
        bannerNode.active = false;
      }
    }

    const items = page.items.length > 0
      ? page.items
      : [
          {
            title: "当前暂无内容",
            detail: page.subtitle,
            footnote: "渲染面板已就绪，等待数据同步。",
            emphasis: "neutral" as const
          }
        ];

    items.forEach((item, index) => {
      cardsTop = this.renderCard(
        `ProgressionItem-${index}`,
        centerX,
        cardsTop,
        contentWidth,
        72,
        [item.title, item.detail, item.footnote],
        item.emphasis === "positive"
          ? {
              fill: CARD_HIGHLIGHT_FILL,
              stroke: new Color(224, 240, 220, 78)
            }
          : {
              fill: page.items.length > 0 ? CARD_FILL : MUTED_FILL,
              stroke: new Color(220, 230, 244, 56)
            },
        null,
        13,
        16
      );
    });
    this.hideExtraItems(items.length);
  }

  private renderBattlePass(view: CocosBattlePassPanelView): void {
    if (!view.visible) {
      this.node.active = false;
      return;
    }

    this.node.active = true;
    this.hideAccountReviewNodes();

    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const width = transform.width || 380;
    const height = transform.height || 440;
    const contentWidth = width - 30;
    let cursorY = height / 2 - 16;

    this.syncChrome(width, height);

    this.renderButton(
      "BattlePassClose",
      contentWidth / 2 - 12,
      height / 2 - 18,
      72,
      24,
      "关闭",
      {
        fill: NEGATIVE_FILL,
        stroke: new Color(244, 226, 214, 114)
      },
      this.onClose ?? null
    );

    cursorY = this.renderCard(
      "BattlePassHeader",
      0,
      cursorY,
      contentWidth,
      88,
      [view.title, view.subtitle, view.progressLabel],
      {
        fill: CARD_HIGHLIGHT_FILL,
        stroke: new Color(244, 236, 208, 82)
      },
      null,
      15,
      18
    );

    cursorY = this.renderCard(
      "BattlePassNextReward",
      0,
      cursorY,
      contentWidth,
      62,
      ["奖励预览", view.nextRewardLabel, view.statusLabel],
      {
        fill: CARD_FILL,
        stroke: new Color(220, 230, 244, 56)
      },
      null,
      13,
      16
    );

    this.renderProgressBar("BattlePassMeter", 0, cursorY - 18, contentWidth, 16, view.progressRatio);
    cursorY -= 34;

    this.renderButton(
      "BattlePassPremiumAction",
      0,
      cursorY - 12,
      contentWidth,
      26,
      `${view.premiumActionLabel} · ${view.premiumStatusLabel}`,
      {
        fill: PREMIUM_TRACK_FILL,
        stroke: new Color(248, 230, 184, 118)
      },
      view.premiumPurchaseEnabled ? this.onPurchasePremium ?? null : null
    );
    cursorY -= 34;

    view.tiers.forEach((tier, index) => {
      cursorY = this.renderCard(
        `BattlePassTier-${index}`,
        0,
        cursorY,
        contentWidth,
        44,
        [`${tier.tierLabel} · ${tier.xpLabel}`],
        {
          fill: MUTED_FILL,
          stroke: new Color(220, 230, 244, 56)
        },
        null,
        13,
        16
      );

      const trackWidth = Math.floor((contentWidth - 8) / 2);
      const trackY = cursorY - 42;
      this.renderCard(
        `BattlePassTrack-${index}-free`,
        -trackWidth / 2 - 4,
        trackY,
        trackWidth,
        82,
        [tier.freeTrack.label, tier.freeTrack.detail, tier.freeTrack.claimLabel],
        {
          fill: FREE_TRACK_FILL,
          stroke: new Color(220, 242, 226, 82)
        },
        tier.freeTrack.claimable ? () => this.onClaimTier?.(tier.tier) : null,
        12,
        15
      );
      this.renderCard(
        `BattlePassTrack-${index}-premium`,
        trackWidth / 2 + 4,
        trackY,
        trackWidth,
        82,
        [tier.premiumTrack.label, tier.premiumTrack.detail, tier.premiumTrack.claimLabel],
        {
          fill: PREMIUM_TRACK_FILL,
          stroke: new Color(248, 230, 184, 96)
        },
        tier.premiumTrack.claimable ? () => this.onClaimTier?.(tier.tier) : null,
        12,
        15
      );
      cursorY = trackY - 90;
    });

    this.hideExtraBattlePassItems(view.tiers.length);
  }

  private syncChrome(width: number, height: number): void {
    const graphics = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = PANEL_BG;
    graphics.strokeColor = PANEL_BORDER;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 18);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = PANEL_INNER;
    graphics.roundRect(-width / 2 + 14, height / 2 - 22, width - 28, 6, 3);
    graphics.fill();
  }

  private renderProgressBar(
    name: string,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    ratio: number
  ): void {
    let node = this.node.getChildByName(name);
    if (!node) {
      node = new Node(name);
      node.parent = this.node;
    }
    assignUiLayer(node);
    node.active = true;
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(width, height);
    node.setPosition(centerX, centerY, 0.2);

    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = new Color(40, 52, 70, 220);
    graphics.roundRect(-width / 2, -height / 2, width, height, 8);
    graphics.fill();
    graphics.fillColor = new Color(214, 184, 124, 232);
    graphics.roundRect(-width / 2, -height / 2, Math.max(8, width * Math.max(0, Math.min(1, ratio))), height, 8);
    graphics.fill();
  }

  private renderCard(
    name: string,
    centerX: number,
    topY: number,
    width: number,
    minHeight: number,
    lines: string[],
    tone: PanelButtonTone,
    onPress: (() => void) | null,
    fontSize: number,
    lineHeight: number
  ): number {
    let node = this.node.getChildByName(name);
    if (!node) {
      node = new Node(name);
      node.parent = this.node;
    }
    assignUiLayer(node);
    node.active = true;

    const height = Math.max(minHeight, 24 + lines.length * lineHeight);
    const centerY = topY - height / 2;
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(width, height);
    node.setPosition(centerX, centerY, 0.2);

    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = tone.fill;
    graphics.strokeColor = tone.stroke;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 14);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 14);
    graphics.roundRect(-width / 2 + 12, height / 2 - 14, width - 24, 4, 2);
    graphics.fill();

    let labelNode = node.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = node;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 22, height - 14);
    labelNode.setPosition(0, 0, 0.1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = lines.join("\n");
    label.fontSize = fontSize;
    label.lineHeight = lineHeight;
    label.horizontalAlign = H_ALIGN_LEFT;
    label.verticalAlign = V_ALIGN_TOP;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.enableWrapText = true;
    label.color = new Color(244, 240, 230, 255);

    node.off(Node.EventType.TOUCH_END);
    node.off(Node.EventType.MOUSE_UP);
    if (onPress) {
      node.on(Node.EventType.TOUCH_END, () => onPress());
      node.on(Node.EventType.MOUSE_UP, () => onPress());
    }
    return topY - height - 8;
  }

  private renderButton(
    name: string,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    labelText: string,
    tone: PanelButtonTone,
    onPress: (() => void) | null
  ): void {
    let node = this.node.getChildByName(name);
    if (!node) {
      node = new Node(name);
      node.parent = this.node;
    }
    assignUiLayer(node);
    node.active = true;
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(width, height);
    node.setPosition(centerX, centerY, 0.4);

    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = onPress ? tone.fill : new Color(tone.fill.r, tone.fill.g, tone.fill.b, 108);
    graphics.strokeColor = tone.stroke;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 10);
    graphics.fill();
    graphics.stroke();

    let labelNode = node.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = node;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 12, height - 6);
    labelNode.setPosition(0, 0, 0.1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = labelText;
    label.fontSize = 12;
    label.lineHeight = 14;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.enableWrapText = false;
    label.color = new Color(244, 247, 252, onPress ? 255 : 132);

    node.off(Node.EventType.TOUCH_END);
    node.off(Node.EventType.MOUSE_UP);
    if (onPress) {
      node.on(Node.EventType.TOUCH_END, () => onPress());
      node.on(Node.EventType.MOUSE_UP, () => onPress());
    }
  }

  private hideExtraItems(visibleCount: number): void {
    for (let index = visibleCount; index < 8; index += 1) {
      const node = this.node.getChildByName(`ProgressionItem-${index}`);
      if (node) {
        node.active = false;
      }
    }
  }

  private hideExtraBattlePassItems(visibleCount: number): void {
    for (let index = visibleCount; index < 4; index += 1) {
      const tierNode = this.node.getChildByName(`BattlePassTier-${index}`);
      if (tierNode) {
        tierNode.active = false;
      }
      const freeNode = this.node.getChildByName(`BattlePassTrack-${index}-free`);
      if (freeNode) {
        freeNode.active = false;
      }
      const premiumNode = this.node.getChildByName(`BattlePassTrack-${index}-premium`);
      if (premiumNode) {
        premiumNode.active = false;
      }
    }
  }

  private hideAccountReviewNodes(): void {
    this.hideNodesByPrefix(["ProgressionHeader", "ProgressionBanner", "ProgressionClose", "ProgressionPrev", "ProgressionNext", "ProgressionRetry", "ProgressionTab-", "ProgressionItem-"]);
  }

  private hideBattlePassNodes(): void {
    this.hideNodesByPrefix(["BattlePassHeader", "BattlePassNextReward", "BattlePassMeter", "BattlePassPremiumAction", "BattlePassClose", "BattlePassTier-", "BattlePassTrack-"]);
  }

  private hideNodesByPrefix(prefixes: string[]): void {
    for (const child of this.node.children) {
      if (prefixes.some((prefix) => child.name.startsWith(prefix))) {
        child.active = false;
      }
    }
  }
}
