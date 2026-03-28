import assert from "node:assert/strict";
import test from "node:test";
import {
  pixelSpriteManifest,
  pixelSpriteResourcePaths,
  resolvePixelSpritePreloadPaths,
  toCocosResourcePath
} from "../assets/scripts/cocos-pixel-sprite-manifest";

test("toCocosResourcePath trims pixel asset URLs into Cocos resource ids", () => {
  assert.equal(toCocosResourcePath("/assets/pixel/terrain/grass-tile.png"), "pixel/terrain/grass-tile");
  assert.equal(toCocosResourcePath("/assets/pixel/badges/faction-crown.png"), "pixel/badges/faction-crown");
  assert.equal(toCocosResourcePath("/assets/badges/faction-crown.svg"), null);
});

test("pixel sprite manifest maps shared asset config entries and local UI icons", () => {
  assert.deepEqual(pixelSpriteManifest.tiles.grass, ["pixel/terrain/grass-tile", "pixel/terrain/grass-tile-alt"]);
  assert.deepEqual(pixelSpriteManifest.tiles.hidden, [
    "pixel/terrain/hidden-tile",
    "pixel/terrain/hidden-tile-alt",
    "pixel/terrain/hidden-tile-deep"
  ]);
  assert.equal(pixelSpriteManifest.icons.hero, "pixel/markers/hero-marker");
  assert.equal(pixelSpriteManifest.heroes.hero_guard_basic, "pixel/heroes/hero-guard-basic");
  assert.equal(pixelSpriteManifest.heroes.hero_oracle_lyra, "pixel/heroes/hero-oracle-lyra");
  assert.equal(pixelSpriteManifest.icons.recruitment, "pixel/buildings/recruitment-post");
  assert.equal(pixelSpriteManifest.showcaseUnits.sunlance_knight.idle, "pixel/showcase-units/sunlance-knight");
  assert.equal(pixelSpriteManifest.showcaseTerrain.mountain, "pixel/showcase-terrain/mountain-tile");
  assert.equal(pixelSpriteManifest.showcaseBuildings.forge_hall, "pixel/buildings/forge-hall");
  assert.equal(pixelSpriteManifest.icons.hud, "pixel/ui/hud-icon");
  assert.equal(pixelSpriteManifest.units.hero_guard_basic.frame, "pixel/frames/unit-frame-ally");
  assert.equal(pixelSpriteManifest.badges.factions.crown, "pixel/badges/faction-crown");
  assert.equal(pixelSpriteManifest.badges.rarities.elite, "pixel/badges/rarity-elite");
  assert.equal(pixelSpriteManifest.badges.interactions.battle, "pixel/badges/interaction-battle");
});

test("pixel sprite preload groups resolve boot and battle bundles from config patterns", () => {
  const bootPaths = resolvePixelSpritePreloadPaths("boot");
  const battlePaths = resolvePixelSpritePreloadPaths("battle");

  assert.ok(bootPaths.includes("pixel/terrain/grass-tile"));
  assert.ok(bootPaths.includes("pixel/ui/hud-icon"));
  assert.ok(bootPaths.includes("pixel/badges/faction-crown"));
  assert.ok(bootPaths.includes("pixel/heroes/hero-guard-basic"));
  assert.ok(bootPaths.includes("pixel/showcase-terrain/snow-tile"));
  assert.ok(bootPaths.includes("pixel/showcase-units/sunlance-knight"));
  assert.ok(bootPaths.includes("pixel/buildings/forge-hall"));
  assert.ok(!bootPaths.includes("pixel/ui/battle-icon"));
  assert.ok(battlePaths.includes("pixel/ui/battle-icon"));
  assert.ok(battlePaths.includes("pixel/frames/unit-frame-ally"));
  assert.ok(!battlePaths.includes("pixel/badges/faction-crown"));
  assert.ok(battlePaths.includes("pixel/units/hero-guard-basic"));
  assert.equal(pixelSpriteResourcePaths.includes("pixel/units/wolf-pack-hit"), true);
  assert.equal(pixelSpriteResourcePaths.includes("pixel/showcase-terrain/mountain-tile"), true);
});
