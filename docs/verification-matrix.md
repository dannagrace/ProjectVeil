# Repository Verification Matrix

Use this matrix before opening a PR to pick the smallest verification set that still matches the risk of your change. It is intentionally scoped to the repo's current scripts, workflows, and release-readiness surfaces instead of generic "run everything" advice.

For deterministic path-to-plan routing, use `npm run plan:validation:minimal -- --branch origin/main`, `npm run plan:validation:minimal -- --pr <number>`, or pass explicit changed paths. The helper mirrors this matrix for major surfaces such as Cocos client, H5 shell, server runtime, release packaging, observability, and content/config. Treat its output as the fast routing layer, then fall back to the matrix when behavior or risk is broader than the touched paths suggest.

## Contributor Quick Reference

Start here when you already know the shape of your change and want the minimum expected verification before opening a PR. Treat `Minimum required` as the floor, use `Optional diagnostics` only when risk broadens or a required check fails, and attach the listed artifacts only when that row says reviewers depend on them.

Quick routing rules:

- `Minimum required` is the smallest expected proof for that change type before opening a PR.
- `Optional diagnostics` stay optional unless the change crosses surfaces, a required check fails, or the PR changes release-facing evidence reviewers need to trust.
- If your diff matches more than one row, combine the `Minimum required` commands from each row and keep the higher-risk artifact expectations.

### Common Issue-Type Minimums

Use this shorter list when the issue is already phrased as a common contribution slice instead of a file-path diff. It is the fastest reviewer-friendly route for the repo slices that show up most often in maintenance and release-hardening work. Each row explicitly answers three questions:

- `Must run`: the floor before opening the PR.
- `Recommended`: run this when the change widens risk, changes reviewer-facing output, or a must-run check fails.
- `Can skip`: what you do not need to run for that slice unless the diff crosses into it.

| Issue or change type | Must run | Recommended | Can skip | Notes |
| --- | --- | --- | --- | --- |
| Docs-only or contributor-guidance updates | Review rendered Markdown plus every edited path and command. Run `npm run validate:quickstart` only if setup, onboarding, or quickstart text changed. | Re-run any edited setup command exactly as documented when practical in your environment. | Typecheck, runtime smoke, release packaging, and Cocos delivery checks if the diff only changes wording, paths, or contributor guidance. | Default path for `README.md`, `docs/**`, templates, and process notes. |
| Ops/readiness docs | Review rendered Markdown plus every edited path, artifact name, and command. Re-run the exact readiness or release command you edited when the doc changes operator steps or expected output, for example `npm run release:gate:summary` or `npm run release:health:summary`. | `npm run typecheck:ci` plus the nearest script test, such as `npm run test:release-gate-summary` or `npm run test:release-health-summary`, when the doc change also updates expected schema, automation assumptions, or script-facing examples. | Cocos runtime, H5 smoke, content validators, and packaging-specific commands when the change stays at procedure/readiness-doc level and does not alter the underlying script or release surface. | Use this for runbooks, release-readiness docs, dashboards, and operator-facing evidence instructions. |
| Runtime contract changes | `npm run typecheck:shared && npm run test:shared && npm run typecheck:server`, plus the nearest touched server `npm test` coverage. | `npm run test:contracts` when payload, snapshot, or cross-runtime shape changed. `npm run validate:quickstart` when local-dev boot, auth readiness, or startup expectations changed. | Cocos/export, release packaging, and content-pack validation unless the same PR also touches those surfaces. | Use this when a gameplay or contract change crosses `packages/shared/**` and `apps/server/**`, or when a runtime contract doc changes the promised server/shared boundary. |
| Content/config changes | `npm run validate:content-pack` for shipped config/content changes. Add `npm run test:phase1-release-persistence` when the edit changes persistence behavior, migration rules, or release-facing storage expectations. | `npm run validate:battle` for balance or skill changes. Escalate to `npm run validate:content-pack:all` or a map-pack-specific persistence run when the diff broadens release-facing data coverage. | Cocos delivery checks, Playwright smoke, and release packaging commands unless the content change also alters those delivery surfaces. | Use this for `configs/**`, config-center-backed content, validators, and persistence-facing release inputs. |
| Cocos client changes | `npm run typecheck:cocos && npm run check:wechat-build` | `npm run audit:cocos-primary-delivery -- --output-dir apps/cocos-client/test/fixtures/wechatgame-export --artifacts-dir artifacts/wechat-release --expect-exported-runtime` when delivery metadata, exported runtime assumptions, or release-facing evidence changed. | H5-only smoke, server-only contract tests, and release-gate aggregation unless the same PR crosses into those areas. | Default path for presentation, runtime, and primary-client delivery work under `apps/cocos-client/**`. |
| Release tooling changes | `npm run typecheck:ci` plus the nearest script-level test for the touched release surface, such as `npm run test:release-gate-summary`, `npm run test:release-health-summary`, or `npm run test:sync-governance-matrix`. | `npm run release:gate:summary` when reviewer-facing release output or artifact fields changed. Add the nearest packaging flow, such as `npm run verify:wechat-release` or `npm run validate:wechat-rc`, when the tooling change touches WeChat release evidence. | H5 smoke, shared-runtime contract tests, and content validators when the diff is isolated to release automation and reviewer-facing summaries. | Covers release-readiness scripts, CI-facing summaries, and release procedure docs that change expected output semantics. |
| WeChat packaging or release-packaging changes | `npm run check:wechat-build` plus the nearest touched packaging command such as `npm run package:wechat-release`, `npm run verify:wechat-release`, or `npm run validate:wechat-rc`. | `npm run smoke:wechat-release` when smoke-report schema or device/runtime evidence handling changed. `npm run release:cocos-rc:bundle` when candidate-level evidence assembly changed. | H5-only smoke and unrelated server/content checks unless the packaging diff also changes those surfaces. | Use this for packaging scripts, release evidence templates, and WeChat release/manual-review flow updates. |

If an issue spans more than one row, combine the `Must run` commands from each relevant type and use the broader recommended checks only where the reviewer-facing risk actually widened.

| Change type | Typical examples | Minimum required | Optional diagnostics | Attach to PR when relevant | Deeper docs |
| --- | --- | --- | --- | --- | --- |
| Docs-only or process-only | `README.md`, `docs/**`, Markdown templates, contributor guidance, contributor workflow notes | Review rendered Markdown plus every edited path and command. Run `npm run validate:quickstart` only if setup or quickstart guidance changed. | Re-run any edited setup command exactly as documented when the wording changed and the command is practical in your environment. | Usually none. If the doc changes release or verification procedure, summarize which command or path you re-checked in the PR body. | [`README.md`](../README.md), [`docs/operational-entry-point-repo-map.md`](./operational-entry-point-repo-map.md) |
| Shared gameplay logic changes | `packages/shared/**`, combat math, progression rules, shared payload helpers | `npm run typecheck:shared && npm run test:shared` | `npm run test:contracts` when payloads, snapshots, or client/server contract shapes changed. Escalate to multiplayer checks if both clients and server consume the new behavior. | Contract snapshot diffs or failing/passing payload notes when shared message shapes changed. | [`docs/shared-contract-snapshots.md`](./shared-contract-snapshots.md), [`docs/core-gameplay-release-readiness.md`](./core-gameplay-release-readiness.md) |
| Server/runtime API changes | `apps/server/**` routes, auth readiness, admin/runtime APIs, room lifecycle behavior | `npm run typecheck:server` plus the nearest targeted `npm test` coverage for the touched route or subsystem | `npm run validate:quickstart` when local-dev boot, auth readiness, or server startup expectations changed. Add multiplayer smoke if the API change affects room/session behavior. | Usually none for narrow API fixes. If response shape, auth readiness, or operational behavior changed, note the exercised test file or endpoint flow in the PR body. | [`docs/verification-matrix.md#change-area-matrix`](./verification-matrix.md#change-area-matrix), [`docs/operational-entry-point-repo-map.md`](./operational-entry-point-repo-map.md) |
| H5 regression-shell changes | `apps/client/**`, lobby flows, Playwright-backed H5 behavior, browser-only debug surfaces | `npm run typecheck:client:h5 && npm run test:e2e:smoke` | `npm run test:e2e:h5:connectivity` when browser-to-server connectivity assumptions changed. | Attach or quote the relevant Playwright result only when the PR changes user-visible browser flow or fixes a flaky regression. | [`README.md`](../README.md), [`docs/operational-entry-point-repo-map.md`](./operational-entry-point-repo-map.md) |
| Cocos primary-client delivery changes | `apps/cocos-client/**`, primary-client runtime, WeChat export templates that affect shipped client output | `npm run typecheck:cocos && npm run check:wechat-build` | `npm run audit:cocos-primary-delivery -- --output-dir apps/cocos-client/test/fixtures/wechatgame-export --artifacts-dir artifacts/wechat-release --expect-exported-runtime` when delivery metadata or exported runtime assumptions changed. | `artifacts/wechat-release/` audit output or the exact generated artifact path when delivery metadata, exported runtime assumptions, or release-facing client evidence changed. | [`docs/cocos-primary-client-delivery.md`](./cocos-primary-client-delivery.md), [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md) |
| Release/readiness tooling changes | `.github/workflows/**`, `scripts/release-*.ts`, readiness summaries, gate artifacts, reviewer-facing schemas | `npm run typecheck:ci` plus the nearest script-level test such as `npm run test:release-gate-summary`, `npm run test:release-health-summary`, `npm run test:ci-trend-summary`, or `npm run test:sync-governance-matrix` | `npm run release:gate:summary` when gate output semantics, release evidence, or reviewer-facing artifact fields changed. | Attach the generated JSON/Markdown path when the PR changes reviewer-facing output, for example `artifacts/release-readiness/release-gate-summary.json`, `artifacts/release-readiness/release-health-summary-<short-sha>.md`, or `.coverage/summary.md`. | [`docs/release-gate-summary.md`](./release-gate-summary.md), [`docs/release-health-summary.md`](./release-health-summary.md), [`docs/release-readiness-snapshot.md`](./release-readiness-snapshot.md) |
| Persistence/config pipeline changes | `scripts/migrate*.ts`, `configs/**`, config-center content, content-pack validators, MySQL persistence flows | `npm run validate:content-pack` for shipped config/content changes, plus `npm run test:phase1-release-persistence` when persistence behavior, migration rules, or release-facing storage expectations changed | `npm run validate:battle` for balance/skill changes. Use `npm run validate:content-pack:all` or a map-pack-specific persistence run when the edit affects release-facing data breadth. | Attach the generated validation or persistence artifact path when release-facing data or storage behavior changed, such as `artifacts/release-readiness/phase1-release-persistence-regression.json` or the validator output path used in review. | [`docs/mysql-persistence.md`](./mysql-persistence.md), [`docs/core-gameplay-release-readiness.md`](./core-gameplay-release-readiness.md), [`docs/release-readiness-snapshot.md`](./release-readiness-snapshot.md) |
| WeChat packaging or release evidence changes | `scripts/prepare-wechat-*.ts`, `scripts/package-wechat-*.ts`, `scripts/verify-wechat-*.ts`, `docs/wechat-*.md`, release evidence templates | `npm run check:wechat-build` plus the nearest changed packaging/evidence command such as `npm run package:wechat-release`, `npm run verify:wechat-release`, or `npm run validate:wechat-rc` against the touched flow | `npm run smoke:wechat-release` when the change affects smoke-report schema or device/runtime evidence handling. `npm run release:cocos-rc:bundle` when the PR changes candidate-level evidence assembly. | Attach the touched evidence artifact path when reviewer-facing release output changed, typically `artifacts/wechat-release/codex.wechat.rc-validation-report.json`, `artifacts/wechat-release/codex.wechat.smoke-report.json`, or the candidate bundle summary under `artifacts/release-readiness/`. | [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md), [`docs/wechat-runtime-observability-signoff.md`](./wechat-runtime-observability-signoff.md), [`docs/cocos-release-evidence-template.md`](./cocos-release-evidence-template.md) |
| Multiplayer or reconnect behavior | Shared sync, reconnect recovery, prediction correction, multiplayer Playwright coverage | `npm run test:e2e:multiplayer:smoke && npm run test:sync-governance:matrix` | `npm run test:e2e:multiplayer` for broader multiplayer regression coverage, or `npm run stress:rooms:reconnect-soak` when reconnect semantics or room recovery rules changed. | Attach the generated sync or reconnect artifact when the PR changes reviewer-visible governance evidence, for example `artifacts/release-readiness/sync-governance-matrix-<short-sha>.json`. | [`docs/sync-governance-matrix.md`](./sync-governance-matrix.md), [`docs/reconnect-smoke-gate.md`](./reconnect-smoke-gate.md), [`docs/reconnect-soak-gate.md`](./reconnect-soak-gate.md) |

If a change fits more than one row, combine the minimum required commands from each matching row and prefer the higher-risk path when they conflict.

### Example Flows

Use these when you want a concrete `changed X -> run Y` translation before opening the PR.

#### Cocos-facing change example

Change:

- You updated `apps/cocos-client/assets/scripts/VeilHudPanel.ts` and a WeChat export template to adjust the primary client HUD presentation.

Required:

- `npm run typecheck:cocos`
- `npm run check:wechat-build`

Optional only when needed:

- `npm run audit:cocos-primary-delivery -- --output-dir apps/cocos-client/test/fixtures/wechatgame-export --artifacts-dir artifacts/wechat-release --expect-exported-runtime`
  Run this when the change affects delivery metadata, exported runtime assumptions, or reviewer-facing release evidence instead of local presentation only.

What to mention in the PR:

- For a runtime/presentation-only change, note that `typecheck:cocos` and `check:wechat-build` passed.
- If the change altered exported runtime or delivery evidence, attach the resulting `artifacts/wechat-release/` path called out by the audit command.

#### Ops/readiness change example

Change:

- You updated `scripts/release-gate-summary.ts` and the matching readiness doc so the reviewer-facing gate summary shows a new field.

Required:

- `npm run typecheck:ci`
- The nearest script test for the touched readiness surface, for example `npm run test:release-gate-summary`

Optional only when needed:

- `npm run release:gate:summary`
  Run this when output semantics, generated fields, or reviewer-facing readiness evidence changed and reviewers need to inspect the refreshed artifact.

What to mention in the PR:

- Name the script-level test you ran.
- If the generated gate output changed, attach the refreshed artifact path such as `artifacts/release-readiness/release-gate-summary.json`.

## Changed Surface Helper

Use the helper when you want the repo to translate touched paths into a concise required-versus-optional validation plan:

```bash
npm run plan:validation:minimal -- --branch origin/main
```

```bash
npm run plan:validation:minimal -- --pr 708
```

```bash
npm run plan:validation:minimal -- \
  --path apps/cocos-client/assets/scripts/VeilRoot.ts \
  --path scripts/package-wechat-minigame-release.ts
```

Maintainer and contributor flow:

1. Before opening a PR, run `npm run plan:validation:minimal -- --branch origin/main` from your topic branch. The helper uses the same three-dot diff GitHub review uses, so the path set comes from the merge-base against `origin/main`.
2. Paste the Markdown output into your PR description or working notes, then run the `Required checks` list.
3. If you are reviewing an open PR, run `npm run plan:validation:minimal -- --pr <number>` to regenerate the same style of plan directly from the PR diff.
4. Use `Optional diagnostics` only when the changed surface rationale matches the broader risk, a required check fails, or reviewers need extra release evidence.

What it does:

- maps changed paths to the maintained repo surfaces in this matrix
- emits deduped Markdown `Required checks` plus `Optional diagnostics`
- includes short rationale per changed surface so reviewers can see why each command is in the plan
- points only at existing `npm run ...` commands or existing manual checks already described here

What it does not do:

- it does not replace subsystem judgement when behavior crosses surfaces more broadly than the path list implies
- it does not pick the exact server `node:test` file for you; use the nearest touched suite
- it does not waive release-facing evidence refresh just because a local smoke or typecheck passed

Override the helper and use the higher-risk matrix row when:

- one change affects more than one runtime surface
- a documented command or CI entry point changed
- reviewers depend on a stable artifact or same-revision release evidence set
- the PR comes from a fork and `gh pr diff <number> --name-only` is unavailable in your environment

## Verification Tiers

| Tier | Use when | Default expectation |
| --- | --- | --- |
| `lightweight` | Docs-only changes, comment/refactor-only edits, or tightly scoped code changes with no user-facing flow impact | Run the nearest targeted check plus one fast repository-level sanity check when applicable. |
| `medium` | Changes to one runtime area, one shared contract surface, or one release/build script that can affect adjacent paths | Run the targeted checks for that area plus the closest smoke or typecheck command that matches CI. |
| `high` | Cross-package behavior changes, release/build pipeline changes, sync or reconnect behavior, or anything likely to affect shipping artifacts | Run the targeted checks, the matching smoke/regression commands, and the CI-equivalent command set for that area. |

If a row below seems to fit more than one area, use the higher tier.

## Change-Area Matrix

| Change area | Representative paths | Tier | Recommended verification |
| --- | --- | --- | --- |
| Docs, Markdown templates, contributor guidance | `README.md`, `docs/**` | `lightweight` | Review rendered Markdown, verify referenced paths/commands still exist, run `npm run validate:quickstart` only if the change modifies quickstart or setup guidance. |
| Shared pure logic or data contracts | `packages/shared/**`, `packages/shared/test/fixtures/contract-snapshots/**` | `medium` | `npm run test:shared`; `npm run test:contracts` when payloads or snapshots move; `npm run typecheck:shared`. Escalate to `high` if the change alters multiplayer payloads consumed by both clients and server. |
| Server-only room, auth, persistence, or runtime APIs | `apps/server/**`, `scripts/migrate*.ts`, `docs/mysql-persistence.md` | `medium` | `npm run typecheck:server`; run the nearest targeted `node:test` coverage through `npm test` or `npm run test:coverage:ci` if the change spans multiple server subsystems; run `npm run validate:quickstart` for local dev boot regressions. |
| H5 debug shell, lobby, or browser automation support | `apps/client/**`, `playwright*.ts`, `tests/e2e/**` | `medium` | `npm run typecheck:client:h5`; `npm run test:e2e:smoke` for lobby/H5 flow changes; `npm run test:e2e:h5:connectivity` when the edit touches browser-to-server connectivity assumptions. |
| Cocos primary client runtime or WeChat export templates | `apps/cocos-client/**`, `apps/cocos-client/build-templates/wechatgame/**`, `scripts/prepare-wechat-*.ts` | `high` | `npm run typecheck:cocos`; `npm run check:wechat-build`; `npm run audit:cocos-primary-delivery -- --output-dir apps/cocos-client/test/fixtures/wechatgame-export --artifacts-dir artifacts/wechat-release --expect-exported-runtime` when delivery metadata or exported runtime assumptions change. |
| Multiplayer sync, reconnect, prediction correction | `apps/server/**`, `apps/client/**`, `packages/shared/**`, Playwright multiplayer specs | `high` | `npm run test:e2e:multiplayer:smoke`; `npm run test:sync-governance:matrix`; add `npm run test:e2e:multiplayer` for broader multiplayer regressions; use `npm run stress:rooms:reconnect-soak` when reconnect semantics or room recovery rules change. |
| Runtime performance, room concurrency, regression baselines | `scripts/stress-concurrent-rooms.ts`, `scripts/compare-runtime-regression.ts`, `configs/runtime-regression-baseline.json`, `docs/runtime-regression-baseline.md` | `high` | `npm run stress:rooms:baseline`; `npm run perf:runtime:compare`; if the stress harness itself changed, also run `npm run test:runtime-regression`. |
| Content packs, gameplay balance, or config-center-backed release inputs | `configs/**`, `scripts/validate-content-pack.ts`, `scripts/validate-battle-balance.ts`, `configs/.config-center-library.json` | `medium` | `npm run validate:content-pack`; `npm run validate:battle` when balance or skill/unit data changes; escalate to `high` and add `npm run release:gate:summary` if the config change is release-facing. |
| Release-readiness, CI summaries, or gate aggregation scripts | `.github/workflows/**`, `scripts/release-*.ts`, `scripts/publish-ci-trend-summary.ts`, `scripts/ci-v8-coverage.ts`, `docs/release-*.md`, `docs/ci-trend-summary.md` | `high` | `npm run typecheck:ci`; run the most relevant script-level tests such as `npm run test:release-gate-summary`, `npm run test:release-health-summary`, `npm run test:ci-trend-summary`, or `npm run test:sync-governance-matrix`; add `npm run release:gate:summary` when gate output semantics change. |
| Repo-wide dependency, tsconfig, or shared tooling changes | `package.json`, `package-lock.json`, `tsconfig*.json`, `playwright*.config.ts` | `high` | `npm run typecheck:ci`; `npm run test:coverage:ci`; add the smallest matching smoke command (`npm run test:e2e:smoke`, `npm run test:e2e:multiplayer:smoke`, or `npm run check:wechat-build`) for the runtime surface the tooling change touches. |

## Practical Selection Rules

1. Start with the row that matches the files you changed, not the component you intended to change.
2. If the change touches more than one runtime surface, combine the targeted commands from each row.
3. If you modified `.github/workflows/ci.yml` or a script called directly by CI, prefer the CI-equivalent command over a narrower local shortcut.
4. If you changed documented commands, rerun the command you edited in the docs unless it is clearly out of scope for your environment; if you cannot run it, call that out in the PR.
5. If a command produces an artifact that reviewers rely on, keep the artifact path stable when possible. Current examples include:
   - `artifacts/release-readiness/sync-governance-matrix-<short-sha>.json`
   - `.coverage/summary.md`
   - `artifacts/release-readiness/runtime-regression-report.json`

## Smallest Sufficient Sets

Use these as defaults when you are unsure:

- Docs-only PR: verify links/paths in the edited Markdown. If setup text changed, also run `npm run validate:quickstart`.
- Shared contract PR: `npm run typecheck:shared && npm run test:shared && npm run test:contracts`
- Server gameplay/auth PR: `npm run typecheck:server && npm run validate:quickstart`
- H5 lobby/flow PR: `npm run typecheck:client:h5 && npm run test:e2e:smoke`
- Multiplayer/reconnect PR: `npm run test:e2e:multiplayer:smoke && npm run test:sync-governance:matrix`
- WeChat/Cocos delivery PR: `npm run typecheck:cocos && npm run check:wechat-build`
- CI/release gate PR: `npm run typecheck:ci` plus the nearest script test and any changed gate command

When in doubt, choose the next higher tier rather than inventing a new local checklist.
