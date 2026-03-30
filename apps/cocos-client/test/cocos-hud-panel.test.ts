import assert from "node:assert/strict";
import test from "node:test";
import { VeilHudPanel, type VeilHudRenderState } from "../assets/scripts/VeilHudPanel.ts";
import { createLobbyPanelTestAccount } from "../assets/scripts/cocos-lobby-panel-model.ts";
import { createComponentHarness, findNode } from "./helpers/cocos-panel-harness.ts";
import { createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";

function toHudLocalPosition(root: { name: string }, node: { position: { x: number; y: number }; parent: unknown | null }): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current: { position: { x: number; y: number }; parent: unknown | null } | null = node;
  while (current && current !== root) {
    x += current.position.x;
    y += current.position.y;
    current = current.parent as typeof current;
  }
  return { x, y };
}

function createHudState(): VeilHudRenderState {
  return {
    roomId: "room-alpha",
    playerId: "player-1",
    displayName: "暮潮守望",
    account: createLobbyPanelTestAccount(),
    authMode: "guest",
    loginId: "",
    sessionSource: "local",
    remoteUrl: "http://127.0.0.1:2567",
    update: createSessionUpdate(),
    moveInFlight: false,
    predictionStatus: "",
    inputDebug: "",
    runtimeHealth: "运行稳定",
    triageSummaryLines: [],
    levelUpNotice: null,
    achievementNotice: null,
    presentation: {
      audio: {
        supported: false,
        assetBacked: false,
        unlocked: false,
        currentScene: null,
        lastCue: null,
        cueCount: 0,
        musicMode: "idle",
        cueMode: "idle"
      },
      pixelAssets: {
        phase: "idle",
        pendingGroups: [],
        loadedGroups: [],
        loadedResourceCount: 0,
        totalResourceCount: 0,
        loadDurationMs: null,
        targetMs: 400,
        hardLimitMs: 900,
        exceededTarget: false,
        exceededHardLimit: false
      },
      readiness: {
        summary: "等待表现资源",
        nextStep: "等待资源包",
        pixel: {
          label: "像素",
          stage: "placeholder",
          headline: "像素占位资源",
          detail: "待补全",
          shortLabel: "像素 占位"
        },
        audio: {
          label: "音频",
          stage: "placeholder",
          headline: "音频占位资源",
          detail: "待补全",
          shortLabel: "音频 占位"
        },
        animation: {
          label: "动画",
          stage: "placeholder",
          headline: "动画占位资源",
          detail: "待补全",
          shortLabel: "动画 占位",
          deliveryModes: {
            fallback: 1,
            clip: 0,
            spine: 0
          }
        }
      }
    }
  };
}

test("VeilHudPanel dispatchPointerUp routes equipment button presses through the rendered inventory controls", () => {
  const { component, node } = createComponentHarness(VeilHudPanel, { name: "HudPanelRoot", width: 320, height: 720 });
  const state = createHudState();
  state.update!.world.ownHeroes[0]!.loadout.inventory = ["militia_pike"];

  let equipped: { slot: string; equipmentId: string } | null = null;
  component.configure({
    onEquipItem: (slot, equipmentId) => {
      equipped = { slot, equipmentId };
    }
  });
  component.render(state);

  const button = findNode(node, "HudEquipButton-weapon-militia_pike");
  assert.ok(button);
  const buttonCenter = toHudLocalPosition(node, button);
  const action = component.dispatchPointerUp(buttonCenter.x, buttonCenter.y);

  assert.equal(action, "HudEquipButton-weapon-militia_pike");
  assert.deepEqual(equipped, {
    slot: "weapon",
    equipmentId: "militia_pike"
  });
});
