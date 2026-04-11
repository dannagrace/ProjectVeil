# Phase 1 Candidate Rehearsal

The `Phase 1 Candidate Rehearsal` workflow automates the nightly and `main`-branch evidence refresh for one candidate-scoped Phase 1 bundle.

It keeps the implementation narrow by reusing the existing evidence commands instead of creating a second release pipeline:

- `npm run test:coverage:ci`
- `npm run stress:rooms:reconnect-soak`
- `npm run package:wechat-release`
- `npm run validate:wechat-rc`
- `npm run smoke:client:release-candidate`
- `npm run release:cocos-rc:bundle`
- `npm run release:runtime-observability:bundle`
- `npm run release:candidate:evidence-audit`
- `npm run release:evidence:index`
- `npm run release:gate:summary`
- `npm run release:phase1:same-revision-evidence-bundle`
- `npm run release:phase1:evidence-drift-gate`
- `npm run ci:trend-summary`
- `npm run release:health:summary`
- `npm run release:phase1:candidate-dossier`
- `npm run release:phase1:exit-audit`
- `npm run release:phase1:exit-dossier-freshness-gate`
- `npm run release:go-no-go-packet`

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
- one same-revision evidence bundle manifest plus the paired drift-gate JSON / Markdown
- one Cocos primary-client journey evidence pair so the canonical main path proof is staged directly in the candidate packet
- one Cocos main-journey replay gate pair so reviewers can verify same-revision main-path coverage without opening the RC bundle manifest first
- one Cocos primary-client diagnostic snapshot pair so the runtime milestone packet is staged with the candidate bundle
- one candidate-revision triage input/digest pair derived from the Cocos primary diagnostics checkpoints so reviewers get a revision-scoped error summary without hand-scanning raw checkpoints
- the same-revision bundle's manual evidence owner ledger and release-readiness dashboard restaged at the rehearsal bundle top level, plus the paired Phase 1 release evidence drift gate, Phase 1 exit audit, Phase 1 exit-dossier freshness gate, and final go/no-go packet as packet-level reviewer checkpoints
- one candidate-level evidence audit plus the dedicated freshness guard, its owner-reminder and freshness-history companions, along with one current release evidence index, so reviewers have a front-door into the packet
- one Phase 1 exit audit plus the paired exit-dossier freshness gate so the final reviewer call stays in the same candidate packet
- one reviewer-facing release PR summary Markdown so the final GitHub-visible digest is staged with the same candidate bundle
- one reviewer-facing runtime observability bundle directory with the staged evidence and gate files for the target environment
- the candidate-scoped Cocos RC bundle, Phase 1 dossier, and final go/no-go packet
- `SUMMARY.md`, which is also appended to `GITHUB_STEP_SUMMARY`

The workflow fails when an evidence-generation stage regresses, when a required rehearsal artifact is missing from the final bundle, or when the same-revision drift gate reports candidate/revision mismatch across the assembled packet.

The workflow does not treat an otherwise valid dossier `pending` result as a generation failure. That pending state is expected when automation intentionally omits live runtime sampling or WeChat manual-review evidence. The same rule now applies to the candidate-level evidence audit: the rehearsal stages the reviewer-facing audit artifact even when that audit still reports blocking manual sign-off debt. When `--server-url` is supplied, the rehearsal writes one stable runtime observability bundle directory, stages the raw runtime evidence and gate outputs inside it, and then feeds the staged gate into the candidate dossier instead of resampling the environment.

## Local Rerun

To mirror the workflow locally from repo root, first produce the prerequisite artifacts:

```bash
npm ci --no-audit --no-fund
npm run test:coverage:ci
npm run stress:rooms:reconnect-soak -- --artifact-path artifacts/release-readiness/colyseus-reconnect-soak-summary-local.json
npm run package:wechat-release -- --output-dir apps/cocos-client/test/fixtures/wechatgame-export --artifacts-dir artifacts/wechat-release-local --expect-exported-runtime --source-revision "$(git rev-parse HEAD)"
npm run validate:wechat-rc -- --artifacts-dir artifacts/wechat-release-local --expected-revision "$(git rev-parse HEAD)"
npm run smoke:client:release-candidate -- --output artifacts/release-readiness/client-release-candidate-smoke-local.json
npm run release:runtime-observability:bundle -- --candidate phase1-mainline --candidate-revision "$(git rev-parse HEAD)" --target-surface h5 --target-environment local --server-url http://127.0.0.1:2567 --include-room-lifecycle
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

Open `artifacts/release-readiness/phase1-candidate-rehearsal-local/SUMMARY.md` first. That file has a dedicated reviewer front-door section for the current release evidence index, candidate evidence audit, candidate freshness guard, candidate owner reminder, candidate freshness history, restaged release-readiness dashboard, the Phase 1 release evidence drift gate, the Phase 1 exit audit, the Phase 1 exit-dossier freshness gate, the go/no-go packet, manual evidence owner ledger, Cocos primary journey evidence, the Cocos main-journey replay gate, Cocos primary diagnostics, the candidate revision triage digest, and the release PR summary, then records the release gate, release health, and dossier outcomes for the candidate revision.

For the standalone CI guard and explicit GitHub Actions inputs, see [`docs/phase1-release-evidence-drift-gate.md`](./phase1-release-evidence-drift-gate.md).
