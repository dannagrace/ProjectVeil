# Repository Verification Matrix

Use this matrix before opening a PR to pick the smallest verification set that still matches the risk of your change. It is intentionally scoped to the repo's current scripts, workflows, and release-readiness surfaces instead of generic "run everything" advice.

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
