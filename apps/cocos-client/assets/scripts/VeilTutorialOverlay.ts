import { _decorator, Color, Component, Graphics, Label, Node, UITransform, view } from "cc";
import { assignUiLayer } from "./cocos-ui-layer.ts";

const { ccclass } = _decorator;

export interface TutorialOverlayView {
  title: string;
  body: string;
  detailLines: string[];
  stepLabel: string;
  primaryLabel: string;
  secondaryLabel?: string;
  badge?: string;
  busy?: boolean;
}

@ccclass("ProjectVeilTutorialOverlay")
export class VeilTutorialOverlay extends Component {
  private currentView: TutorialOverlayView | null = null;
  private onPrimaryAction: (() => void) | null = null;
  private onSecondaryAction: (() => void) | null = null;

  onLoad(): void {
    this.node.on(Node.EventType.TOUCH_START, this.swallowPointerEvent, this);
    this.node.on(Node.EventType.TOUCH_END, this.swallowPointerEvent, this);
  }

  onDestroy(): void {
    this.node.off(Node.EventType.TOUCH_START, this.swallowPointerEvent, this);
    this.node.off(Node.EventType.TOUCH_END, this.swallowPointerEvent, this);
  }

  configure(options: { onPrimaryAction?: (() => void) | null; onSecondaryAction?: (() => void) | null }): void {
    this.onPrimaryAction = options.onPrimaryAction ?? null;
    this.onSecondaryAction = options.onSecondaryAction ?? null;
  }

  render(viewModel: TutorialOverlayView | null): void {
    this.currentView = viewModel;
    this.node.active = Boolean(viewModel);
    if (!viewModel) {
      return;
    }

    assignUiLayer(this.node);
    const rootTransform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const visibleSize = view.getVisibleSize();
    rootTransform.setContentSize(visibleSize.width, visibleSize.height);

    const overlayGraphics = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    overlayGraphics.clear();
    overlayGraphics.fillColor = new Color(10, 16, 24, 190);
    overlayGraphics.rect(-visibleSize.width / 2, -visibleSize.height / 2, visibleSize.width, visibleSize.height);
    overlayGraphics.fill();

    const cardWidth = Math.min(visibleSize.width - 56, 560);
    const cardHeight = Math.min(visibleSize.height - 84, 410);
    const cardNode = this.ensureChildNode(this.node, "Card");
    assignUiLayer(cardNode);
    cardNode.setPosition(0, 0, 2);
    const cardTransform = cardNode.getComponent(UITransform) ?? cardNode.addComponent(UITransform);
    cardTransform.setContentSize(cardWidth, cardHeight);
    const cardGraphics = cardNode.getComponent(Graphics) ?? cardNode.addComponent(Graphics);
    cardGraphics.clear();
    cardGraphics.fillColor = new Color(22, 31, 44, 246);
    cardGraphics.strokeColor = new Color(232, 205, 152, 164);
    cardGraphics.lineWidth = 3;
    cardGraphics.roundRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 24);
    cardGraphics.fill();
    cardGraphics.stroke();

    const badgeNode = this.ensureLabelNode(cardNode, "Badge", viewModel.badge ?? "新手引导", 18, new Color(244, 214, 150, 255));
    badgeNode.setPosition(-cardWidth / 2 + 88, cardHeight / 2 - 32, 1);
    const badgeTransform = badgeNode.getComponent(UITransform) ?? badgeNode.addComponent(UITransform);
    badgeTransform.setContentSize(cardWidth - 72, 26);

    const stepNode = this.ensureLabelNode(cardNode, "StepLabel", viewModel.stepLabel, 16, new Color(174, 196, 222, 255));
    stepNode.setPosition(0, cardHeight / 2 - 66, 1);
    const stepTransform = stepNode.getComponent(UITransform) ?? stepNode.addComponent(UITransform);
    stepTransform.setContentSize(cardWidth - 72, 24);

    const titleNode = this.ensureLabelNode(cardNode, "Title", viewModel.title, 30, new Color(247, 248, 251, 255));
    titleNode.setPosition(0, cardHeight / 2 - 112, 1);
    const titleTransform = titleNode.getComponent(UITransform) ?? titleNode.addComponent(UITransform);
    titleTransform.setContentSize(cardWidth - 72, 40);

    const bodyNode = this.ensureLabelNode(cardNode, "Body", viewModel.body, 20, new Color(222, 229, 239, 255));
    bodyNode.setPosition(0, cardHeight / 2 - 170, 1);
    const bodyTransform = bodyNode.getComponent(UITransform) ?? bodyNode.addComponent(UITransform);
    bodyTransform.setContentSize(cardWidth - 84, 84);

    const detailsNode = this.ensureLabelNode(
      cardNode,
      "Details",
      viewModel.detailLines.map((line) => `• ${line}`).join("\n"),
      17,
      new Color(193, 205, 220, 255)
    );
    detailsNode.setPosition(0, 2, 1);
    const detailsTransform = detailsNode.getComponent(UITransform) ?? detailsNode.addComponent(UITransform);
    detailsTransform.setContentSize(cardWidth - 96, 138);

    const primaryButton = this.ensureButton(cardNode, "PrimaryButton", () => {
      if (!this.currentView?.busy) {
        this.onPrimaryAction?.();
      }
    });
    primaryButton.setPosition(viewModel.secondaryLabel ? 86 : 0, -cardHeight / 2 + 46, 1);
    this.renderButton(primaryButton, 180, 54, viewModel.primaryLabel, !viewModel.busy, "primary");

    const secondaryButton = this.ensureButton(cardNode, "SecondaryButton", () => {
      if (!this.currentView?.busy) {
        this.onSecondaryAction?.();
      }
    });
    secondaryButton.active = Boolean(viewModel.secondaryLabel);
    if (viewModel.secondaryLabel) {
      secondaryButton.setPosition(-110, -cardHeight / 2 + 46, 1);
      this.renderButton(secondaryButton, 148, 54, viewModel.secondaryLabel, !viewModel.busy, "secondary");
    }
  }

  private swallowPointerEvent(): void {
    return;
  }

  private ensureChildNode(parent: Node, name: string): Node {
    const child = parent.getChildByName(name) ?? new Node(name);
    child.parent = parent;
    return child;
  }

  private ensureLabelNode(parent: Node, name: string, text: string, fontSize: number, color: Color): Node {
    const node = this.ensureChildNode(parent, name);
    assignUiLayer(node);
    const label = node.getComponent(Label) ?? node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 8;
    label.horizontalAlign = 1;
    label.verticalAlign = 1;
    label.enableWrapText = true;
    label.color = color;
    return node;
  }

  private ensureButton(parent: Node, name: string, onClick: () => void): Node {
    const node = this.ensureChildNode(parent, name);
    assignUiLayer(node);
    if (!node.getComponent(UITransform)) {
      node.addComponent(UITransform);
    }
    if (!(node as Node & { __veilTutorialButtonBound?: boolean }).__veilTutorialButtonBound) {
      node.on(Node.EventType.TOUCH_END, () => {
        onClick();
      });
      (node as Node & { __veilTutorialButtonBound?: boolean }).__veilTutorialButtonBound = true;
    }
    return node;
  }

  private renderButton(
    buttonNode: Node,
    width: number,
    height: number,
    labelText: string,
    enabled: boolean,
    tone: "primary" | "secondary"
  ): void {
    const transform = buttonNode.getComponent(UITransform) ?? buttonNode.addComponent(UITransform);
    transform.setContentSize(width, height);
    const graphics = buttonNode.getComponent(Graphics) ?? buttonNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor =
      tone === "primary"
        ? enabled
          ? new Color(205, 148, 54, 255)
          : new Color(112, 102, 92, 220)
        : enabled
          ? new Color(52, 68, 92, 232)
          : new Color(55, 60, 68, 220);
    graphics.strokeColor = tone === "primary" ? new Color(255, 227, 182, 220) : new Color(206, 218, 236, 140);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 16);
    graphics.fill();
    graphics.stroke();

    const labelNode = this.ensureChildNode(buttonNode, "Label");
    assignUiLayer(labelNode);
    labelNode.setPosition(0, 0, 1);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 12, height - 8);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = labelText;
    label.fontSize = 18;
    label.lineHeight = 24;
    label.horizontalAlign = 1;
    label.verticalAlign = 1;
    label.enableWrapText = false;
    label.color = enabled ? new Color(249, 251, 255, 255) : new Color(214, 214, 214, 220);
  }
}
