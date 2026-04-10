# Feature Flag Experiment Runbook

Issue #893 adds a minimal experiment layer on top of `configs/feature-flags.json`.
Issue #1203 adds an ops safety net for production flag rollout, with rollout stage metadata, audit history, and runtime checksum visibility.

## Current Flag Status

- `quest_system_enabled`: enabled by default as of 2026-04-08. Daily quest board, UTC daily rotation, progress tracking, and reward claims are live in the default config.
- Roll back `quest_system_enabled` by setting `value: false` in `configs/feature-flags.json`, or use `VEIL_FEATURE_FLAGS_JSON` / `VEIL_DAILY_QUESTS_ENABLED=off` as an emergency override while investigating.
- `battle_pass_enabled`: enabled by default as of 2026-04-10. The Cocos season pass panel, season progress sync, and reward claim flow are live in the default config.
- Roll back `battle_pass_enabled` by setting `value: false` in `configs/feature-flags.json`, or use `VEIL_FEATURE_FLAGS_JSON` as an emergency override while investigating.
- `battle_pass_enabled` is now the first flag with a production rollout policy under `operations.rolloutPolicies.battle_pass_enabled`. The live value remains `rollout: 1`, but all future percentage changes should follow the stage gates below and append an `operations.auditHistory[]` entry.

## Config Shape

Experiments and rollout operations live beside `flags` in the same config document:

```json
{
  "schemaVersion": 1,
  "flags": {},
  "operations": {
    "rolloutPolicies": {
      "battle_pass_enabled": {
        "owner": "ops-oncall",
        "stages": [
          { "key": "canary-1", "rollout": 0.01, "holdMinutes": 30, "monitorWindowMinutes": 30 },
          { "key": "batch-10", "rollout": 0.1, "holdMinutes": 30, "monitorWindowMinutes": 30 },
          { "key": "batch-50", "rollout": 0.5, "holdMinutes": 60, "monitorWindowMinutes": 60 },
          { "key": "full", "rollout": 1, "holdMinutes": 120, "monitorWindowMinutes": 120 }
        ],
        "alertThresholds": {
          "errorRate": 0.02,
          "sessionFailureRate": 0.01,
          "paymentFailureRate": 0.02
        },
        "rollback": {
          "mode": "automatic",
          "maxConfigAgeMinutes": 5,
          "cooldownMinutes": 30
        }
      }
    },
    "auditHistory": [
      {
        "at": "2026-04-11T00:30:00.000Z",
        "actor": "ConfigOps",
        "summary": "battle pass rollout guardrail baseline",
        "flagKeys": ["battle_pass_enabled"],
        "ticket": "#1203"
      }
    ]
  },
  "experiments": {
    "account_portal_copy": {
      "name": "Account Portal Upgrade Copy",
      "owner": "growth",
      "enabled": true,
      "startAt": "2026-04-05T00:00:00.000Z",
      "fallbackVariant": "control",
      "variants": [
        { "key": "control", "allocation": 50 },
        { "key": "upgrade", "allocation": 50 }
      ],
      "whitelist": {
        "pm-demo-player": "upgrade"
      }
    }
  }
}
```

Rules:

- `allocation` is a stable 0-100 bucket share per variant.
- The remaining unallocated percentage falls back to `fallbackVariant`.
- `whitelist` overrides hashing and is the fastest way to QA a treatment.
- `startAt` and `endAt` gate rollout without code changes.
- `operations.rolloutPolicies.<flag>.stages[]` is the operator SOP for percentage rollout; it is metadata, not an automatic mutator.
- `operations.rolloutPolicies.<flag>.alertThresholds` defines the stop-the-line threshold used by docs/alerts and by the runtime observability endpoint.
- `operations.auditHistory[]` is append-only operator evidence: who changed what, when, and against which ticket.

## Runtime Behavior

- Assignment is deterministic per `playerId + experimentKey`.
- `/api/player-accounts/me` returns normalized `account.experiments[]`.
- The H5 account card consumes `account_portal_copy` and changes the account-upgrade CTA copy.
- The server emits `experiment_exposure` when the profile payload is returned.
- The server emits `experiment_conversion` when the player successfully binds a password account from that surface.
- The server now exposes `/api/runtime/feature-flags`, which returns the currently loaded config checksum, load/check timestamps, rollout policy summaries, and audit history.
- Prometheus now exports `veil_feature_flag_config_stale`, `veil_feature_flag_config_cache_age_seconds`, and `veil_feature_flag_rollout_ratio{flag=...,owner=...}` to support rollout-card alerts.

## Gray Release SOP

### Battle Pass Gray Release Stage Gates

Use `battle_pass_enabled` as the first exercise and keep the same revision throughout the whole rollout:

1. `canary-1` (`rollout: 0.01`, hold 30m)
   Verify internal accounts and low-risk traffic only. Watch `VeilFeatureFlagBattlePassErrorRateHigh`, `VeilFeatureFlagBattlePassSessionFailuresHigh`, and `VeilFeatureFlagConfigStale`.
2. `batch-10` (`rollout: 0.1`, hold 30m)
   Require all nodes to report the same `/api/runtime/feature-flags` checksum before promotion.
3. `batch-50` (`rollout: 0.5`, hold 60m)
   Confirm battle pass progress sync, reward claim flow, and WeChat payment-related errors stay below the configured thresholds.
4. `full` (`rollout: 1`, hold 120m)
   Keep the alerting card in warning-free state for two hours before removing the rollout label.

Stop promotion immediately when any of these conditions is true:

- 15-minute feature-area error rate exceeds `2%`
- 15-minute auth/session failure rate exceeds `1%`
- 15-minute payment failure-related error rate exceeds `2%`
- any node reports `veil_feature_flag_config_stale == 1`
- any node exposes a checksum mismatch for the same candidate/revision

## Audit And Consistency

- Every rollout step must update both `flags.<flag>.rollout` and `operations.auditHistory[]`.
- `operations.auditHistory[]` entries should include `actor`, `summary`, `flagKeys`, and `ticket`; use `approvedBy`, `changeId`, and `rollback: true` when applicable.
- `VEIL_FEATURE_FLAGS_RELOAD_INTERVAL_MS` controls how often each node re-checks the flag file. The default is 30 seconds.
- `/api/runtime/feature-flags` returns `loadedAt`, `lastCheckedAt`, `sourceUpdatedAt`, and `checksum`; use these fields to prove multi-node consistency before each promotion.
- A node is considered stale if it has not re-checked the source inside the configured freshness window. This is surfaced as `veil_feature_flag_config_stale`.

## Rollout

1. Start with `enabled: true` and low allocations such as `5` or `10`.
2. Use `whitelist` for PM/QA verification before broadening traffic.
3. Increase `allocation` in place. Existing players stay in stable buckets.
4. Watch analytics for `experiment_exposure` and `experiment_conversion` by `experimentKey`, `variant`, and `bucket`.

## Rollback

Use the smallest safe rollback first:

- Set all live allocations to `0`.
- Or set `enabled: false`.
- Or move a specific player to `whitelist` for incident triage.

All three paths fall back to `fallbackVariant` without requiring client redeploys.

## Audit

- The assigned variant, owner, fallback variant, and bucket are returned in the profile payload.
- The H5 account card renders the active experiment summary for quick spot checks.
- Exposure and conversion analytics reuse the shared schema catalog, so downstream reporting stays versioned and explicit.
- Flag rollout audit evidence now also lives in `configs/feature-flags.json` under `operations.auditHistory[]`, and the live server view is available at `/api/runtime/feature-flags`.
