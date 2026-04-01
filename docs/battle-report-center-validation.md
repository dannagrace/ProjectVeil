# Battle Report Center Validation

## Scope

- Supported client slice: `apps/client` H5 account card replay/report center
- Primary client slice: `apps/cocos-client` gameplay HUD entry opens the account-level battle report center
- Data sources exercised:
  - `/api/player-accounts/:playerId/battle-reports`
  - `/api/player-accounts/:playerId/battle-replays`
  - `/api/player-accounts/:playerId`
  - shared `PlayerBattleReportCenter` contract derived from replay + combat event evidence
  - shared replay timeline helpers used by the H5 renderer and Cocos replay center

## Contract Summary

- `PlayerBattleReportCenter.latestReportId`
  - stable entry point for "open latest report" flows
- `PlayerBattleReportCenter.items[]`
  - `id` / `replayId`
  - `result`
  - `battleKind`
  - `playerCamp`
  - `heroId`
  - `opponentHeroId` or `neutralArmyId`
  - `turnCount`
  - `actionCount`
  - `completedAt`
  - `rewards[]`
  - `evidence.replay`
  - `evidence.rewards`

## Repeatable Local Validation

1. Start the local server and H5 client:
   - `npm run dev:server`
   - `npm run dev:client`
2. Optional Cocos parity check:
   - open `apps/cocos-client` in Cocos Creator 3.8.x
   - preview the `VeilRoot` scene
   - in gameplay HUD, use `战报中心` to jump directly into the latest account-level battle report section
3. Open the H5 shell with a clean room and player, for example:
   - `http://127.0.0.1:4173/?roomId=replay-center-validate-20260329&playerId=player-1`
4. Complete at least one battle in that room. The quickest repeatable path is to run the existing automation flow against the same room:
   - `tests/automation/keyboard-battle.actions.json`
5. Refresh or reopen the same room URL after the battle resolves.
6. In H5 and Cocos, verify the battle report center shows:
   - a recent battle report entry
   - result, encounter, turn count, and timestamp
   - reward chips or an explicit missing-evidence state
   - replay availability and rewards evidence availability
   - a selectable replay detail panel with step timeline rows
   - explicit outcome text and casualty summary after opening a report

## Targeted Checks

- Shared contract and report derivation:
  - `node --import tsx --test ./packages/shared/test/shared-core.test.ts`
- Renderer regression:
  - `node --import tsx --test ./apps/client/test/account-history-render.test.ts`
- Cocos report summary / replay-center regression:
  - `node --import tsx --test ./apps/cocos-client/test/cocos-battle-report.test.ts ./apps/cocos-client/test/cocos-battle-replay-center.test.ts`
- Cocos gameplay entry regression:
  - `node --import tsx --test ./apps/cocos-client/test/cocos-root-orchestration.test.ts`

## Notes

- Rewards are still sourced from combat/account evidence rather than replay steps alone, but the summary/evidence contract is now normalized in shared code instead of being reconstructed independently per client.
- `GET /api/player-accounts/:playerId/battle-reports` and `GET /api/player-accounts/me/battle-reports` mirror the replay query parameters and return the shared center payload.
