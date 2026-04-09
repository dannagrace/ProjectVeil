import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_PLACEHOLDER_SCOPES,
  normalizePlaceholderScopes,
  PLACEHOLDER_FOG_MASK_PATHS,
  PLACEHOLDER_ICON_PATHS,
  PLACEHOLDER_SCOPE_PATHS,
  PLACEHOLDER_TILE_PATHS,
  resolvePlaceholderSpritePathsForScopes
} from "../assets/scripts/cocos-placeholder-sprite-plan.ts";

test("placeholder scope plan exposes the expected scope order and asset groups", () => {
  assert.deepEqual(ALL_PLACEHOLDER_SCOPES, ["map", "hud", "timeline"]);
  assert.deepEqual(PLACEHOLDER_TILE_PATHS.hidden, [
    "placeholder/tiles/hidden-1",
    "placeholder/tiles/hidden-2",
    "placeholder/tiles/hidden-3"
  ]);
  assert.equal(PLACEHOLDER_FOG_MASK_PATHS.hidden.length, 16);
  assert.equal(PLACEHOLDER_FOG_MASK_PATHS.hidden[0], "placeholder/fog/hidden-0");
  assert.equal(PLACEHOLDER_FOG_MASK_PATHS.explored[15], "placeholder/fog/explored-15");
  assert.equal(PLACEHOLDER_SCOPE_PATHS.map.at(-1), PLACEHOLDER_ICON_PATHS.mine);
  assert.deepEqual(PLACEHOLDER_SCOPE_PATHS.hud, [PLACEHOLDER_ICON_PATHS.hud, PLACEHOLDER_ICON_PATHS.hero]);
  assert.deepEqual(PLACEHOLDER_SCOPE_PATHS.timeline, [PLACEHOLDER_ICON_PATHS.timeline]);
});

test("normalizePlaceholderScopes accepts strings, defaults all scopes, and filters duplicates", () => {
  assert.deepEqual(normalizePlaceholderScopes(["map", "hud", "map", "timeline"]), ["map", "hud", "timeline"]);
  assert.deepEqual(normalizePlaceholderScopes(undefined), ALL_PLACEHOLDER_SCOPES);
  assert.deepEqual(
    normalizePlaceholderScopes(["timeline", "unknown" as "timeline", "hud", "timeline"]),
    ["timeline", "hud"]
  );
});

test("resolvePlaceholderSpritePathsForScopes defaults to all scopes in stable order", () => {
  const paths = resolvePlaceholderSpritePathsForScopes();

  assert.deepEqual(paths.slice(0, 3), PLACEHOLDER_TILE_PATHS.grass);
  assert.ok(paths.includes(PLACEHOLDER_ICON_PATHS.hud));
  assert.ok(paths.includes(PLACEHOLDER_ICON_PATHS.timeline));
  assert.ok(paths.includes(PLACEHOLDER_FOG_MASK_PATHS.hidden[0]));
  assert.ok(paths.includes(PLACEHOLDER_FOG_MASK_PATHS.explored[15]));
  assert.equal(paths.filter((path) => path === PLACEHOLDER_ICON_PATHS.hero).length, 1);
  assert.equal(paths.at(-1), PLACEHOLDER_ICON_PATHS.timeline);
});

test("resolvePlaceholderSpritePathsForScopes deduplicates shared hero icon across map and hud", () => {
  const paths = resolvePlaceholderSpritePathsForScopes(["map", "hud"]);

  assert.equal(paths.filter((path) => path === PLACEHOLDER_ICON_PATHS.hero).length, 1);
  assert.ok(paths.includes(PLACEHOLDER_ICON_PATHS.hud));
  assert.ok(paths.includes("placeholder/tiles/grass-1"));
  assert.ok(paths.includes("placeholder/icons/mine"));
});
