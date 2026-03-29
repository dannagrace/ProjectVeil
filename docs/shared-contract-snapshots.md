# Shared Contract Snapshots

Issue `#328` adds file-backed shared contract snapshots for high-value client-facing payloads under `packages/shared/test/fixtures/contract-snapshots/`.

## Covered Payloads

- `SessionStatePayload`
- `PlayerProgressionSnapshot`
- `RuntimeDiagnosticsSnapshot`

The contract test lives in `packages/shared/test/client-payload-contracts.test.ts` and runs through both:

- `npm run test:contracts`
- `npm run test:shared`

## Failure Mode

The suite fails when:

- a checked-in snapshot file is missing or renamed
- a payload shape changes in a way that modifies the serialized JSON contract

Failures print the snapshot path, the first differing line, and the exact refresh command.

## Safe Update Workflow

Only refresh snapshots when the contract change is intentional and reviewed.

```bash
UPDATE_CONTRACT_SNAPSHOTS=1 npm run test:contracts
```

Before committing:

- review the JSON diff in `packages/shared/test/fixtures/contract-snapshots/`
- confirm downstream H5 / Cocos / server consumers still agree on the changed structure
- include the snapshot update in the same PR as the contract change
