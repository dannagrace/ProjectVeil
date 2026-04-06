# Phase 1 Candidate Rehearsal

The `Phase 1 Candidate Rehearsal` workflow automates the nightly and `main`-branch evidence refresh for one candidate-scoped Phase 1 bundle.

It keeps the implementation narrow by reusing the existing evidence commands instead of creating a second release pipeline:

- `npm run test:coverage:ci`
- `npm run stress:rooms:reconnect-soak`
- `npm run package:wechat-release`
- `npm run validate:wechat-rc`
- `npm run smoke:client:release-candidate`
- `npm run release:cocos-rc:bundle`
- `npm run release:runtime-observability:evidence`
- `npm run release:runtime-observability:gate`
- `npm run release:gate:summary`
- `npm run ci:trend-summary`
- `npm run release:health:summary`
- `npm run release:phase1:candidate-dossier`

## Workflow Contract

The workflow runs on:

- every push to `main`
- a nightly cron
- manual `workflow_dispatch`

It uploads one reviewer-facing artifact bundle named:

- `phase1-candidate-rehearsal-phase1-mainline-<full-sha>`

The bundle contains:

- stable copied inputs such as `client-release-candidate-smoke-phase1-mainline-<short-sha>.json`
- stable generated summaries such as `release-gate-summary-phase1-mainline-<short-sha>.json`
- the candidate-scoped Cocos RC bundle and Phase 1 dossier
- `SUMMARY.md`, which is also appended to `GITHUB_STEP_SUMMARY`

The workflow fails when an evidence-generation stage regresses or when a required rehearsal artifact is missing from the final bundle.

The workflow does not treat an otherwise valid dossier `pending` result as a generation failure. That pending state is expected when automation intentionally omits live runtime sampling or WeChat manual-review evidence. When `--server-url` is supplied, the rehearsal first writes a stable runtime observability evidence JSON/Markdown pair, then derives the runtime observability gate from that captured artifact and feeds the gate into the candidate dossier instead of resampling the environment.

## Local Rerun

To mirror the workflow locally from repo root, first produce the prerequisite artifacts:

```bash
npm ci --no-audit --no-fund
npm run test:coverage:ci
npm run stress:rooms:reconnect-soak -- --artifact-path artifacts/release-readiness/colyseus-reconnect-soak-summary-local.json
npm run package:wechat-release -- --output-dir apps/cocos-client/test/fixtures/wechatgame-export --artifacts-dir artifacts/wechat-release-local --expect-exported-runtime --source-revision "$(git rev-parse HEAD)"
npm run validate:wechat-rc -- --artifacts-dir artifacts/wechat-release-local --expected-revision "$(git rev-parse HEAD)"
npm run smoke:client:release-candidate -- --output artifacts/release-readiness/client-release-candidate-smoke-local.json
npm run release:runtime-observability:evidence -- --candidate phase1-mainline --candidate-revision "$(git rev-parse HEAD)" --target-surface h5 --target-environment local --server-url http://127.0.0.1:2567
npm run release:runtime-observability:gate -- --candidate phase1-mainline --candidate-revision "$(git rev-parse HEAD)" --target-surface h5 --target-environment local --capture-report artifacts/release-readiness/runtime-observability-evidence-phase1-mainline-$(git rev-parse --short HEAD).json
```

Then run the orchestration command that the workflow uses:

```bash
npm run release:phase1:candidate-rehearsal -- \
  --candidate phase1-mainline \
  --output-dir artifacts/release-readiness/phase1-candidate-rehearsal-local \
  --h5-smoke artifacts/release-readiness/client-release-candidate-smoke-local.json \
  --reconnect-soak artifacts/release-readiness/colyseus-reconnect-soak-summary-local.json \
  --server-url http://127.0.0.1:2567 \
  --wechat-artifacts-dir artifacts/wechat-release-local \
  --validate-status success \
  --wechat-build-status success \
  --client-rc-smoke-status success \
  --target-surface h5
```

Open `artifacts/release-readiness/phase1-candidate-rehearsal-local/SUMMARY.md` first. That file links the stable artifact paths used for the rehearsal and records the release gate, release health, and dossier outcomes for the candidate revision.
