# Manual Release Evidence Owner Ledger

This example shows the candidate-scoped ledger format maintainers should keep under `artifacts/release-readiness/` when manual release evidence is still in flight for one candidate revision.

## Candidate

- Candidate: `phase1-rc`
- Target revision: `abc1234`
- Release owner: `release-owner`
- Last updated: `2026-04-02T08:42:00Z`
- Linked readiness snapshot: `artifacts/release-readiness/release-readiness-2026-04-02T08-30-00.000Z.json`

## Ledger

| Evidence type | Candidate | Revision | Owner | Status | Last updated | Artifact path / link | Notes / blocker context |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime-observability-review` | `phase1-rc` | `abc1234` | `oncall-ops` | `in-review` | `2026-04-02T08:32:00Z` | `artifacts/wechat-release/runtime-observability-signoff-phase1-rc-abc1234.md` | Reviewing `/api/runtime/health`, `/api/runtime/auth-readiness`, and `/api/runtime/metrics` from the release environment before the release call. |
| `cocos-rc-checklist-review` | `phase1-rc` | `abc1234` | `release-owner` | `done` | `2026-04-02T08:35:00Z` | `artifacts/release-readiness/cocos-rc-checklist-phase1-rc-abc1234.md` | Candidate checklist reviewed and aligned with the current readiness snapshot. |
| `cocos-rc-blockers-review` | `phase1-rc` | `abc1234` | `release-owner` | `in-review` | `2026-04-02T08:36:00Z` | `artifacts/release-readiness/cocos-rc-blockers-phase1-rc-abc1234.md` | Waiting on final blocker-owner confirmation that no open P0 remains. |
| `cocos-presentation-signoff` | `phase1-rc` | `abc1234` | `client-lead` | `pending` | `2026-04-02T08:38:00Z` | `artifacts/release-readiness/cocos-presentation-signoff-phase1-rc-abc1234.md` | Need updated world-map capture after the latest placeholder-art swap. |
| `wechat-devtools-export-review` | `phase1-rc` | `abc1234` | `qa-release` | `done` | `2026-04-02T08:39:00Z` | `artifacts/wechat-release/codex.wechat.release-candidate-summary.json` | DevTools export metadata and revision match the candidate. |
| `wechat-device-runtime-smoke` | `phase1-rc` | `abc1234` | `qa-release` | `done` | `2026-04-02T08:40:00Z` | `artifacts/wechat-release/codex.wechat.smoke-report.json` | Device/quasi-device smoke evidence is current for this candidate revision. |
| `reconnect-release-followup` | `phase1-rc` | `abc1234` | `server-oncall` | `pending` | `2026-04-02T08:41:00Z` | `artifacts/release-readiness/colyseus-reconnect-soak-summary-phase1-rc-abc1234.json` | Human call still needed on the reconnect warning before promotion. |

## Maintainer Update Loop

1. Copy the template as `artifacts/release-readiness/manual-release-evidence-owner-ledger-<candidate>-<short-sha>.md` as soon as the candidate snapshot exists.
2. Pre-fill one row per required manual evidence family before the review starts, even if the status is still `pending`.
3. Update the matching row in the same commit or PR comment whenever the checklist, blocker log, runtime sign-off, or WeChat review artifact changes.
4. Treat the candidate as incomplete while any required row remains `pending` or `in-review`.
