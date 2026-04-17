import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FEATURE_FLAG_CONFIG,
  evaluateExperiments,
  evaluateFeatureFlags,
  normalizeFeatureFlagConfigDocument,
  normalizeExperimentAssignments,
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

test("default feature flags keep pve enabled", () => {
  const flags = evaluateFeatureFlags("player-1", DEFAULT_FEATURE_FLAG_CONFIG);
  assert.equal(flags.pve_enabled, true);
});

test("experiments assign stable buckets, respect whitelist, and fall back outside allocation", () => {
  const config = normalizeFeatureFlagConfigDocument({
    schemaVersion: 1,
    flags: DEFAULT_FEATURE_FLAG_CONFIG.flags,
    experiments: {
      account_portal_copy: {
        name: "Account Portal Upgrade Copy",
        owner: "growth",
        enabled: true,
        startAt: "2026-04-05T00:00:00.000Z",
        fallbackVariant: "control",
        whitelist: {
          "vip-player": "upgrade"
        },
        variants: [
          { key: "control", allocation: 10 },
          { key: "upgrade", allocation: 10 }
        ]
      }
    }
  });

  const first = evaluateExperiments("player-42", config, new Date("2026-04-05T12:00:00.000Z"));
  const second = evaluateExperiments("player-42", config, new Date("2026-04-05T12:00:00.000Z"));
  const whitelisted = evaluateExperiments("vip-player", config, new Date("2026-04-05T12:00:00.000Z"));

  assert.deepEqual(first, second);
  assert.equal(first[0]?.experimentKey, "account_portal_copy");
  assert.equal(typeof first[0]?.bucket, "number");
  assert.equal(whitelisted[0]?.variant, "upgrade");
  assert.equal(whitelisted[0]?.reason, "whitelist");
  assert.equal(first[0]?.bucket != null && first[0].bucket >= 20, first[0]?.assigned === false || first[0]?.variant === "control");
});

test("feature flag config normalizes dynamic experiments with traffic allocation metadata", () => {
  const config = normalizeFeatureFlagConfigDocument({
    schemaVersion: 1,
    flags: DEFAULT_FEATURE_FLAG_CONFIG.flags,
    experiments: {
      shop_headline_2026_05: {
        name: "Shop Headline May 2026",
        owner: "monetization",
        enabled: true,
        trafficAllocation: 25,
        stickyBucketKey: "wechat_open_id",
        fallbackVariant: "control",
        variants: [
          { key: "control", allocation: 10 },
          { key: "value", allocation: 15 }
        ]
      }
    }
  });

  assert.equal(config.experiments?.shop_headline_2026_05?.trafficAllocation, 25);
  assert.equal(config.experiments?.shop_headline_2026_05?.stickyBucketKey, "wechat_open_id");

  const assignment = evaluateExperiments("player-42", config, new Date("2026-05-10T12:00:00.000Z")).find(
    (entry) => entry.experimentKey === "shop_headline_2026_05"
  );
  assert.ok(assignment);
  assert.equal(assignment?.trafficAllocation, 25);
  assert.equal(assignment?.stickyBucketKey, "wechat_open_id");
  assert.ok(["bucket", "traffic_cap", "fallback"].includes(assignment?.reason ?? ""));
});

test("normalize experiment assignments drops malformed records", () => {
  assert.deepEqual(
    normalizeExperimentAssignments([
      {
        experimentKey: "account_portal_copy",
        experimentName: "Account Portal Upgrade Copy",
        owner: "growth",
        bucket: 12,
        trafficAllocation: 100,
        stickyBucketKey: "player_id",
        variant: "upgrade",
        fallbackVariant: "control",
        assigned: true,
        reason: "bucket"
      },
      {
        experimentKey: "",
        variant: "control"
      }
    ]),
    [
      {
        experimentKey: "account_portal_copy",
        experimentName: "Account Portal Upgrade Copy",
        owner: "growth",
        bucket: 12,
        trafficAllocation: 100,
        stickyBucketKey: "player_id",
        variant: "upgrade",
        fallbackVariant: "control",
        assigned: true,
        reason: "bucket"
      }
    ]
  );
});

test("feature flag config normalizes rollout policies and audit history", () => {
  const config = normalizeFeatureFlagConfigDocument({
    schemaVersion: 1,
    flags: DEFAULT_FEATURE_FLAG_CONFIG.flags,
    operations: {
      rolloutPolicies: {
        battle_pass_enabled: {
          owner: "ops-oncall",
          stages: [
            { key: "full", rollout: 1, holdMinutes: 60, monitorWindowMinutes: 60 },
            { key: "canary", rollout: 0.01, holdMinutes: 30, monitorWindowMinutes: 30 }
          ],
          alertThresholds: {
            errorRate: 2,
            sessionFailureRate: -1,
            paymentFailureRate: 0.02
          },
          rollback: {
            mode: "automatic",
            maxConfigAgeMinutes: 0,
            cooldownMinutes: -5
          }
        }
      },
      auditHistory: [
        {
          at: "2026-04-11T01:00:00.000Z",
          actor: "ConfigOps",
          summary: "approved canary rollout",
          flagKeys: ["battle_pass_enabled"],
          ticket: "#1203"
        },
        {
          at: "invalid",
          actor: "",
          summary: "",
          flagKeys: []
        }
      ]
    }
  });

  assert.equal(config.operations?.rolloutPolicies?.battle_pass_enabled?.stages[0]?.key, "canary");
  assert.equal(config.operations?.rolloutPolicies?.battle_pass_enabled?.alertThresholds.errorRate, 1);
  assert.equal(config.operations?.rolloutPolicies?.battle_pass_enabled?.alertThresholds.sessionFailureRate, 0);
  assert.equal(config.operations?.rolloutPolicies?.battle_pass_enabled?.rollback.maxConfigAgeMinutes, 1);
  assert.equal(config.operations?.rolloutPolicies?.battle_pass_enabled?.rollback.cooldownMinutes, 0);
  assert.equal(config.operations?.auditHistory?.length, 1);
  assert.equal(config.operations?.auditHistory?.[0]?.ticket, "#1203");
});

test("analytics event catalog validates", () => {
  assert.deepEqual(validateAnalyticsEventCatalog(), {
    valid: true,
    errors: []
  });
});
