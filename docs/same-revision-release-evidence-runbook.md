# Same-Revision Release Evidence Runbook

This runbook is for maintainers assembling one release-candidate evidence packet without mixing artifacts from different commits.

Use it when you need one explicit answer to: "Do we have the minimum same-revision evidence to make a release call for this candidate?"

Related references:

- [`docs/verification-matrix.md`](./verification-matrix.md)
- [`docs/release-readiness-snapshot.md`](./release-readiness-snapshot.md)
- [`docs/release-readiness-dashboard.md`](./release-readiness-dashboard.md)
- [`docs/cocos-release-evidence-template.md`](./cocos-release-evidence-template.md)
- [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md)
- [`docs/wechat-runtime-observability-signoff.md`](./wechat-runtime-observability-signoff.md)

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
| WeChat packaged RC smoke | `npm run smoke:wechat-release -- --artifacts-dir artifacts/wechat-release --check --expected-revision <git-sha>` | `artifacts/wechat-release/codex.wechat.smoke-report.json` |
| Cocos / WeChat RC bundle | `npm run release:cocos-rc:bundle -- --candidate <candidate-name> --build-surface wechat_preview --wechat-smoke-report artifacts/wechat-release/codex.wechat.smoke-report.json --release-readiness-snapshot <snapshot-json>` | `artifacts/release-readiness/cocos-rc-evidence-bundle-<candidate>-<short-sha>.json` plus paired `.md`, snapshot, checklist, and blockers files |
| Runtime observability sign-off | Manual review using `docs/wechat-runtime-observability-signoff.md` | `artifacts/wechat-release/runtime-observability-signoff.json` or equivalent reviewer artifact |
| Final same-revision assembly check | `npm run release:readiness:dashboard -- --server-url http://127.0.0.1:2567 --wechat-artifacts-dir artifacts/wechat-release --candidate-revision <git-sha>` | `artifacts/release-readiness/release-readiness-dashboard-*.json` plus `.md` |

If the candidate is missing any item above, the release call is still incomplete even if individual scripts passed earlier.

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

3. Refresh or verify the WeChat smoke evidence for the same packaged revision.

```bash
npm run smoke:wechat-release -- \
  --artifacts-dir artifacts/wechat-release \
  --check \
  --expected-revision <git-sha>
```

Freshness check:

- open `artifacts/wechat-release/codex.wechat.smoke-report.json`
- confirm the report revision matches `<git-sha>`
- confirm required cases are not `pending` or `blocked`
- confirm `reconnect-recovery.requiredEvidence` is populated, not just free-form notes

4. Build the candidate-scoped Cocos RC bundle from the same snapshot and WeChat smoke report.

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

5. Complete the runtime observability sign-off for the same candidate revision.

Use [`docs/wechat-runtime-observability-signoff.md`](./wechat-runtime-observability-signoff.md) and capture:

- `/api/runtime/health`
- `/api/runtime/diagnostic-snapshot`
- `/api/runtime/metrics`
- reviewer, timestamp, revision, conclusion, and any accepted follow-up

Freshness check:

- confirm the sign-off artifact records the same `<git-sha>`
- confirm the captured environment is the release environment you are actually calling from
- confirm any blockers or follow-ups are also reflected in the RC checklist or blocker register

6. Run the final assembly check that enforces same-revision consistency.

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
- one WeChat smoke report JSON for `<git-sha>`
- one Cocos RC evidence bundle JSON for `<candidate-name>` and `<git-sha>`
- one RC checklist Markdown file for `<candidate-name>` and `<git-sha>`
- one RC blocker Markdown file for `<candidate-name>` and `<git-sha>`
- one runtime observability sign-off artifact for `<git-sha>`
- one release readiness dashboard JSON or Markdown for `<git-sha>`

If two files for the "same" evidence disagree on revision or timestamp window, treat the packet as invalid and refresh the stale file instead of choosing by hand.

## Go / No-Go Checklist

Release is `go` only when all of the following are true:

- every required artifact above points to the same candidate revision
- the readiness snapshot has no `requiredFailed` and no unresolved required manual checks
- the WeChat smoke report has no required case in `failed`, `blocked`, or `pending`
- the Cocos RC bundle is generated for the same candidate and revision and includes the latest checklist/blocker files
- the runtime observability sign-off is recorded for the same revision and environment
- the final readiness dashboard does not report revision mismatch, missing revision metadata, or stale evidence

Release is `no-go` when any of the following happens:

- one artifact was generated from a different commit
- a required manual review is still pending
- smoke, runtime, or RC evidence is missing, blocked, or stale
- the blocker register contains an unresolved release-blocking item
- maintainers cannot prove which exact artifact set belongs to the candidate under review

When in doubt, rerun the stale step for the pinned `<git-sha>` and rebuild the packet. Same-revision evidence is stricter than "latest successful command."
