# Phase 1 Same-Revision Evidence Bundle

`npm run release:phase1:same-revision-evidence-bundle` assembles the Phase 1 release packet for one candidate revision and emits one machine-readable manifest that links the required evidence artifacts.

It is the candidate-scoped assembly command for the release owner path described in [`docs/same-revision-release-evidence-runbook.md`](./same-revision-release-evidence-runbook.md). The command does not replace manual approvals. It creates or reuses the candidate-scoped manual placeholder artifacts, validates same-revision coherence, and writes one manifest plus one Markdown summary in a stable bundle directory.

## What It Produces

The bundle manifest records:

- release readiness snapshot
- H5 packaged smoke evidence when provided
- reconnect soak evidence
- Phase 1 persistence evidence
- Cocos RC bundle plus linked RC snapshot/checklist/blockers artifacts
- release gate summary
- release readiness dashboard
- manual evidence owner ledger
- WeChat runtime observability placeholder when the target surface is `wechat`

The manifest fails closed when a required artifact is missing, stale, or revision-mismatched.

## Usage

Reuse already-generated candidate artifacts:

```bash
npm run release:phase1:same-revision-evidence-bundle -- \
  --candidate phase1-rc \
  --candidate-revision "$(git rev-parse HEAD)" \
  --target-surface h5 \
  --snapshot artifacts/release-readiness/release-readiness-phase1-rc.json \
  --h5-smoke artifacts/release-readiness/client-release-candidate-smoke-phase1-rc.json \
  --reconnect-soak artifacts/release-readiness/colyseus-reconnect-soak-summary-phase1-rc.json \
  --phase1-persistence artifacts/release-readiness/phase1-release-persistence-regression-phase1-rc.json
```

Let the command generate the automated artifacts it can own directly:

```bash
npm run release:phase1:same-revision-evidence-bundle -- \
  --candidate phase1-rc \
  --candidate-revision "$(git rev-parse HEAD)" \
  --target-surface wechat \
  --wechat-artifacts-dir artifacts/wechat-release
```

## Output Contract

By default the command writes into:

- `artifacts/release-readiness/phase1-same-revision-evidence-bundle-<candidate>-<short-sha>/`

Key outputs:

- `phase1-same-revision-evidence-bundle-manifest.json`
- `phase1-same-revision-evidence-bundle.md`
- generated or copied candidate-scoped artifact files

The JSON manifest is the CI/operator integration point. It contains:

- candidate metadata and bundle directory
- machine-readable artifact references
- manual evidence placeholder references
- downstream status from the release gate summary, dashboard, and Cocos RC bundle
- same-revision validation findings with explicit failure codes

## Operator Flow

1. Pin the candidate name and git revision.
2. Run the bundle command with either explicit artifact paths or enough inputs for the command to generate them.
3. Open `phase1-same-revision-evidence-bundle.md` for the reviewer summary.
4. If the manifest reports `stale`, `missing`, or `revision_mismatch`, refresh the upstream artifact named in the finding instead of editing the manifest.
5. Update the generated manual evidence owner ledger and, for WeChat, the runtime observability placeholder as reviewers complete manual sign-off.

## Notes

- The bundle command validates same-revision coherence itself. It is intentionally stricter about missing/stale/revision drift than about placeholder rows that are still waiting on human sign-off.
- The generated dashboard is kept in the same bundle for reviewer convenience, but the bundle manifest is the canonical machine-readable same-revision contract for this workflow.
