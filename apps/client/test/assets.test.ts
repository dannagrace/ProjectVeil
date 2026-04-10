import assert from "node:assert/strict";
import test from "node:test";
import {
  assetManifestEntry,
  buildingAsset,
  markerAsset,
  objectBadgeAssets,
  resourceAsset,
  terrainAsset,
  unitAsset,
  unitBadgeAssets,
  unitFrameAsset
} from "../src/assets";

// terrainAsset

test("terrainAsset returns a non-null string for known terrain at (0, 0)", () => {
  const result = terrainAsset("grass", 0, 0);
  assert.ok(typeof result === "string" && result.length > 0);
});

test("terrainAsset returns a non-null string for known terrain at (1, 1)", () => {
  const result = terrainAsset("grass", 1, 1);
  assert.ok(typeof result === "string" && result.length > 0);
});

test("terrainAsset falls back to unknown fog tile for unrecognised terrain key", () => {
  assert.equal(terrainAsset("nonexistent", 0, 0), "/assets/pixel/terrain/fog-tile.png");
});

test("terrainAsset is deterministic for the same coordinates", () => {
  assert.equal(terrainAsset("grass", 5, 3), terrainAsset("grass", 5, 3));
});

test("terrainAsset variants differ based on seed when multiple variants exist", () => {
  // grass has two variants; different seeds should be able to produce different results
  const results = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((n) => terrainAsset("grass", n, 0)));
  assert.ok(results.size > 1, "expected at least two distinct variants for grass");
});

// resourceAsset

test("resourceAsset returns non-null for known resource key 'gold'", () => {
  const result = resourceAsset("gold");
  assert.ok(result !== null && result.length > 0);
});

test("resourceAsset returns non-null for known resource key 'wood'", () => {
  const result = resourceAsset("wood");
  assert.ok(result !== null && result.length > 0);
});

test("resourceAsset returns null for unknown key", () => {
  assert.equal(resourceAsset("nonexistent"), null);
});

// buildingAsset

test("buildingAsset returns non-null for known key 'recruitment_post'", () => {
  const result = buildingAsset("recruitment_post");
  assert.ok(result !== null && result.length > 0);
});

test("buildingAsset returns non-null for known key 'resource_mine'", () => {
  const result = buildingAsset("resource_mine");
  assert.ok(result !== null && result.length > 0);
});

test("buildingAsset returns null for unknown key", () => {
  assert.equal(buildingAsset("nonexistent"), null);
});

// markerAsset

test("markerAsset returns non-null string for 'hero' default state", () => {
  const result = markerAsset("hero");
  assert.equal(result, "/assets/pixel/markers/hero-marker.png");
});

test("markerAsset returns non-null string for 'neutral' default state", () => {
  const result = markerAsset("neutral");
  assert.equal(result, "/assets/pixel/markers/neutral-marker.png");
});

test("markerAsset returns selected variant for 'hero' with state 'selected'", () => {
  assert.equal(markerAsset("hero", "selected"), "/assets/pixel/markers/hero-marker-selected.png");
});

test("markerAsset returns hit variant for 'neutral' with state 'hit'", () => {
  assert.equal(markerAsset("neutral", "hit"), "/assets/pixel/markers/neutral-marker-hit.png");
});

// unitAsset

test("unitAsset returns non-null for known unit key 'hero_guard_basic' idle", () => {
  const result = unitAsset("hero_guard_basic");
  assert.equal(result, "/assets/pixel/units/hero-guard-basic.png");
});

test("unitAsset returns correct path for 'hero_guard_basic' selected state", () => {
  assert.equal(unitAsset("hero_guard_basic", "selected"), "/assets/pixel/units/hero-guard-basic-selected.png");
});

test("unitAsset returns correct path for 'wolf_pack' hit state", () => {
  assert.equal(unitAsset("wolf_pack", "hit"), "/assets/pixel/units/wolf-pack-hit.png");
});

test("unitAsset returns null for unknown key", () => {
  assert.equal(unitAsset("nonexistent"), null);
});

// unitFrameAsset

test("unitFrameAsset returns non-null for known unit key 'hero_guard_basic'", () => {
  assert.equal(unitFrameAsset("hero_guard_basic"), "/assets/pixel/frames/unit-frame-ally.png");
});

test("unitFrameAsset returns enemy frame for 'wolf_pack'", () => {
  assert.equal(unitFrameAsset("wolf_pack"), "/assets/pixel/frames/unit-frame-enemy.png");
});

test("unitFrameAsset returns null for unknown key", () => {
  assert.equal(unitFrameAsset("nonexistent"), null);
});

// unitBadgeAssets

test("unitBadgeAssets returns faction and rarity paths for known unit template 'hero_guard_basic'", () => {
  const result = unitBadgeAssets("hero_guard_basic");
  assert.deepEqual(result, {
    faction: "/assets/pixel/badges/faction-crown.png",
    rarity: "/assets/pixel/badges/rarity-common.png"
  });
});

test("unitBadgeAssets returns elite rarity for 'crown_heavy_cavalry'", () => {
  const result = unitBadgeAssets("crown_heavy_cavalry");
  assert.equal(result.rarity, "/assets/pixel/badges/rarity-elite.png");
  assert.equal(result.faction, "/assets/pixel/badges/faction-crown.png");
});

test("unitBadgeAssets returns null values for unknown unit template id", () => {
  assert.deepEqual(unitBadgeAssets("nonexistent"), { faction: null, rarity: null });
});

test("unitBadgeAssets result has exactly faction and rarity keys", () => {
  const result = unitBadgeAssets("hero_guard_basic");
  assert.deepEqual(Object.keys(result).sort(), ["faction", "rarity"]);
});

// objectBadgeAssets

test("objectBadgeAssets returns null fields for null metadata", () => {
  assert.deepEqual(objectBadgeAssets(null), { faction: null, rarity: null, interaction: null });
});

test("objectBadgeAssets returns null fields for empty metadata object", () => {
  assert.deepEqual(objectBadgeAssets({}), { faction: null, rarity: null, interaction: null });
});

test("objectBadgeAssets resolves known faction, rarity, and interactionType", () => {
  assert.deepEqual(
    objectBadgeAssets({ faction: "crown", rarity: "elite", interactionType: "move" }),
    {
      faction: "/assets/pixel/badges/faction-crown.png",
      rarity: "/assets/pixel/badges/rarity-elite.png",
      interaction: "/assets/pixel/badges/interaction-move.png"
    }
  );
});

test("objectBadgeAssets returns null for unknown faction, rarity, and interactionType values", () => {
  assert.deepEqual(
    objectBadgeAssets({ faction: "void", rarity: "mythic", interactionType: "teleport" }),
    { faction: null, rarity: null, interaction: null }
  );
});

test("objectBadgeAssets result always has exactly faction, rarity, and interaction keys", () => {
  const result = objectBadgeAssets({ faction: "wild" });
  assert.deepEqual(Object.keys(result).sort(), ["faction", "interaction", "rarity"]);
});

test("objectBadgeAssets handles partial metadata with only interactionType", () => {
  const result = objectBadgeAssets({ interactionType: "battle" });
  assert.equal(result.interaction, "/assets/pixel/badges/interaction-battle.png");
  assert.equal(result.faction, null);
  assert.equal(result.rarity, null);
});

// assetManifestEntry

test("assetManifestEntry returns entry for known asset path", () => {
  const result = assetManifestEntry("/assets/pixel/terrain/grass-tile.png");
  assert.ok(result !== null);
  assert.equal(result.slot, "terrain.grass.default");
  assert.equal(result.stage, "prototype");
  assert.equal(result.source, "generated");
});

test("assetManifestEntry returns entry for known resource asset path", () => {
  const result = assetManifestEntry("/assets/pixel/resources/gold-pile.png");
  assert.ok(result !== null);
  assert.equal(result.slot, "resource.gold");
});

test("assetManifestEntry returns entry for known building asset path", () => {
  const result = assetManifestEntry("/assets/pixel/buildings/resource-mine.png");
  assert.ok(result !== null);
  assert.equal(result.slot, "building.resource_mine");
});

test("assetManifestEntry returns null for unknown path", () => {
  assert.equal(assetManifestEntry("/assets/pixel/buildings/missing.png"), null);
});

test("assetManifestEntry returns null for empty string", () => {
  assert.equal(assetManifestEntry(""), null);
});
