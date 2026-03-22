import { _decorator, Color, Component, Graphics, Label, Node, UIOpacity, UITransform } from "cc";
import type { FogOverlayStyle } from "./cocos-map-visuals.ts";

const { ccclass, property } = _decorator;
const HIDDEN_FOG = new Color(13, 19, 30, 255);
const EXPLORED_FOG = new Color(42, 57, 76, 255);

@ccclass("ProjectVeilFogOverlay")
export class VeilFogOverlay extends Component {
  @property
  tileSize = 84;

  private graphics: Graphics | null = null;
  private label: Label | null = null;
  private opacity: UIOpacity | null = null;

  configure(tileSize: number): void {
    this.tileSize = tileSize;
    this.ensureView();
  }

  render(style: FogOverlayStyle | null, enabled = true): void {
    if (!enabled || !style) {
      this.node.active = false;
      return;
    }

    this.ensureView();
    if (!this.label || !this.opacity) {
      this.node.active = false;
      return;
    }

    this.node.active = true;
    this.drawChrome(style);
    this.label.string = style.text;
    this.label.color = new Color(255, 255, 255, style.labelOpacity);
    this.opacity.opacity = 255;
  }

  private ensureView(): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    transform.setContentSize(this.tileSize - 12, this.tileSize - 12);
    this.node.setPosition(0, 0, 0.2);

    const opacity = this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);
    const graphics = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    const label = this.node.getComponent(Label) ?? this.node.addComponent(Label);
    const fontSize = Math.max(10, Math.floor(this.tileSize * 0.18));
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 2;
    label.string = "";

    this.graphics = graphics;
    this.label = label;
    this.opacity = opacity;
  }

  private drawChrome(style: FogOverlayStyle): void {
    if (!this.graphics) {
      return;
    }

    const width = this.tileSize - 12;
    const height = this.tileSize - 12;
    const baseColor = style.tone === "hidden" ? HIDDEN_FOG : EXPLORED_FOG;

    this.graphics.clear();
    this.graphics.fillColor = new Color(baseColor.r, baseColor.g, baseColor.b, style.opacity);

    if (style.tone === "hidden") {
      const radius = Math.max(8, Math.floor(this.tileSize * 0.18));
      this.graphics.circle(-width * 0.18, 0, radius);
      this.graphics.circle(width * 0.04, height * 0.1, radius * 0.95);
      this.graphics.circle(width * 0.22, -height * 0.02, radius * 0.85);
      this.graphics.roundRect(-width * 0.22, -height * 0.16, width * 0.46, height * 0.18, Math.max(6, radius - 2));
      this.graphics.fill();
      return;
    }

    this.graphics.roundRect(-width * 0.28, -height * 0.08, width * 0.56, height * 0.12, Math.max(6, Math.floor(this.tileSize * 0.1)));
    this.graphics.fill();
  }
}
