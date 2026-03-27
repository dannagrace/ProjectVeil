import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBattleReplayPlaybackCommand,
  createEmptyBattleState,
  restoreBattleReplayPlaybackState,
  type PlayerBattleReplaySummary
} from "../src/index";

function createReplay(): PlayerBattleReplaySummary {
  const initialState = createEmptyBattleState();
  initialState.id = "battle-playback-command";

  return {
    id: "replay-playback-command",
    roomId: "room-1",
    playerId: "player-1",
    battleId: "battle-1",
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId: "hero-1",
    neutralArmyId: "neutral-1",
    startedAt: "2026-03-27T10:00:00.000Z",
    completedAt: "2026-03-27T10:01:00.000Z",
    initialState,
    steps: [
      {
        index: 1,
        source: "player",
        action: {
          type: "battle.wait",
          unitId: "stack-1"
        }
      },
      {
        index: 2,
        source: "automated",
        action: {
          type: "battle.defend",
          unitId: "stack-2"
        }
      }
    ],
    result: "attacker_victory"
  };
}

test("restoreBattleReplayPlaybackState rebuilds the replay cursor from a step index", () => {
  const playback = restoreBattleReplayPlaybackState(createReplay(), 1, "paused");

  assert.equal(playback.currentStepIndex, 1);
  assert.equal(playback.status, "paused");
  assert.equal(playback.currentStep?.index, 1);
  assert.equal(playback.nextStep?.index, 2);
});

test("applyBattleReplayPlaybackCommand advances stateless step and tick controls", () => {
  const replay = createReplay();

  const stepped = applyBattleReplayPlaybackCommand(replay, {
    currentStepIndex: 0,
    status: "paused",
    action: "step",
    repeat: 2
  });
  assert.equal(stepped.currentStepIndex, 2);
  assert.equal(stepped.status, "completed");
  assert.equal(stepped.currentStep?.index, 2);

  const ticked = applyBattleReplayPlaybackCommand(replay, {
    currentStepIndex: 0,
    status: "paused",
    action: "tick",
    repeat: 1
  });
  assert.equal(ticked.currentStepIndex, 1);
  assert.equal(ticked.status, "playing");
});

test("applyBattleReplayPlaybackCommand supports play, pause, and reset from a restored cursor", () => {
  const replay = createReplay();

  const playing = applyBattleReplayPlaybackCommand(replay, {
    currentStepIndex: 1,
    status: "paused",
    action: "play"
  });
  assert.equal(playing.status, "playing");
  assert.equal(playing.currentStepIndex, 1);

  const paused = applyBattleReplayPlaybackCommand(replay, {
    currentStepIndex: 1,
    status: "playing",
    action: "pause"
  });
  assert.equal(paused.status, "paused");
  assert.equal(paused.currentStepIndex, 1);

  const reset = applyBattleReplayPlaybackCommand(replay, {
    currentStepIndex: 1,
    status: "playing",
    action: "reset"
  });
  assert.equal(reset.status, "paused");
  assert.equal(reset.currentStepIndex, 0);
  assert.equal(reset.currentStep, null);
  assert.equal(reset.nextStep?.index, 1);
});
