# Release Gate Summary

`npm run release:gate:summary` aggregates the existing release signals into one CI-friendly JSON file plus a Markdown summary for PR comments, workflow artifacts, or manual review.

For the short reviewer-facing checklist of the remaining Phase 1 hardening gaps, use [`docs/phase1-hardening-reviewer-checklist.md`](./phase1-hardening-reviewer-checklist.md).

It intentionally reuses the current evidence instead of introducing a parallel gate system:

- `npm run release:readiness:snapshot` for the baseline regression/build gate state
- `npm run smoke:client:release-candidate` for packaged H5 smoke evidence
- `npm run release:reconnect-soak -- --candidate <candidate-name> --candidate-revision <git-sha>` for candidate-scoped reconnect soak evidence plus room cleanup evidence
- `npm run validate:wechat-rc` or `npm run smoke:wechat-release -- --check` for WeChat release evidence
- `configs/.config-center-library.json` for the latest applied config-center publish audit and config change risk summary

Because the snapshot now executes `npm run validate:map-object-visuals` as a required automated check, the top-level release gate will also fail when shipped map objects reference missing visual definitions or coverage in `configs/object-visuals.json`.

The summary now also records one explicit `targetSurface` contract. That contract is what makes `H5 passed` different from `WeChat passed`: WeChat release decisions now require a current `codex.wechat.release-candidate-summary.json` plus fresh manual/runtime review metadata, while H5-only release decisions can mark the WeChat gate as advisory.

For reviewer handoff, treat the WeChat RC checklist and blocker register as the human-readable mirror of that same contract, not as optional notes. They should carry the same surface, revision, freshness, owner, blocker, and waiver story that the JSON report enforces.

When the target surface is `wechat`, the summary also auto-discovers the latest `codex.wechat.commercial-verification-<short-sha>.json` from the selected WeChat artifacts dir and surfaces it as an advisory warning when it is missing, stale, or blocked. This does not change the hard technical gate semantics, but it keeps the external-launch checklist visible in the same handoff artifact instead of leaving it implicit in a separate PR comment or release note.

## Usage

Use the latest local artifacts under `artifacts/release-readiness/` and `artifacts/wechat-release/`:

```bash
npm run release:gate:summary
```

When the current working set lives inside a candidate rehearsal bundle rather than the top-level artifact roots, the command now also scans nested directories under `artifacts/release-readiness/` and reuses the newest matching snapshot / H5 smoke / reconnect soak / WeChat evidence set from that bundle.

Pick the release target surface explicitly when needed:

```bash
npm run release:gate:summary -- --target-surface wechat
```

```bash
npm run release:gate:summary -- --target-surface h5
```

Point at explicit artifact paths when CI already produced stable filenames:

```bash
npm run release:gate:summary -- \
  --snapshot artifacts/release-readiness/release-readiness-2026-03-29T08-12-04.512Z.json \
  --h5-smoke artifacts/release-readiness/client-release-candidate-smoke-abc1234-2026-03-29T08-15-10.000Z.json \
  --reconnect-soak artifacts/release-readiness/colyseus-reconnect-soak-summary-phase1-rc-abc1234.json \
  --manual-evidence-ledger artifacts/release-readiness/manual-release-evidence-owner-ledger-abc1234.md \
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

Default input discovery remains intentionally conservative about artifact families, but it is now recursive for release-readiness working-set files. That means a prior `release:phase1:candidate-rehearsal` run can feed a later top-level `release:gate:summary` call without having to re-pass every nested path explicitly.

## Triage Summary

The JSON and Markdown outputs now include a normalized `triage` section for operator handoff:

- `triage.blockers`
  - one entry per failing required release-gate dimension, with `impactedSurface`, `summary`, `nextStep`, and artifact paths
- `triage.warnings`
  - advisory items that should be reviewed before promotion, such as elevated config-change risk

Use this first when CI is red or when a PR comment needs one concise release/ops answer.

## Gate Rules

The summary contains five release dimensions:

- `release-readiness`
  - Fails when the snapshot is missing, when the snapshot summary is not `passed`, or when any required snapshot check is `failed` or `pending`.
  - That includes `npm run validate:map-object-visuals`, so missing sprite/visual coverage now blocks release promotion through the same snapshot gate instead of relying on reviewers to run it separately.
- `h5-release-candidate-smoke`
  - Fails when the packaged H5 smoke report is missing, the smoke execution status is not `passed`, or any smoke case failed.
- `multiplayer-reconnect-soak`
  - Fails when the reconnect soak artifact is missing, when the soak run itself failed, or when it did not record reconnect attempts plus invariant checks.
  - Fails closed when the post-soak cleanup counters show lingering active rooms, live connections, active battles, or hero snapshots.
  - The target-surface contract now distinguishes reconnect soak evidence that is `present`, `stale`, or `failing` for the current candidate revision instead of only reporting file presence.
  - Use this gate for release candidates and reconnect / room-recovery changes; keep `test:e2e:multiplayer:smoke` as the faster PR-level signal for canonical multiplayer link health.
- `wechat-release`
  - Prefers `codex.wechat.release-candidate-summary.json` when present.
  - Falls back to `codex.wechat.rc-validation-report.json` when the candidate summary is absent.
  - Falls back to `codex.wechat.smoke-report.json` when the RC validation report is absent.
  - Fails closed when required WeChat evidence is missing, failed, blocked, or still pending.
  - When the candidate summary is available, also fails on required manual-review metadata drift: missing `owner`, missing `recordedAt`, missing `revision`, revision mismatch, or review evidence older than 24h.
  - Markdown/JSON summary text distinguishes `blocked` device/runtime evidence from true execution failures so CI reviewers can see whether a gate is red because proof is absent or because the runtime actually regressed.
- `phase1-evidence-consistency`
  - Cross-checks the release-readiness snapshot, packaged H5 smoke report, and selected WeChat evidence as one Phase 1 candidate set.
  - When a manual evidence owner ledger is provided, or when one exists under `artifacts/release-readiness/`, it also validates the ledger header against the current candidate revision.
  - Fails when any artifact is missing revision metadata, missing/invalid generated timestamps, points at a different commit than the current release candidate, carries a conflicting candidate hint from its artifact path, or disagrees with another artifact’s commit/candidate hint.
  - For the ledger, the checked fields are `Target revision` and `Last updated`.
  - Fails when the selected evidence timestamps drift by more than 72 hours, which is the cutoff for “same candidate evidence set” in this report.
  - The Markdown output now includes a `Selected Inputs` section so reviewers can see the exact artifact paths that were compared instead of inferring them from the default directory scan.

Any failed dimension makes the script exit non-zero so the result can act as a CI release gate.

## Target Surface Contract

The report now includes a `Target Surface Contract` section with:

- `targetSurface`
  - `wechat` or `h5`
- `releaseSurface.status`
  - pass/fail call for the selected surface
- `releaseSurface.evidence[*]`
  - exact evidence item, freshness, owner, revision, waiver, and artifact path
- Markdown `Manual Evidence Ownership`
  - a reviewer-facing rollup of the candidate ledger plus each required manual evidence item with owner, freshness, recorded timestamp, revision, blocker ids, and artifact path so stale or unowned ledger rows are visible without expanding the full evidence list

When `--manual-evidence-ledger` is present, the summary now parses the ledger table itself instead of only the header metadata. That means one `release:gate:summary` run will surface:

- a stale ledger header
- missing release owner metadata
- required ledger rows still marked `pending` or `in-review`
- row-level ownership gaps such as missing `Owner`
- row-level freshness or revision drift for the current candidate

Those row-level findings are promoted into both the `Target Surface Contract` and the top-level `Triage Summary`, so reviewers can tell from the generated gate summary whether the candidate still has manual evidence handoff work outstanding before the release call.

For `wechat`, the generated Markdown `Selected Inputs` section also records the currently selected commercial-verification artifact path, and the `Warnings` section will call out missing or blocked external-launch verification. Use that warning as the trigger to run:

```bash
npm run release:wechat:commercial-verification -- --artifacts-dir <wechat-artifacts-dir>
```

That warning stays advisory on purpose: it is there to prevent a technically green RC packet from being mistaken for an externally launch-ready packet.

For `wechat`, the required surface evidence is:

- release readiness snapshot
- H5 packaged RC smoke
- reconnect soak
- WeChat candidate summary
- required WeChat manual-review checks with current owner/timestamp/revision metadata

## Config Change Risk Summary

Besides the four hard release gates, the report now appends a structured `Config Change Risk Summary` section sourced from the latest `resultStatus=applied` config-center publish audit.

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

## Refreshing Stale Evidence For One Candidate Revision

When `phase1-evidence-consistency` fails, refresh the evidence for one candidate revision instead of mixing old and new artifacts in place:

1. Pick the target Git revision and keep it fixed for the whole refresh pass.
2. Re-run `npm run release:readiness:snapshot` for that revision and keep the resulting JSON path.
3. Re-run `npm run smoke:client:release-candidate` for the same revision and keep the resulting H5 smoke path.
4. Re-run `npm run validate:wechat-rc` or `npm run smoke:wechat-release -- --check` against the WeChat artifacts built from that same revision.
5. Re-run `npm run release:gate:summary -- --snapshot <snapshot-json> --h5-smoke <h5-smoke-json> --wechat-artifacts-dir <wechat-artifacts-dir>` so the summary compares the exact refreshed paths instead of whichever files happen to be newest.

If the report still shows timestamp drift or a candidate/path mismatch, delete or archive the stale artifact set before regenerating the summary. The goal is one candidate revision, one coherent evidence packet.
