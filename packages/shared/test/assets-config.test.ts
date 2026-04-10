import assert from "node:assert/strict";
import test from "node:test";
import assetConfig from "../../../configs/assets.json";
import {
  collectAssetPaths,
  getAssetConfigValidationErrors,
  getAssetMetadataEntry,
  parseAssetConfig,
  summarizeAssetMetadata
} from "../src/assets-config.ts";

test("getAssetConfigValidationErrors accepts the checked-in asset fixture", () => {
  assert.deepEqual(getAssetConfigValidationErrors(assetConfig), []);
});

test("parseAssetConfig returns the typed asset config for a valid fixture", () => {
  assert.equal(parseAssetConfig(assetConfig), assetConfig);
});

test("parseAssetConfig throws the collected validation errors for invalid configs", () => {
  assert.throws(
    () =>
      parseAssetConfig({
        terrain: {},
        resources: {},
        buildings: {},
        heroes: {},
        units: {},
        showcaseUnits: {},
        showcaseTerrain: {},
        showcaseBuildings: {},
        markers: {},
        metadata: {},
        badges: {}
      }),
    /Invalid asset config:\n- terrain\.grass must be an object/
  );
});

test("getAssetConfigValidationErrors reports metadata field violations", () => {
  const invalidConfig = structuredClone(assetConfig);
  const duplicateSlotPath = invalidConfig.units.hero_guard_basic.portrait.idle;

  invalidConfig.metadata[duplicateSlotPath] = {
    ...invalidConfig.metadata[duplicateSlotPath],
    slot: invalidConfig.metadata["/assets/pixel/terrain/grass-tile.png"]!.slot
  };
  invalidConfig.metadata["/assets/pixel/resources/wood-stack.png"] = {
    slot: "Resource.Wood",
    stage: "shipping",
    source: "generated",
    notes: 42
  };

  const errors = getAssetConfigValidationErrors(invalidConfig);

  assert.ok(
    errors.includes(
      `metadata[${duplicateSlotPath}].slot duplicates metadata[/assets/pixel/terrain/grass-tile.png].slot (terrain.grass.default)`
    )
  );
  assert.ok(
    errors.includes(
      "metadata[/assets/pixel/resources/wood-stack.png].slot must use lowercase letters, numbers, dots, dashes or underscores"
    )
  );
  assert.ok(
    errors.includes("metadata[/assets/pixel/resources/wood-stack.png].stage must be one of: placeholder, prototype, production")
  );
  assert.ok(errors.includes("metadata[/assets/pixel/resources/wood-stack.png].notes must be a string when provided"));
});

test("getAssetConfigValidationErrors reports metadata coverage gaps after schema validation passes", () => {
  const invalidConfig = structuredClone(assetConfig);
  const heroPortraitPath = invalidConfig.heroes.hero_guard_basic.portrait;

  delete invalidConfig.metadata[heroPortraitPath];

  const errors = getAssetConfigValidationErrors(invalidConfig);

  assert.ok(errors.includes(`metadata[${heroPortraitPath}] is missing for referenced asset path`));
});

test("collectAssetPaths returns each referenced asset path once and matches metadata coverage", () => {
  const paths = collectAssetPaths(assetConfig);

  assert.equal(paths.length, new Set(paths).size);
  assert.deepEqual(new Set(paths), new Set(Object.keys(assetConfig.metadata)));
  assert.ok(paths.includes(assetConfig.terrain.grass.default));
  assert.ok(paths.includes(assetConfig.showcaseUnits.moss_stalker.portrait.idle));
  assert.ok(paths.includes(assetConfig.badges.interactions.battle));
  assert.equal(paths.filter((path) => path === "/assets/pixel/frames/unit-frame-ally.png").length, 1);
});

test("getAssetMetadataEntry returns metadata entries and null for unknown paths", () => {
  const assetPath = assetConfig.units.hero_guard_basic.portrait.idle;

  assert.deepEqual(getAssetMetadataEntry(assetConfig, assetPath), {
    slot: "unit.hero_guard_basic.idle",
    stage: "prototype",
    source: "generated",
    notes: "Synced from Cocos placeholder icon bundle for H5 pixel preview."
  });
  assert.equal(getAssetMetadataEntry(assetConfig, "/assets/pixel/missing.png"), null);
});

test("summarizeAssetMetadata reports stable totals by stage and source", () => {
  assert.deepEqual(summarizeAssetMetadata(assetConfig), {
    total: 65,
    byStage: {
      placeholder: 38,
      prototype: 27,
      production: 0
    },
    bySource: {
      generated: 65,
      "open-source": 0,
      licensed: 0,
      commissioned: 0
    }
  });
});
