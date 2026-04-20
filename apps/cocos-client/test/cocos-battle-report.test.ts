import assert from "node:assert/strict";
import test from "node:test";
import { summarizeLatestBattleReplay } from "../assets/scripts/cocos-battle-report";
import type { PlayerBattleReplaySummary } from "@veil/shared/battle";

function createBattleState() {
  return {
    id: "battle-1",
    round: 1,
    lanes: 3,
    activeUnitId: null,
    turnOrder: [],
    units: {},
    environment: [],
    log: [],
    rng: {
      seed: 7,
      cursor: 0
    }
  };
}

test("summarizeLatestBattleReplay falls back when no replays exist", () => {
  assert.deepEqual(summarizeLatestBattleReplay([]), {
    title: "战报 暂无记录",
    detail: "完成一次战斗后，这里会同步最近战报摘要"
  });
});

test("summarizeLatestBattleReplay builds a concise latest replay summary", () => {
  const replays: PlayerBattleReplaySummary[] = [
    {
      id: "room-alpha:battle-hero-1:player-1",
      roomId: "room-alpha",
      playerId: "player-1",
      battleId: "battle-hero-1",
      battleKind: "hero",
      playerCamp: "defender",
      heroId: "hero-2",
      opponentHeroId: "hero-1",
      startedAt: "2026-03-27T12:00:00.000Z",
      completedAt: "2026-03-27T12:03:00.000Z",
      initialState: createBattleState(),
      steps: [
        {
          index: 1,
          source: "player",
          action: {
            type: "battle.attack",
            attackerId: "hero-2-stack",
            defenderId: "hero-1-stack"
          }
        },
        {
          index: 2,
          source: "automated",
          action: {
            type: "battle.defend",
            unitId: "hero-1-stack"
          }
        }
      ],
      result: "defender_victory"
    }
  ];

  assert.deepEqual(summarizeLatestBattleReplay(replays), {
    title: "战报 最近胜利 · PVP 英雄 hero-1",
    detail: "03-27 12:03 · 守方 · 1 回合/2 步 · 无额外奖励 · 玩1/自1"
  });
});
