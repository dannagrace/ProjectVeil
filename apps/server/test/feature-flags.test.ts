import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  clearCachedFeatureFlagConfig,
  configureFeatureFlagRuntimeDependencies,
  loadFeatureFlagConfig,
  resetFeatureFlagRuntimeDependencies,
  resolveFeatureEntitlementsForPlayer,
  resolveFeatureFlagsForPlayer
} from "../src/feature-flags";
import { DEFAULT_FEATURE_FLAG_CONFIG, type FeatureFlagConfigDocument } from "../../../packages/shared/src/index";

function makeMinimalFlagConfig(overrides: Partial<FeatureFlagConfigDocument["flags"]> = {}): FeatureFlagConfigDocument {
  return {
    schemaVersion: 1,
    flags: {
      ...DEFAULT_FEATURE_FLAG_CONFIG.flags,
      ...overrides
    }
  };
}

function withCleanState(t: TestContext): void {
  clearCachedFeatureFlagConfig();
  resetFeatureFlagRuntimeDependencies();
  const originalEnv: Record<string, string | undefined> = {
    VEIL_FEATURE_FLAGS_JSON: process.env.VEIL_FEATURE_FLAGS_JSON,
    VEIL_FEATURE_FLAGS_PATH: process.env.VEIL_FEATURE_FLAGS_PATH,
    VEIL_DAILY_QUESTS_ENABLED: process.env.VEIL_DAILY_QUESTS_ENABLED
  };
  t.after(() => {
    clearCachedFeatureFlagConfig();
    resetFeatureFlagRuntimeDependencies();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("loadFeatureFlagConfig returns default config when file is missing and no override", (t) => {
  withCleanState(t);
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () => {
      throw new Error("ENOENT: no such file or directory");
    }
  });
  delete process.env.VEIL_FEATURE_FLAGS_JSON;
  delete process.env.VEIL_FEATURE_FLAGS_PATH;

  const config = loadFeatureFlagConfig({});
  assert.equal(config.schemaVersion, 1);
  assert.ok(config.flags, "should have flags");
});

test("loadFeatureFlagConfig uses VEIL_FEATURE_FLAGS_JSON env override when set", (t) => {
  withCleanState(t);
  const customConfig = makeMinimalFlagConfig({
    quest_system_enabled: { type: "boolean", value: true, defaultValue: false, enabled: true }
  });

  const config = loadFeatureFlagConfig({
    VEIL_FEATURE_FLAGS_JSON: JSON.stringify(customConfig)
  });

  assert.equal(config.schemaVersion, 1);
  assert.ok(config.flags.quest_system_enabled, "quest flag should be present");
});

test("loadFeatureFlagConfig ignores invalid VEIL_FEATURE_FLAGS_JSON and falls through to file", (t) => {
  withCleanState(t);
  const fileConfig = makeMinimalFlagConfig();
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () => JSON.stringify(fileConfig)
  });

  const config = loadFeatureFlagConfig({
    VEIL_FEATURE_FLAGS_JSON: "not-valid-json{{{"
  });

  assert.equal(config.schemaVersion, 1);
});

test("loadFeatureFlagConfig caches result on repeated calls", (t) => {
  withCleanState(t);
  let callCount = 0;
  const fileConfig = makeMinimalFlagConfig();
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () => {
      callCount += 1;
      return JSON.stringify(fileConfig);
    }
  });

  const first = loadFeatureFlagConfig({});
  const second = loadFeatureFlagConfig({});

  assert.equal(callCount, 1, "file should be read only once due to caching");
  assert.equal(first, second, "both calls should return the same cached object");
});

test("clearCachedFeatureFlagConfig forces a fresh file read on next call", (t) => {
  withCleanState(t);
  let callCount = 0;
  const fileConfig = makeMinimalFlagConfig();
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () => {
      callCount += 1;
      return JSON.stringify(fileConfig);
    }
  });

  loadFeatureFlagConfig({});
  clearCachedFeatureFlagConfig();
  loadFeatureFlagConfig({});

  assert.equal(callCount, 2, "file should be read again after cache is cleared");
});

test("loadFeatureFlagConfig uses VEIL_FEATURE_FLAGS_PATH env to locate a custom config file", (t) => {
  withCleanState(t);
  const customConfig = makeMinimalFlagConfig();
  let receivedPath = "";
  configureFeatureFlagRuntimeDependencies({
    readFileSync: (filePath) => {
      receivedPath = filePath;
      return JSON.stringify(customConfig);
    }
  });

  loadFeatureFlagConfig({ VEIL_FEATURE_FLAGS_PATH: "/custom/path/flags.json" });

  assert.ok(receivedPath.includes("/custom/path/flags.json"), `expected custom path, got: ${receivedPath}`);
});

test("resolveFeatureFlagsForPlayer returns flags from config without legacy override", (t) => {
  withCleanState(t);
  const config = makeMinimalFlagConfig();
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () => JSON.stringify(config)
  });

  const flags = resolveFeatureFlagsForPlayer("player-1", {});
  assert.ok(typeof flags.quest_system_enabled === "boolean");
});

test("resolveFeatureFlagsForPlayer applies VEIL_DAILY_QUESTS_ENABLED=true legacy override", (t) => {
  withCleanState(t);
  const config = makeMinimalFlagConfig({
    quest_system_enabled: { type: "boolean", value: false, defaultValue: false, enabled: false }
  });
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () => JSON.stringify(config)
  });

  const flags = resolveFeatureFlagsForPlayer("player-1", { VEIL_DAILY_QUESTS_ENABLED: "true" });
  assert.equal(flags.quest_system_enabled, true, "legacy override should force quest flag to true");
});

test("resolveFeatureFlagsForPlayer applies VEIL_DAILY_QUESTS_ENABLED=0 legacy override", (t) => {
  withCleanState(t);
  const config = makeMinimalFlagConfig({
    quest_system_enabled: { type: "boolean", value: true, defaultValue: true, enabled: true }
  });
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () => JSON.stringify(config)
  });

  const flags = resolveFeatureFlagsForPlayer("player-1", { VEIL_DAILY_QUESTS_ENABLED: "0" });
  assert.equal(flags.quest_system_enabled, false, "legacy override should force quest flag to false");
});

test("resolveFeatureFlagsForPlayer leaves flags unchanged when VEIL_DAILY_QUESTS_ENABLED is unset", (t) => {
  withCleanState(t);
  const config = makeMinimalFlagConfig({
    quest_system_enabled: { type: "boolean", value: true, defaultValue: true, enabled: true }
  });
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () => JSON.stringify(config)
  });

  const flags = resolveFeatureFlagsForPlayer("player-1", {});
  assert.equal(flags.quest_system_enabled, true, "without legacy override, value from config should be used");
});

test("resolveFeatureEntitlementsForPlayer applies VEIL_DAILY_QUESTS_ENABLED legacy override", (t) => {
  withCleanState(t);
  const config = makeMinimalFlagConfig({
    quest_system_enabled: { type: "boolean", value: false, defaultValue: false, enabled: false }
  });
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () => JSON.stringify(config)
  });

  const entitlements = resolveFeatureEntitlementsForPlayer("player-1", { VEIL_DAILY_QUESTS_ENABLED: "yes" });
  assert.equal(entitlements.featureFlags.quest_system_enabled, true);
});

test("resolveFeatureEntitlementsForPlayer leaves entitlements unchanged without VEIL_DAILY_QUESTS_ENABLED", (t) => {
  withCleanState(t);
  const config = makeMinimalFlagConfig({
    quest_system_enabled: { type: "boolean", value: true, defaultValue: true, enabled: true }
  });
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () => JSON.stringify(config)
  });

  const entitlements = resolveFeatureEntitlementsForPlayer("player-1", {});
  assert.equal(entitlements.featureFlags.quest_system_enabled, true);
});
