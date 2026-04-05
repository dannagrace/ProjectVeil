# Cocos Primary Client And H5 Debug Shell Runtime Contract

This note is the maintainer-facing contract between [`apps/cocos-client`](../apps/cocos-client) and [`apps/client`](../apps/client). It exists to answer one operational question quickly: when a feature, regression, or release gate touches a user-facing runtime, which surface owns it?

## Contract In One Screen

| Surface | Role | Shipping expectation |
| --- | --- | --- |
| `apps/cocos-client` | Primary runtime for player-facing gameplay and release candidates | Must own the journeys that define "the game works" for Phase 1 and WeChat release readiness. |
| `apps/client` | Browser H5 debug shell for fast verification, config-center access, and regression feedback | Must stay useful for debugging and automation, but it is not a substitute for primary-runtime sign-off. |

The split is intentional:

- `apps/cocos-client` is where primary gameplay behavior must feel complete enough to ship, demo, or submit.
- `apps/client` is where contributors get the cheapest browser-based loop for troubleshooting, reproducing regressions, and validating shared/runtime semantics.
- Shared gameplay logic, payload shapes, and authoritative state rules still belong in `packages/shared` and `apps/server`; the contract here is only about client-runtime ownership.

## Ownership Boundary

Use these rules when deciding where new work belongs:

### `apps/cocos-client` owns

- Primary player journeys: lobby entry, room join, map exploration, battle entry/command/settlement, reconnect/session recovery, and release-facing account session flows.
- Release-facing runtime presentation and UX needed to prove the canonical journey in Creator preview and WeChat delivery.
- Runtime-specific integrations that only the primary client can satisfy, such as Cocos scene orchestration, WeChat runtime/export assumptions, and release evidence capture for the shipped client.

### `apps/client` owns

- Fast browser debugging for shared/server behavior, room-state inspection, reconnect semantics, and automation hooks.
- Config-center access and browser-first operational tooling that is easier to iterate outside the Cocos runtime.
- Lightweight regression coverage for boot/session fallback, browser rendering semantics, and H5-specific diagnostics.

### Neither client should own alone

- Shared gameplay rules, battle math, world-state reducers, protocol shapes, and authoritative room behavior.
- Any fix that only "works in H5" while leaving the primary Cocos runtime broken.
- Any release checklist that treats H5 success as proof that the shipped client is ready.

## Journey Split

Treat the following journeys as the default routing guide.

| Journey or feature | Primary owner | H5 shell expectation |
| --- | --- | --- |
| Login/lobby to room entry that will ship to players | Cocos primary runtime | Optional fast repro path only. |
| World exploration, object interaction, and battle loop used for release review | Cocos primary runtime | Mirror enough semantics to debug reducers, room events, and browser-visible regressions. |
| Cached-session boot, reconnect interpretation, and room feedback semantics | Shared between both surfaces, with Cocos as the release-proof owner | H5 remains the quick feedback surface for regression triage. |
| Config-center launch and browser-only tools | H5 debug shell | Cocos may link out or hand off, but does not need to absorb browser-only tooling. |
| Diagnostic exports, test hooks, and manual debugging affordances | H5 debug shell first | Add Cocos-specific evidence only when the release path needs it. |
| WeChat packaging, Creator preview, and release-candidate evidence | Cocos primary runtime | Out of scope except for supporting shared semantics and debug parity. |

Practical rule:

- If the feature changes what a release reviewer or external playtester must trust, implement or validate it in `apps/cocos-client`.
- If the feature mainly reduces debugging cost, speeds up regression feedback, or helps inspect shared/runtime state in a browser, keep it in `apps/client`.
- If both surfaces expose the same user-visible meaning, keep the semantic contract shared and let each runtime render it in its own way.

## Testing And Release Gates

The repo's verification and release gates should stay asymmetric on purpose.

### What H5 gates prove

- `apps/client` checks prove browser-shell behavior, debug affordances, and fast regression coverage.
- `npm run typecheck:client:h5`, `npm run test:e2e:smoke`, and related H5 tests are the fast signal for lobby/browser regressions and shared reconnect semantics.
- These checks are sufficient for H5-shell changes, but they do not prove the shipped runtime is healthy.

### What Cocos gates prove

- `npm run typecheck:cocos`, `npm run smoke:cocos:canonical-journey`, `npm run check:wechat-build`, and the Cocos release-evidence flows prove the primary runtime can still carry the main player journey.
- Release-facing readiness, RC evidence, and WeChat packaging gates must point at `apps/cocos-client` outputs, not H5 screenshots or H5-only smoke runs.
- If a change affects the canonical player journey, the merge/release plan should treat Cocos evidence as the decisive signal and H5 evidence as supporting diagnostics.

### Expected gate behavior by change type

| Change type | Minimum expectation |
| --- | --- |
| H5-only debug shell or browser-tooling change | Run the H5 verification path from [`docs/verification-matrix.md`](./verification-matrix.md). |
| Cocos runtime, WeChat delivery, or player-facing main-journey change | Run the Cocos verification path and, when release-facing, the primary-client evidence/delivery audits. |
| Shared/server change that affects both surfaces | Keep the shared/server checks, then choose H5 or Cocos follow-up based on whether the change is debug-surface only or primary-journey/release-facing. |
| Docs or process updates about runtime ownership | Keep this contract, [`README.md`](../README.md), and the verification/release docs aligned. |

## Readiness Rules

Use these rules to avoid boundary drift:

1. Do not block a release solely on H5 polish if the primary Cocos runtime and its release evidence are healthy.
2. Do block release/readiness on missing Cocos canonical-journey evidence, broken WeChat export assumptions, or primary-runtime-only regressions.
3. Do keep H5 healthy enough to reproduce shared/server regressions quickly; broken debug tooling slows triage, but it should not silently redefine the shipping surface.
4. When a contributor adds a new journey, decide explicitly whether it is:
   - primary-runtime mandatory
   - H5 debug-only
   - semantic/shared across both, with Cocos still owning release proof

## Related Docs

- [`README.md`](../README.md)
- [`docs/verification-matrix.md`](./verification-matrix.md)
- [`docs/core-gameplay-release-readiness.md`](./core-gameplay-release-readiness.md)
- [`docs/cocos-primary-client-delivery.md`](./cocos-primary-client-delivery.md)
- [`apps/cocos-client/README.md`](../apps/cocos-client/README.md)
