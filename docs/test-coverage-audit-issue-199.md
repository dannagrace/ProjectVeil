# Issue #199 Test Coverage Audit

Issue [#199](https://github.com/dannagrace/ProjectVeil/issues/199) asks for a repo-level audit of automated coverage across the server, H5 debug shell, and Cocos client. This document records the current test surface, the highest-payoff gaps, and the tooling limits that make those gaps harder to close.

## Audit Baseline

- Shared core currently has `7` Node test files.
- Server currently has `23` Node test files under `apps/server/test`.
- H5 debug shell currently has `10` Node test files under `apps/client/test`.
- Cocos client currently has `41` Node test files under `apps/cocos-client/test`.
- Browser regression currently has `11` Playwright specs under `tests/e2e`.

### Important tooling note

Before this audit, the root `npm test` script only executed `57` of the `62` checked-in Node test files. The missing suites were:

- `apps/server/test/account-token-delivery.test.ts`
- `apps/server/test/player-account-battle-replay-detail-routes.test.ts`
- `apps/server/test/player-account-battle-replay-playback-routes.test.ts`
- `apps/cocos-client/test/cocos-battle-replay-timeline.test.ts`
- `apps/cocos-client/test/cocos-hero-progression.test.ts`

This PR updates `package.json` so `npm test` now exercises all checked-in Node test files.

## Current Coverage Shape

### Server

Strongest coverage today sits around room simulation, persistence retention, player-account routes, lobby/matchmaking routes, and observability endpoints. The tested areas are mostly reducer-heavy and HTTP-heavy code paths where the repo already has stable seams for `node:test`.

Recent coverage improvements closed two previously high-risk entrypoint gaps:

- `apps/server/test/dev-server.test.ts` now directly covers the `apps/server/src/dev-server.ts` bootstrap seam, including route registration, in-memory startup, MySQL startup, migration-warning fallback, and retention cleanup scheduling.
- `apps/server/test/schema-migrations.test.ts` now directly covers `apps/server/src/schema-migrations.ts` migration discovery, invalid module exports, pending migration detection, missing database/table status, and metadata drift warning output.

Highest-risk gaps with weaker direct coverage now center on:

1. `apps/server/src/colyseus-room.ts`
   Room lifecycle integration is only covered indirectly through persistence and route tests. Reconnect, disposal, and multi-room registration behavior remain comparatively exposed.
2. `apps/server/src/index.ts` and `apps/server/src/battle-replays.ts`
   Core room orchestration is covered by `authoritative-room.test.ts`, but replay capture lifecycle and battle replay emission are still not locked down module-by-module. That matters because replay routes already exist and were previously omitted from the default root test run.
3. `apps/server/src/player-accounts.ts`
   This file has route coverage, but the module remains large and risk is concentrated in cross-cutting account flows: fallback behavior without MySQL, account session revocation, replay/history pagination, and credential/WeChat interactions.

### H5 Debug Shell (`apps/client`)

The H5 shell has a good mix of storage-focused unit tests and Playwright flows for room entry, movement, battle, reconnect, keyboard input, and multiplayer sync. That gives reasonable confidence on core happy paths.

Highest-risk gaps with weak or missing direct coverage:

1. `apps/client/src/main.ts`
   The main browser entry point is the biggest untested seam on the web side. It owns boot selection, state orchestration, automation hooks, account flows, timeline updates, modal handling, and battle/world transitions. Most of that is only exercised indirectly through a narrow set of Playwright scenarios.
2. `apps/client/src/local-session.ts`
   Session bootstrapping, remote/local fallback, and push-update handling do not have focused unit coverage. Failures here can strand the H5 shell before any gameplay spec starts.
3. `apps/client/src/config-center.ts`
   The config-center editor has effectively no automated coverage despite being one of the higher-risk operator-facing tools in the repo. Save, diff, validation, snapshot, and preview flows remain largely manual.
4. `apps/client/src/renderers.ts`, `apps/client/src/object-visuals.ts`, and `apps/client/src/assets.ts`
   Rendering and visual mapping layers have no direct tests. They are lower risk than session/auth flows, but they are susceptible to silent UI regressions when config keys or asset manifests drift.

### Cocos Client

The Cocos client has broad helper-level unit coverage around formatters, presentation config, readiness summaries, lobby/auth helpers, runtime platform detection, WeChat build helpers, and several battle/HUD helper modules. That is the widest unit surface in the repo.

The largest remaining gap is that most actual scene/controller entry points are still untested:

1. `apps/cocos-client/assets/scripts/VeilRoot.ts`
   This is the main runtime orchestrator and currently the single highest-value missing test target in the entire client stack. It coordinates launch identity, lobby boot, session lifecycle, prediction, reconnect, HUD wiring, memory warnings, and WeChat share sync.
2. `apps/cocos-client/assets/scripts/VeilCocosSession.ts`
   Networking, typed-array tile decode, local snapshot replay, and connection event handling are critical but not directly covered.
3. `apps/cocos-client/assets/scripts/VeilMapBoard.ts`, `VeilBattlePanel.ts`, `VeilLobbyPanel.ts`, `VeilHudPanel.ts`, and `VeilTimelinePanel.ts`
   These components carry most of the primary-runtime interaction surface, yet current tests focus on pure helper modules rather than component behavior.
4. `apps/cocos-client/assets/scripts/VeilTilemapRenderer.ts`, `VeilFogOverlay.ts`, and `VeilUnitAnimator.ts`
   Rendering fallbacks and asset-state transitions are still largely unverified outside static helper tests.
5. `apps/cocos-client/assets/scripts/VeilBattleTransition.ts`, `cocos-audio-resources.ts`, `cocos-pixel-sprites.ts`, and `cocos-prediction.ts`
   Runtime transition/audio/loading seams have support tests around adjacent helpers, but not around the modules that actually bind those helpers into the live client.

## Recommended Follow-Up Tests

### Priority 1: Highest payoff

- Add a thin H5 boot regression suite around `apps/client/src/main.ts` for cached-session boot, local fallback boot, and automation-hook registration.
- Add a Cocos harness around `VeilRoot.ts` plus `VeilCocosSession.ts` to lock reconnect, lobby boot, and session handoff behavior.

### Priority 2: Strong payoff, moderate effort

- Add direct tests for `apps/client/src/local-session.ts` and `apps/client/src/config-center.ts`.
- Add room-lifecycle integration tests for `apps/server/src/colyseus-room.ts`.
- Add component-focused tests for `VeilMapBoard.ts`, `VeilBattlePanel.ts`, and `VeilLobbyPanel.ts`.
- Add targeted coverage for replay-capture lifecycle around `apps/server/src/battle-replays.ts`.

### Priority 3: Useful once the above lands

- Add snapshot-style tests for `apps/client/src/renderers.ts`, `apps/client/src/object-visuals.ts`, and `apps/client/src/assets.ts`.
- Add rendering fallback tests for `VeilTilemapRenderer.ts`, `VeilFogOverlay.ts`, `VeilUnitAnimator.ts`, and `VeilBattleTransition.ts`.
- Add validation around `cocos-audio-resources.ts`, `cocos-pixel-sprites.ts`, and `cocos-prediction.ts`.

## Tooling Limitations

The current tooling makes coverage expansion slower than it needs to be:

1. The root `npm test` script is a manually maintained file list instead of a discovery-based pattern. This already caused five checked-in suites to be skipped until this audit.
2. The repo now publishes scoped Node/V8 coverage through `npm run test:coverage:ci`, including `.coverage/summary.md`, raw V8 JSON artifacts, and minimum line/branch/function floors for `shared`, `server`, `client`, and `cocos-client`. The summary now calls out threshold failures explicitly so CI logs and `GITHUB_STEP_SUMMARY` show which scope and metric fell below its floor.
3. H5 Playwright coverage is useful, but it only validates the DOM debug shell; it does not exercise the Cocos runtime that now serves as the primary client.
4. Cocos scene components depend on `cc` runtime behavior, which makes them harder to test in plain `node:test` without maintaining more test doubles or extracting more pure logic seams.
5. WeChat readiness still depends on artifact validation and manual smoke-report workflows rather than automated device/runtime execution.

## Suggested Next Slice

If the goal is maximum stabilization value per PR, the next coverage-focused issue should target:

1. `apps/client/src/main.ts`
2. `apps/cocos-client/assets/scripts/VeilRoot.ts`
3. `apps/server/src/colyseus-room.ts`
4. `apps/server/src/index.ts`

Those four seams cover the startup and orchestration paths most likely to produce high-severity regressions that the current suite would miss.
