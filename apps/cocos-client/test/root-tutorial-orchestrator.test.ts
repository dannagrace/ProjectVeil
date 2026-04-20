import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTutorialOverlayViewForRoot,
  resolveTutorialCampaignGuidanceForRoot
} from "../assets/scripts/root/tutorial-orchestrator.ts";

function createMission(overrides: Partial<any> = {}) {
  return {
    id: "chapter-1-scout",
    chapterId: "chapter-1",
    name: "首章·侦察前线",
    description: "向前线推进并清理第一支守军。",
    status: "available",
    objectives: [
      { id: "obj-1", description: "抵达前哨" },
      { id: "obj-2", description: "击败守军" }
    ],
    rewards: [],
    dialogue: [],
    ...overrides
  };
}

test("resolveTutorialCampaignGuidanceForRoot marks the next available mission", () => {
  const mission = createMission();
  const guidance = resolveTutorialCampaignGuidanceForRoot({
    gameplayCampaign: {
      chapterId: "chapter-1",
      chapterName: "第一章",
      chapterDescription: "首章",
      missions: [mission],
      nextMissionId: mission.id
    },
    gameplayCampaignSelectedMissionId: null,
    gameplayCampaignActiveMissionId: null
  });

  assert.equal(guidance.mission?.id, mission.id);
  assert.equal(guidance.phaseLabel, "下一主线");
  assert.deepEqual(guidance.objectivePreview, ["抵达前哨", "击败守军"]);
});

test("buildTutorialOverlayViewForRoot turns the last tutorial step into a campaign handoff", () => {
  const mission = createMission();
  const overlay = buildTutorialOverlayViewForRoot({
    lobbyAccountProfile: {
      tutorialStep: 3
    },
    sessionSource: "remote",
    showLobby: false,
    tutorialProgressInFlight: false,
    gameplayCampaign: {
      chapterId: "chapter-1",
      chapterName: "第一章",
      chapterDescription: "首章",
      missions: [mission],
      nextMissionId: mission.id
    },
    gameplayCampaignSelectedMissionId: null,
    gameplayCampaignActiveMissionId: null
  });

  assert.equal(overlay?.badge, "首章接管");
  assert.equal(overlay?.primaryLabel, "进入首章主线");
  assert.match(overlay?.body ?? "", /首章任务 首章·侦察前线/);
  assert.match((overlay?.detailLines ?? []).join(" "), /引导结束后每日任务与活动奖励会恢复正常曝光/);
});
