import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCocosCampaignPanelView,
  resolveCampaignPanelMission,
  type CocosCampaignPanelInput
} from "../assets/scripts/cocos-campaign-panel.ts";
import type { CocosCampaignSummary } from "../assets/scripts/cocos-lobby.ts";

function createCampaignSummary(): CocosCampaignSummary {
  return {
    completedCount: 0,
    totalMissions: 2,
    nextMissionId: "chapter1-ember-watch",
    completionPercent: 0,
    missions: [
      {
        id: "chapter1-ember-watch",
        missionId: "chapter1-ember-watch",
        chapterId: "chapter1",
        order: 1,
        mapId: "ember-watch",
        name: "余烬哨站",
        description: "夺回哨站并建立第一条补给线。",
        recommendedHeroLevel: 3,
        enemyArmyTemplateId: "orc_warrior",
        enemyArmyCount: 2,
        enemyStatMultiplier: 1,
        objectives: [
          {
            id: "hold-gate",
            description: "守住南门两回合",
            kind: "hold",
            gate: "start"
          }
        ],
        reward: {
          gems: 25,
          resources: {
            gold: 120,
            wood: 3,
            ore: 1
          }
        },
        introDialogue: [
          {
            id: "intro-1",
            speakerId: "captain",
            speakerName: "守望队长",
            text: "先把火线稳住。"
          }
        ],
        outroDialogue: [
          {
            id: "outro-1",
            speakerId: "captain",
            speakerName: "守望队长",
            text: "哨站重新亮灯了。"
          }
        ],
        attempts: 0,
        status: "available"
      },
      {
        id: "chapter1-thornwall-road",
        missionId: "chapter1-thornwall-road",
        chapterId: "chapter1",
        order: 2,
        mapId: "thornwall-road",
        name: "荆墙驿路",
        description: "打通商道。",
        recommendedHeroLevel: 4,
        enemyArmyTemplateId: "wolf_rider",
        enemyArmyCount: 2,
        enemyStatMultiplier: 1.05,
        objectives: [
          {
            id: "escort",
            description: "护送补给车",
            kind: "escort",
            gate: "end"
          }
        ],
        reward: {},
        attempts: 0,
        status: "locked",
        unlockRequirements: [
          {
            type: "mission_complete",
            description: "Complete 余烬哨站.",
            missionId: "chapter1-ember-watch",
            chapterId: "chapter1",
            satisfied: false
          }
        ]
      }
    ]
  };
}

function createInput(): CocosCampaignPanelInput {
  return {
    campaign: createCampaignSummary(),
    selectedMissionId: "chapter1-ember-watch",
    activeMissionId: null,
    dialogue: null,
    statusMessage: "战役面板已就绪。",
    loading: false,
    pendingAction: null
  };
}

test("resolveCampaignPanelMission prefers selected mission and falls back to next available", () => {
  const campaign = createCampaignSummary();

  assert.equal(resolveCampaignPanelMission(campaign, "chapter1-ember-watch", null)?.id, "chapter1-ember-watch");
  assert.equal(resolveCampaignPanelMission(campaign, "missing", null)?.id, "chapter1-ember-watch");
});

test("buildCocosCampaignPanelView exposes start action for an available mission before dialogue begins", () => {
  const view = buildCocosCampaignPanelView(createInput());

  assert.match(view.subtitle, /完成 0\/2/);
  assert.match(view.missionLines.join("\n"), /余烬哨站/);
  assert.deepEqual(
    view.actions.find((action) => action.id === "start"),
    {
      id: "start",
      label: "开始任务",
      enabled: true
    }
  );
  assert.equal(view.actions.find((action) => action.id === "complete")?.enabled, false);
});

test("buildCocosCampaignPanelView switches into dialogue mode while intro is active", () => {
  const input = createInput();
  input.activeMissionId = "chapter1-ember-watch";
  input.dialogue = {
    missionId: "chapter1-ember-watch",
    sequence: "intro",
    lineIndex: 0
  };

  const view = buildCocosCampaignPanelView(input);

  assert.match(view.dialogueLines.join("\n"), /守望队长/);
  assert.equal(view.actions.find((action) => action.id === "advance-dialogue")?.enabled, true);
  assert.equal(view.actions.find((action) => action.id === "start")?.enabled, false);
});

test("buildCocosCampaignPanelView exposes complete action once an active mission is out of dialogue", () => {
  const input = createInput();
  input.activeMissionId = "chapter1-ember-watch";

  const view = buildCocosCampaignPanelView(input);

  assert.equal(view.actions.find((action) => action.id === "complete")?.enabled, true);
  assert.match(view.rewardLines.join("\n"), /宝石 \+25/);
});
