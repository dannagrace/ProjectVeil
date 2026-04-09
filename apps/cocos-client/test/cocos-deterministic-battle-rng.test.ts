import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBattleAction,
  createDemoBattleState,
  restoreBattleReplayPlaybackState,
  type PlayerBattleReplaySummary
} from "../assets/scripts/project-shared";

test("cocos project-shared battle damage stays deterministic for the same seed and actions", () => {
  const firstState = createDemoBattleState();
  const secondState = createDemoBattleState();
  const actions = [
    {
      type: "battle.attack" as const,
      attackerId: "wolf-d",
      defenderId: "pikeman-a"
    },
    {
      type: "battle.wait" as const,
      unitId: "pikeman-a"
    }
  ];

  const firstResult = actions.reduce((state, action) => applyBattleAction(state, action), firstState);
  const secondResult = actions.reduce((state, action) => applyBattleAction(state, action), secondState);

  assert.deepEqual(secondResult.log, firstResult.log);
  assert.deepEqual(secondResult.units, firstResult.units);
  assert.deepEqual(secondResult.rng, firstResult.rng);
});

test("cocos project-shared replay restore normalizes legacy battle states without rng metadata", () => {
  const initialState = createDemoBattleState();
  delete (initialState as Partial<typeof initialState>).rng;

  const replay: PlayerBattleReplaySummary = {
    id: "replay-cocos-deterministic-battle",
    roomId: "room-alpha",
    playerId: "player-1",
    battleId: "battle-1",
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId: "hero-1",
    neutralArmyId: "neutral-1",
    startedAt: "2026-04-09T00:00:00.000Z",
    completedAt: "2026-04-09T00:01:00.000Z",
    initialState,
    steps: [
      {
        index: 1,
        source: "player",
        action: {
          type: "battle.attack",
          attackerId: "wolf-d",
          defenderId: "pikeman-a"
        }
      }
    ],
    result: "attacker_victory"
  };

  const playback = restoreBattleReplayPlaybackState(replay, 1, "paused");
  const expectedState = createDemoBattleState();
  delete (expectedState as Partial<typeof expectedState>).rng;
  const replayedState = applyBattleAction(expectedState, replay.steps[0]!.action);

  assert.deepEqual(playback.currentState.rng, replayedState.rng);
  assert.deepEqual(playback.currentState.units, replayedState.units);
  assert.deepEqual(playback.currentState.log, replayedState.log);
});

test("cocos project-shared replay restore reproduces retaliation state transitions", () => {
  const initialState = createDemoBattleState();
  const action = {
    type: "battle.attack" as const,
    attackerId: "wolf-d",
    defenderId: "pikeman-a"
  };
  const replay: PlayerBattleReplaySummary = {
    id: "replay-cocos-retaliation",
    roomId: "room-alpha",
    playerId: "player-1",
    battleId: "battle-retaliation",
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId: "hero-1",
    neutralArmyId: "neutral-1",
    startedAt: "2026-04-09T00:00:00.000Z",
    completedAt: "2026-04-09T00:01:00.000Z",
    initialState,
    steps: [
      {
        index: 1,
        source: "player",
        action
      }
    ],
    result: "defender_victory"
  };

  const playback = restoreBattleReplayPlaybackState(replay, 1, "paused");
  const resolved = applyBattleAction(createDemoBattleState(), action);

  assert.equal(playback.currentState.units["pikeman-a"]?.hasRetaliated, true);
  assert.deepEqual(playback.currentState.units, resolved.units);
  assert.deepEqual(playback.currentState.rng, resolved.rng);
  assert.match(playback.currentState.log.join("\n"), /枪兵 反击 恶狼/);
});
