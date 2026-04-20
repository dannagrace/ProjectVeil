# Release Evidence Lifecycle

`artifacts/release-readiness/` and `artifacts/wechat-release/` are live review surfaces. They should only hold the artifact sets that are still valid for active release review.

## Policy

- Live directories keep artifact sets that are either:
  - still within the configured live retention window, or
  - among the latest retained sets for the same artifact family.
- Historical artifact sets move to `artifacts/release-archive/runs/<timestamp>/...`.
- Reviewers should treat anything under `artifacts/release-archive/` as historical context only. It is not part of the active release packet.
- The reviewer front doors in live storage are:
  - `candidate-evidence-manifest-<candidate>-<short-sha>.json|md`
  - `current-release-evidence-index-<short-sha>.json|md`
  - `release-gate-summary-<short-sha>.json|md`
  - `release-readiness-dashboard-<candidate>-<short-sha>.json|md`
  - packet directories such as `phase1-candidate-rehearsal/<candidate>/SUMMARY.md`, `phase1-candidate-dossier-*`, and `runtime-observability-bundle-*`

## Command

Dry-run first:

```bash
npm run release -- evidence:lifecycle -- \
  --retention-days 14 \
  --archive-retention-days 90 \
  --keep-latest-per-family 2
```

Apply the plan after review:

```bash
npm run release -- evidence:lifecycle -- \
  --retention-days 14 \
  --archive-retention-days 90 \
  --keep-latest-per-family 2 \
  --apply
```

## Outputs

- `artifacts/release-readiness/release-evidence-lifecycle-report-<short-sha>.json`
- `artifacts/release-readiness/release-evidence-lifecycle-report-<short-sha>.md`
- When `--apply` archives anything, the matching archive run also gets:
  - `artifacts/release-archive/runs/<timestamp>/archive-manifest.json`
  - `artifacts/release-archive/runs/<timestamp>/archive-manifest.md`

## Reviewer Guidance

- Start with the retained candidate manifest or current release evidence index instead of browsing directories manually.
- If the lifecycle report marks an artifact set as an archive candidate, refresh or restage the current candidate evidence before review instead of reading the stale copy.
- Do not point gate scripts at archived paths unless you are performing historical forensics on an old candidate.
