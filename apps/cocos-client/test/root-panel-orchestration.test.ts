import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceGameplayCampaignDialogueForRoot,
  describeCampaignErrorForRoot,
  openLobbyPvePanelForRoot,
  resolveSelectedGameplayCampaignMissionForRoot,
  syncGameplayCampaignSelectionForRoot,
  toggleGameplayBattlePassPanelForRoot
} from "../assets/scripts/root/panel-orchestration.ts";

function createCampaignState() {
  return {
    nextMissionId: "chapter1-ember-watch",
    missions: [
      {
        id: "chapter1-ember-watch",
        name: "余烬哨站",
        status: "available",
        objectives: [],
        introDialogue: [
          {
            id: "intro-1",
            text: "守住火线。"
          }
        ],
        outroDialogue: [
          {
            id: "outro-1",
            text: "哨站重新亮灯了。"
          }
        ]
      },
      {
        id: "chapter1-thornwall-road",
        name: "荆墙驿路",
        status: "locked",
        objectives: [],
        introDialogue: [],
        outroDialogue: []
      }
    ]
  };
}

test("describeCampaignErrorForRoot maps known campaign failures to player-facing copy", () => {
  assert.match(describeCampaignErrorForRoot(new Error("campaign_mission_locked")), /尚未解锁/);
  assert.match(describeCampaignErrorForRoot(new Error("campaign_mission_already_completed")), /已完成/);
  assert.match(describeCampaignErrorForRoot(new Error("cocos_request_failed:401:expired")), /重新登录正式账号/);
});

test("toggleGameplayBattlePassPanelForRoot closes sibling panels and snapshots season progress before refresh", async () => {
  let refreshCalls = 0;
  let renderCalls = 0;
  let announced: { title: string; detail: string } | null = null;
  const state = {
    lastUpdate: {
      featureFlags: {
        battle_pass_enabled: true
      }
    },
    lobbyAccountProfile: {
      seasonXp: 128,
      seasonPassTier: 4,
      seasonPassPremium: true,
      seasonPassClaimedTiers: [1, 2]
    },
    gameplayAccountReviewPanelOpen: true,
    gameplayBattlePassPanelOpen: false,
    gameplayDailyDungeonPanelOpen: true,
    gameplaySeasonalEventPanelOpen: true,
    gameplayCampaignPanelOpen: true,
    seasonProgress: null,
    seasonProgressStatus: "",
    announceGameplayPanelSwitch(title: string, detail: string) {
      announced = { title, detail };
    },
    renderView() {
      renderCalls += 1;
    },
    async refreshSeasonProgress() {
      refreshCalls += 1;
    }
  };

  await toggleGameplayBattlePassPanelForRoot(state);

  assert.equal(state.gameplayBattlePassPanelOpen, true);
  assert.equal(state.gameplayAccountReviewPanelOpen, false);
  assert.equal(state.gameplayDailyDungeonPanelOpen, false);
  assert.equal(state.gameplaySeasonalEventPanelOpen, false);
  assert.equal(state.gameplayCampaignPanelOpen, false);
  assert.deepEqual(state.seasonProgress, {
    battlePassEnabled: true,
    seasonXp: 128,
    seasonPassTier: 4,
    seasonPassPremium: true,
    seasonPassClaimedTiers: [1, 2]
  });
  assert.equal(refreshCalls, 1);
  assert.ok(renderCalls >= 1);
  assert.deepEqual(announced, {
    title: "成长目标",
    detail: "正在同步赛季通行证、长期成长与下一解锁目标。"
  });
});

test("openLobbyPvePanelForRoot blocks guest sessions with clear lobby copy", async () => {
  let renderCalls = 0;
  const state = {
    authMode: "guest",
    authToken: null,
    lobbyStatus: "",
    renderView() {
      renderCalls += 1;
    }
  };

  await openLobbyPvePanelForRoot(state, "campaign");

  assert.match(state.lobbyStatus, /正式账号会话/);
  assert.equal(renderCalls, 1);
});

test("syncGameplayCampaignSelectionForRoot and resolveSelectedGameplayCampaignMissionForRoot prefer the active mission", () => {
  const state = {
    gameplayCampaign: createCampaignState(),
    gameplayCampaignSelectedMissionId: "missing",
    gameplayCampaignActiveMissionId: "chapter1-ember-watch"
  };

  syncGameplayCampaignSelectionForRoot(state);

  assert.equal(state.gameplayCampaignSelectedMissionId, "chapter1-ember-watch");
  assert.equal(resolveSelectedGameplayCampaignMissionForRoot(state)?.id, "chapter1-ember-watch");
});

test("advanceGameplayCampaignDialogueForRoot acknowledges lines and clears intro or outro flows", async () => {
  const acknowledgements: Array<{ missionId: string; sequence: string; lineId: string }> = [];
  let renderCalls = 0;
  const state = {
    gameplayCampaign: createCampaignState(),
    gameplayCampaignDialogue: {
      missionId: "chapter1-ember-watch",
      sequence: "intro",
      lineIndex: 0
    },
    gameplayCampaignPanelOpen: true,
    gameplayCampaignStatus: "",
    gameplayCampaignActiveMissionId: "chapter1-ember-watch",
    gameplayCampaignSelectedMissionId: "chapter1-ember-watch",
    session: {
      async acknowledgeCampaignDialogue(missionId: string, sequence: string, lineId: string) {
        acknowledgements.push({ missionId, sequence, lineId });
      }
    },
    renderView() {
      renderCalls += 1;
    }
  };

  advanceGameplayCampaignDialogueForRoot(state);
  assert.equal(state.gameplayCampaignDialogue, null);
  assert.equal(state.gameplayCampaignPanelOpen, false);
  assert.match(String(state.gameplayCampaignStatus), /执行阶段|已开始/);

  state.gameplayCampaignDialogue = {
    missionId: "chapter1-ember-watch",
    sequence: "outro",
    lineIndex: 0
  };
  state.gameplayCampaignPanelOpen = true;
  state.gameplayCampaign.nextMissionId = "chapter1-thornwall-road";

  advanceGameplayCampaignDialogueForRoot(state);
  assert.equal(state.gameplayCampaignDialogue, null);
  assert.equal(state.gameplayCampaignActiveMissionId, null);
  assert.equal(state.gameplayCampaignSelectedMissionId, "chapter1-thornwall-road");
  assert.match(String(state.gameplayCampaignStatus), /已完成并结算/);
  assert.equal(renderCalls, 2);
  assert.deepEqual(acknowledgements, [
    {
      missionId: "chapter1-ember-watch",
      sequence: "intro",
      lineId: "intro-1"
    },
    {
      missionId: "chapter1-ember-watch",
      sequence: "outro",
      lineId: "outro-1"
    }
  ]);
});
