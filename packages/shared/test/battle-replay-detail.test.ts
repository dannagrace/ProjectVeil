import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBattleState, findPlayerBattleReplaySummary } from "../src/index";

test("battle replay detail helper returns a normalized replay by id", () => {
  const battle = createEmptyBattleState();
  const replay = findPlayerBattleReplaySummary(
    [
      {
        id: " replay-neutral ",
        roomId: "room-alpha",
        playerId: "player-1",
        battleId: "battle-neutral-1",
        battleKind: "neutral",
        playerCamp: "attacker",
        heroId: "hero-1",
        neutralArmyId: "neutral-1",
        startedAt: "2026-03-27T10:00:00.000Z",
        completedAt: "2026-03-27T10:01:00.000Z",
        initialState: battle,
        steps: [
          {
            index: 3,
            source: "player",
            action: {
              type: "battle.wait",
              unitId: "hero-1-stack"
            }
          }
        ],
        result: "attacker_victory"
      }
    ],
    "replay-neutral"
  );

  assert.ok(replay);
  assert.equal(replay.id, "replay-neutral");
  assert.equal(replay.steps[0]?.index, 3);
  assert.equal(findPlayerBattleReplaySummary([replay], "missing-replay"), null);
  assert.equal(findPlayerBattleReplaySummary([replay], "   "), null);
});
