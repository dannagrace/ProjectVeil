# Battle Report Center Validation

## Scope

- Supported client slice: `apps/client` H5 account card replay/report center
- Data sources exercised:
  - `/api/player-accounts/:playerId/battle-replays`
  - `/api/player-accounts/:playerId`
  - shared replay timeline helpers used by the H5 renderer

## Repeatable Local Validation

1. Start the local server and H5 client:
   - `npm run dev:server`
   - `npm run dev:client`
2. Open the H5 shell with a clean room and player, for example:
   - `http://127.0.0.1:4173/?roomId=replay-center-validate-20260329&playerId=player-1`
3. Complete at least one battle in that room. The quickest repeatable path is to run the existing automation flow against the same room:
   - `tests/automation/keyboard-battle.actions.json`
4. Refresh or reopen the same room URL after the battle resolves.
5. In the account card, verify the replay/report center shows:
   - a recent battle report entry
   - a selectable replay detail panel with step timeline rows
   - explicit outcome text
   - casualty summary
   - reward chips or a clear "no extra rewards recorded" message sourced from recent combat events

## Targeted Checks

- Renderer regression:
  - `node --import tsx --test ./apps/client/test/account-history-render.test.ts`
- Client data loading regression:
  - `node --import tsx --test ./apps/client/test/player-account-storage.test.ts`

## Notes

- The replay read model does not currently store rewards directly. The H5 report summary combines replay timeline data with recent combat event log entries to expose reward outcomes without requiring raw API inspection.
