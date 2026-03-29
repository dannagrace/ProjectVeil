import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCocosPresentationReadiness,
  cocosPresentationReadiness,
  formatPresentationReadinessSummary
} from "../assets/scripts/cocos-presentation-readiness";

test("presentation readiness summarizes placeholder pixel, audio and fallback animation coverage", () => {
  const readiness = buildCocosPresentationReadiness();
  assert.equal(readiness.pixel.stage, "placeholder");
  assert.match(readiness.pixel.headline, /5 地形 \/ 4 英雄 \/ 10 单位 \/ 5 建筑/);
  assert.equal(readiness.audio.stage, "mixed");
  assert.match(readiness.audio.headline, /2 首 BGM \/ 6 组 SFX/);
  assert.match(readiness.audio.detail, /2 正式 \/ 6 占位/);
  assert.equal(readiness.animation.deliveryModes.fallback, 2);
  assert.equal(readiness.animation.deliveryModes.spine, 0);
  assert.match(readiness.nextStep, /正式像素美术/);
  assert.match(readiness.nextStep, /Spine Skeleton/);
});

test("presentation readiness summary stays concise for Lobby and HUD surfaces", () => {
  assert.match(formatPresentationReadinessSummary(cocosPresentationReadiness), /^像素 占位 0\/\d+ · 音频 混合 2\/8 · 动画 回退 2\/2$/);
});
