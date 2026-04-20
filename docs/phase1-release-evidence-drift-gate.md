# Phase 1 Release Evidence Drift Gate

`npm run release -- phase1:evidence-drift-gate` is the CI-oriented guardrail for candidate-scoped Phase 1 release evidence drift.

It reuses the machine-readable `phase1-same-revision-evidence-bundle` manifest as the base contract, then optionally layers in the runtime observability gate/evidence packet when GitHub Actions already captured target-environment runtime proof for the same candidate revision.

Use this command when GitHub Actions should fail immediately if the current candidate's:

- Cocos RC bundle
- release-readiness snapshot
- manual evidence owner ledger
- runtime observability packet, when supplied

no longer agree on the same candidate or revision.

## Required Inputs

Minimum CI invocation:

```bash
npm run release -- phase1:evidence-drift-gate -- \
  --candidate phase1-mainline \
  --candidate-revision "${GITHUB_SHA}" \
  --same-revision-bundle-manifest "${RUNNER_TEMP}/phase1-same-revision-evidence-bundle/phase1-same-revision-evidence-bundle-manifest.json"
```

Recommended invocation when runtime observability evidence exists:

```bash
npm run release -- phase1:evidence-drift-gate -- \
  --candidate phase1-mainline \
  --candidate-revision "${GITHUB_SHA}" \
  --same-revision-bundle-manifest "${RUNNER_TEMP}/phase1-same-revision-evidence-bundle/phase1-same-revision-evidence-bundle-manifest.json" \
  --runtime-observability-gate "${RUNNER_TEMP}/runtime-observability-bundle/runtime-observability-gate-phase1-mainline-${GITHUB_SHA::7}.json" \
  --runtime-observability-evidence "${RUNNER_TEMP}/runtime-observability-bundle/runtime-observability-evidence-phase1-mainline-${GITHUB_SHA::7}.json"
```

## Output Contract

Default outputs:

- `artifacts/release-readiness/phase1-release-evidence-drift-gate-<candidate>-<short-sha>.json`
- `artifacts/release-readiness/phase1-release-evidence-drift-gate-<candidate>-<short-sha>.md`

The JSON output is the machine-readable CI artifact. It records:

- the candidate and revision under test
- the same-revision bundle manifest path used as the source contract
- per-family pass/fail status for the RC bundle, snapshot, owner ledger, and runtime observability packet
- blocking findings such as candidate mismatch, revision mismatch, missing artifacts, and runtime-gate failure

The command exits non-zero whenever a blocking finding is present.

## GitHub Actions Integration

Recommended pattern inside a workflow that already built the Phase 1 packet:

```yaml
- name: Build Phase 1 same-revision evidence bundle
  run: |
    npm run release -- phase1:same-revision-evidence-bundle -- \
      --candidate "${CANDIDATE_LABEL}" \
      --candidate-revision "${GITHUB_SHA}" \
      --target-surface h5 \
      --output-dir "${RUNNER_TEMP}/phase1-same-revision-evidence-bundle" \
      --snapshot "${RUNNER_TEMP}/release-readiness/release-readiness-${GITHUB_SHA}.json" \
      --reconnect-soak "${RUNNER_TEMP}/release-readiness/colyseus-reconnect-soak-summary-${GITHUB_SHA}.json" \
      --phase1-persistence "${RUNNER_TEMP}/release-readiness/phase1-release-persistence-regression-${GITHUB_SHA}.json" \
      --cocos-rc-bundle "${RUNNER_TEMP}/release-readiness/cocos-rc-evidence-bundle-${GITHUB_SHA}.json" \
      --release-gate-summary "${RUNNER_TEMP}/release-readiness/release-gate-summary-${GITHUB_SHA}.json"

- name: Gate Phase 1 release evidence drift
  run: |
    args=(
      --candidate "${CANDIDATE_LABEL}"
      --candidate-revision "${GITHUB_SHA}"
      --same-revision-bundle-manifest "${RUNNER_TEMP}/phase1-same-revision-evidence-bundle/phase1-same-revision-evidence-bundle-manifest.json"
      --output "${RUNNER_TEMP}/release-readiness/phase1-release-evidence-drift-gate-${GITHUB_SHA}.json"
      --markdown-output "${RUNNER_TEMP}/release-readiness/phase1-release-evidence-drift-gate-${GITHUB_SHA}.md"
    )

    if [[ -f "${RUNNER_TEMP}/runtime-observability-bundle/runtime-observability-gate-${CANDIDATE_LABEL}-${GITHUB_SHA::7}.json" ]]; then
      args+=(--runtime-observability-gate "${RUNNER_TEMP}/runtime-observability-bundle/runtime-observability-gate-${CANDIDATE_LABEL}-${GITHUB_SHA::7}.json")
    fi
    if [[ -f "${RUNNER_TEMP}/runtime-observability-bundle/runtime-observability-evidence-${CANDIDATE_LABEL}-${GITHUB_SHA::7}.json" ]]; then
      args+=(--runtime-observability-evidence "${RUNNER_TEMP}/runtime-observability-bundle/runtime-observability-evidence-${CANDIDATE_LABEL}-${GITHUB_SHA::7}.json")
    fi

    npm run release -- phase1:evidence-drift-gate -- "${args[@]}"
```

If the workflow already uses `npm run release -- phase1:candidate-rehearsal`, the rehearsal now runs this gate automatically and stages the JSON/Markdown outputs in the rehearsal bundle.
