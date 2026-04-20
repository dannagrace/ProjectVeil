import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  clearCachedFeatureFlagConfig,
  configureFeatureFlagRuntimeDependencies,
  getRuntimeKillSwitchSnapshot,
  getFeatureFlagRuntimeSnapshot,
  loadFeatureFlagConfig,
  resetFeatureFlagRuntimeDependencies,
  resolveMinimumSupportedClientVersion,
  resolveFeatureEntitlementsForPlayer,
  resolveFeatureFlagsForPlayer
} from "../src/feature-flags";
import { DEFAULT_FEATURE_FLAG_CONFIG, type FeatureFlagConfigDocument } from "@veil/shared/platform";

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
    VEIL_FEATURE_FLAGS_RELOAD_INTERVAL_MS: process.env.VEIL_FEATURE_FLAGS_RELOAD_INTERVAL_MS,
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

test("loadFeatureFlagConfig reloads the file after the refresh interval when mtime changes", (t) => {
  withCleanState(t);
  let nowMs = Date.parse("2026-04-11T00:00:00.000Z");
  let mtimeMs = Date.parse("2026-04-11T00:00:00.000Z");
  let fileConfig = makeMinimalFlagConfig({
    battle_pass_enabled: { type: "boolean", value: true, defaultValue: false, enabled: true, rollout: 0.01 }
  });

  configureFeatureFlagRuntimeDependencies({
    now: () => nowMs,
    statSync: () => ({ mtimeMs } as never),
    readFileSync: () => JSON.stringify(fileConfig)
  });

  const first = loadFeatureFlagConfig({ VEIL_FEATURE_FLAGS_RELOAD_INTERVAL_MS: "1000" });
  assert.equal(first.flags.battle_pass_enabled.rollout, 0.01);

  nowMs += 500;
  fileConfig = makeMinimalFlagConfig({
    battle_pass_enabled: { type: "boolean", value: true, defaultValue: false, enabled: true, rollout: 0.5 }
  });
  const cached = loadFeatureFlagConfig({ VEIL_FEATURE_FLAGS_RELOAD_INTERVAL_MS: "1000" });
  assert.equal(cached.flags.battle_pass_enabled.rollout, 0.01);

  nowMs += 1_500;
  mtimeMs += 2_000;
  const reloaded = loadFeatureFlagConfig({ VEIL_FEATURE_FLAGS_RELOAD_INTERVAL_MS: "1000" });
  assert.equal(reloaded.flags.battle_pass_enabled.rollout, 0.5);
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
    statSync: (filePath) => ({ mtimeMs: Date.parse("2026-04-11T00:00:00.000Z"), path: filePath } as never),
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

test("resolveMinimumSupportedClientVersion prefers channel-specific runtime gate values", (t) => {
  withCleanState(t);
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () =>
      JSON.stringify({
        ...DEFAULT_FEATURE_FLAG_CONFIG,
        runtimeGates: {
          clientMinVersion: {
            defaultVersion: "1.0.0",
            channels: {
              wechat: "1.0.7",
              h5: "1.0.2"
            }
          }
        }
      })
  });

  assert.equal(resolveMinimumSupportedClientVersion("wechat", {}), "1.0.7");
  assert.equal(resolveMinimumSupportedClientVersion("h5", {}), "1.0.2");
  assert.equal(resolveMinimumSupportedClientVersion(null, {}), "1.0.0");
});

test("getRuntimeKillSwitchSnapshot exposes kill switches and active version overrides", (t) => {
  withCleanState(t);
  configureFeatureFlagRuntimeDependencies({
    readFileSync: () =>
      JSON.stringify({
        ...DEFAULT_FEATURE_FLAG_CONFIG,
        runtimeGates: {
          clientMinVersion: {
            defaultVersion: "1.0.1",
            channels: {
              wechat: "1.0.8"
            },
            upgradeMessage: "force upgrade"
          },
          killSwitches: {
            wechat_matchmaking: {
              enabled: true,
              label: "微信匹配入口",
              channels: ["wechat"]
            }
          }
        }
      })
  });

  const snapshot = getRuntimeKillSwitchSnapshot({});
  assert.equal(snapshot.clientMinVersion.activeVersion, "1.0.1");
  assert.equal(snapshot.clientMinVersion.channels.wechat, "1.0.8");
  assert.equal(snapshot.clientMinVersion.upgradeMessage, "force upgrade");
  assert.equal(snapshot.killSwitches[0]?.key, "seasonal_live_ops");
  assert.equal(snapshot.killSwitches.find((entry) => entry.key === "wechat_matchmaking")?.enabled, true);
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

test("getFeatureFlagRuntimeSnapshot reports checksum, source timestamps, and rollout audit metadata", (t) => {
  withCleanState(t);
  const nowMs = Date.parse("2026-04-11T01:30:00.000Z");
  const mtimeMs = Date.parse("2026-04-11T01:25:00.000Z");
  configureFeatureFlagRuntimeDependencies({
    now: () => nowMs,
    statSync: () => ({ mtimeMs } as never),
    readFileSync: () =>
      JSON.stringify({
        schemaVersion: 1,
        flags: {
          ...DEFAULT_FEATURE_FLAG_CONFIG.flags
        },
        operations: {
          rolloutPolicies: {
            battle_pass_enabled: {
              owner: "ops-oncall",
              stages: [
                { key: "canary-1", rollout: 0.01, holdMinutes: 30, monitorWindowMinutes: 30 },
                { key: "full", rollout: 1, holdMinutes: 60, monitorWindowMinutes: 60 }
              ],
              alertThresholds: {
                errorRate: 0.02,
                sessionFailureRate: 0.01,
                paymentFailureRate: 0.02
              },
              rollback: {
                mode: "automatic",
                maxConfigAgeMinutes: 5,
                cooldownMinutes: 30
              }
            }
          },
          auditHistory: [
            {
              at: "2026-04-11T01:20:00.000Z",
              actor: "ConfigOps",
              summary: "battle pass canary plan approved",
              flagKeys: ["battle_pass_enabled"],
              ticket: "#1203"
            }
          ]
        }
      })
  });

  const snapshot = getFeatureFlagRuntimeSnapshot({ VEIL_FEATURE_FLAGS_RELOAD_INTERVAL_MS: "1000" });

  assert.equal(snapshot.metadata.source, "file");
  assert.equal(snapshot.metadata.sourceUpdatedAt, "2026-04-11T01:25:00.000Z");
  assert.equal(snapshot.metadata.loadedAt, "2026-04-11T01:30:00.000Z");
  assert.equal(snapshot.metadata.lastCheckedAt, "2026-04-11T01:30:00.000Z");
  assert.equal(snapshot.metadata.stale, false);
  assert.equal(snapshot.config.operations?.auditHistory?.[0]?.ticket, "#1203");
  assert.equal(snapshot.config.operations?.rolloutPolicies?.battle_pass_enabled?.rollback.mode, "automatic");
  assert.match(snapshot.metadata.checksum, /^[a-f0-9]{64}$/);
});
