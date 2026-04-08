import assert from "node:assert/strict";
import test from "node:test";
import { cocosPresentationConfig, resolveUnitAnimationProfile } from "../assets/scripts/cocos-presentation-config";

test("presentation config exposes animation profiles and load budget", () => {
  const guardProfile = resolveUnitAnimationProfile("hero_guard_basic");
  assert.equal(guardProfile.fallbackPrefix, "Guard");
  assert.equal(guardProfile.spinePrefix, "hero_guard_basic_");
  assert.equal(guardProfile.deliveryMode, "fallback");
  assert.equal(guardProfile.assetStage, "production");
  assert.equal(guardProfile.returnTimings.attack, 0.42);

  assert.equal(cocosPresentationConfig.loadingBudget.targetMs, 1800);
  assert.equal(cocosPresentationConfig.loadingBudget.hardLimitMs, 3000);
  assert.deepEqual(cocosPresentationConfig.loadingBudget.preloadGroups.boot.slice(0, 2), [
    "pixel/terrain/*",
    "pixel/showcase-terrain/*"
  ]);
  assert.equal(cocosPresentationConfig.loadingBudget.preloadGroups.boot.includes("pixel/markers/*"), true);
  assert.equal(cocosPresentationConfig.loadingBudget.preloadGroups.boot.includes("pixel/badges/*"), true);
  assert.deepEqual(cocosPresentationConfig.loadingBudget.preloadGroups.battle.slice(-2), [
    "pixel/frames/*",
    "pixel/ui/battle-icon"
  ]);
});

test("unknown animation template falls back to the guard profile", () => {
  const fallbackProfile = resolveUnitAnimationProfile("missing_template");
  assert.equal(fallbackProfile.fallbackPrefix, "Guard");
  assert.equal(fallbackProfile.clipPrefix, "hero_guard_basic_");
});

test("audio cue sequences are normalized from config", () => {
  assert.equal(cocosPresentationConfig.audio.music.explore.waveform, "triangle");
  assert.equal(cocosPresentationConfig.audio.music.explore.assetPath, "audio/explore-loop");
  assert.equal(cocosPresentationConfig.audio.music.explore.assetStage, "production");
  assert.equal(cocosPresentationConfig.audio.music.battle.notes.length, 6);
  assert.equal(cocosPresentationConfig.audio.music.battle.assetVolume, 0.58);
  assert.equal(cocosPresentationConfig.audio.cues.attack.notes.length, 2);
  assert.equal(cocosPresentationConfig.audio.cues.attack.assetStage, "production");
  assert.equal(cocosPresentationConfig.audio.cues.skill.assetPath, "audio/skill");
  assert.equal(cocosPresentationConfig.audio.cues.skill.assetStage, "production");
  assert.equal(cocosPresentationConfig.audio.cues.hit.assetStage, "production");
  assert.equal(cocosPresentationConfig.audio.cues.victory.assetPath, "audio/victory-fanfare");
  assert.equal(cocosPresentationConfig.audio.cues.victory.assetStage, "production");
  assert.equal(cocosPresentationConfig.audio.cues.defeat.assetPath, "audio/defeat-sting");
  assert.equal(cocosPresentationConfig.audio.cues.defeat.assetStage, "production");
  assert.equal(cocosPresentationConfig.audio.cues.level_up.notes.at(-1)?.frequency, 783.99);
});
