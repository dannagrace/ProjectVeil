# Release Gate Summary

`npm run release:gate:summary` aggregates the existing release signals into one CI-friendly JSON file plus a Markdown summary for PR comments, workflow artifacts, or manual review.

It intentionally reuses the current evidence instead of introducing a parallel gate system:

- `npm run release:readiness:snapshot` for the baseline regression/build gate state
- `npm run smoke:client:release-candidate` for packaged H5 smoke evidence
- `npm run validate:wechat-rc` or `npm run smoke:wechat-release -- --check` for WeChat release evidence

## Usage

Use the latest local artifacts under `artifacts/release-readiness/` and `artifacts/wechat-release/`:

```bash
npm run release:gate:summary
```

Point at explicit artifact paths when CI already produced stable filenames:

```bash
npm run release:gate:summary -- \
  --snapshot artifacts/release-readiness/release-readiness-2026-03-29T08-12-04.512Z.json \
  --h5-smoke artifacts/release-readiness/client-release-candidate-smoke-abc1234-2026-03-29T08-15-10.000Z.json \
  --wechat-artifacts-dir artifacts/wechat-release
```

Write to explicit output files:

```bash
npm run release:gate:summary -- \
  --output artifacts/release-readiness/release-gate-summary.json \
  --markdown-output artifacts/release-readiness/release-gate-summary.md
```

## Default Outputs

If you do not pass output flags, the script writes:

- `artifacts/release-readiness/release-gate-summary-<short-sha>.json`
- `artifacts/release-readiness/release-gate-summary-<short-sha>.md`

## Gate Rules

The summary contains exactly three release dimensions:

- `release-readiness`
  - Fails when the snapshot is missing, when the snapshot summary is not `passed`, or when any required snapshot check is `failed` or `pending`.
- `h5-release-candidate-smoke`
  - Fails when the packaged H5 smoke report is missing, the smoke execution status is not `passed`, or any smoke case failed.
- `wechat-release`
  - Prefers `codex.wechat.rc-validation-report.json` when present.
  - Falls back to `codex.wechat.smoke-report.json` when the RC validation report is absent.
  - Fails when required WeChat evidence is missing, failed, or still pending.

Any failed dimension makes the script exit non-zero so the result can act as a CI release gate.
