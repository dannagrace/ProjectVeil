import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_PLACEHOLDER_SCOPES,
  normalizePlaceholderScopes,
  PLACEHOLDER_ICON_PATHS,
  PLACEHOLDER_SCOPE_PATHS,
  resolvePlaceholderSpritePathsForScopes
} from "../assets/scripts/cocos-placeholder-sprite-plan.ts";

test("normalizePlaceholderScopes deduplicates and keeps known scopes only", () => {
  assert.deepEqual(normalizePlaceholderScopes(["map", "hud", "map", "timeline"]), ["map", "hud", "timeline"]);
  assert.deepEqual(normalizePlaceholderScopes(undefined), ALL_PLACEHOLDER_SCOPES);
});

test("resolvePlaceholderSpritePathsForScopes deduplicates shared hero icon across map and hud", () => {
  const paths = resolvePlaceholderSpritePathsForScopes(["map", "hud"]);

  assert.equal(paths.filter((path) => path === PLACEHOLDER_ICON_PATHS.hero).length, 1);
  assert.ok(paths.includes(PLACEHOLDER_ICON_PATHS.hud));
  assert.ok(paths.includes("placeholder/tiles/grass-1"));
  assert.ok(paths.includes("placeholder/icons/mine"));
});

test("placeholder scope plan keeps battle and timeline assets isolated from map bundle", () => {
  assert.deepEqual(PLACEHOLDER_SCOPE_PATHS.battle, [PLACEHOLDER_ICON_PATHS.battle]);
  assert.deepEqual(PLACEHOLDER_SCOPE_PATHS.timeline, [PLACEHOLDER_ICON_PATHS.timeline]);
  assert.ok(!PLACEHOLDER_SCOPE_PATHS.map.includes(PLACEHOLDER_ICON_PATHS.battle));
  assert.ok(!PLACEHOLDER_SCOPE_PATHS.map.includes(PLACEHOLDER_ICON_PATHS.timeline));
});
