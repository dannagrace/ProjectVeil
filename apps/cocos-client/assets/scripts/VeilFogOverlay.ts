import { _decorator, Component, Sprite, SpriteFrame, UIOpacity, UITransform } from "cc";
import type { FogTileStyle } from "./cocos-map-visuals.ts";

const { ccclass, property } = _decorator;

export type FogOverlayFrameLookup = ReadonlyMap<string, SpriteFrame | null>;

@ccclass("ProjectVeilFogOverlay")
export class VeilFogOverlay extends Component {
  @property
  tileSize = 84;

  private sprite: Sprite | null = null;
  private opacity: UIOpacity | null = null;
  private frameLookup: FogOverlayFrameLookup = new Map();

  configure(tileSize: number, frameLookup: FogOverlayFrameLookup): void {
    this.tileSize = tileSize;
    this.frameLookup = frameLookup;
    this.ensureView();
  }

  render(style: FogTileStyle | null, enabled = true): void {
    if (!enabled || !style) {
      this.node.active = false;
      return;
    }

    this.ensureView();
    if (!this.sprite || !this.opacity) {
      this.node.active = false;
      return;
    }

    const frame = this.frameLookup.get(style.frameKey) ?? null;
    if (!frame) {
      this.sprite.spriteFrame = null;
      this.node.active = false;
      return;
    }

    this.node.active = true;
    this.sprite.spriteFrame = frame;
    this.opacity.opacity = 255;
  }

  private ensureView(): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    transform.setContentSize(this.tileSize, this.tileSize);
    this.node.setPosition(0, 0, 0.2);

    this.opacity = this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);
    this.sprite = this.node.getComponent(Sprite) ?? this.node.addComponent(Sprite);
  }
}
