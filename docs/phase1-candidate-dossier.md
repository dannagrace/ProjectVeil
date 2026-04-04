# Phase 1 Candidate Dossier

`npm run release:phase1:candidate-dossier` folds the current Phase 1 exit evidence for one candidate revision into a single JSON dossier plus a Markdown attachment.

It now also emits one explicit candidate-level `Phase 1 exit evidence gate` so reviewers can make the final pass/pending/fail call from one object instead of re-interpreting each evidence section by hand.

The same run also emits a smaller runtime observability dossier that keeps the target-environment runtime probes and reconnect/session-recovery evidence in one reviewer-facing artifact for the same candidate revision.

For release-time target-environment enforcement, use `npm run release:runtime-observability:gate`. The dossier can either sample the live endpoints directly with `--server-url` or reuse a previously written gate report with `--runtime-observability-gate`.

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

Reuse a stable runtime gate artifact instead of probing the environment a second time:

```bash
npm run release:runtime-observability:gate -- \
  --candidate phase1-wechat-rc \
  --candidate-revision abc1234 \
  --target-surface wechat \
  --target-environment release-staging \
  --server-url https://veil-staging.example.com

npm run release:phase1:candidate-dossier -- \
  --candidate phase1-wechat-rc \
  --candidate-revision abc1234 \
  --runtime-observability-gate artifacts/release-readiness/runtime-observability-gate-phase1-wechat-rc-abc1234.json
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

Write the dossier bundle into one stable candidate directory:

```bash
npm run release:phase1:candidate-dossier -- \
  --candidate phase1-wechat-rc \
  --candidate-revision abc1234 \
  --output-dir artifacts/release-dossiers/phase1-wechat-rc-abc1234
```

## Default Outputs

If you do not pass output flags, the script writes one stable candidate bundle directory:

- `artifacts/release-readiness/phase1-candidate-dossier-<candidate>-<short-sha>/phase1-candidate-dossier.json`
- `artifacts/release-readiness/phase1-candidate-dossier-<candidate>-<short-sha>/phase1-candidate-dossier.md`
- `artifacts/release-readiness/phase1-candidate-dossier-<candidate>-<short-sha>/runtime-observability-dossier.json`
- `artifacts/release-readiness/phase1-candidate-dossier-<candidate>-<short-sha>/runtime-observability-dossier.md`
- `artifacts/release-readiness/phase1-candidate-dossier-<candidate>-<short-sha>/release-gate-summary.json`
- `artifacts/release-readiness/phase1-candidate-dossier-<candidate>-<short-sha>/release-gate-summary.md`
- `artifacts/release-readiness/phase1-candidate-dossier-<candidate>-<short-sha>/release-health-summary.json`
- `artifacts/release-readiness/phase1-candidate-dossier-<candidate>-<short-sha>/release-health-summary.md`

If you pass `--output-dir`, the same file names are written into that directory instead.

## Output Contract

The dossier surfaces:

- generated timestamp plus candidate branch/dirty metadata
- one candidate revision and target surface
- one `Selected Inputs` block so reviewers can see the exact artifact paths and runtime URL that were used
- optional reuse of a stable runtime observability gate artifact so release rehearsal and manual review can point at the same endpoint sample
- one `Generated Bundle` block so PR/release巡检 reviewers can stay inside the dossier directory
- one runtime observability companion dossier that ties `/api/runtime/health`, `/api/runtime/auth-readiness`, `/api/runtime/metrics`, and reconnect soak evidence to the same candidate revision
- one `phase1ExitEvidenceGate` result with blocking/pending/accepted-risk section lists
- for WeChat targets, candidate-level package / verify / smoke / manual-review evidence is surfaced explicitly, and missing required manual checks keep the exit gate blocked instead of being treated as build-only success
- `requiredFailed`
- `requiredPending`
- `acceptedRisks`
- per-section freshness and artifact paths
- explicit Phase 1 persistence storage-mode evidence, including the verified storage mode (`memory` / `mysql`) and whether that artifact is stale or missing for the candidate revision
- Phase 1 sections for readiness, Cocos RC, WeChat release, runtime sampling, reconnect soak, persistence/content-pack validation, release gate summary, and release health summary

The JSON artifact is intended for CI/automation, and the Markdown artifact is intended for PR/release review so reviewers do not need to stitch Phase 1 exit evidence together by hand.

For the scheduled and `main`-branch automation that refreshes this dossier together with its prerequisite artifact set, see [`docs/phase1-candidate-rehearsal.md`](./phase1-candidate-rehearsal.md).
