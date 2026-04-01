# Phase 1 Candidate Dossier

`npm run release:phase1:candidate-dossier` folds the current Phase 1 exit evidence for one candidate revision into a single JSON dossier plus a Markdown attachment.

The command stays intentionally thin and reuses the existing evidence producers:

- `npm run release:readiness:snapshot`
- `npm run release:cocos-rc:bundle`
- `npm run validate:wechat-rc` / `codex.wechat.release-candidate-summary.json`
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

## Output Contract

The dossier surfaces:

- one candidate revision and target surface
- `requiredFailed`
- `requiredPending`
- `acceptedRisks`
- per-section freshness and artifact paths
- Phase 1 sections for readiness, Cocos RC, WeChat release, runtime sampling, persistence/content-pack validation, release gate summary, and release health summary

The JSON artifact is intended for CI/automation, and the Markdown artifact is intended for PR/release review so reviewers do not need to stitch Phase 1 exit evidence together by hand.
