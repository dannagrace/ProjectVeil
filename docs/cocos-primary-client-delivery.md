# Primary Cocos Client Delivery Checklist

This checklist is the maintained delivery baseline for the primary client at [`apps/cocos-client`](/home/gpt/project/ProjectVeil/apps/cocos-client). It keeps the release path small and stable by splitting regression validation into one runtime-journey guard, two automated artifact audits, and a short manual sign-off list. For remaining placeholder or fallback presentation debt, use the canonical reviewer checklist and maintained fallback inventory in [`docs/cocos-phase1-presentation-signoff.md`](./cocos-phase1-presentation-signoff.md) rather than tracking those items ad hoc in PR comments.

## Primary Client Regression Gate

Run the account -> lobby -> room-entry automation slice before packaging or signing off the primary client:

```bash
npm run smoke -- cocos:canonical-journey
```

The command exercises the Cocos `VeilRoot` launch path in CI-friendly node-based automation, reuses the existing runtime/session harness, and emits JSON + Markdown evidence under `artifacts/release-readiness/`. On failure it prints the failed stage plus the exact diagnostic artifact path so contributors can tell apart:

- lobby/bootstrap environment issues
- stale or unavailable auth session bootstrap
- room join or gameplay-state regressions after lobby entry
- reconnect / cached-snapshot restore / authoritative convergence drift
- HUD action shell or first-battle command-panel regressions that would leave the primary runtime non-actionable

## Automated Delivery Audit

Run the audit after exporting and packaging the WeChat build:

```bash
npm run audit:cocos-primary-delivery -- \
  --output-dir <wechatgame-build-dir> \
  --artifacts-dir <release-artifacts-dir> \
  --expect-exported-runtime \
  --expected-revision <git-sha>
```

The audit currently enforces two stable checks:

1. `exported-build-validation`
   - Re-runs `validate:wechat-build` against the exported primary-client build.
   - Confirms required files, injected templates/runtime bootstrap, and package budget constraints still match the checked-in config.
2. `packaged-artifact-audit`
   - Re-runs `validate:wechat-rc` against the packaged release artifact directory.
   - Confirms the archive, sidecar, release manifest, and revision metadata still form a valid release candidate.

The command emits a concise JSON plus Markdown summary under `artifacts/release-readiness/` by default, and CI appends the Markdown summary to the GitHub step summary.

For PRs that touch Cocos release-packaging surfaces, GitHub Actions now treats this audit as part of the merge gate. The same run also executes:

- `npm run smoke -- cocos:canonical-journey`
- `npm run release -- cocos:primary-diagnostics`

CI then uploads a single reviewer-facing artifact named `cocos-release-packaging-evidence-<sha>`. Its `SUMMARY.md` calls out whether the delivery audit or primary-client diagnostics evidence was missing so regressions are actionable without digging through raw logs first.

## Primary-Client Diagnostic Snapshots

Generate the structured diagnostic evidence packet before final release review:

```bash
npm run release -- cocos:primary-diagnostics
```

By default this writes versioned JSON + Markdown artifacts under `artifacts/release-readiness/`:

- `artifacts/release-readiness/cocos-primary-client-diagnostic-snapshots-<short-sha>-<timestamp>.json`
- `artifacts/release-readiness/cocos-primary-client-diagnostic-snapshots-<short-sha>-<timestamp>.md`

The exporter reuses the existing Cocos `VeilRoot` harness and records checkpointed runtime-diagnostics evidence for:

- progression review loading
- inventory overflow / blocked equipment evidence
- battle entry -> command/impact feedback -> resolution/settlement handoff
- reconnect cached-replay fallback
- reconnect recovery back to authoritative state

Inspect the Markdown file for a reviewer-friendly summary and open the JSON file when you need the raw runtime snapshot payloads, telemetry checkpoints, and connection-state details. If you want explicit output paths:

```bash
npm run release -- cocos:primary-diagnostics -- \
  --output artifacts/release-readiness/cocos-primary-client-diagnostics.json \
  --markdown-output artifacts/release-readiness/cocos-primary-client-diagnostics.md
```

## Manual Release Sign-Off

Keep these manual items short and attach evidence through the existing release evidence flow instead of inventing a new format:

1. Complete the current candidate snapshot with `npm run release -- cocos-rc:snapshot`.
2. Refresh the primary-client diagnostic artifact with `npm run release -- cocos:primary-diagnostics`.
3. Run `npm run release -- cocos-rc:bundle -- --candidate <candidate-name> --build-surface <surface>` and keep the generated `cocos-presentation-signoff-<candidate>-<short-sha>.json/.md` with the rest of the candidate bundle.
   Review that artifact using [`docs/cocos-phase1-presentation-signoff.md`](./cocos-phase1-presentation-signoff.md), starting from the maintained Phase 1 fallback inventory there, and classify each presentation row as `pass`, `waived-controlled-test`, or `fail` so reviewers can distinguish functional RC pass from presentation risk.
   The same candidate evidence should explicitly show one polished battle journey covering encounter entry, at least one command/impact beat, and a stable victory or defeat settlement state before reconnect review.
   The bundle now also emits `cocos-main-journey-replay-gate-<candidate>-<short-sha>.json/.md`; use that gate as the reviewer-facing proof that the primary-client journey evidence, RC snapshot, bundle manifest, checklist, and blocker log still point at the same candidate revision.
4. Copy and fill the RC checklist/template files in [`docs/release-evidence`](./release-evidence/), reusing the generated presentation sign-off artifact instead of free-form PR notes.
5. Record any open risk in the blocker template before sign-off.
6. Confirm the release candidate still matches the intended commit/revision.

Reviewer workflow for the candidate packet:

1. Open the generated `cocos-main-journey-replay-gate-<candidate>-<short-sha>.md` first.
2. Treat `Infrastructure Failures` or `Evidence Drift` there as a stop-ship signal for the candidate revision.
3. Treat `Presentation Blockers` there as a separate sign-off track, then continue into [`docs/cocos-phase1-presentation-signoff.md`](./cocos-phase1-presentation-signoff.md) for the visual/debt decision.
4. If the gate passes, use the linked bundle summary, checkpoint ledger, checklist, and blocker log for the full reviewer packet.

## Related Commands

- Export template refresh: `npm run prepare:wechat-build`
- Primary client canonical smoke evidence: `npm run smoke -- cocos:canonical-journey`
- Export validation: `npm run validate -- wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime`
- Package artifact: `npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir> --expect-exported-runtime --source-revision <git-sha>`
- RC artifact validation: `npm run validate -- wechat-rc -- --artifacts-dir <release-artifacts-dir> --expected-revision <git-sha>`
- Unified Cocos evidence snapshot: `npm run release -- cocos-rc:snapshot`
- Primary-client diagnostic evidence: `npm run release -- cocos:primary-diagnostics`
