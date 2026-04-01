import assert from "node:assert/strict";
import test from "node:test";

import { buildPlayerBattleReportCenter, normalizePlayerAccountReadModel, createEmptyBattleState } from "../src/index.ts";

test("battle report helpers derive rewards, turn count, and evidence availability from replay plus event log", () => {
  const battle = createEmptyBattleState({
    id: "battle-1",
    round: 1,
    attackerHeroId: "hero-1",
    defenderHeroId: "neutral-1"
  });

  const center = buildPlayerBattleReportCenter(
    [
      {
        id: "replay-1",
        roomId: "room-alpha",
        playerId: "player-1",
        battleId: "battle-1",
        battleKind: "neutral",
        playerCamp: "attacker",
        heroId: "hero-1",
        neutralArmyId: "neutral-1",
        startedAt: "2026-03-27T10:00:00.000Z",
        completedAt: "2026-03-27T10:01:00.000Z",
        initialState: battle,
        steps: [{ index: 1, source: "player", action: { type: "battle.wait", unitId: "hero-1-stack" } }],
        result: "attacker_victory"
      }
    ],
    [
      {
        id: "event-1",
        timestamp: "2026-03-27T10:01:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "combat",
        description: "resolved",
        heroId: "hero-1",
        worldEventType: "battle.resolved",
        rewards: [{ type: "experience", label: "经验", amount: 40 }]
      }
    ]
  );

  assert.equal(center.latestReportId, "replay-1");
  assert.deepEqual(center.items[0]?.rewards, [{ type: "experience", label: "经验", amount: 40 }]);
  assert.equal(center.items[0]?.turnCount, 1);
  assert.equal(center.items[0]?.actionCount, 1);
  assert.deepEqual(center.items[0]?.evidence, {
    replay: "available",
    rewards: "available"
  });
});

test("player account read model derives a battle report center from replay and event inputs", () => {
  const account = normalizePlayerAccountReadModel({
    playerId: "player-1",
    recentEventLog: [
      {
        id: "event-1",
        timestamp: "2026-03-27T10:01:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "combat",
        description: "resolved",
        heroId: "hero-1",
        worldEventType: "battle.resolved",
        rewards: [{ type: "experience", label: "经验", amount: 40 }]
      }
    ],
    recentBattleReplays: [
      {
        id: "replay-1",
        roomId: "room-alpha",
        playerId: "player-1",
        battleId: "battle-1",
        battleKind: "neutral",
        playerCamp: "attacker",
        heroId: "hero-1",
        neutralArmyId: "neutral-1",
        startedAt: "2026-03-27T10:00:00.000Z",
        completedAt: "2026-03-27T10:01:00.000Z",
        initialState: createEmptyBattleState({
          id: "battle-1",
          attackerHeroId: "hero-1",
          defenderHeroId: "neutral-1"
        }),
        steps: [],
        result: "attacker_victory"
      }
    ]
  });

  assert.equal(account.battleReportCenter?.latestReportId, "replay-1");
  assert.equal(account.battleReportCenter?.items[0]?.result, "victory");
  assert.deepEqual(account.battleReportCenter?.items[0]?.rewards, [{ type: "experience", label: "经验", amount: 40 }]);
});
