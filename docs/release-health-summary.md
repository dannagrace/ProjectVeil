# Release Health Summary

`npm run release -- health:summary` aggregates the existing release/readiness artifacts into one stable JSON summary plus a Markdown digest.

The summary now includes a unified `triage` section so maintainers can see, in one place:

- which signals are blocking vs warning-only
- which underlying artifact(s) to open next
- the next debugging command or inspection step for each failing signal
- how the latest candidate readiness call changed versus the previous candidate revision when dashboard history is available

It reuses the current artifact producers instead of redefining them:

- `npm run release -- readiness:snapshot`
- `npm run release -- gate:summary`
- `npm run release -- readiness:dashboard`
- `npm run ci:trend-summary`
- `npm test -- coverage:ci`
- `npm test -- sync-governance:matrix`

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

In CI, the `Release health gate` check runs `npm run release -- health:summary` after the release readiness, release gate, and trend artifacts are assembled.

- `blocking` summary status fails the PR check.
- `warning` and `healthy` summary statuses keep the check green, while still publishing the JSON/Markdown summary and the PR comment.
- When the go/no-go packet is available for the same revision, the PR comment also includes a concise verdict section with blocker/warning counts plus links or paths back to the full packet and its key evidence inputs.

That keeps the existing summary/comment flow usable without turning warning-only noise into a merge blocker.

## Usage

Use the latest local artifacts discovered under `artifacts/release-readiness/` plus `.coverage/summary.json`:

```bash
npm run release -- health:summary
```

Point at explicit artifact paths when CI already produced stable filenames:

```bash
npm run release -- health:summary -- \
  --release-readiness artifacts/release-readiness/release-readiness-2026-03-30T08-00-00.000Z.json \
  --release-gate-summary artifacts/release-readiness/release-gate-summary.json \
  --release-readiness-dashboard artifacts/release-readiness/release-readiness-dashboard.json \
  --previous-release-readiness-dashboard artifacts/release-readiness/release-readiness-dashboard-prev.json \
  --ci-trend-summary artifacts/release-readiness/ci-trend-summary.json \
  --coverage-summary .coverage/summary.json \
  --sync-governance artifacts/release-readiness/sync-governance-matrix-abc1234.json
```

Write to explicit output files:

```bash
npm run release -- health:summary -- \
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
  - when a current readiness dashboard is provided, includes `readiness-trend` for regression/improvement across candidate revisions
- `findings`
  - flattened machine-readable findings with `severity`, `signalId`, and source path
- `triage`
  - `blockers` and `warnings`
  - each entry includes a concise summary, next step, and artifact references

Use this as the top-level release health entry point when a person, bot, or PR comment needs one answer for the current branch state.

For signal-specific triage once `readiness-trend` appears, use [`docs/release-readiness-trend-troubleshooting.md`](./release-readiness-trend-troubleshooting.md).

## Maintainer History Check

For branch-level readiness history in GitHub Actions, use the `Release Readiness History` workflow instead of stitching together raw CI artifacts by hand.

- Open the latest successful workflow run for the branch.
- Download the `release-readiness-history` artifact.
- Start with `release-health-summary.md` for the top-level call. It now includes candidate readiness trend reporting when the workflow can compare the latest dashboard against the previous successful history baseline.
- Then inspect `ci-trend-summary.md` for runtime/release-gate deltas and `release-readiness-dashboard.md` for the latest go/no-go view.
- If `readiness-trend` is warning, open [`docs/release-readiness-trend-troubleshooting.md`](./release-readiness-trend-troubleshooting.md) before rerunning evidence producers so you can separate a true candidate regression from a missing/misaligned baseline artifact.
