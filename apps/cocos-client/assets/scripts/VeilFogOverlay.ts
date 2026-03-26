import { _decorator, Color, Component, Graphics, Label, Node, UIOpacity, UITransform } from "cc";
import type { FogOverlayStyle } from "./cocos-map-visuals.ts";

const { ccclass, property } = _decorator;
const HIDDEN_FOG = new Color(13, 19, 30, 255);
const EXPLORED_FOG = new Color(42, 57, 76, 255);
const NORTH_BIT = 1;
const EAST_BIT = 2;
const SOUTH_BIT = 4;
const WEST_BIT = 8;

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

    const width = this.tileSize - 6;
    const height = this.tileSize - 6;
    const baseColor = style.tone === "hidden" ? HIDDEN_FOG : EXPLORED_FOG;
    const radius = Math.max(10, Math.floor(this.tileSize * 0.18));
    const featherWidth = Math.max(12, Math.floor(this.tileSize * 0.16));
    const innerWidth = Math.max(12, width - featherWidth * 2);
    const innerHeight = Math.max(12, height - featherWidth * 2);

    this.graphics.clear();
    this.graphics.fillColor = new Color(baseColor.r, baseColor.g, baseColor.b, Math.max(10, Math.floor(style.edgeOpacity * 0.4)));
    this.graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    this.graphics.fill();

    this.graphics.fillColor = new Color(baseColor.r, baseColor.g, baseColor.b, style.opacity);
    this.graphics.roundRect(
      -innerWidth / 2,
      -innerHeight / 2,
      innerWidth,
      innerHeight,
      Math.max(6, radius - Math.floor(featherWidth * 0.35))
    );
    this.graphics.fill();

    this.paintFeatheredEdge(baseColor, style, "north", -width / 2, width, height / 2 - featherWidth, featherWidth);
    this.paintFeatheredEdge(baseColor, style, "south", -width / 2, width, -height / 2, featherWidth);
    this.paintFeatheredEdge(baseColor, style, "west", -width / 2, featherWidth, -height / 2, height);
    this.paintFeatheredEdge(baseColor, style, "east", width / 2 - featherWidth, featherWidth, -height / 2, height);
  }

  private paintFeatheredEdge(
    baseColor: Color,
    style: FogOverlayStyle,
    direction: "north" | "east" | "south" | "west",
    x: number,
    width: number,
    y: number,
    height: number
  ): void {
    if (!this.graphics) {
      return;
    }

    const maskBit =
      direction === "north"
        ? NORTH_BIT
        : direction === "east"
          ? EAST_BIT
          : direction === "south"
            ? SOUTH_BIT
            : WEST_BIT;
    const frontier = (style.featherMask & maskBit) !== 0;
    const steps = frontier ? [0.35, 0.52, 0.7, 0.88] : [1, 1, 1, 1];
    const horizontal = direction === "north" || direction === "south";

    for (let index = 0; index < steps.length; index += 1) {
      const alpha = Math.max(8, Math.floor(style.edgeOpacity * steps[index]!));
      this.graphics.fillColor = new Color(baseColor.r, baseColor.g, baseColor.b, alpha);

      if (horizontal) {
        const bandHeight = height / steps.length;
        const bandY = direction === "north" ? y + bandHeight * (steps.length - index - 1) : y + bandHeight * index;
        this.graphics.roundRect(x, bandY, width, bandHeight + 1, 0);
      } else {
        const bandWidth = width / steps.length;
        const bandX = direction === "west" ? x + bandWidth * index : x + bandWidth * (steps.length - index - 1);
        this.graphics.roundRect(bandX, y, bandWidth + 1, height, 0);
      }
      this.graphics.fill();
    }
  }
}
