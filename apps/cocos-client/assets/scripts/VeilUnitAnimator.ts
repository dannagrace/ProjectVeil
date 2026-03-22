import { _decorator, Animation, Component, Label, sp } from "cc";
import {
  createUnitAnimationNameMap,
  resolveUnitAnimationName,
  resolveUnitAnimationReturnDelay,
  shouldLoopUnitAnimation,
  type UnitAnimationState
} from "./unit-animation-config.ts";

const { ccclass, property } = _decorator;

@ccclass("ProjectVeilUnitAnimator")
export class VeilUnitAnimator extends Component {
  @property
  spinePrefix = "";

  @property
  clipPrefix = "";

  @property
  fallbackPrefix = "Hero";

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

  play(state: UnitAnimationState): void {
    this.unscheduleAllCallbacks();
    this.currentState = state;

    if (!this.playSpine(state) && !this.playTimeline(state)) {
      const label = this.node.getComponent(Label);
      if (label) {
        label.string = `${this.fallbackPrefix}\n[${state.toUpperCase()}]`;
      }
    }

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
