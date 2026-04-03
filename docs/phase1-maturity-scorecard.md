# Project Veil Phase 1 Maturity Scorecard

_Repository snapshot assessed on 2026-03-31._

This scorecard summarizes whether Project Veil is still in Phase 1, how mature the current Phase 1 deliverables are, what gaps remain, and what must be true before the project should be treated as ready to move beyond Phase 1.

Phase 1 in this repository still means one bounded loop delivered on top of an authoritative TypeScript stack:

- lobby/login into a room
- world exploration with fog, pathfinding, resources, and building interaction
- encounter-driven turn-based battle
- result settlement back into world state
- Cocos as the primary client runtime, with H5 retained as a debug/regression shell

## Overall Call

`Late Phase 1 / release-hardening`

The repository already contains the core gameplay loop, shared rules, authoritative server flow, reconnect/multiplayer gates, Cocos primary-client runtime, WeChat packaging scripts, and config/persistence foundations. The main remaining work is not "build the Phase 1 loop" but "prove it is repeatable, reviewable, and presentation-ready enough to declare Phase 1 complete."

## Scorecard

| Area | Current maturity | Evidence in repo | Remaining gap | Exit criteria to clear the area |
| --- | --- | --- | --- | --- |
| Phase 1 scope delivery | `Mostly complete` | [`README.md`](../README.md), [`docs/phase1-design.md`](./phase1-design.md) | Scope exists across multiple docs, but there was no single scorecard mapping shipped work to advancement criteria. | This scorecard stays current with repo reality, and scope drift remains bounded to the documented Phase 1 loop rather than Phase 2 expansion. |
| Shared gameplay rules and authoritative server | `Established` | `packages/shared`, `apps/server`, [`docs/core-gameplay-release-readiness.md`](./core-gameplay-release-readiness.md) | Need continued proof that exploration, encounter, settlement, reconnect, and multiplayer sync stay authoritative under release-candidate pressure. | Latest candidate passes `npm test`, `npm run typecheck:ci`, `npm run test:e2e:smoke`, `npm run test:e2e:multiplayer:smoke`, and the release snapshot still records no required automated failures. |
| Primary client runtime | `Mostly complete` | `apps/cocos-client`, [`docs/cocos-primary-client-delivery.md`](./cocos-primary-client-delivery.md), [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md), [`docs/cocos-phase1-presentation-signoff.md`](./cocos-phase1-presentation-signoff.md) | Cocos is the primary client, and the battle loop presentation is now formalized at the copy/state layer, but the repo still carries asset-level placeholder/fallback risk and relies on structured RC evidence to prove the main journey. | A current Cocos RC snapshot exists for the same candidate, the main journey `Lobby -> world -> battle -> settlement -> reconnect` is recorded, and any remaining placeholder/fallback presentation items are either closed or explicitly accepted as non-blocking in the canonical presentation sign-off checklist. |
| H5 debug and regression surface | `Established` | `apps/client`, Playwright smoke coverage, [`docs/reconnect-smoke-gate.md`](./reconnect-smoke-gate.md) | H5 is intentionally no longer the shipping client, so the risk is regression drift between the debug shell and the Cocos runtime. | H5 remains green as a regression surface, and no Phase 1 gate depends on an H5-only behavior that the Cocos runtime cannot reproduce. |
| Persistence and config pipeline | `Mostly complete` | MySQL migrations, config-center flows, [`docs/mysql-persistence.md`](./mysql-persistence.md), content-pack/balance validators | Persistence/config foundations exist, but they still need disciplined release-time verification instead of assuming parity from implementation alone. | The latest candidate includes one successful persistence regression on the intended storage mode plus passing config/content validation for shipped Phase 1 data. |
| Release and operational readiness | `Partial` | [`docs/release-readiness-snapshot.md`](./release-readiness-snapshot.md), [`docs/release-readiness-dashboard.md`](./release-readiness-dashboard.md), [`docs/release-gate-summary.md`](./release-gate-summary.md), [`artifacts/release-readiness/manual-release-evidence-owner-ledger-phase1-rc-abc1234.md`](../artifacts/release-readiness/manual-release-evidence-owner-ledger-phase1-rc-abc1234.md) | The repo has strong gate machinery, but Phase 1 exit still depends on keeping human evidence fresh: runtime review, Cocos RC checklist/blockers, and WeChat smoke/reporting. | For a single candidate revision, automated gates pass, required manual checks are no longer pending, evidence is fresh, the owner ledger points to the exact supporting artifacts, and the candidate can be rebuilt/reviewed without ad hoc interpretation. |

## Major Remaining Gaps

1. `Phase 1 exit evidence is still fragmented across automated and manual artifacts.`
The repository has snapshots, dashboards, RC templates, and smoke commands, but Phase 1 should not be considered complete until one candidate revision has a clean, current, end-to-end evidence set.

2. `Cocos release proof is still more fragile than H5 regression proof.`
The repo clearly positions `apps/cocos-client` as the primary runtime, yet the strongest repeatable automation remains H5-heavy. Phase 1 should exit only after the Cocos journey evidence is routine rather than exceptional.

3. `Presentation-readiness is not the same as gameplay-complete.`
Current docs already note placeholder/fallback asset and presentation risks. That is acceptable during Phase 1 hardening, but not if the team wants to claim the project is beyond Phase 1.

4. `Operational/manual release checks still matter.`
Runtime health review, reconnect evidence, WeChat package validation, and device/quasi-device smoke are not optional paperwork. They are part of proving the shipped Phase 1 loop is actually supportable.

## Explicit Phase 1 Exit Criteria

Project Veil should advance beyond Phase 1 only when all of the following are true for the same release-candidate revision:

1. `Bounded scope remains intact.`
The candidate still represents the documented Phase 1 loop and is not being declared "Phase 2" merely because more systems were added around an unstable core.

2. `Core automated gates are green.`
The candidate passes:
   `npm test`
   `npm run typecheck:ci`
   `npm run test:e2e:smoke`
   `npm run test:e2e:multiplayer:smoke`
   `npm run check:cocos-release-readiness`

3. `Release snapshot status is not blocked by required failures or pending required checks.`
`npm run release:readiness:snapshot` for the candidate shows no `requiredFailed` checks and no `requiredPending` checks.

4. `Cocos primary-client evidence is current.`
A candidate-specific Cocos RC evidence bundle exists under `artifacts/release-readiness/` and demonstrates the complete main journey:
`Lobby/login -> room join -> map exploration -> encounter battle -> settlement -> reconnect/session recovery`.
The canonical generation path is `npm run release:cocos-rc:bundle -- --candidate <candidate-name> ...`, which must emit the candidate+revision bundle manifest, Markdown summary, RC snapshot, checklist, and blocker log for the same revision.

5. `WeChat release evidence is current when WeChat is the target surface.`
The candidate has current package/verify/smoke evidence, and the required report is attached rather than implied from a successful build alone.

6. `Runtime observability is proven in the target environment.`
`/api/runtime/health`, `/api/runtime/auth-readiness`, and `/api/runtime/metrics` are reachable for the candidate environment and reviewed as part of release evidence.

7. `Phase 1 data and persistence are verified on the intended storage path.`
The shipped config/content pack validates cleanly, and `npm run test:phase1-release-persistence` has completed at least one current regression on the intended storage mode. When the candidate is reviewing the `frontier-basin`, `stonewatch-fork`, or `ridgeway-crossing` Phase 1 packs, include `npm run test:phase1-release-persistence:frontier`, `npm run test:phase1-release-persistence:stonewatch`, `npm run test:phase1-release-persistence:ridgeway`, or the equivalent `--map-pack` form in the evidence set as well. For release candidates with `VEIL_MYSQL_*` enabled, that means the generated report should show `Storage: mysql` while still proving player/account/world data flows hold.

8. `Known Phase 1 blockers are closed or explicitly accepted.`
Any remaining Cocos presentation fallback, reconnect risk, multiplayer divergence risk, or release-process blocker is either fixed or recorded as a conscious non-blocking acceptance with owner and rationale.

## Battle Presentation Baseline

For the primary Cocos client battle path, the following now count as `production-intent` presentation behavior rather than fallback:

- battle entry uses encounter-specific transition copy with terrain/context
- battle command, impact, and resolution phases expose explicit labels, badges, and summary lines in the battle panel
- battle settlement no longer falls back to an accidental defeat state when the client is only waiting for world-state sync
- victory / defeat settlement remains the only path that drives the dedicated exit transition overlay

The following are still considered `non-blocking fallback` for Phase 1 hardening and should stay tracked through [`docs/cocos-phase1-presentation-signoff.md`](./cocos-phase1-presentation-signoff.md) plus the surrounding presentation-readiness / RC evidence rather than battle-loop copy logic:

- placeholder pixel art, mixed audio packs, and animation fallback delivery modes
- any remaining asset substitutions already reported by `cocos-presentation-readiness`

## What Advancing Beyond Phase 1 Means Here

Advancing beyond Phase 1 should mean the team has a repeatable, evidence-backed, supportable release candidate for the current core loop. It should not mean:

- promoting unfinished presentation work to "good enough" without explicit acceptance
- shifting validation from Cocos/WeChat back onto the H5 shell
- starting Phase 2 scope because core release evidence is tedious to maintain

Until the exit criteria above are met, the correct label for the repository is still `Phase 1 hardening`, not `post-Phase-1`.
