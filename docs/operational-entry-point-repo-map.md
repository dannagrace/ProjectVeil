# Operational Entry-Point Repo Map

Use this as the maintainer-facing map for the repository's existing operational surfaces. It does not redefine workflows; it points to the current commands and docs that already own each function.

For detailed release sequencing, keep [`docs/same-revision-release-evidence-runbook.md`](./same-revision-release-evidence-runbook.md) as the assembly runbook. This page is the faster routing layer for answering "which command, doc, or artifact family should I open first for this operational task?"

## Daily Routing

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Local contributor sanity check | `npm run validate:quickstart` | [`README.md`](../README.md), [`docs/verification-matrix.md`](./verification-matrix.md) |
| Respond to a live production incident | Start with the 5-minute triage in [`docs/incident-response-runbook.md`](./incident-response-runbook.md) | [`docs/incident-response-runbook.md`](./incident-response-runbook.md), [`docs/alerting-rules.yml`](./alerting-rules.yml) |
| Pick the smallest sufficient PR verification | [`docs/verification-matrix.md`](./verification-matrix.md) | [`docs/verification-matrix.md`](./verification-matrix.md) |
| Turn changed paths into a minimal validation plan | `npm run plan:validation:minimal -- --branch origin/main` | [`docs/verification-matrix.md`](./verification-matrix.md) |
| Confirm the current primary client surface | `npm run client:primary` | [`README.md`](../README.md), [`docs/cocos-primary-client-delivery.md`](./cocos-primary-client-delivery.md) |
| Confirm the runtime boundary between the primary client and the H5 shell | [`docs/runtime-contract-cocos-h5.md`](./runtime-contract-cocos-h5.md) | [`docs/runtime-contract-cocos-h5.md`](./runtime-contract-cocos-h5.md), [`README.md`](../README.md) |
| Audit Codex automation branches | `npm run ops:codex-branches` | [`docs/codex-automation-branch-maintenance.md`](./codex-automation-branch-maintenance.md) |
| Detect long-running Codex/Claude validation jobs | `npm run ops:run-watchdog -- list` | [`docs/codex-run-watchdog.md`](./codex-run-watchdog.md) |

## Common Artifact Homes

| Artifact family | Usually lands in | Typical producers |
| --- | --- | --- |
| Release readiness, dashboards, gate summaries, reconnect soak, persistence, Cocos RC bundles | `artifacts/release-readiness/` | `npm run release:readiness:snapshot`, `npm run release:readiness:dashboard`, `npm run release:gate:summary`, `npm run release:reconnect-soak`, `npm run release:cocos-rc:bundle`, `npm run test:phase1-release-persistence` |
| WeChat package, smoke, RC validation, runtime observability sign-off | `artifacts/wechat-release/` | `npm run package:wechat-release`, `npm run smoke:wechat-release`, `npm run validate:wechat-rc` |
| Downloaded or rollback WeChat candidate bundles | `artifacts/downloaded/`, `artifacts/rollback/` | `npm run download:wechat-release` |
| Candidate-specific manual evidence ledger when kept on disk instead of in the PR | `artifacts/release-readiness/` | Copy [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md) |

## Release Readiness And Health

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Generate one candidate readiness snapshot | `npm run release:readiness:snapshot` | [`docs/release-readiness-snapshot.md`](./release-readiness-snapshot.md) |
| Confirm which gate script or artifact is authoritative for a release question | [`docs/release-ops-ownership-matrix.md`](./release-ops-ownership-matrix.md) | [`docs/release-ops-ownership-matrix.md`](./release-ops-ownership-matrix.md), [`docs/release-script-inventory.md`](./release-script-inventory.md) |
| Generate the branch-level readiness dashboard | `npm run release:readiness:dashboard` | [`docs/release-readiness-dashboard.md`](./release-readiness-dashboard.md) |
| Aggregate release gates for one candidate | `npm run release:gate:summary` | [`docs/release-gate-summary.md`](./release-gate-summary.md) |
| Aggregate top-level release health and triage | `npm run release:health:summary` | [`docs/release-health-summary.md`](./release-health-summary.md), [`docs/release-readiness-trend-troubleshooting.md`](./release-readiness-trend-troubleshooting.md) |
| Assemble same-revision release evidence | [`docs/same-revision-release-evidence-runbook.md`](./same-revision-release-evidence-runbook.md) | [`docs/same-revision-release-evidence-runbook.md`](./same-revision-release-evidence-runbook.md) |
| Track manual release evidence ownership for one candidate | Copy [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md) into `artifacts/release-readiness/` or the release PR | [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md), [`docs/same-revision-release-evidence-runbook.md`](./same-revision-release-evidence-runbook.md) |
| Index the latest and previous release-readiness packets for one candidate | Copy [`docs/release-evidence/release-readiness-artifact-index.template.md`](./release-evidence/release-readiness-artifact-index.template.md) into `artifacts/release-readiness/` | [`docs/release-evidence/release-readiness-artifact-index.template.md`](./release-evidence/release-readiness-artifact-index.template.md), [`docs/same-revision-release-evidence-runbook.md`](./same-revision-release-evidence-runbook.md) |
| Review the Phase 1 candidate dossier or rehearsal flow | `npm run release:phase1:candidate-dossier` / `npm run release:phase1:candidate-rehearsal` | [`docs/phase1-candidate-dossier.md`](./phase1-candidate-dossier.md), [`docs/phase1-candidate-rehearsal.md`](./phase1-candidate-rehearsal.md) |
| Open the short reviewer checklist for remaining Phase 1 hardening gaps | [`docs/phase1-hardening-reviewer-checklist.md`](./phase1-hardening-reviewer-checklist.md) | [`docs/phase1-hardening-reviewer-checklist.md`](./phase1-hardening-reviewer-checklist.md), [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md) |

## Cocos And WeChat Delivery

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Validate the export/build surface used by CI | `npm run check:wechat-build` | [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md) |
| Review the bounded Cocos equipment bag and loot loop runtime entry points | `apps/cocos-client/assets/scripts/VeilRoot.ts`, `apps/cocos-client/assets/scripts/VeilEquipmentPanel.ts`, `apps/cocos-client/assets/scripts/cocos-hero-equipment.ts` | [`docs/cocos-equipment-loot-validation.md`](./cocos-equipment-loot-validation.md), [`docs/cocos-primary-client-delivery.md`](./cocos-primary-client-delivery.md) |
| Prepare, package, upload, download, or verify a WeChat release artifact | `npm run prepare:wechat-release`, `npm run package:wechat-release`, `npm run upload:wechat-release`, `npm run download:wechat-release`, `npm run verify:wechat-release` | [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md) |
| Validate or smoke-check WeChat release evidence | `npm run validate:wechat-rc`, `npm run smoke:wechat-release` | [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md), [`docs/wechat-runtime-observability-signoff.md`](./wechat-runtime-observability-signoff.md). Generated artifacts usually land in `artifacts/wechat-release/` as `codex.wechat.release-candidate-summary.json`, `codex.wechat.rc-validation-report.json`, `codex.wechat.smoke-report.json`, and runtime sign-off notes. |
| Build the Cocos release-candidate evidence packet | `npm run release:cocos-rc:snapshot`, `npm run release:cocos-rc:bundle` | [`docs/cocos-release-evidence-template.md`](./cocos-release-evidence-template.md), [`docs/cocos-primary-client-delivery.md`](./cocos-primary-client-delivery.md) |
| Review primary-client runtime evidence and diagnostics | `npm run release:cocos:primary-journey-evidence`, `npm run release:cocos:primary-diagnostics`, `npm run audit:cocos-primary-delivery` | [`docs/cocos-primary-client-delivery.md`](./cocos-primary-client-delivery.md), [`docs/cocos-primary-client-telemetry.md`](./cocos-primary-client-telemetry.md) |
| Review Cocos Phase 1 presentation placeholders before widening a candidate | `npm run release:cocos-rc:bundle -- --candidate <candidate-name> --build-surface <surface>` | [`docs/cocos-phase1-presentation-signoff.md`](./cocos-phase1-presentation-signoff.md), [`docs/cocos-release-evidence-template.md`](./cocos-release-evidence-template.md). The generated sign-off artifacts land in `artifacts/release-readiness/` as `cocos-presentation-signoff-<candidate>-<short-sha>.json` and `.md`. |

## Runtime, Multiplayer, And Persistence Operations

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Probe live runtime health and auth readiness for a candidate environment | `GET /api/runtime/health`, `GET /api/runtime/auth-readiness`, `GET /api/runtime/metrics` | [`docs/wechat-runtime-observability-signoff.md`](./wechat-runtime-observability-signoff.md), [`docs/release-readiness-dashboard.md`](./release-readiness-dashboard.md). Reviewer notes usually land in `artifacts/wechat-release/` or `artifacts/release-readiness/`. |
| Route a production incident by severity, owner, and rollback decision | [`docs/incident-response-runbook.md`](./incident-response-runbook.md) | [`docs/incident-response-runbook.md`](./incident-response-runbook.md), [`docs/alerting-runbook.md`](./alerting-runbook.md), [`docs/wechat-pay-ops-runbook.md`](./wechat-pay-ops-runbook.md) |
| Run reconnect or multiplayer governance checks | `npm run test:e2e:multiplayer:smoke`, `npm run test:sync-governance:matrix`, `npm run stress:rooms:reconnect-soak` | [`docs/sync-governance-matrix.md`](./sync-governance-matrix.md), [`docs/reconnect-smoke-gate.md`](./reconnect-smoke-gate.md), [`docs/reconnect-soak-gate.md`](./reconnect-soak-gate.md) |
| Run room stress or runtime regression comparisons | `npm run stress:rooms:baseline`, `npm run perf:runtime:compare` | [`docs/runtime-regression-baseline.md`](./runtime-regression-baseline.md). Generated runtime metrics and comparison reports usually land in `artifacts/release-readiness/`. |
| Review or validate MySQL persistence expectations | `npm run db:migrate`, `npm run db:migrate:rollback`, `npm run test:phase1-release-persistence` | [`docs/mysql-persistence.md`](./mysql-persistence.md). The release-facing regression artifact usually lands in `artifacts/release-readiness/phase1-release-persistence-regression-*.json`. |
| Inspect release-facing multiplayer load evidence | `npm run stress:rooms:baseline`, `npm run release:reconnect-soak` | [`docs/multiplayer-loadtest-gate.md`](./multiplayer-loadtest-gate.md), [`docs/reconnect-soak-gate.md`](./reconnect-soak-gate.md). Generated summaries usually land in `artifacts/release-readiness/`. |

## Content, Contracts, And Config Inputs

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Validate shipped content packs | `npm run validate:content-pack`, `npm run validate:content-pack:all` | [`docs/content-pack-validation.md`](./content-pack-validation.md), [`docs/core-gameplay-release-readiness.md`](./core-gameplay-release-readiness.md). Use this when config-pack or map-pack changes need release-facing validation before they are bundled into persistence or candidate evidence. |
| Validate battle balance assumptions | `npm run validate:battle` | [`docs/core-gameplay-release-readiness.md`](./core-gameplay-release-readiness.md) |
| Review shared client/server contract coverage | `npm run test:contracts`, `npm run test:shared` | [`docs/shared-contract-snapshots.md`](./shared-contract-snapshots.md), [`docs/test-coverage-audit-issue-199.md`](./test-coverage-audit-issue-199.md) |

## Planning And Maturity Context

| Need | Primary command or entry point | Canonical docs |
| --- | --- | --- |
| Check current repository maturity and next ops slices | [`docs/repo-maturity-baseline.md`](./repo-maturity-baseline.md) | [`docs/repo-maturity-baseline.md`](./repo-maturity-baseline.md) |
| Open an ops/readiness follow-up issue with the expected evidence fields | [`.github/ISSUE_TEMPLATE/projectveil-ops-readiness.md`](../.github/ISSUE_TEMPLATE/projectveil-ops-readiness.md) | [`.github/ISSUE_TEMPLATE/projectveil-ops-readiness.md`](../.github/ISSUE_TEMPLATE/projectveil-ops-readiness.md), [`docs/repo-maturity-baseline.md`](./repo-maturity-baseline.md) |
| Check Phase 1 exit posture and remaining release gaps | [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md) | [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md) |
| Fall back when GitHub issue intake automation is unavailable | [`docs/github-issue-intake-fallback.md`](./github-issue-intake-fallback.md) | [`docs/github-issue-intake-fallback.md`](./github-issue-intake-fallback.md), [`docs/github-issue-intake-fallback-smoke-checklist.md`](./github-issue-intake-fallback-smoke-checklist.md) |

## Boundaries

- Use [`README.md`](../README.md) for contributor setup and broad repository orientation.
- Use [`docs/verification-matrix.md`](./verification-matrix.md) to choose PR validation depth.
- Use the release-readiness and release-health docs above for shipping questions instead of inventing a parallel checklist.
