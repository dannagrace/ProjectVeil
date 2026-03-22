import assert from "node:assert/strict";
import test from "node:test";
import {
  createUnitAnimationNameMap,
  resolveUnitAnimationName,
  resolveUnitAnimationReturnDelay,
  shouldLoopUnitAnimation
} from "../assets/scripts/unit-animation-config";

test("resolveUnitAnimationName prefers explicit state names over prefixes", () => {
  const names = createUnitAnimationNameMap({
    idle: "hero_idle",
    attack: "hero_slash"
  });

  assert.equal(resolveUnitAnimationName("idle", names, "sp_"), "hero_idle");
  assert.equal(resolveUnitAnimationName("attack", names, "sp_"), "hero_slash");
});

test("resolveUnitAnimationName falls back to prefix plus state when no explicit mapping exists", () => {
  const names = createUnitAnimationNameMap();
  assert.equal(resolveUnitAnimationName("move", names, "hero_"), "hero_move");
  assert.equal(resolveUnitAnimationName("hit", names, ""), "hit");
});

test("shouldLoopUnitAnimation only loops idle and move", () => {
  assert.equal(shouldLoopUnitAnimation("idle"), true);
  assert.equal(shouldLoopUnitAnimation("move"), true);
  assert.equal(shouldLoopUnitAnimation("attack"), false);
  assert.equal(shouldLoopUnitAnimation("hit"), false);
});

test("resolveUnitAnimationReturnDelay returns null for looping states and configured delays for one-shots", () => {
  const timings = {
    attack: 0.45,
    hit: 0.25,
    victory: 0.8,
    defeat: 1.1
  };

  assert.equal(resolveUnitAnimationReturnDelay("idle", timings), null);
  assert.equal(resolveUnitAnimationReturnDelay("move", timings), null);
  assert.equal(resolveUnitAnimationReturnDelay("attack", timings), 0.45);
  assert.equal(resolveUnitAnimationReturnDelay("defeat", timings), 1.1);
});
