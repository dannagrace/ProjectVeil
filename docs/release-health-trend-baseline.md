# Release Health Trend Baseline

`npm run release:health:trend-baseline` summarizes the latest N `release-readiness-history` artifact directories into one concise baseline for maintainers.

It is intended to answer three questions quickly:

- Is the current candidate healthier or worse than the last few candidates?
- Which blockers are newly introduced versus already known?
- Did reconnect soak, smoke, server health, or auth readiness regress between the latest two candidates?

## Inputs

Each candidate directory should contain the stable files produced by the `Release Readiness History` workflow:

- `release-health-summary.json`
- `release-gate-summary.json`
- `release-readiness-dashboard.json` (recommended for runtime/auth readiness deltas)
- `source-run.json` (optional, used for CI run links in Markdown)

You can provide directories explicitly:

```bash
npm run release:health:trend-baseline -- \
  --artifact-dir ./tmp/history/run-101 \
  --artifact-dir ./tmp/history/run-100 \
  --artifact-dir ./tmp/history/run-099 \
  --limit 3
```

Or point the script at a cache root. By default it scans `artifacts/release-readiness-history-cache/` and reads each immediate child directory that contains the required summary files:

```bash
npm run release:health:trend-baseline
```

Override the cache root when needed:

```bash
npm run release:health:trend-baseline -- \
  --cache-dir ./tmp/release-readiness-history-cache \
  --limit 5
```

## Default Outputs

If you do not pass output flags, the script writes:

- `artifacts/release-readiness/release-health-trend-baseline.json`
- `artifacts/release-readiness/release-health-trend-baseline.md`

## Output Shape

The JSON output contains:

- `summary`
  - compared candidate count
  - current candidate and previous candidate
  - current release-health status and readiness decision
  - counts for healthy / warning / blocking recent candidates
  - newly introduced / known / recovered blocker counts
  - regressing / improving key-signal counts
- `blockers`
  - `current`, `previous`, `new`, `known`, and `recovered`
- `signalTrends`
  - deltas for release health, candidate readiness, reconnect soak, H5 smoke, WeChat release validation, server health, and auth readiness
- `candidates`
  - the per-candidate normalized summaries used to build the baseline

The Markdown output is stable enough for PR comments or release notes because it keeps the top-level sections fixed:

- `Blocker Delta`
- `Signal Trends`
- `Recent Candidates`

## Local Regeneration

Populate the default cache path with recent workflow artifacts. One straightforward pattern is to download the `release-readiness-history` artifact from several workflow runs into separate directories:

```bash
mkdir -p artifacts/release-readiness-history-cache/run-101
gh run download 101 --repo dannagrace/ProjectVeil -n release-readiness-history -D artifacts/release-readiness-history-cache/run-101

mkdir -p artifacts/release-readiness-history-cache/run-100
gh run download 100 --repo dannagrace/ProjectVeil -n release-readiness-history -D artifacts/release-readiness-history-cache/run-100
```

Then rebuild the baseline:

```bash
npm run release:health:trend-baseline -- --limit 5
```

## CI Regeneration

In GitHub Actions, reuse the existing `release-readiness-history` artifact instead of rebuilding raw evidence by hand:

1. Download recent `release-readiness-history` artifacts into sibling directories under a workspace cache path.
2. Run `npm run release:health:trend-baseline -- --cache-dir <that-path> --limit <n>`.
3. Attach the generated JSON / Markdown to the workflow summary, PR comment, or release notes bundle.

This keeps the trend baseline aligned with the same normalized artifacts already used by `release:health:summary`, `release:gate:summary`, and `release:readiness:dashboard`.
