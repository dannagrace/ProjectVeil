import assert from "node:assert/strict";
import test from "node:test";
import {
  ONBOARDING_FUNNEL_STAGES,
  getOnboardingFunnelStageIndex
} from "../src/onboarding-funnel.ts";

test("getOnboardingFunnelStageIndex returns 0 for onboarding_session_started", () => {
  assert.equal(getOnboardingFunnelStageIndex("onboarding_session_started"), 0);
});

test("getOnboardingFunnelStageIndex returns 1 for tutorial_step_1_seen", () => {
  assert.equal(getOnboardingFunnelStageIndex("tutorial_step_1_seen"), 1);
});

test("getOnboardingFunnelStageIndex returns 2 for tutorial_step_2_seen", () => {
  assert.equal(getOnboardingFunnelStageIndex("tutorial_step_2_seen"), 2);
});

test("getOnboardingFunnelStageIndex returns 3 for tutorial_step_3_seen", () => {
  assert.equal(getOnboardingFunnelStageIndex("tutorial_step_3_seen"), 3);
});

test("getOnboardingFunnelStageIndex returns 4 for onboarding_completed", () => {
  assert.equal(getOnboardingFunnelStageIndex("onboarding_completed"), 4);
});

test("ONBOARDING_FUNNEL_STAGES has exactly 5 entries", () => {
  assert.equal(ONBOARDING_FUNNEL_STAGES.length, 5);
});

test("all stage IDs are unique", () => {
  const ids = ONBOARDING_FUNNEL_STAGES.map((stage) => stage.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length);
});

test("stages are in ascending index order (0..4)", () => {
  for (let i = 0; i < ONBOARDING_FUNNEL_STAGES.length; i++) {
    const stageId = ONBOARDING_FUNNEL_STAGES[i].id as Parameters<typeof getOnboardingFunnelStageIndex>[0];
    assert.equal(getOnboardingFunnelStageIndex(stageId), i);
  }
});
