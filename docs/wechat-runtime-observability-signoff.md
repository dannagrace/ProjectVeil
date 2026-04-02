# WeChat Runtime Observability Sign-Off

This sign-off is the manual release contract for proving that the WeChat candidate can still be observed in the target runtime, not just launched.

Use it together with:

- [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md)
- [`docs/release-evidence/wechat-release-manual-review.example.json`](./release-evidence/wechat-release-manual-review.example.json)
- [`docs/release-evidence/cocos-wechat-rc-checklist.template.md`](./release-evidence/cocos-wechat-rc-checklist.template.md)
- [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md)

## Required Evidence

For the same candidate revision, capture and attach:

- `/api/runtime/health`
  - Confirm the payload is live for the release environment and note `activeRoomCount`, `connectionCount`, `gameplayTraffic`, and auth summary.
- `/api/runtime/diagnostic-snapshot`
  - Confirm the response renders the current room overview and diagnostics state.
  - `?format=text` is acceptable when it is easier to attach to PR or artifact logs.
- `/api/runtime/metrics`
  - Capture at least one scrape/export showing the runtime metrics endpoint is reachable for the same environment.
- Reviewer decision
  - Record owner, `recordedAt`, revision, artifact path, and any follow-up or accepted risk.
  - Mirror the same owner, revision, artifact path, and follow-up status into the manual evidence owner ledger so the candidate handoff still has one pending-signoff view.

## Minimum Review Questions

- Does the target environment expose the runtime health, diagnostic, and metrics endpoints for this candidate revision?
- Do the responses show coherent room, connection, and gameplay counters instead of empty or obviously stale data?
- Are any alerts, missing dimensions, or environment-specific caveats documented in the sign-off artifact or blocker register?

## Suggested Artifact Shape

Store one small JSON or Markdown artifact at `artifacts/wechat-release/runtime-observability-signoff.json` and reference it from the WeChat manual-review file.

Keep the artifact scoped to:

- candidate revision and environment
- endpoint captures or links
- reviewer / timestamp
- conclusion: `passed | hold | ship-with-followups`
- follow-ups or blocker IDs
