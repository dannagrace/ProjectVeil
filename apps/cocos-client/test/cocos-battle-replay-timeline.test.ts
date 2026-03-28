import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosBattleReplayTimelineView } from "../assets/scripts/cocos-battle-replay-timeline";
import type { PlayerBattleReplaySummary } from "../assets/scripts/project-shared/battle-replay";

function createBaseBattleReplay(): PlayerBattleReplaySummary {
  return {
    id: "replay-1",
    roomId: "room-alpha",
    playerId: "player-1",
    battleId: "battle-1",
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId: "hero-1",
    neutralArmyId: "neutral-1",
    startedAt: "2026-03-28T12:00:00.000Z",
    completedAt: "2026-03-28T12:02:00.000Z",
    initialState: {
      id: "battle-1",
      round: 1,
      lanes: 1,
      activeUnitId: "hero-1-stack",
      turnOrder: ["hero-1-stack", "neutral-1-stack"],
      units: {
        "hero-1-stack": {
          id: "hero-1-stack",
          templateId: "hero_guard_basic",
          camp: "attacker",
          lane: 0,
          stackName: "先锋长枪",
          initiative: 8,
          attack: 6,
          defense: 4,
          minDamage: 3,
          maxDamage: 5,
          count: 12,
          currentHp: 10,
          maxHp: 10,
          hasRetaliated: false,
          defending: false,
          skills: [],
          statusEffects: []
        },
        "neutral-1-stack": {
          id: "neutral-1-stack",
          templateId: "neutral_raider",
          camp: "defender",
          lane: 0,
          stackName: "雾林劫匪",
          initiative: 5,
          attack: 4,
          defense: 2,
          minDamage: 2,
          maxDamage: 4,
          count: 8,
          currentHp: 9,
          maxHp: 9,
          hasRetaliated: false,
          defending: false,
          skills: [],
          statusEffects: []
        }
      },
      environment: [],
      log: [],
      rng: {
        seed: 7,
        cursor: 0
      },
      neutralArmyId: "neutral-1"
    },
    steps: [],
    result: "attacker_victory"
  };
}

test("buildCocosBattleReplayTimelineView highlights acting unit, action and outcome", () => {
  const replay = createBaseBattleReplay();
  replay.steps = [
    {
      index: 1,
      source: "player",
      action: {
        type: "battle.attack",
        attackerId: "hero-1-stack",
        defenderId: "neutral-1-stack"
      }
    },
    {
      index: 2,
      source: "automated",
      action: {
        type: "battle.wait",
        unitId: "neutral-1-stack"
      }
    }
  ];

  const view = buildCocosBattleReplayTimelineView(replay, { limit: 2 });

  assert.match(view.title, /战报/);
  assert.equal(view.entries.length, 2);
  assert.match(view.entries[0]?.actorLabel ?? "", /攻方/);
  assert.match(view.entries[0]?.actionLabel ?? "", /攻击/);
  assert.match(view.entries[0]?.outcomeLabel ?? "", /雾林劫匪/);
  assert.equal(view.entries[0]?.sourceLabel, "玩家");
});

test("buildCocosBattleReplayTimelineView provides fallback when no steps are recorded", () => {
  const replay = createBaseBattleReplay();
  replay.steps = [];

  const view = buildCocosBattleReplayTimelineView(replay);

  assert.equal(view.entries.length, 0);
  assert.ok(view.emptyMessage);
  assert.match(view.subtitle, /攻方/);
});
