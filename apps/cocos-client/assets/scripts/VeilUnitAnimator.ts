import { _decorator, Animation, Color, Component, Label, Sprite, UIOpacity, sp } from "cc";
import {
  createUnitAnimationNameMap,
  resolveUnitAnimationName,
  resolveUnitAnimationReturnDelay,
  shouldLoopUnitAnimation,
  type UnitAnimationState
} from "./unit-animation-config.ts";
import type { CocosAnimationProfile } from "./cocos-presentation-config.ts";
import { getPixelSpriteAssets } from "./cocos-pixel-sprites.ts";
import { resolveUnitAnimationFallbackFrame } from "./cocos-unit-animation-fallback.ts";
import { resolveUnitAnimationFrameSequence } from "./cocos-unit-animation-sequence.ts";

const { ccclass, property } = _decorator;

@ccclass("ProjectVeilUnitAnimator")
export class VeilUnitAnimator extends Component {
  @property
  templateId = "";

  @property
  spinePrefix = "";

  @property
  clipPrefix = "";

  @property
  fallbackPrefix = "Hero";

  @property
  deliveryMode = "fallback";

  @property
  spineIdleName = "";

  @property
  spineMoveName = "";

  @property
  spineAttackName = "";

  @property
  spineHitName = "";

  @property
  spineVictoryName = "";

  @property
  spineDefeatName = "";

  @property
  clipIdleName = "";

  @property
  clipMoveName = "";

  @property
  clipAttackName = "";

  @property
  clipHitName = "";

  @property
  clipVictoryName = "";

  @property
  clipDefeatName = "";

  @property
  attackReturnDelay = 0.45;

  @property
  hitReturnDelay = 0.25;

  @property
  victoryReturnDelay = 0.8;

  @property
  defeatReturnDelay = 0.8;

  @property
  returnToIdleAfterOneShot = true;

  private currentState: UnitAnimationState = "idle";
  private lastPixelFallbackReady = false;
  private pixelSequenceToken = 0;
  private pixelSequenceTimeoutId: ReturnType<typeof setTimeout> | null = null;

  applyProfile(profile: CocosAnimationProfile, templateId = this.templateId): void {
    const templateChanged = this.templateId !== templateId;
    this.templateId = templateId;
    const pixelFallbackReady = this.hasPixelFallback(templateId);
    this.fallbackPrefix = profile.fallbackPrefix;
    this.deliveryMode = profile.deliveryMode;
    this.spinePrefix = profile.spinePrefix;
    this.clipPrefix = profile.clipPrefix;
    this.spineIdleName = profile.spineNames.idle;
    this.spineMoveName = profile.spineNames.move;
    this.spineAttackName = profile.spineNames.attack;
    this.spineHitName = profile.spineNames.hit;
    this.spineVictoryName = profile.spineNames.victory;
    this.spineDefeatName = profile.spineNames.defeat;
    this.clipIdleName = profile.clipNames.idle;
    this.clipMoveName = profile.clipNames.move;
    this.clipAttackName = profile.clipNames.attack;
    this.clipHitName = profile.clipNames.hit;
    this.clipVictoryName = profile.clipNames.victory;
    this.clipDefeatName = profile.clipNames.defeat;
    this.attackReturnDelay = profile.returnTimings.attack;
    this.hitReturnDelay = profile.returnTimings.hit;
    this.victoryReturnDelay = profile.returnTimings.victory;
    this.defeatReturnDelay = profile.returnTimings.defeat;
    this.returnToIdleAfterOneShot = profile.returnToIdleAfterOneShot;
    if (templateChanged || pixelFallbackReady !== this.lastPixelFallbackReady) {
      this.lastPixelFallbackReady = pixelFallbackReady;
      this.renderCurrentState();
    }
  }

  play(state: UnitAnimationState): void {
    this.unscheduleAllCallbacks();
    this.clearPixelSequenceTimeout();
    this.currentState = state;
    this.renderCurrentState();

    if (!this.returnToIdleAfterOneShot) {
      return;
    }

    const returnDelay = resolveUnitAnimationReturnDelay(state, {
      attack: this.attackReturnDelay,
      hit: this.hitReturnDelay,
      victory: this.victoryReturnDelay,
      defeat: this.defeatReturnDelay
    });

    if (returnDelay && returnDelay > 0) {
      this.scheduleOnce(() => {
        this.play("idle");
      }, returnDelay);
    }
  }

  hasPixelFallback(templateId = this.templateId): boolean {
    return resolveUnitAnimationFallbackFrame(templateId, this.currentState, getPixelSpriteAssets()).frame !== null;
  }

  private renderCurrentState(): void {
    this.pixelSequenceToken += 1;
    this.clearPixelSequenceTimeout();
    const rendered = this.tryRenderPreferredMode(this.currentState)
      || this.tryRenderSecondaryModes(this.currentState);
    if (!rendered) {
      const label = this.node.getComponent(Label);
      if (label) {
        label.string = `${this.fallbackPrefix}\n[${this.currentState.toUpperCase()}]`;
      }
    }
  }

  private tryRenderPreferredMode(state: UnitAnimationState): boolean {
    switch (this.deliveryMode) {
      case "spine":
        return this.playSpine(state);
      case "clip":
        return this.playTimeline(state);
      case "sequence":
        return this.playPixelSequence(state);
      default:
        return this.playPixelFallback(state);
    }
  }

  private tryRenderSecondaryModes(state: UnitAnimationState): boolean {
    switch (this.deliveryMode) {
      case "spine":
        return this.playTimeline(state) || this.playPixelSequence(state) || this.playPixelFallback(state);
      case "clip":
        return this.playSpine(state) || this.playPixelSequence(state) || this.playPixelFallback(state);
      case "sequence":
        return this.playSpine(state) || this.playTimeline(state) || this.playPixelFallback(state);
      default:
        return this.playPixelSequence(state) || this.playSpine(state) || this.playTimeline(state);
    }
  }

  private playSpine(state: UnitAnimationState): boolean {
    const skeleton = this.node.getComponent(sp.Skeleton);
    if (!skeleton) {
      return false;
    }

    skeleton.setAnimation(0, this.resolveSpineAnimationName(state), shouldLoopUnitAnimation(state));
    return true;
  }

  private playTimeline(state: UnitAnimationState): boolean {
    const animation = this.node.getComponent(Animation);
    if (!animation) {
      return false;
    }

    animation.play(this.resolveClipAnimationName(state));
    return true;
  }

  private playPixelFallback(state: UnitAnimationState): boolean {
    const targetNode = this.node.getChildByName("HeroIcon") ?? this.node;
    const targetSprite = targetNode.getComponent(Sprite) ?? this.node.getComponent(Sprite);
    if (!targetSprite || !this.templateId) {
      return false;
    }

    const selection = resolveUnitAnimationFallbackFrame(this.templateId, state, getPixelSpriteAssets());
    if (!selection.frame) {
      return false;
    }

    targetNode.active = true;
    targetSprite.spriteFrame = selection.frame;
    targetSprite.color = this.resolvePixelFallbackColor(state);
    targetNode.setScale(this.resolvePixelFallbackScale(state));
    const opacity = targetNode.getComponent(UIOpacity);
    if (opacity) {
      opacity.opacity = 255;
    }

    const label = this.node.getComponent(Label);
    if (label) {
      label.string = "";
    }

    return true;
  }

  private playPixelSequence(state: UnitAnimationState): boolean {
    const targetNode = this.node.getChildByName("HeroIcon") ?? this.node;
    const targetSprite = targetNode.getComponent(Sprite) ?? this.node.getComponent(Sprite);
    if (!targetSprite || !this.templateId) {
      return false;
    }

    const sequence = resolveUnitAnimationFrameSequence(this.templateId, state, getPixelSpriteAssets());
    if (sequence.frames.length === 0 || (sequence.source !== "unit" && sequence.source !== "showcase")) {
      return false;
    }

    targetNode.active = true;
    targetSprite.spriteFrame = sequence.frames[0] ?? null;
    targetSprite.color = this.resolvePixelFallbackColor(state);
    targetNode.setScale(this.resolvePixelFallbackScale(state));
    const opacity = targetNode.getComponent(UIOpacity);
    if (opacity) {
      opacity.opacity = 255;
    }

    const label = this.node.getComponent(Label);
    if (label) {
      label.string = "";
    }

    if (sequence.frames.length === 1) {
      return true;
    }

    const token = this.pixelSequenceToken;
    if (sequence.loop && this.shouldFreezeLoopingPixelSequence()) {
      return true;
    }

    let frameIndex = 0;
    const advanceFrame = (): void => {
      if (token !== this.pixelSequenceToken) {
        return;
      }

      if (!sequence.loop && frameIndex >= sequence.frames.length - 1) {
        return;
      }

      frameIndex = sequence.loop ? (frameIndex + 1) % sequence.frames.length : Math.min(frameIndex + 1, sequence.frames.length - 1);
      targetSprite.spriteFrame = sequence.frames[frameIndex] ?? null;
      if (sequence.loop || frameIndex < sequence.frames.length - 1) {
        this.schedulePixelSequenceFrame(advanceFrame, sequence.frameDurationSeconds);
      }
    };

    this.schedulePixelSequenceFrame(advanceFrame, sequence.frameDurationSeconds);
    return true;
  }

  private schedulePixelSequenceFrame(callback: () => void, delaySeconds: number): void {
    if (this.shouldFreezeLoopingPixelSequence()) {
      const delayMs = Math.max(1, Math.round(delaySeconds * 1_000));
      this.pixelSequenceTimeoutId = setTimeout(() => {
        this.pixelSequenceTimeoutId = null;
        callback();
      }, delayMs);
      return;
    }

    this.scheduleOnce(callback, delaySeconds);
  }

  private clearPixelSequenceTimeout(): void {
    if (this.pixelSequenceTimeoutId !== null) {
      clearTimeout(this.pixelSequenceTimeoutId);
      this.pixelSequenceTimeoutId = null;
    }
  }

  private shouldFreezeLoopingPixelSequence(): boolean {
    return typeof window === "undefined";
  }

  private resolvePixelFallbackScale(state: UnitAnimationState): number {
    if (state === "attack" || state === "victory" || state === "move") {
      return 1.06;
    }
    if (state === "hit" || state === "defeat") {
      return 0.94;
    }
    return 1;
  }

  private resolvePixelFallbackColor(state: UnitAnimationState): Color {
    if (state === "hit" || state === "defeat") {
      return new Color(242, 188, 188, 255);
    }
    if (state === "victory") {
      return new Color(252, 246, 210, 255);
    }
    return new Color(255, 255, 255, 255);
  }

  private resolveSpineAnimationName(state: UnitAnimationState): string {
    return resolveUnitAnimationName(
      state,
      createUnitAnimationNameMap({
        idle: this.spineIdleName,
        move: this.spineMoveName,
        attack: this.spineAttackName,
        hit: this.spineHitName,
        victory: this.spineVictoryName,
        defeat: this.spineDefeatName
      }),
      this.spinePrefix
    );
  }

  private resolveClipAnimationName(state: UnitAnimationState): string {
    return resolveUnitAnimationName(
      state,
      createUnitAnimationNameMap({
        idle: this.clipIdleName,
        move: this.clipMoveName,
        attack: this.clipAttackName,
        hit: this.clipHitName,
        victory: this.clipVictoryName,
        defeat: this.clipDefeatName
      }),
      this.clipPrefix
    );
  }
}
