# Phase 1 Exit Audit

`npm run release:phase1:exit-audit` emits the single reviewer-facing Phase 1 exit call for one candidate revision.

The command reuses the existing Phase 1 evidence producers and turns the explicit exit criteria from [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md) into first-class audited rows:

1. bounded scope remains intact
2. core automated gates are green
3. release readiness snapshot has no required failures or pending required checks
4. Cocos primary-client evidence is current
5. WeChat release evidence is current when WeChat is the target surface
6. runtime observability is proven
7. Phase 1 persistence/content evidence is current
8. known blockers are closed or explicitly accepted

Each row is reported as `pass`, `fail`, or `pending`, and each row links back to the exact source artifacts used for the decision. The JSON artifact is intended for CI/automation, and the Markdown artifact is intended for release review / PR attachment.

## Usage

Use the latest local artifacts:

```bash
npm run release:phase1:exit-audit -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha>
```

Pin the exact upstream artifacts when CI or a rehearsal job already produced stable paths:

```bash
npm run release:phase1:exit-audit -- \
  --candidate phase1-wechat-rc \
  --candidate-revision abc1234 \
  --target-surface wechat \
  --snapshot artifacts/release-readiness/release-readiness-abc1234.json \
  --cocos-bundle artifacts/release-readiness/cocos-rc-evidence-bundle-phase1-wechat-rc-abc1234.json \
  --wechat-candidate-summary artifacts/wechat-release/codex.wechat.release-candidate-summary.json \
  --runtime-observability-gate artifacts/release-readiness/runtime-observability-gate-phase1-wechat-rc-abc1234.json \
  --reconnect-soak artifacts/release-readiness/colyseus-reconnect-soak-summary-phase1-wechat-rc-abc1234.json \
  --phase1-persistence artifacts/release-readiness/phase1-release-persistence-regression-abc1234.json
```

Write into one stable candidate directory:

```bash
npm run release:phase1:exit-audit -- \
  --candidate phase1-wechat-rc \
  --candidate-revision abc1234 \
  --output-dir artifacts/release-readiness/phase1-exit-audit-phase1-wechat-rc-abc1234
```

## Outputs

Default outputs:

- `artifacts/release-readiness/phase1-exit-audit-<candidate>-<short-sha>.json`
- `artifacts/release-readiness/phase1-exit-audit-<candidate>-<short-sha>.md`

If `--output-dir` is set, the command writes:

- `phase1-exit-audit.json`
- `phase1-exit-audit.md`

## Decision Model

- `fail`: the candidate is blocked on one or more required exit criteria
- `pending`: no current blocker is recorded, but required evidence is stale or otherwise not fresh enough to close the criterion
- `pass`: the criterion is currently satisfied for the candidate revision

The audit intentionally treats missing optional WeChat evidence as non-blocking when the target surface is `h5`. When the target surface is `wechat`, the candidate summary, smoke/manual-review state, and linked blocker artifacts become required input for the WeChat criterion.

## Relationship To Other Reports

- Use [`docs/phase1-candidate-dossier.md`](./phase1-candidate-dossier.md) when reviewers need the broader section-by-section drill-down.
- Use this exit audit when reviewers want the explicit scorecard criteria mapped into one top-level release decision input.
- Use [`docs/release-go-no-go-decision-packet.md`](./release-go-no-go-decision-packet.md) after the lower-level artifacts already exist and the release owner wants the final operator packet.
