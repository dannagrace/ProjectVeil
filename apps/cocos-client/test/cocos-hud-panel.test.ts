import assert from "node:assert/strict";
import test from "node:test";
import { VeilHudPanel, type VeilHudRenderState } from "../assets/scripts/VeilHudPanel.ts";
import { createLobbyPanelTestAccount } from "../assets/scripts/cocos-lobby-panel-model.ts";
import { createComponentHarness, findNode, readLabelString } from "./helpers/cocos-panel-harness.ts";
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
    sessionIndicators: [],
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

test("VeilHudPanel surfaces reconnect, replay, resync, and degraded session indicators in the status card", () => {
  const { component, node } = createComponentHarness(VeilHudPanel, { name: "HudPanelRoot", width: 320, height: 720 });
  const state = createHudState();
  state.sessionIndicators = [
    {
      kind: "reconnecting",
      label: "重连中",
      detail: "正在尝试恢复与权威房间的连接。"
    },
    {
      kind: "replaying_cached_snapshot",
      label: "缓存快照回放",
      detail: "当前 HUD 正在展示本地缓存的上一份会话快照。"
    },
    {
      kind: "awaiting_authoritative_resync",
      label: "等待权威重同步",
      detail: "请等待服务端权威快照覆盖当前回放状态。"
    },
    {
      kind: "degraded_offline_fallback",
      label: "降级/离线回退",
      detail: "最近一次重连失败，客户端正依赖回退路径维持会话。"
    }
  ];

  component.render(state);

  const statusText = readLabelString(findNode(node, "HudStatus"));
  const badgeText = readLabelString(findNode(node, "HudBadge-status"));

  assert.match(statusText, /会话 重连中 · 正在尝试恢复与权威房间的连接。/);
  assert.match(statusText, /会话 缓存快照回放 · 当前 HUD 正在展示本地缓存的上一份会话快照。/);
  assert.match(statusText, /会话 等待权威重同步 · 请等待服务端权威快照覆盖当前回放状态。/);
  assert.match(statusText, /会话 降级\/离线回退 · 最近一次重连失败，客户端正依赖回退路径维持会话。/);
  assert.equal(badgeText, "重连中");
});
