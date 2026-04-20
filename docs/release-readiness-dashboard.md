# Phase 1 Release Readiness Dashboard

`npm run release -- readiness:dashboard` generates a single local report for the current Phase 1 gameplay release gates. It now promotes one Phase 1 `go/no-go` decision for a candidate/revision pair, including first-class `requiredFailed` / `requiredPending` counts, normalized blocker/warning drill-down, and linked artifact paths for quick audit. The report reuses existing evidence instead of redefining the workflow:

- `npm run release -- readiness:snapshot` for automated regression/build gates
- `GET /api/runtime/health`, `GET /api/runtime/auth-readiness`, `GET /api/runtime/metrics` for live server/auth posture
- `npm run package:wechat-release` sidecar metadata for package validation
- `npm run smoke -- wechat-release` for device/quasi-device smoke evidence
- `npm run release -- cocos-rc:snapshot` for recent Cocos RC journey evidence
- `npm run release -- cocos:primary-diagnostics` for checkpointed primary-client runtime diagnostics evidence
- `npm run stress:rooms:reconnect-soak` for reconnect soak + teardown evidence
- `npm test -- phase1-release-persistence` for persistence + shipped content evidence
- `npm run release -- candidate:evidence-audit` for the candidate-scoped artifact-family consistency check under `artifacts/release-readiness/`

If you need the faster maintainer-facing index of which command or doc owns each operational task, open [`docs/operational-entry-point-repo-map.md`](./operational-entry-point-repo-map.md).

The dashboard writes both JSON and Markdown so it works as a quick terminal summary and as a review artifact.

## Usage

Generate a report from the latest local evidence already under `artifacts/`:

```bash
npm run release -- readiness:dashboard
```

Generate a candidate-scoped dashboard for one candidate/revision pair:

```bash
npm run release -- readiness:dashboard -- \
  --candidate phase1-rc \
  --candidate-revision abc1234 \
  --server-url http://127.0.0.1:2567 \
  --snapshot artifacts/release-readiness/rc-2026-03-29.json \
  --cocos-rc artifacts/release-evidence/phase1-wechat-rc.json \
  --primary-client-diagnostics artifacts/release-readiness/cocos-primary-client-diagnostic-snapshots-abc1234-2026-03-29T08-18-00.000Z.json \
  --reconnect-soak artifacts/release-readiness/colyseus-reconnect-soak-summary-phase1-rc-abc1234.json \
  --phase1-persistence artifacts/release-readiness/phase1-release-persistence-regression-abc1234.json \
  --same-candidate-audit artifacts/release-readiness/candidate-evidence-audit-phase1-rc-abc1234.json \
  --wechat-artifacts-dir artifacts/wechat-release \
```

Write to explicit output files:

```bash
npm run release -- readiness:dashboard -- \
  --output artifacts/release-readiness/phase1-dashboard.json \
  --markdown-output artifacts/release-readiness/phase1-dashboard.md
```

If your evidence freshness window should be stricter or looser than the default 14 days:

```bash
npm run release -- readiness:dashboard -- --max-evidence-age-days 7
```

If you want the report to pin all automated and manual evidence to one explicit candidate revision, pass:

```bash
npm run release -- readiness:dashboard -- --candidate <candidate-name> --candidate-revision <git-sha>
```

When both `--candidate` and `--candidate-revision` are set, the command becomes the enforcing candidate-consistency check for the required local evidence set. It still writes the JSON + Markdown dashboard, but the dashboard now explicitly calls out when the same-candidate audit is missing or failing, and exits non-zero if any linked artifact:

- reports a different revision than the pinned candidate
- omits revision metadata, so the candidate cannot be verified end to end
- is older than `--max-evidence-age-days`, missing a timestamp, or carries an invalid timestamp

## Gate Mapping

The report starts with one `go/no-go` section:

- `ready`
  - `requiredFailed=0`, `requiredPending=0`, no gate is failing or warning, and the linked evidence revisions align with the candidate revision when one can be verified.
- `pending`
  - no blocking failures exist, but required checks are still pending, some evidence is stale / missing a timestamp, live/manual checks were not run, or the candidate revision cannot yet be verified across the linked evidence.
- `blocked`
  - one or more required checks failed, a gate failed, or linked artifact revisions disagree on which candidate is under review.
  - when `--candidate-revision` is supplied, `blocked` also covers required evidence with missing revision metadata or freshness that cannot be verified inside the configured window.

After that, the report summarizes seven bounded gates:

- `Server health`
  - `pass` when `/api/runtime/health` is reachable and `/api/runtime/metrics` exposes the expected gameplay/auth counters.
  - `fail` when the live health probe fails or required metrics are missing.
  - `warn` when no `--server-url` is supplied.
- `Auth readiness`
  - `pass` when `/api/runtime/auth-readiness` returns `status: ok`.
  - `warn` when the endpoint reports `status: warn` or no server URL is supplied.
  - `fail` when the endpoint cannot be read.
- `Smoke/build/package validation`
  - Reuses the structured `release:readiness:snapshot` check results.
  - Confirms a `*.package.json` WeChat sidecar exists alongside its archive.
  - Reads `codex.wechat.smoke-report.json` and flags `pending` as `warn`, `failed` as `fail`.
- `Critical readiness evidence`
  - Lists the latest linked evidence with exact timestamps, paths, and any revision identifiers discovered in the source artifacts.
  - Fails closed when primary-client diagnostic snapshots are missing or incomplete.
  - Warns when present evidence is older than the configured freshness window.
- `Same-candidate evidence`
  - Reuses `candidate-evidence-audit-<candidate>-<short-sha>.json` when you run the dashboard as a candidate/revision pair.
  - Fails when the audit is missing or failed for the selected candidate.
  - Warns instead of failing when the dashboard is run without a pinned candidate pair and no audit was selected.
- `Reconnect soak evidence`
  - Fails when the reconnect soak artifact is missing, reports failed scenarios / rooms, omits reconnect or invariant counters, or leaves cleanup counters above zero.
  - Warns when the artifact passes but is older than the configured freshness window.
- `Phase 1 persistence evidence`
  - Fails when the persistence regression artifact is missing, the regression did not pass, shipped content validation failed, or no persistence assertions were recorded.
  - Warns when the artifact passes but is older than the configured freshness window.

## Recommended Local Flow

1. Refresh the automated gate evidence:

```bash
npm run release -- readiness:snapshot -- \
  --manual-checks docs/release-readiness-manual-checks.example.json
```

2. If validating a WeChat candidate, refresh artifact evidence:

```bash
npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir artifacts/wechat-release --expect-exported-runtime
npm run smoke -- wechat-release -- --artifacts-dir artifacts/wechat-release
```

3. If validating a Cocos RC, refresh the RC journey snapshot:

```bash
npm run release -- cocos-rc:snapshot -- --candidate <candidate-name> --build-surface wechat_preview --output artifacts/release-evidence/<candidate-name>.json
```

4. Refresh the primary-client diagnostic evidence artifact:

```bash
npm run release -- cocos:primary-diagnostics
```

5. Refresh reconnect soak and persistence evidence when the RC scope touches room recovery or shipped content/persistence paths:

```bash
npm run stress:rooms:reconnect-soak
npm test -- phase1-release-persistence
```

6. Start the local server if you want live runtime/auth evidence in the same report:

```bash
npm run dev -- server
```

7. Run the candidate-level evidence audit for the pinned candidate pair:

```bash
npm run release -- candidate:evidence-audit -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha> \
  --target-surface <h5|wechat>
```

8. Generate the dashboard:

```bash
npm run release -- readiness:dashboard -- \
  --candidate <candidate-name> \
  --server-url http://127.0.0.1:2567 \
  --wechat-artifacts-dir artifacts/wechat-release \
  --candidate-revision <git-sha>
```

Use the same `<candidate-name>` and `<git-sha>` across the snapshot, reconnect soak artifact, same-candidate audit, WeChat package/smoke artifacts, Cocos RC snapshot, and primary-client diagnostics generation flow. If one artifact drifts to another revision or goes stale, the dashboard now prints the exact artifact path plus the observed/expected revision mismatch before exiting non-zero.

The Markdown output is intended to be attachable to issue/PR discussion, while the JSON output is intended for automation or later aggregation. Both formats now expose the same candidate-level `goNoGo` block plus a `Blocker Drill-Down` section so reviewers do not need to stitch the final Phase 1 release call together by hand.

## CI And Manual Review

- CI should treat the JSON dashboard as the machine-readable contract and key off `overallStatus`, `goNoGo.decision`, `goNoGo.blockers`, and `triage.blockers`.
- Manual release review should start with the Markdown `Blocker Drill-Down`, then open the listed evidence paths for the specific failing or warning gate instead of re-reading the entire artifact packet.
- The dashboard replaces manual evidence stitching when the selected candidate pair already has fresh snapshot, reconnect soak, same-candidate audit, WeChat, and Cocos evidence. It does not replace manual runtime observability sign-off, RC checklist review, or any target-surface-specific human approvals that are still recorded outside the dashboard.

If `release:health:summary` later flags a `readiness-trend` warning for this dashboard, use [`docs/release-readiness-trend-troubleshooting.md`](./release-readiness-trend-troubleshooting.md) to compare this candidate call against the previous successful branch baseline.
