import assert from "node:assert/strict";
import test from "node:test";
import { buildHudPanelViewModel, type VeilHudRenderState } from "../assets/scripts/cocos-hud-panel-model.ts";
import { createLobbyPanelTestAccount } from "../assets/scripts/cocos-lobby-panel-model.ts";
import { createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";

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
    reporting: {
      open: false,
      available: false,
      targetLabel: null,
      status: null,
      submitting: false,
    },
    surrendering: {
      open: false,
      available: false,
      targetLabel: null,
      status: null,
      submitting: false,
    },
    sharing: {
      available: false,
    },
    battlePassEnabled: true,
    seasonalEventAvailable: false,
    interaction: null,
    presentation: {
      audio: {
        supported: false,
        assetBacked: false,
        unlocked: false,
        currentScene: null,
        lastCue: null,
        cueCount: 0,
        musicMode: "idle",
        cueMode: "idle",
        bgmVolume: 100,
        sfxVolume: 100,
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
        exceededHardLimit: false,
      },
      readiness: {
        summary: "等待表现资源",
        nextStep: "等待资源包",
        pixel: {
          label: "像素",
          stage: "placeholder",
          headline: "像素占位资源",
          detail: "待补全",
          shortLabel: "像素 占位",
        },
        audio: {
          label: "音频",
          stage: "placeholder",
          headline: "音频占位资源",
          detail: "待补全",
          shortLabel: "音频 占位",
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
            spine: 0,
          },
        },
      },
    },
    worldFocus: null,
  };
}

test("buildHudPanelViewModel foregrounds the current focus, status summary, and hero progression", () => {
  const state = createHudState();
  state.worldFocus = {
    headline: "继续推进本日探索",
    detail: "你当前仍有 1 格可达，适合继续探索、靠近建筑或触发下一次遭遇。",
    badge: "推进",
    summaryLines: [
      "当前位置：草地 · 木材 5",
      "英雄状态：暮潮守望 · 移动力 6/8 · 部队 12",
    ],
  };
  state.sessionIndicators = [
    {
      kind: "reconnecting",
      label: "重连中",
      detail: "正在尝试恢复与权威房间的连接。",
    },
  ];

  const view = buildHudPanelViewModel(state);

  assert.equal(view.hero?.name, "暮潮守望");
  assert.equal(view.statusBadge, "推进");
  assert.match(view.titleLines.join("\n"), /当前焦点 · 继续推进本日探索/);
  assert.match(view.statusLines.join("\n"), /焦点 继续推进本日探索/);
  assert.match(view.statusLines.join("\n"), /会话 重连中 · 正在尝试恢复与权威房间的连接。/);
  assert.match(view.heroLines.join("\n"), /等级 1/);
});
