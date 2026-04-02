# CI Trend Summary

`npm run ci:trend-summary` folds the existing runtime-regression report and release-gate summary into one compact JSON/Markdown artifact for workflow summaries, PR comments, or downstream automation.

The script does not replace the existing report producers:

- `npm run perf:runtime:compare` still owns the thresholded runtime comparison against [`configs/runtime-regression-baseline.json`](/home/gpt/project/ProjectVeil/.worktrees/issue-344-0330-0131/configs/runtime-regression-baseline.json)
- `npm run release:gate:summary` still owns the current release-gate snapshot

`ci:trend-summary` only compares those current reports against optional prior artifacts and emits stable machine-readable findings:

- `runtime:<scenario>:<metric>`
- `release-gate:<gate-id>`

Each finding records:

- category: `runtime-regression` or `release-gate-regression`
- status: `new`, `ongoing`, or `recovered`
- current and previous status
- threshold/actual values for runtime checks

## Usage

Compare current reports only:

```bash
npm run ci:trend-summary -- \
  --runtime-report artifacts/release-readiness/runtime-regression-report.json \
  --release-gate-report artifacts/release-readiness/release-gate-summary.json
```

Add prior artifacts when CI or a reviewer has them:

```bash
npm run ci:trend-summary -- \
  --runtime-report artifacts/release-readiness/runtime-regression-report.json \
  --previous-runtime-report artifacts/release-readiness/runtime-regression-report-main.json \
  --release-gate-report artifacts/release-readiness/release-gate-summary.json \
  --previous-release-gate-report artifacts/release-readiness/release-gate-summary-main.json \
  --output artifacts/release-readiness/ci-trend-summary.json \
  --markdown-output artifacts/release-readiness/ci-trend-summary.md
```

Append the Markdown output directly to the workflow summary:

```bash
npm run ci:trend-summary -- \
  --runtime-report artifacts/release-readiness/runtime-regression-report.json \
  --release-gate-report artifacts/release-readiness/release-gate-summary.json \
  --github-step-summary "${GITHUB_STEP_SUMMARY}"
```

## GitHub Actions History

Maintain the long-running branch history from GitHub Actions `Release Readiness History`.

- The workflow runs on a daily schedule and also supports `workflow_dispatch`.
- Maintainers should open the latest successful run on the branch they care about and download the `release-readiness-history` artifact.
- The stable entry points inside that artifact are:
  - `release-health-summary.md`
  - `ci-trend-summary.md`
  - `release-readiness-dashboard.md`
  - `release-readiness-snapshot.json`

When a previous successful history artifact exists on the same branch, the workflow compares the current runtime-regression report and release-gate summary against that baseline before publishing `ci-trend-summary.json` / `.md`.

If the companion `release-health-summary` output reports a `readiness-trend` warning, follow [`docs/release-readiness-trend-troubleshooting.md`](./release-readiness-trend-troubleshooting.md) to compare the current and previous dashboards before deciding whether the branch regressed or only lacks a usable baseline.
