import assert from "node:assert/strict";
import test from "node:test";
import { VeilCampaignPanel } from "../assets/scripts/VeilCampaignPanel.ts";
import type { CocosCampaignPanelInput } from "../assets/scripts/cocos-campaign-panel.ts";
import type { CocosCampaignSummary } from "../assets/scripts/cocos-lobby.ts";
import { createComponentHarness, findNode, pressNode, readCardLabel } from "./helpers/cocos-panel-harness.ts";

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
          gems: 25
        },
        introDialogue: [
          {
            id: "intro-1",
            speakerId: "captain",
            speakerName: "守望队长",
            text: "先把火线稳住。"
          }
        ],
        outroDialogue: [],
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

test("VeilCampaignPanel renders campaign cards and routes enabled mission actions", () => {
  const { component, node } = createComponentHarness(VeilCampaignPanel, {
    name: "CampaignPanelRoot",
    width: 460,
    height: 560
  });
  const state = createInput();
  let started = 0;
  let closed = 0;

  component.configure({
    onStartMission: () => {
      started += 1;
    },
    onClose: () => {
      closed += 1;
    }
  });
  component.render(state);

  assert.match(readCardLabel(node, "CampaignPanelHeader"), /战役任务/);
  assert.match(readCardLabel(node, "CampaignPanelMission"), /余烬哨站 · 可进行/);
  assert.match(readCardLabel(node, "CampaignPanelObjectives"), /守住南门两回合/);
  assert.match(readCardLabel(node, "CampaignPanelReward"), /宝石 \+25/);
  assert.match(readCardLabel(node, "CampaignPanelStatus"), /战役面板已就绪/);

  pressNode(findNode(node, "CampaignPanelAction-start"));
  pressNode(findNode(node, "CampaignPanelAction-close"));

  assert.equal(started, 1);
  assert.equal(closed, 1);
});

test("VeilCampaignPanel disables unavailable actions after mission start and keeps dialogue/status cards in sync", () => {
  const { component, node } = createComponentHarness(VeilCampaignPanel, {
    name: "CampaignPanelRoot",
    width: 460,
    height: 560
  });
  const state = createInput();
  state.activeMissionId = "chapter1-ember-watch";
  state.dialogue = {
    missionId: "chapter1-ember-watch",
    sequence: "intro",
    lineIndex: 0
  };

  let started = 0;
  let advanced = 0;
  component.configure({
    onStartMission: () => {
      started += 1;
    },
    onAdvanceDialogue: () => {
      advanced += 1;
    }
  });
  component.render(state);

  assert.match(readCardLabel(node, "CampaignPanelDialogue"), /开场对话 1\/1/);
  assert.match(readCardLabel(node, "CampaignPanelStatus"), /任务序号 1\/2/);

  pressNode(findNode(node, "CampaignPanelAction-start"));
  pressNode(findNode(node, "CampaignPanelAction-advance-dialogue"));

  assert.equal(started, 0);
  assert.equal(advanced, 1);
});
