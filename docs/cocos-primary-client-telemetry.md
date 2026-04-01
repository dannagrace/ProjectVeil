# Cocos Primary-Client Telemetry

Issue #514 adds a bounded primary-client telemetry stream to the existing runtime diagnostics snapshot. The goal is not backend analytics yet; it is a stable, inspectable contract for verifying the core client loop in tests and release evidence.

## Schema

Runtime diagnostics now expose `diagnostics.primaryClientTelemetry`, a short rolling array of structured checkpoints:

- `at`: ISO timestamp captured on the client
- `category`: `progression`, `inventory`, or `combat`
- `checkpoint`: stable checkpoint id such as `review.loaded`, `hero.progressed`, `loot.overflowed`, `encounter.started`
- `status`: `info`, `success`, `failure`, or `blocked`
- `detail`: human-readable summary for logs and evidence bundles
- Context fields when available: `roomId`, `playerId`, `heroId`, `battleId`, `battleKind`, `result`, `reason`, `slot`, `equipmentId`, `equipmentName`, `itemCount`, `level`, `experienceGained`, `levelsGained`, `skillPointsAwarded`

## Current coverage

- Progression checkpoints
  - progression review load success/failure
  - hero progression events emitted from authoritative session updates
- Inventory checkpoints
  - equip/unequip rejection reasons from client-side guardrails and failed requests
  - loot pickup vs. inventory overflow after combat
  - committed equipment changes from authoritative session updates
- Combat checkpoints
  - encounter start and resolution
  - battle command submission and command failure

## Validation

- `packages/shared/test/runtime-diagnostics.test.ts` keeps the shared text rendering stable.
- `packages/shared/test/client-payload-contracts.test.ts` snapshots the diagnostics payload contract.
- `apps/cocos-client/test/cocos-root-orchestration.test.ts` verifies `VeilRoot` emits progression, inventory, and combat checkpoints from real client orchestration paths.
