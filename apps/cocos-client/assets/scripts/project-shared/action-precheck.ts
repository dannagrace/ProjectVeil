import type { ValidationResult } from "./models.ts";

export interface ActionPrecheckResult<TState> {
  state: TState;
  validation: ValidationResult;
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
