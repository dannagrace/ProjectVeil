# Release Go/No-Go Decision Packet

`npm run release -- go-no-go-packet` assembles one operator-facing packet from the current release artifacts for a single candidate revision.

Use it after the lower-level evidence has already been generated. This command does not replace those generators:

- `npm run release -- phase1:candidate-dossier`
  - Candidate-scoped evidence bundle with detailed section drill-down.
- `npm run release -- gate:summary`
  - CI-facing pass/fail gate report and triage list.
- `npm run validate -- wechat-rc`
  - WeChat candidate summary, smoke/manual-review state, and blocker list.
- `npm run release -- wechat:commercial-verification`
  - Candidate-scoped commercial verification report for payment, delivery, analytics, compliance, and device experience.

Use the packet when the release owner, QA owner, or operator needs one final decision attachment instead of reading those artifacts separately.

Use the PR-visible summary when reviewers only need the verdict, counts, and artifact pointers in the pull request itself. Use the full packet artifact when release operators need the complete blocker, warning, and manual-review drill-down.

If the candidate is blocked by a live production incident, route the operator response through [`docs/incident-response-runbook.md`](./incident-response-runbook.md) first. The go/no-go packet is the decision artifact; the incident runbook owns severity, escalation, rollback, and post-mortem handling while the incident is active.

## What It Emits

The command writes both of these under `artifacts/release-readiness/`:

- `go-no-go-decision-packet-<candidate>-<short-sha>.json`
- `go-no-go-decision-packet-<candidate>-<short-sha>.md`

The packet always includes these operator-facing sections:

- candidate metadata
- validation summary
- commercial readiness summary
- blocker summary
- runtime observability sign-off links
- unresolved manual checks
- unresolved commercial checks

Pass, warning, and blocker items are normalized into one summary so the final reviewer can distinguish accepted risk from true release blockers.

## Usage

Use the existing dossier and gate summary for one candidate revision:

```bash
npm run release -- go-no-go-packet -- \
  --candidate phase1-wechat-rc \
  --candidate-revision abc1234
```

Pin explicit artifact paths when CI already produced the exact files you want to assemble:

```bash
npm run release -- go-no-go-packet -- \
  --dossier artifacts/release-readiness/phase1-candidate-dossier-phase1-wechat-rc-abc1234/phase1-candidate-dossier.json \
  --release-gate-summary artifacts/release-readiness/release-gate-summary-abc1234.json \
  --wechat-candidate-summary artifacts/wechat-release/codex.wechat.release-candidate-summary.json \
  --commercial-verification artifacts/wechat-release/codex.wechat.commercial-verification-abc1234.json
```

Write to explicit output files:

```bash
npm run release -- go-no-go-packet -- \
  --dossier artifacts/release-readiness/phase1-candidate-dossier-phase1-wechat-rc-abc1234/phase1-candidate-dossier.json \
  --release-gate-summary artifacts/release-readiness/release-gate-summary-abc1234.json \
  --output artifacts/release-readiness/go-no-go-decision-packet.json \
  --markdown-output artifacts/release-readiness/go-no-go-decision-packet.md
```

## Required Upstream Artifacts

The packet fails closed when required upstream evidence is missing:

- Phase 1 candidate dossier
- release gate summary
- WeChat candidate summary when the target surface is `wechat`

When you are preparing an external WeChat release decision instead of a purely technical RC verdict, also attach commercial verification evidence:

- preferred command: `npm run release -- wechat:commercial-verification -- --artifacts-dir <release-artifacts-dir>`
- preferred artifact path: `artifacts/wechat-release/codex.wechat.commercial-verification-<short-sha>.json`
- legacy compatibility input remains supported: `artifacts/wechat-release/codex.wechat.commercial-review.json`

The packet will auto-discover a current `commercial-verification` artifact from the WeChat artifacts dir before falling back to the legacy `commercial-review` file. When present, unresolved required commercial checks are folded into the final packet decision.

Those errors are intentional. The packet is the last-mile reviewer artifact, so it should not invent partial state when the underlying evidence set is incomplete.

## Operator Workflow

1. Generate or refresh the underlying candidate evidence for one fixed revision.
2. Build the candidate dossier and release gate summary for that same revision.
3. Refresh the WeChat candidate summary and manual-review metadata when the target surface is `wechat`.
4. For external release calls, run `npm run release -- wechat:commercial-verification -- --artifacts-dir <release-artifacts-dir> [--candidate <candidate-name>] [--candidate-revision <git-sha>]` to generate the formal commercial verification report for the same candidate revision.
5. Run `npm run release -- go-no-go-packet`.
6. Run `npm run release -- pr-summary -- --release-gate-summary <path> --release-health-summary <path> --go-no-go-packet <path>` to render the concise PR-visible summary markdown when you need to preview the exact reviewer digest locally.
7. In CI pull-request runs, the `Build go/no-go decision packet artifact` plus `Comment PR with release summary` steps publish or update the single bot comment in place, so reruns refresh the same PR-visible summary instead of creating duplicates.
8. Attach or inspect the Markdown packet itself when the release owner needs the full operator record.
9. If any blocker is an active `P0/P1` incident, link the active war room, incident level, and rollback/hotfix decision from [`docs/incident-response-runbook.md`](./incident-response-runbook.md) in the packet review notes before resuming release review.

If the packet still shows blocker items, clear those upstream artifacts first and regenerate the packet instead of editing the packet by hand.
