import assert from "node:assert/strict";
import test from "node:test";
import {
  createActionValidationFailure,
  validateAction
} from "../src/action-precheck.ts";

test("createActionValidationFailure returns undefined when validation is valid", () => {
  const result = createActionValidationFailure(
    "battle",
    { type: "MOVE" },
    { valid: true }
  );
  assert.equal(result, undefined);
});

test("createActionValidationFailure returns failure with reason when validation fails with reason", () => {
  const result = createActionValidationFailure(
    "battle",
    { type: "MOVE" },
    { valid: false, reason: "out of range" }
  );
  assert.deepEqual(result, {
    scope: "battle",
    actionType: "MOVE",
    reason: "out of range"
  });
});

test("createActionValidationFailure uses default fallback reason when validation fails with no reason", () => {
  const result = createActionValidationFailure(
    "battle",
    { type: "MOVE" },
    { valid: false }
  );
  assert.deepEqual(result, {
    scope: "battle",
    actionType: "MOVE",
    reason: "battle_action_invalid"
  });
});

test("createActionValidationFailure uses custom fallbackReason when provided and reason is absent", () => {
  const result = createActionValidationFailure(
    "battle",
    { type: "ATTACK" },
    { valid: false },
    "custom_fallback_reason"
  );
  assert.deepEqual(result, {
    scope: "battle",
    actionType: "ATTACK",
    reason: "custom_fallback_reason"
  });
});

test("createActionValidationFailure for scope world uses world_action_invalid fallback", () => {
  const result = createActionValidationFailure(
    "world",
    { type: "MOVE" },
    { valid: false }
  );
  assert.deepEqual(result, {
    scope: "world",
    actionType: "MOVE",
    reason: "world_action_invalid"
  });
});

test("validateAction without normalizeState passes state through unchanged", () => {
  const state = { hp: 100, position: { x: 0, y: 0 } };
  const action = { type: "MOVE" };
  const result = validateAction(state, action, (s, _a) => ({ valid: true }));
  assert.equal(result.state, state);
});

test("validateAction with normalizeState calls normalizeState before validate and passes transformed state", () => {
  const state = { hp: 100 };
  const action = { type: "HEAL" };
  const normalizedState = { hp: 50 };
  let validatedWith: typeof state | null = null;

  const result = validateAction(
    state,
    action,
    (s, _a) => {
      validatedWith = s;
      return { valid: true };
    },
    (_s) => normalizedState
  );

  assert.equal(result.state, normalizedState);
  assert.equal(validatedWith, normalizedState);
});

test("validateAction returns correct validation result from validate function", () => {
  const state = { hp: 0 };
  const action = { type: "ATTACK" };
  const result = validateAction(state, action, (_s, _a) => ({
    valid: false,
    reason: "hero is dead"
  }));
  assert.deepEqual(result.validation, { valid: false, reason: "hero is dead" });
});
