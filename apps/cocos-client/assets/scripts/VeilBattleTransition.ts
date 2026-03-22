import { _decorator, Component, Label, Node, UITransform, view } from "cc";
import { assignUiLayer } from "./cocos-ui-layer.ts";

const { ccclass, property } = _decorator;

const OVERLAY_NODE_NAME = "ProjectVeilBattleOverlay";

@ccclass("ProjectVeilBattleTransition")
export class VeilBattleTransition extends Component {
  @property
  enterDuration = 0.55;

  @property
  exitDuration = 0.45;

  private overlayNode: Node | null = null;
  private overlayLabel: Label | null = null;

  onLoad(): void {
    this.ensureOverlay();
    if (this.overlayNode) {
      this.overlayNode.active = false;
    }
  }

  async playEnter(): Promise<void> {
    await this.runSequence(["遭遇战", "切入战斗场景"], this.enterDuration);
  }

  async playExit(victory: boolean): Promise<void> {
    await this.runSequence([victory ? "战斗胜利" : "战斗失败", "返回世界地图"], this.exitDuration);
  }

  private async runSequence(lines: string[], duration: number): Promise<void> {
    this.ensureOverlay();
    if (!this.overlayNode || !this.overlayLabel) {
      return;
    }

    this.overlayNode.active = true;
    this.overlayLabel.string = lines.join("\n");

    await new Promise<void>((resolve) => {
      this.scheduleOnce(() => {
        if (this.overlayNode) {
          this.overlayNode.active = false;
        }
        resolve();
      }, duration);
    });
  }

  private ensureOverlay(): void {
    if (this.overlayNode && this.overlayLabel) {
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

    const label = overlayNode.getComponent(Label) ?? overlayNode.addComponent(Label);
    label.fontSize = 38;
    label.lineHeight = 48;
    label.string = "";

    this.overlayNode = overlayNode;
    this.overlayLabel = label;
  }
}
