import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCocosPresentationReadiness,
  cocosPresentationReadiness,
  formatPresentationReadinessSummary,
  getCocosPresentationReleaseGate
} from "../assets/scripts/cocos-presentation-readiness";

test("presentation readiness summarizes production pixel, audio and sequence animation coverage", () => {
  const readiness = buildCocosPresentationReadiness();
  assert.equal(readiness.battleJourney.stage, "production");
  assert.deepEqual(readiness.battleJourney.verifiedStages, ["entry", "command", "impact", "resolution"]);
  assert.match(readiness.battleJourney.detail, /中性结算回写壳/);
  assert.equal(readiness.pixel.stage, "production");
  assert.match(readiness.pixel.headline, /5 地形 \/ 4 英雄 \/ 22 单位 \/ 5 建筑/);
  assert.equal(readiness.audio.stage, "production");
  assert.match(readiness.audio.headline, /2 首 BGM \/ 6 组 SFX/);
  assert.match(readiness.audio.detail, /8 正式 \/ 0 占位/);
  assert.equal(readiness.animation.deliveryModes.fallback, 0);
  assert.equal(readiness.animation.deliveryModes.sequence, 2);
  assert.equal(readiness.animation.deliveryModes.spine, 0);
  assert.equal(readiness.nextStep, "战斗流程与表现资源均已达到正式阶段");
  assert.doesNotMatch(readiness.nextStep, /动画回退交付/);
  assert.deepEqual(getCocosPresentationReleaseGate(readiness), {
    ready: true,
    blockers: []
  });
});

test("presentation readiness summary stays concise for Lobby and HUD surfaces", () => {
  assert.match(formatPresentationReadinessSummary(cocosPresentationReadiness), /^像素 正式 \d+\/\d+ · 音频 正式 8\/8 · 动画 序列 2\/2$/);
});
