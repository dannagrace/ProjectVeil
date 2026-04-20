# Release Readiness Trend Troubleshooting Runbook

Use this runbook when `npm run release -- health:summary`, the PR comment, or the `Release health gate` workflow reports a `readiness-trend` warning.

The `readiness-trend` signal compares the current `release-readiness-dashboard.json` against the previous successful dashboard history for the same branch. It does not replace the current candidate `go/no-go` call. It answers a narrower question: did the candidate readiness decision improve, regress, or stay unready versus the prior revision?

## When To Open This Runbook

Open this runbook when the summary says one of the following:

- candidate readiness regressed from `ready` to `pending` or `blocked`
- candidate readiness remains `pending` or `blocked`
- no previous dashboard baseline was available, but the current candidate is not `ready`

If the current dashboard already says `ready`, the trend warning is informational only and usually means the prior baseline is missing.

## Required Inputs

Start from the two dashboard artifacts named in the warning:

- current: `artifacts/release-readiness/release-readiness-dashboard.json`
- previous baseline: the downloaded `release-readiness-dashboard.json` from the prior successful `release-readiness-history` artifact, often renamed locally to avoid collisions

Keep these neighboring artifacts open while triaging:

- `artifacts/release-readiness/release-health-summary.md`
- `artifacts/release-readiness/ci-trend-summary.md`
- `artifacts/release-readiness/release-gate-summary.json`
- `artifacts/release-readiness/release-readiness-snapshot.json` or the revision-specific `release-readiness-*.json`

## Fast Triage Flow

1. Confirm the branch history baseline is valid.
   - Make sure the previous dashboard came from the same branch, not from `main` or another candidate line.
   - Confirm the previous artifact is the latest successful `release-readiness-history` bundle for that branch.
2. Compare the top-level candidate call.
   - In both dashboards, inspect `goNoGo.decision`, `goNoGo.summary`, `goNoGo.requiredFailed`, `goNoGo.requiredPending`, and `goNoGo.candidateRevision`.
   - If the candidate revision moved forward as expected, the warning usually reflects a real regression or newly stale evidence.
3. Identify whether this is a current-candidate problem or only a delta-reporting problem.
   - If the current dashboard is `blocked` or `pending`, triage that first. The trend warning is then a symptom, not the root cause.
   - If the current dashboard is `ready`, confirm the baseline artifact is present and from the correct branch history.
4. Isolate which gate changed between the two revisions.
   - Compare the Markdown dashboards first, then the JSON gate details if the Markdown is too compressed.
   - Focus on gates that moved from `pass` to `warn` or `fail`, or evidence blocks that became stale/missing.

## Common Failure Patterns

### Current Candidate Regressed To `blocked`

Typical causes:

- a required automated gate failed in `release-readiness-snapshot`
- candidate revisions disagree across linked evidence
- required evidence is missing revision metadata
- linked evidence exceeded the freshness window

What to inspect next:

- `release-readiness-dashboard.json` `goNoGo.blockers`
- `release-readiness-dashboard.json` gate entries that are `fail`
- `release-readiness-snapshot.json` `summary` and failed required checks
- `release-gate-summary.json` failed or missing gate ids

Usual fix:

- rerun the missing or failing producer called out in the dashboard, then rebuild the dashboard and release health summary

### Current Candidate Stayed `pending`

Typical causes:

- manual/runtime evidence was intentionally not refreshed
- no `--server-url` was provided, so live server/auth checks stayed warning-only
- WeChat, reconnect soak, or persistence evidence is present but stale

What to inspect next:

- `goNoGo.pending`
- gate entries marked `warn`
- artifact timestamps in the `Critical readiness evidence`, `Reconnect soak evidence`, and `Phase 1 persistence evidence` sections

Usual fix:

- refresh the stale evidence set for the candidate revision, then rerun `npm run release -- readiness:dashboard`

### No Previous Baseline Was Available

Typical causes:

- the branch has no prior successful `release-readiness-history` run yet
- the PR comes from a fork, so same-repo history lookup was skipped
- the history artifact download failed or the dashboard file was missing

What to inspect next:

- the workflow logs around `Resolve previous successful history baseline`
- whether the downloaded artifact actually contains `release-readiness-dashboard.json`
- whether the PR branch has an earlier successful run in GitHub Actions

Usual fix:

- if the current dashboard is healthy, no product fix is needed; rerun after a successful history artifact exists
- if the current dashboard is unready, treat the signal as a current-candidate warning and fix that state first

## Canonical Recovery Commands

Rebuild the current candidate artifacts in the same order the dashboards expect:

```bash
npm run release -- readiness:snapshot -- \
  --manual-checks docs/release-readiness-manual-checks.example.json
npm run release -- readiness:dashboard -- \
  --candidate-revision <git-sha>
npm run ci:trend-summary
npm run release -- health:summary
```

If the dashboard points to specific stale or missing evidence, rerun only the needed producer before rebuilding the dashboard:

```bash
npm run release -- cocos:primary-diagnostics
npm run stress:rooms:reconnect-soak
npm test -- phase1-release-persistence
```

Add these when the candidate depends on them:

```bash
npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir artifacts/wechat-release --expect-exported-runtime
npm run smoke -- wechat-release -- --artifacts-dir artifacts/wechat-release
npm run release -- cocos-rc:snapshot -- --candidate <candidate-name> --build-surface wechat_preview --output artifacts/release-evidence/<candidate-name>.json
```

## Decision Rule

- Treat `readiness-trend` as a release signal amplifier, not the primary gate.
- If the current dashboard is `blocked`, fix the current candidate before worrying about the historical delta.
- If the current dashboard is `pending`, decide whether the missing freshness/manual evidence is acceptable for the branch stage; if not, refresh it.
- If the current dashboard is `ready` and only the baseline is missing, document that the branch lacks prior history and proceed once the workflow has published a successful baseline artifact.
