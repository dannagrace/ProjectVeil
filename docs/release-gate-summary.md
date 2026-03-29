# Release Gate Summary

`npm run release:gate:summary` aggregates the existing release signals into one CI-friendly JSON file plus a Markdown summary for PR comments, workflow artifacts, or manual review.

It intentionally reuses the current evidence instead of introducing a parallel gate system:

- `npm run release:readiness:snapshot` for the baseline regression/build gate state
- `npm run smoke:client:release-candidate` for packaged H5 smoke evidence
- `npm run validate:wechat-rc` or `npm run smoke:wechat-release -- --check` for WeChat release evidence
- `configs/.config-center-library.json` for the latest applied config-center publish audit and config change risk summary

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
  --config-center-library configs/.config-center-library.json \
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

## Config Change Risk Summary

Besides the three hard release gates, the report now appends a structured `Config Change Risk Summary` section sourced from the latest `resultStatus=applied` config-center publish audit.

Current baseline coverage includes:

- `world`
- `mapObjects`
- `units`
- `battleSkills`
- `battleBalance`

For each touched config document, the summary records:

- risk level (`low / medium / high`)
- impacted modules
- highlighted diff paths from config-center publish history
- suggested validation actions
- whether gray release / canary or rehearsal is recommended

This section is advisory by design: it does not change the pass/fail semantics of the three release gates, but it gives PR reviewers and release owners a single place to see which config changes need extra evidence.

## Config Release Workflow

Recommended pre-release flow for planners and developers:

1. In config-center, stage and publish the config bundle so the latest publish audit is recorded in `configs/.config-center-library.json`.
2. Run `npm run release:gate:summary` and inspect the `Config Change Risk Summary` in the generated JSON or Markdown.
3. Execute the suggested validation commands listed in that section. Common actions include:
   - `npm run validate:content-pack`
   - `npm run validate:battle`
   - `npm run release:readiness:snapshot`
   - `npm run smoke:client:release-candidate`
4. If the summary recommends gray release / canary or rehearsal, include that decision and supporting evidence in the release PR.

Use this as the handoff bridge between config-center history and the release gate report: the config publish audit explains what changed, and the release summary explains what evidence should exist before the change ships.
