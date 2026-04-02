# Same-Revision Release Evidence Runbook

This runbook is for maintainers assembling one release-candidate evidence packet without mixing artifacts from different commits.

Use it when you need one explicit answer to: "Do we have the minimum same-revision evidence to make a release call for this candidate?"

Related references:

- [`docs/verification-matrix.md`](./verification-matrix.md)
- [`docs/release-readiness-snapshot.md`](./release-readiness-snapshot.md)
- [`docs/release-readiness-dashboard.md`](./release-readiness-dashboard.md)
- [`docs/cocos-release-evidence-template.md`](./cocos-release-evidence-template.md)
- [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md)
- [`docs/release-evidence/wechat-runtime-observability-signoff.template.md`](./release-evidence/wechat-runtime-observability-signoff.template.md)
- [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md)
- [`docs/wechat-runtime-observability-signoff.md`](./wechat-runtime-observability-signoff.md)
- [`docs/reconnect-soak-gate.md`](./reconnect-soak-gate.md)
- [`docs/release-gate-summary.md`](./release-gate-summary.md)
- [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md)

## Same-Revision Rule

Pick one candidate revision up front and keep it fixed across every artifact in this runbook.

- Use one `<git-sha>` for every command that accepts `--candidate-revision`, `--expected-revision`, or `--source-revision`.
- Do not reuse an older snapshot, smoke report, or RC bundle after rebuilding another part of the candidate on a newer commit.
- If one artifact drifts to a different revision, regenerate that artifact instead of waiving the mismatch.

## Minimum Evidence Set

These are the minimum artifacts for a same-revision release call:

| Evidence area | Command or source | Expected output |
| --- | --- | --- |
| Automated release baseline | `npm run release:readiness:snapshot -- --manual-checks docs/release-readiness-manual-checks.example.json` | `artifacts/release-readiness/release-readiness-*.json` |
| Candidate reconnect soak | `npm run release:reconnect-soak -- --candidate <candidate-name> --candidate-revision <git-sha>` | `artifacts/release-readiness/colyseus-reconnect-soak-summary-<candidate>-<short-sha>.json` plus paired `.md` |
| Release gate summary | `npm run release:gate:summary -- --target-surface <wechat|h5>` | `artifacts/release-readiness/release-gate-summary-<short-sha>.json` plus paired `.md` |
| Cocos / WeChat RC bundle | `npm run release:cocos-rc:bundle -- --candidate <candidate-name> --build-surface wechat_preview --wechat-smoke-report artifacts/wechat-release/codex.wechat.smoke-report.json --release-readiness-snapshot <snapshot-json>` | `artifacts/release-readiness/cocos-rc-evidence-bundle-<candidate>-<short-sha>.json` plus paired `.md`, snapshot, checklist, and blockers files |
| WeChat validation or rehearsal when WeChat is the target surface | `npm run validate:wechat-rc -- --artifacts-dir artifacts/wechat-release --expected-revision <git-sha> --require-smoke-report --manual-checks docs/release-evidence/wechat-release-manual-review.example.json` or `npm run release:wechat:rehearsal -- --build-dir <wechatgame-build-dir> --artifacts-dir artifacts/wechat-release --source-revision <git-sha> --expected-revision <git-sha> --require-smoke-report` | `artifacts/wechat-release/codex.wechat.release-candidate-summary.json`, `artifacts/wechat-release/codex.wechat.rc-validation-report.json`, `artifacts/wechat-release/codex.wechat.smoke-report.json`, or `artifacts/wechat-release/wechat-release-rehearsal-<short-sha>.json` plus paired `.md` |
| Runtime observability sign-off | Manual review using `docs/wechat-runtime-observability-signoff.md` plus `docs/release-evidence/wechat-runtime-observability-signoff.template.md` | `artifacts/wechat-release/runtime-observability-signoff-<candidate>-<short-sha>.md` or equivalent reviewer artifact |
| Manual evidence owner ledger | Copy `docs/release-evidence/manual-release-evidence-owner-ledger.template.md` for the candidate and update it as manual evidence lands | `artifacts/release-readiness/manual-release-evidence-owner-ledger-<candidate>-<short-sha>.md` or release PR table |
| Same-candidate evidence audit | `npm run release:same-candidate:evidence-audit -- --candidate <candidate-name> --candidate-revision <git-sha>` | `artifacts/release-readiness/same-candidate-evidence-audit-<candidate>-<short-sha>.json` plus paired `.md` |
| Final same-revision assembly check | `npm run release:readiness:dashboard -- --server-url http://127.0.0.1:2567 --wechat-artifacts-dir artifacts/wechat-release --candidate-revision <git-sha>` | `artifacts/release-readiness/release-readiness-dashboard-*.json` plus `.md` |

If the candidate is missing any item above, the release call is still incomplete even if individual scripts passed earlier.

## Required Evidence Vs Optional Diagnostics

Treat the following as `required evidence` for the candidate packet:

- release readiness snapshot
- reconnect soak artifact for the same `<candidate-name>` and `<git-sha>`
- release gate summary for the target surface
- Cocos RC bundle for the same `<candidate-name>` and `<git-sha>`
- WeChat candidate summary or rehearsal summary when WeChat is the release surface
- runtime observability sign-off covering `/api/runtime/health`, `/api/runtime/auth-readiness`, and `/api/runtime/metrics`
- manual evidence owner ledger
- same-candidate evidence audit
- final release-readiness dashboard output

Treat these as `optional diagnostics` unless another release doc explicitly upgrades them to required for your target surface:

- rerunning `npm run release:wechat:rehearsal` when `validate:wechat-rc` already points at a fresh same-revision artifact set
- keeping intermediate `verify:wechat-release`, `prepare:wechat-release`, or upload receipts in the packet when the release decision only needs candidate-readiness evidence
- extra H5 packaged smoke details when the selected `--target-surface` is `wechat` and the gate summary already captures the current H5 signal
- additional runtime diagnostic snapshot captures beyond the reviewer artifact and dashboard probe

## Ordered Assembly Flow

1. Record the candidate identity before generating evidence.

```bash
git rev-parse HEAD
git rev-parse --short HEAD
```

Keep the full SHA as `<git-sha>` and reuse it for the rest of the flow.

2. Generate the automated baseline snapshot for that revision.

```bash
npm run release:readiness:snapshot -- \
  --manual-checks docs/release-readiness-manual-checks.example.json
```

Freshness check:

- open the newest `artifacts/release-readiness/release-readiness-*.json`
- confirm `revision.commit == <git-sha>`
- confirm `summary.requiredFailed == 0`
- confirm any remaining `requiredPending` items are the manual checks you still plan to finish in this same pass

3. Run the candidate-scoped reconnect soak for the pinned revision.

```bash
npm run release:reconnect-soak -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha>
```

Freshness check:

- open `artifacts/release-readiness/colyseus-reconnect-soak-summary-<candidate>-<short-sha>.json`
- confirm `candidate` and `candidateRevision` match `<candidate-name>` and `<git-sha>`
- confirm the verdict is `passed`
- confirm the cleanup counters returned to zero and the artifact records reconnect attempts plus invariant checks

4. Refresh the WeChat candidate evidence when WeChat is the target surface.

If `artifacts/wechat-release/` already contains a same-revision package, smoke report, and manual-review metadata, run the validation path:

```bash
npm run validate:wechat-rc -- \
  --artifacts-dir artifacts/wechat-release \
  --expected-revision <git-sha> \
  --require-smoke-report \
  --manual-checks docs/release-evidence/wechat-release-manual-review.example.json
```

Freshness check:

- open `artifacts/wechat-release/codex.wechat.release-candidate-summary.json`
- confirm the summary revision matches `<git-sha>`
- confirm required manual review rows have `owner`, `recordedAt`, `revision`, and artifact paths
- confirm the linked `codex.wechat.smoke-report.json` has required cases completed and `reconnect-recovery.requiredEvidence` populated

If you need to regenerate the WeChat artifact family from the same source revision instead of only checking it, run the rehearsal path:

```bash
npm run release:wechat:rehearsal -- \
  --build-dir <wechatgame-build-dir> \
  --artifacts-dir artifacts/wechat-release \
  --source-revision <git-sha> \
  --expected-revision <git-sha> \
  --require-smoke-report
```

Use the rehearsal output when you need one report that proves prepare/package/verify/validate still run in sequence for this exact revision. Keep the resulting `wechat-release-rehearsal-<short-sha>.json` and `.md` next to the WeChat candidate summary instead of replacing it.

5. Build the candidate-scoped Cocos RC bundle from the same snapshot and WeChat evidence.

```bash
npm run release:cocos-rc:bundle -- \
  --candidate <candidate-name> \
  --build-surface wechat_preview \
  --wechat-smoke-report artifacts/wechat-release/codex.wechat.smoke-report.json \
  --release-readiness-snapshot <snapshot-json>
```

Freshness check:

- inspect the generated `artifacts/release-readiness/cocos-rc-evidence-bundle-<candidate>-<short-sha>.json`
- confirm the bundle commit/revision matches `<git-sha>`
- confirm the paired snapshot, checklist, and blockers files were regenerated for the same candidate
- confirm the bundle did not inherit an older smoke report or snapshot path

6. Complete the runtime observability sign-off for the same candidate revision.

Use [`docs/wechat-runtime-observability-signoff.md`](./wechat-runtime-observability-signoff.md) and [`docs/release-evidence/wechat-runtime-observability-signoff.template.md`](./release-evidence/wechat-runtime-observability-signoff.template.md), and capture:

- `/api/runtime/health`
- `/api/runtime/auth-readiness`
- `/api/runtime/metrics`
- reviewer, timestamp, revision, conclusion, and any accepted follow-up

Freshness check:

- confirm the sign-off artifact records the same `<git-sha>`
- confirm the captured environment is the release environment you are actually calling from
- confirm any blockers or follow-ups are also reflected in the RC checklist or blocker register

7. Update the manual evidence owner ledger for the same candidate revision.

Copy [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md) into the candidate artifact set or PR body and keep one row for each required manual sign-off.

Freshness check:

- confirm every required manual evidence item has one row
- confirm `candidate`, `revision`, `owner`, `status`, `last updated`, and `artifact path` agree with the underlying artifact
- confirm any row still marked `pending` or `in-review` explains the next follow-up clearly enough for handoff

8. Run the release gate summary for the same release surface and artifact packet.

```bash
npm run release:gate:summary -- \
  --target-surface <wechat|h5> \
  --snapshot <snapshot-json> \
  --reconnect-soak artifacts/release-readiness/colyseus-reconnect-soak-summary-<candidate>-<short-sha>.json \
  --manual-evidence-ledger artifacts/release-readiness/manual-release-evidence-owner-ledger-<candidate>-<short-sha>.md \
  --wechat-artifacts-dir artifacts/wechat-release
```

Freshness check:

- open `artifacts/release-readiness/release-gate-summary-<short-sha>.json`
- confirm the summary selected the same snapshot, reconnect soak artifact, ledger, and WeChat artifact directory you intended
- confirm `targetSurface` matches the release decision you are making
- confirm no required gate dimension is `failed`, `pending`, or stale for `<git-sha>`

9. Run the artifact-family audit for the pinned candidate.

Before the broad dashboard pass, run the artifact-family audit that explicitly compares the latest readiness snapshot, release-gate summary, Cocos RC bundle, and manual evidence ledger for the same candidate:

```bash
npm run release:same-candidate:evidence-audit -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha>
```

This audit emits one JSON + Markdown summary and exits non-zero when any required artifact family is missing, stale, points at a different revision, or still links to a different readiness snapshot.

10. Run the final assembly check that enforces same-revision consistency.

```bash
npm run release:readiness:dashboard -- \
  --server-url http://127.0.0.1:2567 \
  --wechat-artifacts-dir artifacts/wechat-release \
  --candidate-revision <git-sha>
```

Freshness check:

- open the generated `artifacts/release-readiness/release-readiness-dashboard-*.json` or `.md`
- confirm the report selected the artifact paths you intended to review
- confirm no linked evidence is missing revision metadata, stale, or mismatched to `<git-sha>`

## Artifact Checklist

Before making the release call, verify this exact packet exists:

- one release readiness snapshot JSON for `<git-sha>`
- one reconnect soak JSON for `<candidate-name>` and `<git-sha>`
- one release gate summary JSON or Markdown for `<git-sha>`
- one Cocos RC evidence bundle JSON for `<candidate-name>` and `<git-sha>`
- one WeChat candidate summary JSON for `<git-sha>` when WeChat is the target surface
- one WeChat smoke report JSON for `<git-sha>` when WeChat is the target surface
- one WeChat rehearsal summary JSON or Markdown when you used rehearsal instead of a prebuilt same-revision artifact family
- one RC checklist Markdown file for `<candidate-name>` and `<git-sha>`
- one RC blocker Markdown file for `<candidate-name>` and `<git-sha>`
- one runtime observability sign-off artifact for `<git-sha>`
- one manual evidence owner ledger Markdown file or PR table for `<candidate-name>` and `<git-sha>`
- one same-candidate evidence audit JSON or Markdown for `<candidate-name>` and `<git-sha>`
- one release readiness dashboard JSON or Markdown for `<git-sha>`

If two files for the "same" evidence disagree on revision or timestamp window, treat the packet as invalid and refresh the stale file instead of choosing by hand.

## Minimum Evidence To Call Phase 1 Ready

This runbook does not redefine Phase 1 exit criteria. Use it to assemble the evidence packet that lets you answer the scorecard's existing question for one candidate revision.

Before calling Phase 1 ready for `<candidate-name>` at `<git-sha>`, confirm the packet above is complete and then re-read:

- [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md#explicit-phase-1-exit-criteria)
- [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md#what-advancing-beyond-phase-1-means-here)

If the packet cannot prove the scorecard's same-revision exit criteria without ad hoc explanation, the candidate is still in Phase 1 hardening.

## Go / No-Go Checklist

Release is `go` only when all of the following are true:

- every required artifact above points to the same candidate revision
- the readiness snapshot has no `requiredFailed` and no unresolved required manual checks
- the WeChat smoke report has no required case in `failed`, `blocked`, or `pending`
- the Cocos RC bundle is generated for the same candidate and revision and includes the latest checklist/blocker files
- the runtime observability sign-off is recorded for the same revision and environment
- the manual evidence owner ledger shows no required row still in `pending` or `in-review` without an accepted release decision
- the final readiness dashboard does not report revision mismatch, missing revision metadata, or stale evidence

Release is `no-go` when any of the following happens:

- one artifact was generated from a different commit
- a required manual review is still pending
- smoke, runtime, or RC evidence is missing, blocked, or stale
- the blocker register contains an unresolved release-blocking item
- maintainers cannot prove which exact artifact set belongs to the candidate under review

When in doubt, rerun the stale step for the pinned `<git-sha>` and rebuild the packet. Same-revision evidence is stricter than "latest successful command."
