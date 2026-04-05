# Feature Flag Experiment Runbook

Issue #893 adds a minimal experiment layer on top of `configs/feature-flags.json`.

## Config Shape

Experiments live beside `flags` in the same config document:

```json
{
  "schemaVersion": 1,
  "flags": {},
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

## Runtime Behavior

- Assignment is deterministic per `playerId + experimentKey`.
- `/api/player-accounts/me` returns normalized `account.experiments[]`.
- The H5 account card consumes `account_portal_copy` and changes the account-upgrade CTA copy.
- The server emits `experiment_exposure` when the profile payload is returned.
- The server emits `experiment_conversion` when the player successfully binds a password account from that surface.

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
