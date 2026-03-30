# Release Health Summary

`npm run release:health:summary` aggregates the existing release/readiness artifacts into one stable JSON summary plus a Markdown digest.

It reuses the current artifact producers instead of redefining them:

- `npm run release:readiness:snapshot`
- `npm run release:gate:summary`
- `npm run ci:trend-summary`
- `npm run test:coverage:ci`
- `npm run test:sync-governance:matrix`

## Severity Rules

The output normalizes findings into three severities:

- `blocker`
  - missing or failing `release-readiness`
  - missing or failing `release-gate`
  - failing `sync-governance`
- `warning`
  - missing `ci-trend`, `coverage`, or `sync-governance`
  - active CI trend regressions
  - coverage threshold failures
- `info`
  - passing artifacts

This makes the JSON easy for bots to consume while keeping the Markdown readable for daily release checks or PR comments.

## PR Gate Rule

In CI, the `Release health gate` check runs `npm run release:health:summary` after the release readiness, release gate, and trend artifacts are assembled.

- `blocking` summary status fails the PR check.
- `warning` and `healthy` summary statuses keep the check green, while still publishing the JSON/Markdown summary and the PR comment.

That keeps the existing summary/comment flow usable without turning warning-only noise into a merge blocker.

## Usage

Use the latest local artifacts discovered under `artifacts/release-readiness/` plus `.coverage/summary.json`:

```bash
npm run release:health:summary
```

Point at explicit artifact paths when CI already produced stable filenames:

```bash
npm run release:health:summary -- \
  --release-readiness artifacts/release-readiness/release-readiness-2026-03-30T08-00-00.000Z.json \
  --release-gate-summary artifacts/release-readiness/release-gate-summary.json \
  --ci-trend-summary artifacts/release-readiness/ci-trend-summary.json \
  --coverage-summary .coverage/summary.json \
  --sync-governance artifacts/release-readiness/sync-governance-matrix-abc1234.json
```

Write to explicit output files:

```bash
npm run release:health:summary -- \
  --output artifacts/release-readiness/release-health-summary.json \
  --markdown-output artifacts/release-readiness/release-health-summary.md
```

## Default Outputs

If you do not pass output flags, the script writes:

- `artifacts/release-readiness/release-health-summary-<short-sha>.json`
- `artifacts/release-readiness/release-health-summary-<short-sha>.md`

## Output Shape

The JSON report contains:

- `summary`
  - overall status: `healthy`, `warning`, or `blocking`
  - blocker / warning / info counts
  - blocking and warning signal ids
- `inputs`
  - resolved artifact paths used for this run
- `signals`
  - per-artifact status, summary, detail lines, and source path
- `findings`
  - flattened machine-readable findings with `severity`, `signalId`, and source path

Use this as the top-level release health entry point when a person, bot, or PR comment needs one answer for the current branch state.
