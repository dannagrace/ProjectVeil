import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTutorialProgressAction, toTutorialAnalyticsPayload } from "@server/domain/account/tutorial-progress";

test("normalizeTutorialProgressAction accepts an in-order advance", () => {
  assert.deepEqual(normalizeTutorialProgressAction({ step: 2, reason: "advance" }, 1), {
    step: 2,
    reason: "advance"
  });
});

test("normalizeTutorialProgressAction rejects out-of-order advance", () => {
  assert.throws(
    () => normalizeTutorialProgressAction({ step: 4, reason: "advance" }, 2),
    /tutorial_progress_out_of_order/
  );
});

test("normalizeTutorialProgressAction rejects advance without a step", () => {
  assert.throws(
    () => normalizeTutorialProgressAction({ step: null, reason: "advance" }, 2),
    /tutorial_progress_invalid_step/
  );
});

test("normalizeTutorialProgressAction rejects non-finite step values", () => {
  assert.throws(
    () => normalizeTutorialProgressAction({ step: Number.NaN, reason: "advance" }, null),
    /tutorial_progress_invalid_step/
  );
});

test("normalizeTutorialProgressAction rejects non-positive step values", () => {
  assert.throws(
    () => normalizeTutorialProgressAction({ step: 0, reason: "advance" }, null),
    /tutorial_progress_invalid_step/
  );
});

test("normalizeTutorialProgressAction rejects skip before the tutorial is unlockable", () => {
  assert.throws(() => normalizeTutorialProgressAction({ step: null, reason: "skip" }, 1), /tutorial_skip_locked/);
});

test("normalizeTutorialProgressAction accepts skip after the tutorial unlocks", () => {
  assert.deepEqual(normalizeTutorialProgressAction({ step: null, reason: "skip" }, 2), {
    step: null,
    reason: "skip"
  });
});

test("normalizeTutorialProgressAction rejects complete when a step is provided", () => {
  assert.throws(
    () => normalizeTutorialProgressAction({ step: 3, reason: "complete" }, 3),
    /tutorial_progress_invalid_step/
  );
});

test("normalizeTutorialProgressAction rejects complete before step three", () => {
  assert.throws(
    () => normalizeTutorialProgressAction({ step: null, reason: "complete" }, 2),
    /tutorial_progress_out_of_order/
  );
});

test("normalizeTutorialProgressAction accepts complete from step three onward", () => {
  assert.deepEqual(normalizeTutorialProgressAction({ step: null, reason: "complete" }, 3), {
    step: null,
    reason: "complete"
  });
});

test("toTutorialAnalyticsPayload maps advance actions", () => {
  assert.deepEqual(toTutorialAnalyticsPayload({ step: 2, reason: "advance" }), {
    stepId: "step_2",
    status: "active",
    reason: "advance"
  });
});

test("toTutorialAnalyticsPayload maps skip actions", () => {
  assert.deepEqual(toTutorialAnalyticsPayload({ step: null, reason: "skip" }), {
    stepId: "tutorial_skipped",
    status: "skipped",
    reason: "skip"
  });
});

test("toTutorialAnalyticsPayload maps complete actions", () => {
  assert.deepEqual(toTutorialAnalyticsPayload({ step: null, reason: "complete" }), {
    stepId: "tutorial_completed",
    status: "completed",
    reason: "complete"
  });
});
