import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveUnitAnimationFallbackFrame,
  resolveUnitAnimationFallbackVariant
} from "../assets/scripts/cocos-unit-animation-fallback";

test("animation fallback maps transient states onto selected and hit portrait variants", () => {
  assert.equal(resolveUnitAnimationFallbackVariant("idle"), "idle");
  assert.equal(resolveUnitAnimationFallbackVariant("move"), "selected");
  assert.equal(resolveUnitAnimationFallbackVariant("attack"), "selected");
  assert.equal(resolveUnitAnimationFallbackVariant("hit"), "hit");
  assert.equal(resolveUnitAnimationFallbackVariant("defeat"), "hit");
});

test("animation fallback prefers unit portraits before showcase and hero portraits", () => {
  const selection = resolveUnitAnimationFallbackFrame("hero_guard_basic", "attack", {
    heroes: {
      hero_guard_basic: "hero-frame"
    },
    units: {
      hero_guard_basic: {
        idle: "unit-idle",
        selected: "unit-selected",
        hit: "unit-hit"
      }
    },
    showcaseUnits: {
      hero_guard_basic: {
        idle: "showcase-idle",
        selected: "showcase-selected",
        hit: "showcase-hit"
      }
    }
  });

  assert.deepEqual(selection, {
    variant: "selected",
    source: "unit",
    frame: "unit-selected"
  });
});

test("animation fallback uses hero portraits when no unit sprite set exists", () => {
  const selection = resolveUnitAnimationFallbackFrame("hero_ranger_serin", "hit", {
    heroes: {
      hero_ranger_serin: "hero-portrait"
    },
    units: {},
    showcaseUnits: {}
  });

  assert.deepEqual(selection, {
    variant: "hit",
    source: "hero",
    frame: "hero-portrait"
  });
});

test("animation fallback returns none when no portrait exists for the template", () => {
  const selection = resolveUnitAnimationFallbackFrame("missing_template", "idle", {
    heroes: {},
    units: {},
    showcaseUnits: {}
  });

  assert.deepEqual(selection, {
    variant: "idle",
    source: "none",
    frame: null
  });
});
