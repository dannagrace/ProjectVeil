import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBattleReplayPlaybackCommand,
  buildBattleReplayTimeline,
  createEmptyBattleState,
  queryPlayerBattleReplaySummaries,
  restoreBattleReplayPlaybackState,
  stepBackBattleReplayPlayback,
  stepBattleReplayPlayback,
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

test("battle replay playback can step backward from partial and completed states", () => {
  const replay = createReplay();

  const firstStep = stepBattleReplayPlayback(restoreBattleReplayPlaybackState(replay));
  const secondStep = stepBattleReplayPlayback(firstStep);
  assert.equal(secondStep.status, "completed");
  assert.equal(secondStep.currentStepIndex, 2);

  const rewoundCompleted = stepBackBattleReplayPlayback(secondStep);
  assert.equal(rewoundCompleted.status, "paused");
  assert.equal(rewoundCompleted.currentStepIndex, 1);
  assert.equal(rewoundCompleted.currentStep?.index, 1);
  assert.equal(rewoundCompleted.nextStep?.index, 2);

  const rewoundToStart = stepBackBattleReplayPlayback(rewoundCompleted);
  assert.equal(rewoundToStart.status, "paused");
  assert.equal(rewoundToStart.currentStepIndex, 0);
  assert.equal(rewoundToStart.currentStep, null);
  assert.equal(rewoundToStart.nextStep?.index, 1);
});

test("battle replay timeline derives round-aware state deltas", () => {
  const replay = createReplay();
  replay.initialState.units = {
    "stack-1": {
      id: "stack-1",
      templateId: "hero-guard-basic",
      camp: "attacker",
      lane: 0,
      stackName: "前锋卫队",
      initiative: 12,
      attack: 5,
      defense: 4,
      minDamage: 1,
      maxDamage: 2,
      count: 3,
      currentHp: 10,
      maxHp: 10,
      hasRetaliated: false,
      defending: false
    },
    "stack-2": {
      id: "stack-2",
      templateId: "wolf-pack",
      camp: "defender",
      lane: 1,
      stackName: "狼群",
      initiative: 8,
      attack: 4,
      defense: 4,
      minDamage: 1,
      maxDamage: 2,
      count: 2,
      currentHp: 10,
      maxHp: 10,
      hasRetaliated: false,
      defending: false
    }
  };
  replay.initialState.round = 1;
  replay.initialState.turnOrder = ["stack-1", "stack-2"];
  replay.initialState.activeUnitId = "stack-1";
  replay.steps = [
    {
      index: 1,
      source: "player",
      action: {
        type: "battle.defend",
        unitId: "stack-1"
      }
    }
  ];

  const timeline = buildBattleReplayTimeline(replay);

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0]?.round, 1);
  assert.match(timeline[0]?.state.log.join(" ") ?? "", /stack-1/);
  assert.equal(timeline[0]?.outcome, "in_progress");
});

test("queryPlayerBattleReplaySummaries supports offset pagination", () => {
  const older = createReplay();
  older.id = "replay-older";
  older.completedAt = "2026-03-27T10:00:00.000Z";

  const newer = createReplay();
  newer.id = "replay-newer";
  newer.completedAt = "2026-03-27T10:05:00.000Z";

  const paged = queryPlayerBattleReplaySummaries([older, newer], {
    limit: 1,
    offset: 1
  });

  assert.deepEqual(paged.map((replay) => replay.id), ["replay-older"]);
});
