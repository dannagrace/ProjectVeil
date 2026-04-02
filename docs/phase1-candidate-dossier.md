# Phase 1 Candidate Dossier

`npm run release:phase1:candidate-dossier` folds the current Phase 1 exit evidence for one candidate revision into a single JSON dossier plus a Markdown attachment.

It now also emits one explicit candidate-level `Phase 1 exit evidence gate` so reviewers can make the final pass/pending/fail call from one object instead of re-interpreting each evidence section by hand.

The Markdown artifact is the canonical reviewer-facing attachment for one candidate revision: it records the candidate metadata, selected evidence inputs, the single Phase 1 exit gate decision, and the per-section drill-down in one place.

The command stays intentionally thin and reuses the existing evidence producers:

- `npm run release:readiness:snapshot`
- `npm run release:cocos-rc:bundle`
- `npm run validate:wechat-rc` / `codex.wechat.release-candidate-summary.json`
- `npm run release:reconnect-soak -- --candidate <candidate-name> --candidate-revision <git-sha>`
- `npm run test:phase1-release-persistence`
- `npm run release:gate:summary`
- `npm run release:health:summary`
- `GET /api/runtime/health`
- `GET /api/runtime/auth-readiness`
- `GET /api/runtime/metrics`

## Usage

Use the latest local artifacts and sample live runtime evidence:

```bash
npm run release:phase1:candidate-dossier -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha> \
  --server-url http://127.0.0.1:2567
```

Pin explicit artifact paths when CI already produced stable filenames:

```bash
npm run release:phase1:candidate-dossier -- \
  --candidate phase1-wechat-rc \
  --candidate-revision abc1234 \
  --snapshot artifacts/release-readiness/release-readiness-abc1234.json \
  --cocos-bundle artifacts/release-readiness/cocos-rc-evidence-bundle-phase1-wechat-rc-abc1234.json \
  --reconnect-soak artifacts/release-readiness/colyseus-reconnect-soak-summary-phase1-wechat-rc-abc1234.json \
  --wechat-candidate-summary artifacts/wechat-release/codex.wechat.release-candidate-summary.json \
  --phase1-persistence artifacts/release-readiness/phase1-release-persistence-regression-abc1234.json \
  --server-url http://127.0.0.1:2567
```

Write to explicit output files:

```bash
npm run release:phase1:candidate-dossier -- \
  --candidate phase1-wechat-rc \
  --candidate-revision abc1234 \
  --output artifacts/release-readiness/phase1-candidate-dossier.json \
  --markdown-output artifacts/release-readiness/phase1-candidate-dossier.md
```

## Default Outputs

If you do not pass output flags, the script writes:

- `artifacts/release-readiness/phase1-candidate-dossier-<candidate>-<short-sha>.json`
- `artifacts/release-readiness/phase1-candidate-dossier-<candidate>-<short-sha>.md`

## Output Contract

The dossier surfaces:

- generated timestamp plus candidate branch/dirty metadata
- one candidate revision and target surface
- one `Selected Inputs` block so reviewers can see the exact artifact paths and runtime URL that were used
- one `phase1ExitEvidenceGate` result with blocking/pending/accepted-risk section lists
- `requiredFailed`
- `requiredPending`
- `acceptedRisks`
- per-section freshness and artifact paths
- Phase 1 sections for readiness, Cocos RC, WeChat release, runtime sampling, reconnect soak, persistence/content-pack validation, release gate summary, and release health summary

The JSON artifact is intended for CI/automation, and the Markdown artifact is intended for PR/release review so reviewers do not need to stitch Phase 1 exit evidence together by hand.

For the scheduled and `main`-branch automation that refreshes this dossier together with its prerequisite artifact set, see [`docs/phase1-candidate-rehearsal.md`](./phase1-candidate-rehearsal.md).
