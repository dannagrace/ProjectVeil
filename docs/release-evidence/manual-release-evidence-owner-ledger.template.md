# Manual Release Evidence Owner Ledger

Use this ledger when one candidate still depends on manual release evidence that lives across multiple JSON artifacts, checklist files, or sign-off notes.

Create one copy per candidate under `artifacts/release-readiness/` or attach the same table to the release PR. Keep it lightweight: the goal is to show, in one place, which manual sign-offs are still missing, who owns them, and which artifact proves completion.

## Candidate

- Candidate: `rc-YYYY-MM-DD`
- Target revision: `<git-sha>`
- Release owner: `<name>`
- Last updated: `<YYYY-MM-DDTHH:MM:SSZ>`
- Linked readiness snapshot: `artifacts/release-readiness/<snapshot>.json`

## Ledger

| Evidence item | Area | Owner | Status | Target revision | Recorded at | Artifact path / link | Follow-up status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime-observability-signoff` | Runtime health | `oncall-ops` | `pending` | `abc123def456` | `pending` | `artifacts/wechat-release/runtime-observability-signoff.json` | Capture `/api/runtime/*` evidence before release call. | Same environment as the packaged candidate. |
| `wechat-device-runtime-review` | WeChat validation | `qa-release` | `pending` | `abc123def456` | `pending` | `artifacts/wechat-release/device-runtime-review.json` | `Waiting on device smoke slot for this candidate.` | Attach smoke report plus supporting screenshots or recordings. |
| `cocos-rc-checklist-review` | RC checklist / blockers | `release-owner` | `passed` | `abc123def456` | `2026-04-02T09:40:00Z` | `artifacts/release-readiness/cocos-rc-checklist-rc-2026-04-02-abc123d.md` | `No follow-up.` | Blocker register reviewed with `none` open. |
| `presentation-signoff` | Presentation review | `client-lead` | `hold` | `abc123def456` | `2026-04-02T09:55:00Z` | `docs/cocos-phase1-presentation-signoff.md` | `Refresh world-map capture after fallback UI fix.` | Keep this row only when presentation review applies to the candidate. |

## Rules

- Keep one row per required manual evidence item for the candidate.
- `Status` should stay within `pending | passed | hold | ship-with-followups | not_applicable`.
- `Target revision` must match the candidate revision recorded in the readiness snapshot, WeChat manual-review JSON, and any RC checklist or sign-off artifact.
- `Recorded at` stays `pending` until the linked artifact exists; once complete, replace it with the artifact timestamp.
- `Artifact path / link` should point at the exact JSON, Markdown, PR comment, or checklist file used during the release call.
- `Follow-up status` should answer the operational question directly: what is waiting, who is blocked, or why the item is allowed to ship with follow-ups.

## Minimal Operating Flow

1. Copy this template for the current candidate.
2. Pre-fill one row for each manual check that is still required.
3. Update the row as soon as the sign-off artifact lands.
4. Treat the candidate as incomplete while any required row remains `pending` or `hold`.
