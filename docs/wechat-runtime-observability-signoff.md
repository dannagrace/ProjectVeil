# WeChat Runtime Observability Sign-Off

This sign-off is the manual release contract for proving that the WeChat candidate can still be observed in the target runtime, not just launched.

Use it together with:

- [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md)
- [`docs/release-evidence/wechat-runtime-observability-signoff.template.md`](./release-evidence/wechat-runtime-observability-signoff.template.md)
- [`docs/release-evidence/wechat-release-manual-review.example.json`](./release-evidence/wechat-release-manual-review.example.json)
- [`docs/release-evidence/cocos-wechat-rc-checklist.template.md`](./release-evidence/cocos-wechat-rc-checklist.template.md)
- [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md)

## When This Artifact Is Required

Treat this sign-off as candidate-scoped release evidence, not a reusable ops note.

- Required for every WeChat `release candidate` or `shipping candidate`.
- Required when assembling the same-revision release evidence packet described in [`docs/same-revision-release-evidence-runbook.md`](./same-revision-release-evidence-runbook.md).
- Re-record it whenever the candidate revision changes, or when the candidate touches runtime observability surfaces such as runtime endpoints, metrics dimensions, diagnostic payloads, or alerting assumptions.

Use the dedicated template at [`docs/release-evidence/wechat-runtime-observability-signoff.template.md`](./release-evidence/wechat-runtime-observability-signoff.template.md) so the output stays aligned with the repo's other release evidence artifacts.

When possible, generate the candidate-scoped probe packet first with:

```bash
npm run release:runtime-observability:evidence -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha> \
  --target-surface wechat \
  --target-environment <env-name> \
  --server-url <base-url>
```

That JSON/Markdown pair is the repo-native source artifact for the sign-off. The reviewer sign-off should reference the generated evidence path instead of pasting ad hoc endpoint output into manual notes.

## Required Evidence

For the same candidate revision, capture and attach:

- `/api/runtime/health`
  - Confirm the payload is live for the release environment and note `activeRoomCount`, `connectionCount`, `gameplayTraffic`, and auth summary.
- `/api/runtime/auth-readiness`
  - Confirm the auth summary is reachable for the same release environment and records a coherent `status` for the candidate.
- `/api/runtime/metrics`
  - Capture at least one scrape/export showing the runtime metrics endpoint is reachable for the same environment.
- Optional supporting diagnostic: `/api/runtime/diagnostic-snapshot`
  - Attach this when it helps explain a warning, blocker, or accepted follow-up, but do not use it as a substitute for `health`, `auth-readiness`, or `metrics`.
- Reviewer decision
  - Record owner, `recordedAt`, revision, artifact path, and any follow-up or accepted risk.
  - Mirror the same owner, revision, artifact path, and follow-up status into the manual evidence owner ledger so the candidate handoff still has one pending-signoff view.

## Minimum Review Questions

- Does the target environment expose the runtime health, diagnostic, and metrics endpoints for this candidate revision?
- Do the responses show coherent room, connection, and gameplay counters instead of empty or obviously stale data?
- Are any alerts, missing dimensions, or environment-specific caveats documented in the sign-off artifact or blocker register?

## Suggested Artifact Shape

Store one small JSON or Markdown artifact under `artifacts/wechat-release/` or `artifacts/release-readiness/` and reference it from the WeChat manual-review file.

Keep the artifact scoped to:

- candidate revision and environment
- endpoint captures or links for `health`, `auth-readiness`, and `metrics`
- reviewer / timestamp
- conclusion: `passed | hold | ship-with-followups`
- follow-ups or blocker IDs

The preferred Markdown shape is the template at [`docs/release-evidence/wechat-runtime-observability-signoff.template.md`](./release-evidence/wechat-runtime-observability-signoff.template.md). If you emit JSON instead, keep the same fields: candidate, target revision, environment, reviewer, recorded timestamp, per-endpoint status, conclusion, and follow-ups. Add `/api/runtime/diagnostic-snapshot` only as supporting context when needed.
