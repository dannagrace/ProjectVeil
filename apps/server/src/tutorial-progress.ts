import { canSkipTutorial } from "@veil/shared/progression";
import type { TutorialProgressAction } from "@veil/shared/protocol";

export function normalizeTutorialProgressAction(input: unknown, currentStep?: number | null): TutorialProgressAction {
  const raw = input as Partial<TutorialProgressAction> | null | undefined;
  const reason =
    raw?.reason === "skip" || raw?.reason === "complete" || raw?.reason === "advance" ? raw.reason : "advance";
  const step = raw?.step == null ? null : Math.floor(raw.step);
  const normalizedCurrentStep = currentStep == null ? null : Math.max(1, Math.floor(currentStep));

  if (step !== null && (!Number.isFinite(step) || step <= 0)) {
    throw new Error("tutorial_progress_invalid_step");
  }
  if (reason === "skip" && !canSkipTutorial(normalizedCurrentStep)) {
    throw new Error("tutorial_skip_locked");
  }
  if (reason === "advance" && step === null) {
    throw new Error("tutorial_progress_invalid_step");
  }
  if (reason === "advance" && normalizedCurrentStep !== null && step !== normalizedCurrentStep + 1) {
    throw new Error("tutorial_progress_out_of_order");
  }
  if (reason === "complete" && normalizedCurrentStep !== null && step !== null) {
    throw new Error("tutorial_progress_invalid_step");
  }
  if (reason === "complete" && normalizedCurrentStep !== null && normalizedCurrentStep < 3) {
    throw new Error("tutorial_progress_out_of_order");
  }

  return {
    step,
    reason
  };
}

export function toTutorialAnalyticsPayload(action: TutorialProgressAction): { stepId: string; status: string; reason: string } {
  return {
    stepId:
      action.step == null
        ? action.reason === "skip"
          ? "tutorial_skipped"
          : "tutorial_completed"
        : `step_${action.step}`,
    status: action.reason === "skip" ? "skipped" : action.step == null ? "completed" : "active",
    reason: action.reason ?? "advance"
  };
}
