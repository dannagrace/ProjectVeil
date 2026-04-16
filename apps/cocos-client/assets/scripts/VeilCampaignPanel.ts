import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from "cc";
import { assignUiLayer } from "./cocos-ui-layer.ts";
import {
  buildCocosCampaignPanelView,
  type CocosCampaignPanelInput,
  type CocosCampaignPanelView
} from "./cocos-campaign-panel.ts";

const { ccclass } = _decorator;
const H_ALIGN_LEFT = 0;
const H_ALIGN_CENTER = 1;
const V_ALIGN_TOP = 0;
const V_ALIGN_MIDDLE = 1;
const OVERFLOW_RESIZE_HEIGHT = 3;
const PANEL_BG = new Color(15, 21, 31, 238);
const PANEL_BORDER = new Color(232, 224, 192, 118);
const PANEL_INNER = new Color(255, 248, 214, 16);
const CARD_FILL = new Color(34, 46, 64, 190);
const CARD_HIGHLIGHT_FILL = new Color(58, 82, 108, 212);
const BUTTON_FILL = new Color(70, 92, 120, 228);
const PRIMARY_FILL = new Color(90, 118, 84, 232);
const NEGATIVE_FILL = new Color(122, 82, 72, 228);

export interface VeilCampaignPanelOptions {
  onClose?: () => void;
  onRefresh?: () => void;
  onSelectPrevious?: () => void;
  onSelectNext?: () => void;
  onFocusNextAvailable?: () => void;
  onStartMission?: () => void;
  onAdvanceDialogue?: () => void;
  onCompleteMission?: () => void;
}

type ButtonId = CocosCampaignPanelView["actions"][number]["id"];

interface PanelButtonState {
  id: ButtonId;
  label: string;
  callback: (() => void) | null;
  tone: "default" | "primary" | "negative";
}

function toButtonState(view: CocosCampaignPanelView, options: VeilCampaignPanelOptions): PanelButtonState[] {
  return view.actions.map((action) => ({
    id: action.id,
    label: action.label,
    callback:
      !action.enabled
        ? null
        : action.id === "close"
          ? options.onClose ?? null
          : action.id === "refresh"
            ? options.onRefresh ?? null
            : action.id === "prev"
              ? options.onSelectPrevious ?? null
              : action.id === "next"
                ? options.onSelectNext ?? null
                : action.id === "focus-next"
                  ? options.onFocusNextAvailable ?? null
                  : action.id === "start"
                    ? options.onStartMission ?? null
                    : action.id === "advance-dialogue"
                      ? options.onAdvanceDialogue ?? null
                      : options.onCompleteMission ?? null,
    tone: action.id === "close" ? "negative" : action.id === "start" || action.id === "complete" ? "primary" : "default"
  }));
}

@ccclass("ProjectVeilCampaignPanel")
export class VeilCampaignPanel extends Component {
  private options: VeilCampaignPanelOptions = {};

  configure(options: VeilCampaignPanelOptions): void {
    this.options = options;
  }

  render(state: CocosCampaignPanelInput): void {
    const view = buildCocosCampaignPanelView(state);
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const width = transform.width || 460;
    const height = transform.height || 560;
    const contentWidth = width - 30;

    this.syncChrome(width, height);

    let cursorY = height / 2 - 16;
    cursorY = this.renderCard(
      "CampaignPanelHeader",
      0,
      cursorY,
      contentWidth,
      84,
      [view.title, view.subtitle, ...view.progressLines],
      {
        fill: CARD_HIGHLIGHT_FILL,
        stroke: new Color(244, 236, 208, 82)
      },
      14,
      18
    );

    cursorY = this.renderCard(
      "CampaignPanelChapterAtlas",
      0,
      cursorY,
      contentWidth,
      Math.max(108, 34 + view.chapterAtlasLines.length * 16),
      ["章节图谱", ...view.chapterAtlasLines],
      {
        fill: CARD_FILL,
        stroke: new Color(220, 230, 244, 56)
      },
      13,
      16
    );

    cursorY = this.renderCard(
      "CampaignPanelMission",
      0,
      cursorY,
      contentWidth,
      Math.max(112, 34 + view.missionLines.length * 16),
      ["任务概览", ...view.missionLines],
      {
        fill: CARD_FILL,
        stroke: new Color(220, 230, 244, 56)
      },
      13,
      16
    );

    cursorY = this.renderCard(
      "CampaignPanelObjectives",
      0,
      cursorY,
      contentWidth,
      Math.max(110, 34 + view.objectiveLines.length * 16),
      ["任务目标", ...view.objectiveLines],
      {
        fill: CARD_FILL,
        stroke: new Color(220, 230, 244, 56)
      },
      13,
      16
    );

    cursorY = this.renderCard(
      "CampaignPanelDialogue",
      0,
      cursorY,
      contentWidth,
      Math.max(94, 34 + view.dialogueLines.length * 16),
      ["任务对话", ...view.dialogueLines],
      {
        fill: CARD_HIGHLIGHT_FILL,
        stroke: new Color(244, 236, 208, 82)
      },
      13,
      16
    );

    cursorY = this.renderCard(
      "CampaignPanelReward",
      0,
      cursorY,
      contentWidth,
      Math.max(78, 34 + view.rewardLines.length * 16),
      ["奖励预览", ...view.rewardLines],
      {
        fill: CARD_FILL,
        stroke: new Color(220, 230, 244, 56)
      },
      13,
      16
    );

    cursorY = this.renderCard(
      "CampaignPanelStatus",
      0,
      cursorY,
      contentWidth,
      Math.max(78, 34 + view.statusLines.length * 16),
      ["状态", ...view.statusLines],
      {
        fill: CARD_FILL,
        stroke: new Color(220, 230, 244, 56)
      },
      13,
      16
    );

    this.renderActionButtons(contentWidth, cursorY, toButtonState(view, this.options));
  }

  private syncChrome(width: number, height: number): void {
    assignUiLayer(this.node);
    const graphics = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = PANEL_BG;
    graphics.strokeColor = PANEL_BORDER;
    graphics.lineWidth = 3;
    graphics.roundRect(-width / 2, -height / 2, width, height, 24);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = PANEL_INNER;
    graphics.roundRect(-width / 2 + 12, -height / 2 + 12, width - 24, height - 24, 18);
    graphics.fill();
  }

  private renderActionButtons(contentWidth: number, topY: number, buttons: PanelButtonState[]): void {
    let cursorY = topY - 10;
    const leftX = -contentWidth / 2 + 68;
    const rightX = contentWidth / 2 - 68;

    buttons.forEach((button, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      this.renderButton(
        `CampaignPanelAction-${button.id}`,
        column === 0 ? leftX : rightX,
        cursorY - row * 30,
        132,
        24,
        button.label,
        button.tone === "negative"
          ? {
              fill: NEGATIVE_FILL,
              stroke: new Color(244, 226, 214, 114)
            }
          : button.tone === "primary"
            ? {
                fill: PRIMARY_FILL,
                stroke: new Color(228, 244, 224, 110)
              }
            : {
                fill: BUTTON_FILL,
                stroke: new Color(220, 232, 244, 96)
              },
        button.callback
      );
    });
  }

  private renderCard(
    name: string,
    centerX: number,
    topY: number,
    width: number,
    height: number,
    lines: string[],
    colors: { fill: Color; stroke: Color },
    fontSize: number,
    lineHeight: number
  ): number {
    let cardNode = this.node.getChildByName(name);
    if (!cardNode) {
      cardNode = new Node(name);
      cardNode.parent = this.node;
    }
    assignUiLayer(cardNode);
    cardNode.active = true;
    const transform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    transform.setContentSize(width, height);
    cardNode.setPosition(centerX, topY - height / 2, 0);

    const graphics = cardNode.getComponent(Graphics) ?? cardNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = colors.fill;
    graphics.strokeColor = colors.stroke;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 18);
    graphics.fill();
    graphics.stroke();

    let labelNode = cardNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = cardNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 22, height - 18);
    labelNode.setPosition(0, 0, 0);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = lines.join("\n");
    label.fontSize = fontSize;
    label.lineHeight = lineHeight;
    label.horizontalAlign = H_ALIGN_LEFT;
    label.verticalAlign = V_ALIGN_TOP;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.color = new Color(244, 240, 228, 255);

    return topY - height - 10;
  }

  private renderButton(
    name: string,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    labelText: string,
    colors: { fill: Color; stroke: Color },
    callback: (() => void) | null
  ): void {
    let buttonNode = this.node.getChildByName(name);
    if (!buttonNode) {
      buttonNode = new Node(name);
      buttonNode.parent = this.node;
    }
    assignUiLayer(buttonNode);
    buttonNode.active = true;
    const transform = buttonNode.getComponent(UITransform) ?? buttonNode.addComponent(UITransform);
    transform.setContentSize(width, height);
    buttonNode.setPosition(centerX, centerY, 0);
    buttonNode.off(Node.EventType.TOUCH_END);
    if (callback) {
      buttonNode.on(Node.EventType.TOUCH_END, callback);
    }

    const graphics = buttonNode.getComponent(Graphics) ?? buttonNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = callback ? colors.fill : new Color(colors.fill.r, colors.fill.g, colors.fill.b, 92);
    graphics.strokeColor = colors.stroke;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 12);
    graphics.fill();
    graphics.stroke();

    let labelNode = buttonNode.getChildByName("Label");
    if (!labelNode) {
      labelNode = new Node("Label");
      labelNode.parent = buttonNode;
    }
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 10, height - 6);
    labelNode.setPosition(0, 0, 0);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = labelText;
    label.fontSize = 12;
    label.lineHeight = 16;
    label.horizontalAlign = H_ALIGN_CENTER;
    label.verticalAlign = V_ALIGN_MIDDLE;
    label.overflow = OVERFLOW_RESIZE_HEIGHT;
    label.color = callback ? new Color(248, 244, 232, 255) : new Color(210, 214, 220, 255);
  }
}
