export interface OnboardingFunnelStageDefinition {
  id: string;
  label: string;
  successCriteria: string;
  evidenceNotes: string;
}

export const ONBOARDING_FUNNEL_STAGES: readonly OnboardingFunnelStageDefinition[] = [
  {
    id: "onboarding_session_started",
    label: "Onboarding Session Started",
    successCriteria: "A new-player session enters the onboarding evidence set.",
    evidenceNotes:
      "Prefer a `session_start` analytics event tagged to onboarding. When only tutorial-step evidence exists, the report infers this stage from the earliest onboarding event for that player."
  },
  {
    id: "tutorial_step_1_seen",
    label: "Tutorial Step 1 Seen",
    successCriteria: "The player reaches the first tutorial overlay / initial onboarding prompt.",
    evidenceNotes:
      "Current telemetry infers this stage from the onboarding session start unless an explicit `step_1` tutorial event is available."
  },
  {
    id: "tutorial_step_2_seen",
    label: "Tutorial Step 2 Seen",
    successCriteria: "The player advances into the second guided onboarding step.",
    evidenceNotes: "Maps to `tutorial_step` analytics with `payload.stepId = step_2`."
  },
  {
    id: "tutorial_step_3_seen",
    label: "Tutorial Step 3 Seen",
    successCriteria: "The player advances into the final guided onboarding step before completion.",
    evidenceNotes: "Maps to `tutorial_step` analytics with `payload.stepId = step_3`."
  },
  {
    id: "onboarding_completed",
    label: "Onboarding Completed",
    successCriteria: "The player finishes onboarding and unlocks normal post-onboarding progression.",
    evidenceNotes: "Maps to `tutorial_step` analytics with `payload.stepId = tutorial_completed`."
  }
] as const;

export type OnboardingFunnelStageId = (typeof ONBOARDING_FUNNEL_STAGES)[number]["id"];

export function getOnboardingFunnelStageIndex(stageId: OnboardingFunnelStageId): number {
  return ONBOARDING_FUNNEL_STAGES.findIndex((stage) => stage.id === stageId);
}
