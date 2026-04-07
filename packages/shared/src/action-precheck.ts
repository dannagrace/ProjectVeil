import type { ValidationResult } from "./models.ts";

export type ActionValidationScope = "battle" | "world";

export interface ActionValidationFailure {
  scope: ActionValidationScope;
  actionType: string;
  reason: string;
}

export interface ActionPrecheckResult<TState> {
  state: TState;
  validation: ValidationResult;
  rejection?: ActionValidationFailure;
}

export function createActionValidationFailure<TAction extends { type: string }>(
  scope: ActionValidationScope,
  action: TAction,
  validation: ValidationResult,
  fallbackReason = `${scope}_action_invalid`
): ActionValidationFailure | undefined {
  if (validation.valid) {
    return undefined;
  }

  return {
    scope,
    actionType: action.type,
    reason: validation.reason ?? fallbackReason
  };
}

export function validateAction<TState, TAction>(
  state: TState,
  action: TAction,
  validate: (state: TState, action: TAction) => ValidationResult,
  normalizeState?: (state: TState) => TState
): ActionPrecheckResult<TState> {
  const nextState = normalizeState ? normalizeState(state) : state;
  return {
    state: nextState,
    validation: validate(nextState, action)
  };
}
