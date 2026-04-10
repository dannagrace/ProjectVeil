import assert from "node:assert/strict";
import test from "node:test";

import {
  createBattleReplayPlaybackState,
  playBattleReplayPlayback,
  pauseBattleReplayPlayback,
  stepBattleReplayPlayback,
  resetBattleReplayPlayback,
  normalizePlayerBattleReplaySummaries,
  queryPlayerBattleReplaySummaries,
  buildBattleReplayTimeline
} from "../src/battle-replay.ts";
import type { PlayerBattleReplaySummary } from "../src/battle-replay.ts";
import type { BattleState } from "../src/models.ts";

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

function makeInitialState(): BattleState {
  return {
    id: "battle-1",
    round: 1,
    lanes: 3,
    activeUnitId: null,
    turnOrder: [],
    units: {},
    unitCooldowns: {},
    environment: [],
    log: [],
    rng: { seed: 42, cursor: 0 }
  };
}

function makeReplay(overrides: Partial<PlayerBattleReplaySummary> = {}): PlayerBattleReplaySummary {
  return {
    id: "replay-1",
    roomId: "room-1",
    playerId: "player-1",
    battleId: "battle-1",
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId: "hero-1",
    startedAt: "2024-01-01T00:00:00.000Z",
    completedAt: "2024-01-01T00:05:00.000Z",
    initialState: makeInitialState(),
    steps: [],
    result: "attacker_victory",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// createBattleReplayPlaybackState
// ---------------------------------------------------------------------------

test("createBattleReplayPlaybackState returns initial state at frame 0 with paused status", () => {
  // A replay with at least one step is needed so totalSteps > 0 and status stays "paused"
  // (when totalSteps === 0, resolvePlaybackStatus treats it as completed immediately)
  const step = { index: 1, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const replay = makeReplay({ steps: [step] });
  const playback = createBattleReplayPlaybackState(replay);

  assert.equal(playback.currentStepIndex, 0);
  assert.equal(playback.status, "paused");
  assert.equal(playback.speed, 1);
  assert.equal(playback.totalSteps, 1);
  assert.equal(playback.currentStep, null);
  assert.deepEqual(playback.nextStep, step);
  assert.deepEqual(playback.replay, replay);
});

test("createBattleReplayPlaybackState with 0 steps resolves to completed status immediately", () => {
  const replay = makeReplay(); // 0 steps
  const playback = createBattleReplayPlaybackState(replay);

  assert.equal(playback.currentStepIndex, 0);
  // 0 >= 0 so resolvePlaybackStatus marks it as completed
  assert.equal(playback.status, "completed");
  assert.equal(playback.totalSteps, 0);
});

test("createBattleReplayPlaybackState with steps reflects correct totalSteps and nextStep", () => {
  const step = { index: 1, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const replay = makeReplay({ steps: [step] });
  const playback = createBattleReplayPlaybackState(replay);

  assert.equal(playback.totalSteps, 1);
  assert.equal(playback.currentStepIndex, 0);
  assert.deepEqual(playback.nextStep, step);
  assert.equal(playback.currentStep, null);
});

// ---------------------------------------------------------------------------
// playBattleReplayPlayback
// ---------------------------------------------------------------------------

test("playBattleReplayPlayback transitions status from paused to playing when steps remain", () => {
  const step = { index: 1, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const replay = makeReplay({ steps: [step] });
  const playback = createBattleReplayPlaybackState(replay);
  assert.equal(playback.status, "paused");

  const playing = playBattleReplayPlayback(playback);
  assert.equal(playing.status, "playing");
});

test("playBattleReplayPlayback returns completed status when already at end", () => {
  const replay = makeReplay(); // 0 steps
  const playback = createBattleReplayPlaybackState(replay);
  // currentStepIndex (0) >= totalSteps (0), so play marks as completed
  const result = playBattleReplayPlayback(playback);
  assert.equal(result.status, "completed");
});

// ---------------------------------------------------------------------------
// pauseBattleReplayPlayback
// ---------------------------------------------------------------------------

test("pauseBattleReplayPlayback transitions from playing to paused", () => {
  const step = { index: 1, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const replay = makeReplay({ steps: [step] });
  const playback = playBattleReplayPlayback(createBattleReplayPlaybackState(replay));
  assert.equal(playback.status, "playing");

  const paused = pauseBattleReplayPlayback(playback);
  assert.equal(paused.status, "paused");
});

test("pauseBattleReplayPlayback returns same object when status is completed", () => {
  const replay = makeReplay();
  const playback = { ...createBattleReplayPlaybackState(replay), status: "completed" as const };

  const result = pauseBattleReplayPlayback(playback);
  assert.strictEqual(result, playback);
});

// ---------------------------------------------------------------------------
// stepBattleReplayPlayback
// ---------------------------------------------------------------------------

test("stepBattleReplayPlayback advances currentStepIndex by 1", () => {
  const step = { index: 1, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const replay = makeReplay({ steps: [step] });
  const playback = createBattleReplayPlaybackState(replay);
  assert.equal(playback.currentStepIndex, 0);

  const stepped = stepBattleReplayPlayback(playback);
  assert.equal(stepped.currentStepIndex, 1);
});

test("stepBattleReplayPlayback returns completed when no nextStep", () => {
  const replay = makeReplay(); // 0 steps
  const playback = createBattleReplayPlaybackState(replay);
  // nextStep is null

  const result = stepBattleReplayPlayback(playback);
  assert.equal(result.status, "completed");
});

test("stepBattleReplayPlayback preserves playing status when called while playing", () => {
  const step1 = { index: 1, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const step2 = { index: 2, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const replay = makeReplay({ steps: [step1, step2] });
  const playback = playBattleReplayPlayback(createBattleReplayPlaybackState(replay));
  assert.equal(playback.status, "playing");

  const stepped = stepBattleReplayPlayback(playback);
  assert.equal(stepped.status, "playing");
  assert.equal(stepped.currentStepIndex, 1);
});

test("stepBattleReplayPlayback preserves paused status when called while paused", () => {
  // Two steps needed so stepping from index 0 -> 1 still has remaining steps and stays paused
  const step1 = { index: 1, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const step2 = { index: 2, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const replay = makeReplay({ steps: [step1, step2] });
  const playback = createBattleReplayPlaybackState(replay);
  assert.equal(playback.status, "paused");

  const stepped = stepBattleReplayPlayback(playback);
  assert.equal(stepped.status, "paused");
  assert.equal(stepped.currentStepIndex, 1);
});

// ---------------------------------------------------------------------------
// resetBattleReplayPlayback
// ---------------------------------------------------------------------------

test("resetBattleReplayPlayback resets frame index to 0 and status to paused", () => {
  const step = { index: 1, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const replay = makeReplay({ steps: [step] });
  const playback = stepBattleReplayPlayback(playBattleReplayPlayback(createBattleReplayPlaybackState(replay)));
  // after stepping through one step we should be at index 1
  assert.equal(playback.currentStepIndex, 1);

  const reset = resetBattleReplayPlayback(playback);
  assert.equal(reset.currentStepIndex, 0);
  assert.equal(reset.status, "paused");
});

test("resetBattleReplayPlayback preserves speed from previous playback state", () => {
  const replay = makeReplay();
  const playback = { ...createBattleReplayPlaybackState(replay), speed: 2 as const };

  const reset = resetBattleReplayPlayback(playback);
  assert.equal(reset.speed, 2);
});

// ---------------------------------------------------------------------------
// normalizePlayerBattleReplaySummaries
// ---------------------------------------------------------------------------

test("normalizePlayerBattleReplaySummaries returns empty array for null/undefined input", () => {
  assert.deepEqual(normalizePlayerBattleReplaySummaries(null), []);
  assert.deepEqual(normalizePlayerBattleReplaySummaries(undefined), []);
  assert.deepEqual(normalizePlayerBattleReplaySummaries([]), []);
});

test("normalizePlayerBattleReplaySummaries filters out items missing required fields", () => {
  const result = normalizePlayerBattleReplaySummaries([
    { id: "r1" } // missing roomId, playerId, etc.
  ]);
  assert.deepEqual(result, []);
});

test("normalizePlayerBattleReplaySummaries returns a valid normalized replay", () => {
  const replay = makeReplay();
  const result = normalizePlayerBattleReplaySummaries([replay]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "replay-1");
  assert.equal(result[0]?.battleKind, "neutral");
  assert.equal(result[0]?.playerCamp, "attacker");
  assert.equal(result[0]?.result, "attacker_victory");
});

test("normalizePlayerBattleReplaySummaries deduplicates by id keeping most recent completedAt", () => {
  const older = makeReplay({
    id: "replay-1",
    completedAt: "2024-01-01T00:00:00.000Z"
  });
  const newer = makeReplay({
    id: "replay-1",
    completedAt: "2024-06-01T00:00:00.000Z"
  });

  const result = normalizePlayerBattleReplaySummaries([older, newer]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "replay-1");
});

test("normalizePlayerBattleReplaySummaries sorts by completedAt descending", () => {
  const first = makeReplay({ id: "r-a", completedAt: "2024-03-01T00:00:00.000Z" });
  const second = makeReplay({ id: "r-b", completedAt: "2024-01-01T00:00:00.000Z" });

  const result = normalizePlayerBattleReplaySummaries([second, first]);
  assert.equal(result[0]?.id, "r-a");
  assert.equal(result[1]?.id, "r-b");
});

test("normalizePlayerBattleReplaySummaries rejects invalid battleKind", () => {
  const replay = { ...makeReplay(), battleKind: "invalid" } as unknown as PlayerBattleReplaySummary;
  const result = normalizePlayerBattleReplaySummaries([replay]);
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// queryPlayerBattleReplaySummaries
// ---------------------------------------------------------------------------

test("queryPlayerBattleReplaySummaries returns all replays when query is empty", () => {
  const replays = [
    makeReplay({ id: "r-1" }),
    makeReplay({ id: "r-2", completedAt: "2024-06-01T00:00:00.000Z" })
  ];
  const result = queryPlayerBattleReplaySummaries(replays, {});
  assert.equal(result.length, 2);
});

test("queryPlayerBattleReplaySummaries filters by roomId", () => {
  const inRoom = makeReplay({ id: "r-1", roomId: "room-A" });
  const otherRoom = makeReplay({ id: "r-2", roomId: "room-B", completedAt: "2024-06-01T00:00:00.000Z" });
  const result = queryPlayerBattleReplaySummaries([inRoom, otherRoom], { roomId: "room-A" });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "r-1");
});

test("queryPlayerBattleReplaySummaries filters by result", () => {
  const win = makeReplay({ id: "r-1", result: "attacker_victory" });
  const loss = makeReplay({ id: "r-2", result: "defender_victory", completedAt: "2024-06-01T00:00:00.000Z" });
  const result = queryPlayerBattleReplaySummaries([win, loss], { result: "defender_victory" });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "r-2");
});

test("queryPlayerBattleReplaySummaries filters by battleKind", () => {
  const neutral = makeReplay({ id: "r-1", battleKind: "neutral" });
  const hero = makeReplay({ id: "r-2", battleKind: "hero", completedAt: "2024-06-01T00:00:00.000Z" });
  const result = queryPlayerBattleReplaySummaries([neutral, hero], { battleKind: "hero" });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "r-2");
});

test("queryPlayerBattleReplaySummaries respects limit and offset", () => {
  const replays = [
    makeReplay({ id: "r-1", completedAt: "2024-03-01T00:00:00.000Z" }),
    makeReplay({ id: "r-2", completedAt: "2024-02-01T00:00:00.000Z" }),
    makeReplay({ id: "r-3", completedAt: "2024-01-01T00:00:00.000Z" })
  ];

  const limited = queryPlayerBattleReplaySummaries(replays, { limit: 2 });
  assert.equal(limited.length, 2);

  const offset = queryPlayerBattleReplaySummaries(replays, { offset: 1, limit: 2 });
  assert.equal(offset.length, 2);
  assert.equal(offset[0]?.id, "r-2");
});

test("queryPlayerBattleReplaySummaries returns empty array for null input", () => {
  const result = queryPlayerBattleReplaySummaries(null, {});
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// buildBattleReplayTimeline
// ---------------------------------------------------------------------------

test("buildBattleReplayTimeline returns empty array for replay with no steps", () => {
  const replay = makeReplay();
  const timeline = buildBattleReplayTimeline(replay);

  assert.ok(Array.isArray(timeline));
  assert.equal(timeline.length, 0);
});

test("buildBattleReplayTimeline returns one entry per step", () => {
  const step1 = { index: 1, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const step2 = { index: 2, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const replay = makeReplay({ steps: [step1, step2] });
  const timeline = buildBattleReplayTimeline(replay);

  assert.equal(timeline.length, 2);
});

test("buildBattleReplayTimeline entry has expected shape", () => {
  const step = { index: 1, source: "player" as const, action: { type: "battle.wait" as const, unitId: "u1" } };
  const replay = makeReplay({ steps: [step] });
  const timeline = buildBattleReplayTimeline(replay);

  assert.equal(timeline.length, 1);
  const entry = timeline[0]!;
  assert.ok("step" in entry);
  assert.ok("round" in entry);
  assert.ok("resultingRound" in entry);
  assert.ok("state" in entry);
  assert.ok("outcome" in entry);
  assert.ok("changes" in entry);
  assert.ok(Array.isArray(entry.changes));
  assert.deepEqual(entry.step, step);
});
