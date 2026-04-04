import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FEATURE_FLAG_CONFIG,
  evaluateFeatureFlags,
  normalizeFeatureFlagConfigDocument,
  validateAnalyticsEventCatalog
} from "../src/index.ts";

test("feature flags evaluate rollout deterministically by player id", () => {
  const config = normalizeFeatureFlagConfigDocument({
    schemaVersion: 1,
    flags: {
      ...DEFAULT_FEATURE_FLAG_CONFIG.flags,
      quest_system_enabled: {
        type: "boolean",
        value: true,
        defaultValue: false,
        rollout: 0.5,
        enabled: true
      }
    }
  });

  const first = evaluateFeatureFlags("player-42", config);
  const second = evaluateFeatureFlags("player-42", config);
  const other = evaluateFeatureFlags("player-99", config);

  assert.deepEqual(first, second);
  assert.equal(typeof first.quest_system_enabled, "boolean");
  assert.equal(typeof other.quest_system_enabled, "boolean");
});

test("feature flags fall back to defaults when disabled", () => {
  const config = normalizeFeatureFlagConfigDocument({
    schemaVersion: 1,
    flags: {
      ...DEFAULT_FEATURE_FLAG_CONFIG.flags,
      tutorial_enabled: {
        type: "boolean",
        value: true,
        defaultValue: false,
        enabled: false,
        rollout: 1
      }
    }
  });

  assert.equal(evaluateFeatureFlags("player-1", config).tutorial_enabled, false);
});

test("analytics event catalog validates", () => {
  assert.deepEqual(validateAnalyticsEventCatalog(), {
    valid: true,
    errors: []
  });
});
