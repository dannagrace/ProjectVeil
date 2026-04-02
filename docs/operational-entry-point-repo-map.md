# Operational Entry-Point Repo Map

Use this as the maintainer-facing map for the repository's existing operational surfaces. It does not redefine workflows; it points to the current commands and docs that already own each function.

## Daily Routing

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Local contributor sanity check | `npm run validate:quickstart` | [`README.md`](../README.md), [`docs/verification-matrix.md`](./verification-matrix.md) |
| Pick the smallest sufficient PR verification | [`docs/verification-matrix.md`](./verification-matrix.md) | [`docs/verification-matrix.md`](./verification-matrix.md) |
| Confirm the current primary client surface | `npm run client:primary` | [`README.md`](../README.md), [`docs/cocos-primary-client-delivery.md`](./cocos-primary-client-delivery.md) |
| Audit Codex automation branches | `npm run ops:codex-branches` | [`docs/codex-automation-branch-maintenance.md`](./codex-automation-branch-maintenance.md) |

## Release Readiness And Health

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Generate one candidate readiness snapshot | `npm run release:readiness:snapshot` | [`docs/release-readiness-snapshot.md`](./release-readiness-snapshot.md) |
| Generate the branch-level readiness dashboard | `npm run release:readiness:dashboard` | [`docs/release-readiness-dashboard.md`](./release-readiness-dashboard.md) |
| Aggregate release gates for one candidate | `npm run release:gate:summary` | [`docs/release-gate-summary.md`](./release-gate-summary.md) |
| Aggregate top-level release health and triage | `npm run release:health:summary` | [`docs/release-health-summary.md`](./release-health-summary.md), [`docs/release-readiness-trend-troubleshooting.md`](./release-readiness-trend-troubleshooting.md) |
| Assemble same-revision release evidence | [`docs/same-revision-release-evidence-runbook.md`](./same-revision-release-evidence-runbook.md) | [`docs/same-revision-release-evidence-runbook.md`](./same-revision-release-evidence-runbook.md) |
| Track manual release evidence ownership for one candidate | Copy [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md) into `artifacts/release-readiness/` or the release PR | [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md), [`docs/same-revision-release-evidence-runbook.md`](./same-revision-release-evidence-runbook.md) |
| Review the Phase 1 candidate dossier or rehearsal flow | `npm run release:phase1:candidate-dossier` / `npm run release:phase1:candidate-rehearsal` | [`docs/phase1-candidate-dossier.md`](./phase1-candidate-dossier.md), [`docs/phase1-candidate-rehearsal.md`](./phase1-candidate-rehearsal.md) |

## Cocos And WeChat Delivery

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Validate the export/build surface used by CI | `npm run check:wechat-build` | [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md) |
| Prepare, package, upload, download, or verify a WeChat release artifact | `npm run prepare:wechat-release`, `npm run package:wechat-release`, `npm run upload:wechat-release`, `npm run download:wechat-release`, `npm run verify:wechat-release` | [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md) |
| Validate or smoke-check WeChat release evidence | `npm run validate:wechat-rc`, `npm run smoke:wechat-release` | [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md), [`docs/wechat-runtime-observability-signoff.md`](./wechat-runtime-observability-signoff.md) |
| Build the Cocos release-candidate evidence packet | `npm run release:cocos-rc:snapshot`, `npm run release:cocos-rc:bundle` | [`docs/cocos-release-evidence-template.md`](./cocos-release-evidence-template.md), [`docs/cocos-primary-client-delivery.md`](./cocos-primary-client-delivery.md) |
| Review primary-client runtime evidence and diagnostics | `npm run release:cocos:primary-journey-evidence`, `npm run release:cocos:primary-diagnostics`, `npm run audit:cocos-primary-delivery` | [`docs/cocos-primary-client-delivery.md`](./cocos-primary-client-delivery.md), [`docs/cocos-primary-client-telemetry.md`](./cocos-primary-client-telemetry.md) |

## Runtime, Multiplayer, And Persistence Operations

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Run reconnect or multiplayer governance checks | `npm run test:e2e:multiplayer:smoke`, `npm run test:sync-governance:matrix`, `npm run stress:rooms:reconnect-soak` | [`docs/sync-governance-matrix.md`](./sync-governance-matrix.md), [`docs/reconnect-smoke-gate.md`](./reconnect-smoke-gate.md), [`docs/reconnect-soak-gate.md`](./reconnect-soak-gate.md) |
| Run room stress or runtime regression comparisons | `npm run stress:rooms:baseline`, `npm run perf:runtime:compare` | [`docs/runtime-regression-baseline.md`](./runtime-regression-baseline.md) |
| Review or validate MySQL persistence expectations | `npm run db:migrate`, `npm run db:migrate:rollback`, `npm run test:phase1-release-persistence` | [`docs/mysql-persistence.md`](./mysql-persistence.md) |
| Inspect release-facing multiplayer load evidence | `npm run stress:rooms:baseline` | [`docs/multiplayer-loadtest-gate.md`](./multiplayer-loadtest-gate.md) |

## Content, Contracts, And Config Inputs

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Validate shipped content packs | `npm run validate:content-pack`, `npm run validate:content-pack:all` | [`docs/core-gameplay-release-readiness.md`](./core-gameplay-release-readiness.md) |
| Validate battle balance assumptions | `npm run validate:battle` | [`docs/core-gameplay-release-readiness.md`](./core-gameplay-release-readiness.md) |
| Review shared client/server contract coverage | `npm run test:contracts`, `npm run test:shared` | [`docs/shared-contract-snapshots.md`](./shared-contract-snapshots.md), [`docs/test-coverage-audit-issue-199.md`](./test-coverage-audit-issue-199.md) |

## Planning And Maturity Context

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Check current repository maturity and next ops slices | [`docs/repo-maturity-baseline.md`](./repo-maturity-baseline.md) | [`docs/repo-maturity-baseline.md`](./repo-maturity-baseline.md) |
| Check Phase 1 exit posture and remaining release gaps | [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md) | [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md) |
| Fall back when GitHub issue intake automation is unavailable | [`docs/github-issue-intake-fallback.md`](./github-issue-intake-fallback.md) | [`docs/github-issue-intake-fallback.md`](./github-issue-intake-fallback.md), [`docs/github-issue-intake-fallback-smoke-checklist.md`](./github-issue-intake-fallback-smoke-checklist.md) |

## Boundaries

- Use [`README.md`](../README.md) for contributor setup and broad repository orientation.
- Use [`docs/verification-matrix.md`](./verification-matrix.md) to choose PR validation depth.
- Use the release-readiness and release-health docs above for shipping questions instead of inventing a parallel checklist.
