import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTutorialStep,
  isTutorialComplete,
  canSkipTutorial,
  countTrackedPvpMatches,
  countRemainingProtectedPvpMatches,
  DEFAULT_TUTORIAL_STEP,
  NEW_PLAYER_MATCHMAKING_PROTECTION_MATCHES,
} from "../src/tutorial.ts";

test("normalizeTutorialStep(null) returns null", () => {
  assert.equal(normalizeTutorialStep(null), null);
});

test("normalizeTutorialStep(undefined) returns null", () => {
  assert.equal(normalizeTutorialStep(undefined), null);
});

test("normalizeTutorialStep(3) returns 3", () => {
  assert.equal(normalizeTutorialStep(3), 3);
});

test("normalizeTutorialStep(3.9) floors to 3", () => {
  assert.equal(normalizeTutorialStep(3.9), 3);
});

test("normalizeTutorialStep(0) returns DEFAULT_TUTORIAL_STEP", () => {
  assert.equal(normalizeTutorialStep(0), DEFAULT_TUTORIAL_STEP);
});

test("normalizeTutorialStep(-1) returns DEFAULT_TUTORIAL_STEP", () => {
  assert.equal(normalizeTutorialStep(-1), DEFAULT_TUTORIAL_STEP);
});

test("isTutorialComplete(null) returns true", () => {
  assert.equal(isTutorialComplete(null), true);
});

test("isTutorialComplete(undefined) returns true", () => {
  assert.equal(isTutorialComplete(undefined), true);
});

test("isTutorialComplete(1) returns false", () => {
  assert.equal(isTutorialComplete(1), false);
});

test("canSkipTutorial(null) returns false", () => {
  assert.equal(canSkipTutorial(null), false);
});

test("canSkipTutorial(1) returns false (step 1 < MIN_SKIP=2)", () => {
  assert.equal(canSkipTutorial(1), false);
});

test("canSkipTutorial(2) returns true", () => {
  assert.equal(canSkipTutorial(2), true);
});

test("canSkipTutorial(10) returns true", () => {
  assert.equal(canSkipTutorial(10), true);
});

test("countTrackedPvpMatches with null returns 0", () => {
  assert.equal(countTrackedPvpMatches(null), 0);
});

test("countTrackedPvpMatches with empty array returns 0", () => {
  assert.equal(countTrackedPvpMatches([]), 0);
});

test("countTrackedPvpMatches with 3 hero battles returns 3", () => {
  const replays = [
    { battleKind: "hero" },
    { battleKind: "hero" },
    { battleKind: "hero" },
  ];
  assert.equal(countTrackedPvpMatches(replays), 3);
});

test("countTrackedPvpMatches with 2 hero + 2 neutral battles returns 2", () => {
  const replays = [
    { battleKind: "hero" },
    { battleKind: "neutral" },
    { battleKind: "hero" },
    { battleKind: "neutral" },
  ];
  assert.equal(countTrackedPvpMatches(replays), 2);
});

test("countTrackedPvpMatches with 7 hero battles is capped at default limit 5", () => {
  const replays = Array.from({ length: 7 }, () => ({ battleKind: "hero" }));
  assert.equal(countTrackedPvpMatches(replays), 5);
});

test("countRemainingProtectedPvpMatches(null) returns NEW_PLAYER_MATCHMAKING_PROTECTION_MATCHES", () => {
  assert.equal(countRemainingProtectedPvpMatches(null), NEW_PLAYER_MATCHMAKING_PROTECTION_MATCHES);
});

test("countRemainingProtectedPvpMatches with 3 hero battles returns 2", () => {
  const replays = [
    { battleKind: "hero" },
    { battleKind: "hero" },
    { battleKind: "hero" },
  ];
  assert.equal(countRemainingProtectedPvpMatches(replays), 2);
});

test("countRemainingProtectedPvpMatches with 5+ hero battles returns 0", () => {
  const replays = Array.from({ length: 7 }, () => ({ battleKind: "hero" }));
  assert.equal(countRemainingProtectedPvpMatches(replays), 0);
});
