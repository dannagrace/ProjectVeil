import assert from "node:assert/strict";
import test from "node:test";
import { Label } from "cc";
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
    reporting: {
      open: false,
      available: false,
      targetLabel: null,
      status: null,
      submitting: false
    },
    surrendering: {
      open: false,
      available: false,
      targetLabel: null,
      status: null,
      submitting: false
    },
    sharing: {
      available: false
    },
    battlePassEnabled: true,
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
        sfxVolume: 100
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
    },
    worldFocus: null
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

test("VeilHudPanel dispatchPointerUp routes the inventory chrome button", () => {
  const { component, node } = createComponentHarness(VeilHudPanel, { name: "HudPanelRoot", width: 320, height: 720 });
  const state = createHudState();
  let opened = 0;

  component.configure({
    onToggleInventory: () => {
      opened += 1;
    }
  });
  component.render(state);

  const button = findNode(node, "HudInventory");
  assert.ok(button);
  const buttonCenter = toHudLocalPosition(node, button);
  const action = component.dispatchPointerUp(buttonCenter.x, buttonCenter.y);

  assert.equal(action, "inventory");
  assert.equal(opened, 1);
});

test("VeilHudPanel dispatchPointerUp routes the campaign chrome button", () => {
  const { component, node } = createComponentHarness(VeilHudPanel, { name: "HudPanelRoot", width: 320, height: 720 });
  const state = createHudState();
  let opened = 0;

  component.configure({
    onToggleCampaign: () => {
      opened += 1;
    }
  });
  component.render(state);

  const button = findNode(node, "HudCampaign");
  assert.ok(button);
  const buttonCenter = toHudLocalPosition(node, button);
  const action = component.dispatchPointerUp(buttonCenter.x, buttonCenter.y);

  assert.equal(action, "campaign");
  assert.equal(opened, 1);
});

test("VeilHudPanel shows the surrender action only when available and routes confirmation clicks", () => {
  const { component, node } = createComponentHarness(VeilHudPanel, { name: "HudPanelRoot", width: 320, height: 720 });
  const state = createHudState();
  state.surrendering = {
    open: true,
    available: true,
    targetLabel: "维恩 · player-2",
    status: "确认后将直接判负。",
    submitting: false
  };

  let confirmed = 0;
  component.configure({
    onToggleSurrender: () => undefined,
    onConfirmSurrender: () => {
      confirmed += 1;
    }
  });
  component.render(state);

  const surrenderButton = findNode(node, "HudSurrender");
  assert.ok(surrenderButton);
  assert.equal(surrenderButton.active, true);

  const confirmButton = findNode(node, "HudSurrenderConfirm");
  assert.ok(confirmButton);
  const confirmCenter = toHudLocalPosition(node, confirmButton);
  const action = component.dispatchPointerUp(confirmCenter.x, confirmCenter.y);

  assert.equal(action, "surrender-confirm");
  assert.equal(confirmed, 1);
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

test("VeilHudPanel renders equipment-adjusted hero totals and immediate session loot", () => {
  const { component, node } = createComponentHarness(VeilHudPanel, { name: "HudPanelRoot", width: 320, height: 720 });
  const state = createHudState();
  state.account.recentEventLog = [];
  state.update!.world.ownHeroes[0]!.name = "凯琳";
  state.update!.world.ownHeroes[0]!.loadout.equipment.armorId = "padded_gambeson";
  state.update!.world.ownHeroes[0]!.loadout.equipment.accessoryId = "scout_compass";
  state.update!.events = [
    {
      type: "hero.equipmentFound",
      heroId: "hero-1",
      battleId: "battle-1",
      battleKind: "neutral",
      equipmentId: "warden_aegis",
      equipmentName: "守誓圣铠",
      rarity: "epic",
      overflowed: true
    }
  ];

  component.render(state);

  const heroText = readLabelString(findNode(node, "HudHero"));
  const equipmentText = readLabelString(findNode(node, "HudEquipment"));

  assert.match(heroText, /攻 2  防 2  力 1  知 2/);
  assert.match(heroText, /生命上限 14 = 基础 12 装备 \+2/);
  assert.match(equipmentText, /战利品 最近 1 条/);
  assert.match(equipmentText, /凯琳 在战斗后发现了史诗装备 守誓圣铠，但背包已满，未能拾取。/);
});

test("VeilHudPanel renders a live turn timer label and flashes it red in the final 10 seconds", () => {
  const { component, node } = createComponentHarness(VeilHudPanel, { name: "HudPanelRoot", width: 320, height: 720 });
  const state = createHudState();
  state.update!.world.turnDeadlineAt = new Date(Date.now() + 9_500).toISOString();

  component.render(state);

  const timerNode = findNode(node, "HudTurnTimer");
  const timerLabel = timerNode?.getComponent(Label) ?? null;

  assert.ok(timerNode);
  assert.equal(timerNode.active, true);
  assert.match(readLabelString(timerNode), /^倒计时 0:(0\d|10)$/);
  assert.ok(timerLabel);
  assert.ok(timerLabel.color.r > timerLabel.color.g, "expected warning tint in the final 10 seconds");
});

test("VeilHudPanel recovers when the cached turn timer label loses its node reference", () => {
  const { component, node } = createComponentHarness(VeilHudPanel, { name: "HudPanelRoot", width: 320, height: 720 });
  const state = createHudState();
  state.update!.world.turnDeadlineAt = new Date(Date.now() + 30_000).toISOString();

  component.render(state);

  const cachedTimerLabel = (component as unknown as { turnTimerLabel: Label | null }).turnTimerLabel;
  assert.ok(cachedTimerLabel);
  (cachedTimerLabel as unknown as { node: null }).node = null;

  assert.doesNotThrow(() => component.update());
  const timerNode = findNode(node, "HudTurnTimer");
  assert.ok(timerNode);
  assert.equal(timerNode.active, true);
});

test("VeilHudPanel surfaces the current world focus ahead of lower-priority diagnostics", () => {
  const { component, node } = createComponentHarness(VeilHudPanel, { name: "HudPanelRoot", width: 320, height: 720 });
  const state = createHudState();
  state.worldFocus = {
    headline: "继续推进本日探索",
    detail: "你当前仍有 1 格可达，适合继续探索、靠近建筑或触发下一次遭遇。",
    badge: "推进",
    summaryLines: [
      "当前位置：草地 · 木材 5",
      "英雄状态：Katherine · 移动力 4/6 · 部队 11",
      "最近战斗：首战胜利"
    ]
  };
  state.triageSummaryLines = ["诊断摘要：这条信息应该排在焦点之后。"];

  component.render(state);

  const titleText = readLabelString(findNode(node, "HudTitle"));
  const statusText = readLabelString(findNode(node, "HudStatus"));
  const badgeText = readLabelString(findNode(node, "HudBadge-status"));

  assert.match(titleText, /当前焦点 · 继续推进本日探索/);
  assert.match(statusText, /焦点 继续推进本日探索/);
  assert.match(statusText, /当前位置：草地 · 木材 5/);
  assert.match(statusText, /诊断摘要：这条信息应该排在焦点之后。/);
  assert.equal(badgeText, "推进");
});

test("VeilHudPanel renames primary flow buttons to match the current gameplay context", () => {
  const { component, node } = createComponentHarness(VeilHudPanel, { name: "HudPanelRoot", width: 320, height: 720 });
  const state = createHudState();
  state.interaction = {
    title: "矿井管理",
    detail: "当前矿井可占领并开始按天结算收益。",
    actions: []
  };
  state.account.recentBattleReplays = [
    {
      id: "replay-1",
      roomId: "room-alpha",
      playerId: "player-1",
      battleId: "battle-1",
      battleKind: "neutral",
      playerCamp: "attacker",
      heroId: "hero-1",
      neutralArmyId: "neutral-1",
      startedAt: "2026-04-16T09:00:00.000Z",
      completedAt: "2026-04-16T09:01:00.000Z",
      initialState: {
        id: "battle-1",
        round: 1,
        lanes: 1,
        activeUnitId: null,
        turnOrder: [],
        units: {},
        environment: [],
        log: [],
        rng: {
          seed: 1001,
          cursor: 0
        }
      },
      steps: [],
      result: "attacker_victory"
    }
  ];

  component.render(state);

  assert.equal(readLabelString(findNode(node, "HudCampaign")), "处理当前点位后看主线");
  assert.equal(readLabelString(findNode(node, "HudDailyDungeon")), "切到今日地城");
  assert.equal(readLabelString(findNode(node, "HudBattlePass")), "查看成长目标");
  assert.equal(readLabelString(findNode(node, "HudAchievements")), "回看上一战");
});
