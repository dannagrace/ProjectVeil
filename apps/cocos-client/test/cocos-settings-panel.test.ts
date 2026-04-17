import assert from "node:assert/strict";
import test from "node:test";
import {
  applySettingsUpdate,
  createDefaultCocosSettingsView,
  deserializeCocosSettings,
  serializeCocosSettings
} from "../assets/scripts/cocos-settings-panel.ts";

test("applySettingsUpdate clamps volume between 0 and 100", () => {
  const state = createDefaultCocosSettingsView();

  assert.equal(applySettingsUpdate(state, { bgmVolume: -14 }).bgmVolume, 0);
  assert.equal(applySettingsUpdate(state, { sfxVolume: 148 }).sfxVolume, 100);
  assert.equal(applySettingsUpdate(state, { bgmVolume: 49.6 }).bgmVolume, 50);
});

test("settings round-trip through storage serialization correctly", () => {
  const serialized = serializeCocosSettings({
    bgmVolume: 22,
    sfxVolume: 91,
    frameRateCap: 30
  });

  assert.deepEqual(deserializeCocosSettings(serialized), {
    bgmVolume: 22,
    sfxVolume: 91,
    frameRateCap: 30
  });
  assert.deepEqual(deserializeCocosSettings("{\"bgmVolume\":-10,\"sfxVolume\":400,\"frameRateCap\":120}"), {
    bgmVolume: 0,
    sfxVolume: 100,
    frameRateCap: 60
  });
});

test("applySettingsUpdate preserves support submission state", () => {
  const state = createDefaultCocosSettingsView();
  const updated = applySettingsUpdate(state, {
    supportSubmittingCategory: "bug",
    statusMessage: "正在提交..."
  });

  assert.equal(updated.supportSubmittingCategory, "bug");
  assert.equal(updated.statusMessage, "正在提交...");
});
