# Manual Release Evidence Owner Ledger

Use this ledger when one candidate still depends on manual release evidence that lives across multiple JSON artifacts, checklist files, or sign-off notes.

Create one copy per candidate under `artifacts/release-readiness/` or attach the same table to the release PR. Use the candidate-scoped filename convention `manual-release-evidence-owner-ledger-<candidate>-<short-sha>.md`; see `artifacts/release-readiness/manual-release-evidence-owner-ledger-phase1-rc-abc1234.md` for a tracked example. Keep it lightweight: the goal is to show, in one place, which manual sign-offs are still missing, who owns them, whether they are still fresh for this candidate revision, and which artifact proves completion.

## Candidate

- Candidate: `rc-YYYY-MM-DD`
- Target revision: `<git-sha>`
- Release owner: `<name>`
- Last updated: `<YYYY-MM-DDTHH:MM:SSZ>`
- Linked readiness snapshot: `artifacts/release-readiness/<snapshot>.json`

## Ledger

| Evidence type | Candidate | Revision | Owner | Status | Last updated | Artifact path / link | Notes / blocker context |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cocos-rc-checklist-review` | `rc-YYYY-MM-DD` | `abc123def456` | `release-owner` | `in-review` | `2026-04-02T09:40:00Z` | `artifacts/release-readiness/cocos-rc-checklist-rc-YYYY-MM-DD-abc123d.md` | Reviewing RC checklist and blocker register for this candidate. |
| `cocos-rc-blockers-review` | `rc-YYYY-MM-DD` | `abc123def456` | `release-owner` | `in-review` | `2026-04-02T09:41:00Z` | `artifacts/release-readiness/cocos-rc-blockers-rc-YYYY-MM-DD-abc123d.md` | Blocker register updated after smoke follow-up; confirm no open P0 remains. |
| `cocos-presentation-signoff` | `rc-YYYY-MM-DD` | `abc123def456` | `client-lead` | `pending` | `2026-04-02T09:42:00Z` | `artifacts/release-readiness/cocos-presentation-signoff-rc-YYYY-MM-DD-abc123d.md` | Refresh world-map capture after the latest fallback UI fix. |
| `runtime-observability-review` | `rc-YYYY-MM-DD` | `abc123def456` | `oncall-ops` | `pending` | `2026-04-02T09:45:00Z` | `artifacts/wechat-release/runtime-observability-signoff-rc-YYYY-MM-DD-abc123d.md` | Capture `/api/runtime/health`, `/api/runtime/auth-readiness`, and `/api/runtime/metrics` in the release environment. |
| `wechat-devtools-export-review` | `rc-YYYY-MM-DD` | `abc123def456` | `qa-release` | `done` | `2026-04-02T09:52:00Z` | `artifacts/wechat-release/codex.wechat.install-launch-evidence.json` | Candidate-scoped WeChat package install/import and first-launch verification is recorded for the same revision. Use `waived` only when WeChat is not the target surface. |
| `wechat-device-runtime-smoke` | `rc-YYYY-MM-DD` | `abc123def456` | `qa-release` | `done` | `2026-04-02T09:55:00Z` | `artifacts/wechat-release/codex.wechat.smoke-report.json` | Device runtime smoke evidence is current for the same candidate and revision. Use `waived` only when WeChat is not the target surface. |
| `reconnect-release-followup` | `rc-YYYY-MM-DD` | `abc123def456` | `server-oncall` | `pending` | `2026-04-02T09:58:00Z` | `artifacts/release-readiness/colyseus-reconnect-soak-summary-rc-YYYY-MM-DD-abc123d.md` | Human review still needed on the reconnect warning before release call. |

## Rules

- Keep one row per required manual evidence item for the candidate revision. Do not split ownership for one sign-off across multiple rows unless the evidence artifacts are genuinely separate.
- `Status` must stay within `pending | in-review | done | waived`.
- The ledger should cover at least the current manual Phase 1 release checks:
  - `runtime-observability-review`
  - `cocos-rc-checklist-review`
  - `cocos-rc-blockers-review`
  - `cocos-presentation-signoff` when presentation review applies to the candidate
  - `wechat-devtools-export-review` when WeChat is the target surface
  - `wechat-device-runtime-smoke` when WeChat is the target surface
  - `reconnect-release-followup` for reconnect or manual release-gate follow-ups that still require a human call
- `Candidate` and `Revision` in each row must match the header and the linked readiness snapshot, WeChat summary, RC checklist, or sign-off artifact.
- `Last updated` should be the latest timestamp at which the row status, owner, or linked artifact was confirmed.
- `Artifact path / link` should point at the exact JSON, Markdown, PR comment, or checklist file used during the release call.
- `Notes / blocker context` should answer the handoff question directly: what is waiting, who is blocked, or why the item is `waived`.
- The ledger does not replace the source artifacts. Keep the checklist, blocker register, smoke report, and sign-off files as the canonical proof; use the ledger only as the candidate-level ownership and freshness index.
- `npm run release -- gate:summary -- --manual-evidence-ledger <path>` reads both the header and the table rows. If a required row is stale, unowned, revision-drifted, `pending`, or `in-review`, the generated gate summary will surface that row directly in its triage output before the release call.

## When To Update It

Update the ledger at the same moments maintainers already touch the candidate packet:

1. Right after generating or refreshing `release:readiness:snapshot`, create the candidate ledger and pre-fill the required manual evidence rows.
2. After editing the Cocos / WeChat RC checklist or blocker register, update the matching ledger row with owner, status, timestamp, and artifact path.
3. After reviewing or regenerating the Cocos presentation sign-off, update the `cocos-presentation-signoff` row.
4. After completing WeChat package install/launch verification, device runtime smoke, or runtime observability sign-off, update those rows immediately instead of waiting for the final release call.
5. When a manual item becomes stale, blocked, waived, or complete, update the row in the same commit or PR comment that records the new evidence state.

## Minimal Operating Flow

1. Copy this template for the current candidate.
2. Pre-fill one row for each required manual check before the release review starts, even if the artifact is not ready yet.
3. Update the owner, status, timestamp, artifact path, and notes as soon as each sign-off changes state.
4. Treat the candidate as incomplete while any required row remains `pending` or `in-review`.
