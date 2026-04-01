import assert from "node:assert/strict";
import test from "node:test";
import { Label, Node, Sprite, UIOpacity } from "cc";
import { VeilUnitAnimator } from "../assets/scripts/VeilUnitAnimator.ts";
import type { CocosAnimationProfile } from "../assets/scripts/cocos-presentation-config.ts";
import { loadPixelSpriteAssets } from "../assets/scripts/cocos-pixel-sprites.ts";
import { createComponentHarness } from "./helpers/cocos-panel-harness.ts";
import { useCcSpriteResourceDoubles } from "./helpers/cc-sprite-resources.ts";

function createAnimatorProfile(): CocosAnimationProfile {
  return {
    fallbackPrefix: "Hero",
    spinePrefix: "Hero",
    clipPrefix: "Hero",
    spineNames: {
      idle: "HeroIdle",
      move: "HeroMove",
      attack: "HeroAttack",
      hit: "HeroHit",
      victory: "HeroVictory",
      defeat: "HeroDefeat"
    },
    clipNames: {
      idle: "HeroClipIdle",
      move: "HeroClipMove",
      attack: "HeroClipAttack",
      hit: "HeroClipHit",
      victory: "HeroClipVictory",
      defeat: "HeroClipDefeat"
    },
    returnTimings: {
      attack: 0.4,
      hit: 0.25,
      victory: 0.8,
      defeat: 0.8
    },
    returnToIdleAfterOneShot: true
  };
}

test("VeilUnitAnimator plays pixel sequences and returns to idle after one-shot actions", async (t) => {
  useCcSpriteResourceDoubles(t);
  await loadPixelSpriteAssets("boot");

  const { node, component } = createComponentHarness(VeilUnitAnimator, { name: "UnitAnimatorRoot", width: 0, height: 0 });
  const heroIcon = new Node("HeroIcon");
  heroIcon.parent = node;
  heroIcon.addComponent(Sprite);
  heroIcon.addComponent(UIOpacity);
  node.addComponent(Label);

  const profile = createAnimatorProfile();
  let scheduledDelay = 0;
  let scheduledCallback: (() => void) | null = null;
  component.scheduleOnce = ((callback: () => void, delay?: number) => {
    scheduledDelay = delay ?? 0;
    scheduledCallback = callback;
    return undefined;
  }) as typeof component.scheduleOnce;

  component.applyProfile(profile, "hero_guard_basic");
  assert.equal(component.hasPixelFallback("hero_guard_basic"), true);

  component.play("victory");

  const heroSprite = heroIcon.getComponent(Sprite);
  const opacity = heroIcon.getComponent(UIOpacity);
  assert.ok(heroSprite?.spriteFrame, "expected hero sprite frame to be assigned");
  assert.equal(heroSprite?.color?.r, 252);
  assert.equal(opacity?.opacity, 255);
  assert.equal(heroIcon.scale.x > 1, true);
  assert.equal(scheduledDelay, profile.returnTimings.victory);

  const stateful = component as VeilUnitAnimator & { currentState: string };
  assert.equal(stateful.currentState, "victory");

  scheduledCallback?.();
  assert.equal(stateful.currentState, "idle");
  assert.equal(heroIcon.scale.x, 1);
});

test("VeilUnitAnimator falls back to idle copy when sprite assets are unavailable", async (t) => {
  useCcSpriteResourceDoubles(t);

  const { node, component } = createComponentHarness(VeilUnitAnimator, { name: "UnitAnimatorRoot", width: 0, height: 0 });
  node.addComponent(Label);

  const profile = createAnimatorProfile();
  profile.returnToIdleAfterOneShot = false;

  component.applyProfile(profile, "unknown_template");
  assert.equal(component.hasPixelFallback("unknown_template"), false);

  component.play("attack");

  const label = node.getComponent(Label);
  assert.match(label?.string ?? "", /\[ATTACK]/);
  assert.equal(component.hasPixelFallback(), false);
});
