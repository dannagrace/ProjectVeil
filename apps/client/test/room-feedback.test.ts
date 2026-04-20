import assert from "node:assert/strict";
import test from "node:test";
import type { BattleState, MovementPlan, PlayerWorldView } from "@veil/shared/models";
import type { SessionUpdate } from "../src/local-session";
import {
  renderEncounterSourceDetail,
  renderRecoverySummary,
  renderRoomActionHint,
  renderRoomResultSummary,
  resolveRecoveryRoomStateLabel,
  resolveRoomFeedbackTone
} from "../src/room-feedback";

type EncounterStartedEvent = Extract<SessionUpdate["events"][number], { type: "battle.started" }>;

function createWorld(): PlayerWorldView {
  return {
    meta: {
      roomId: "room-alpha",
      seed: 1001,
      day: 3
    },
    map: {
      width: 1,
      height: 1,
      tiles: []
    },
    ownHeroes: [
      {
        id: "hero-1",
        playerId: "player-1",
        name: "Katherine",
        position: { x: 0, y: 0 },
        vision: 4,
        move: {
          total: 6,
          remaining: 4
        },
        stats: {
          attack: 2,
          defense: 2,
          power: 1,
          knowledge: 1,
          hp: 30,
          maxHp: 30
        },
        progression: {
          level: 1,
          experience: 0,
          skillPoints: 0,
          battlesWon: 0,
          neutralBattlesWon: 0,
          pvpBattlesWon: 0
        },
        armyCount: 12,
        armyTemplateId: "hero_guard_basic",
        learnedSkills: []
      }
    ],
    visibleHeroes: [],
    resources: {
      gold: 0,
      wood: 0,
      ore: 0
    },
    playerId: "player-1"
  };
}

function createBattle(): BattleState {
  return {
    id: "battle-1",
    round: 1,
    lanes: 1,
    activeUnitId: "hero-1-stack",
    turnOrder: ["hero-1-stack"],
    units: {
      "hero-1-stack": {
        id: "hero-1-stack",
        templateId: "hero_guard_basic",
        camp: "attacker",
        lane: 0,
        stackName: "Guard",
        initiative: 7,
        attack: 4,
        defense: 4,
        minDamage: 1,
        maxDamage: 2,
        count: 12,
        currentHp: 10,
        maxHp: 10,
        hasRetaliated: false,
        defending: false,
        skills: [],
        statusEffects: []
      }
    },
    environment: [],
    log: [],
    rng: {
      seed: 1,
      cursor: 0
    },
    defenderHeroId: "hero-2"
  };
}

function createEncounterStartedEvent(
  overrides: Partial<EncounterStartedEvent> = {}
): EncounterStartedEvent {
  return {
    type: "battle.started",
    battleId: "battle-1",
    battleKind: "hero",
    encounterKind: "hero",
    heroId: "hero-1",
    defenderHeroId: "hero-2",
    initiator: "hero",
    ...overrides
  };
}

function createPreviewPlan(overrides: Partial<MovementPlan> = {}): MovementPlan {
  return {
    heroId: "hero-1",
    destination: { x: 1, y: 0 },
    travelPath: [
      { x: 0, y: 0 },
      { x: 1, y: 0 }
    ],
    remainingMovement: 3,
    endsInEncounter: false,
    encounterKind: "neutral",
    encounterRefId: null,
    ...overrides
  };
}

function createEncounterSourceInput() {
  return {
    battle: null,
    lastEncounterStarted: null,
    world: createWorld(),
    previewPlan: null,
    lastBattleSettlement: null,
    diagnostics: {
      connectionStatus: "connected" as const
    },
    predictionStatus: ""
  };
}

test("renderEncounterSourceDetail covers active hero encounter initiative branches", () => {
  const activeBattle = createBattle();

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      battle: activeBattle,
      lastEncounterStarted: createEncounterStartedEvent()
    }),
    "遭遇来源：我方英雄先手接触敌方英雄，当前房间已切到 PVP 多人遭遇链路；对手身份、当前回合与房间归属现在统一挂到遭遇会话 room-alpha/battle-1。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      battle: activeBattle,
      lastEncounterStarted: createEncounterStartedEvent({
        heroId: "hero-2",
        defenderHeroId: "hero-1"
      })
    }),
    "遭遇来源：敌方英雄先手接触我方，当前房间已切到 PVP 多人遭遇链路；对手身份、当前回合与房间归属现在统一挂到遭遇会话 room-alpha/battle-1。"
  );
});

test("renderEncounterSourceDetail covers active neutral encounter initiator branches", () => {
  const activeBattle = createBattle();

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      battle: activeBattle,
      lastEncounterStarted: createEncounterStartedEvent({
        battleKind: "neutral",
        encounterKind: "neutral",
        neutralArmyId: "neutral-1",
        initiator: "neutral"
      })
    }),
    "遭遇来源：中立守军主动拦截，当前房间已切到遭遇战链路，战斗会话 battle-1 已建立。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      battle: activeBattle,
      lastEncounterStarted: createEncounterStartedEvent({
        battleKind: "neutral",
        encounterKind: "neutral",
        neutralArmyId: "neutral-1",
        initiator: "hero"
      })
    }),
    "遭遇来源：我方接触了中立守军，当前房间已切到遭遇战链路，战斗会话 battle-1 已建立。"
  );
});

test("renderEncounterSourceDetail covers preview, settlement, reconnect, and replay branches", () => {
  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      previewPlan: createPreviewPlan({
        endsInEncounter: true,
        encounterKind: "hero",
        encounterRefId: "hero-2"
      })
    }),
    "遭遇提示：确认移动后会立刻接敌，并锁定到 PVP 英雄遭遇战；进入后会先展示对手摘要与战斗会话。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      previewPlan: createPreviewPlan({
        endsInEncounter: true,
        encounterKind: "neutral",
        encounterRefId: "neutral-1"
      })
    }),
    "遭遇提示：确认移动后会立刻接敌，并锁定到 PVE 中立遭遇战。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      lastBattleSettlement: {
        aftermath: "已结算"
      }
    }),
    "战后反馈：本场结果已结算并回写到房间地图；可结合最近战斗会话、房间态和对手摘要继续移动、推进回合或等待对手。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      battle: createBattle(),
      diagnostics: {
        connectionStatus: "reconnecting"
      }
    }),
    "连接反馈：PVP 遭遇 room-alpha/battle-1 已中断，正在恢复对手归属、当前回合与房间主状态；恢复前请以权威状态为准。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      battle: createBattle(),
      diagnostics: {
        connectionStatus: "reconnect_failed"
      }
    }),
    "连接反馈：PVP 遭遇恢复失败，本场遭遇已转入快照回补；正在回补当前胜负、回合归属和房间状态，短暂期间可能只显示缓存状态。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      predictionStatus: "已回放本地缓存状态，等待服务端确认。"
    }),
    "连接反馈：已回放本地缓存状态，等待服务端确认。"
  );
});

test("renderRoomActionHint covers recovery, battle active, and missing hero states", () => {
  assert.equal(
    renderRoomActionHint({
      battle: createBattle(),
      lastBattleSettlement: null,
      activeHero: {
        move: {
          total: 6,
          remaining: 4
        }
      },
      diagnostics: {
        connectionStatus: "reconnecting"
      },
      predictionStatus: ""
    }),
    "下一步：等待 PVP 遭遇恢复完成；此时先不要依赖本地预览判断胜负或当前回合归属。"
  );

  assert.equal(
    renderRoomActionHint({
      battle: createBattle(),
      lastBattleSettlement: null,
      activeHero: {
        move: {
          total: 6,
          remaining: 4
        }
      },
      diagnostics: {
        connectionStatus: "reconnect_failed"
      },
      predictionStatus: ""
    }),
    "下一步：等待权威房间状态回补；恢复完成后再确认胜负、当前回合与是否还能继续移动。"
  );

  assert.equal(
    renderRoomActionHint({
      battle: createBattle(),
      lastBattleSettlement: null,
      activeHero: {
        move: {
          total: 6,
          remaining: 4
        }
      },
      diagnostics: {
        connectionStatus: "connected"
      },
      predictionStatus: ""
    }),
    "下一步：继续完成当前回合内操作，等待本场对抗结算。"
  );

  assert.equal(
    renderRoomActionHint({
      battle: null,
      lastBattleSettlement: null,
      activeHero: null,
      diagnostics: {
        connectionStatus: "connected"
      },
      predictionStatus: ""
    }),
    "下一步：等待房间首帧同步完成。"
  );
});

test("renderRoomActionHint covers settlement and exploration move branches", () => {
  assert.equal(
    renderRoomActionHint({
      battle: null,
      lastBattleSettlement: {
        aftermath: "已结算"
      },
      activeHero: {
        move: {
          total: 6,
          remaining: 2
        }
      },
      diagnostics: {
        connectionStatus: "connected"
      },
      predictionStatus: ""
    }),
    "下一步：当前英雄仍可继续移动、交互，或直接推进到下一天。"
  );

  assert.equal(
    renderRoomActionHint({
      battle: null,
      lastBattleSettlement: {
        aftermath: "已结算"
      },
      activeHero: {
        move: {
          total: 6,
          remaining: 0
        }
      },
      diagnostics: {
        connectionStatus: "connected"
      },
      predictionStatus: ""
    }),
    "下一步：当前英雄移动力已耗尽，可等待其他玩家推进房间或直接结束当天。"
  );

  assert.equal(
    renderRoomActionHint({
      battle: null,
      lastBattleSettlement: null,
      activeHero: {
        move: {
          total: 6,
          remaining: 3
        }
      },
      diagnostics: {
        connectionStatus: "connected"
      },
      predictionStatus: ""
    }),
    "下一步：选择地图格继续探索；若接敌，将自动切入对抗。"
  );

  assert.equal(
    renderRoomActionHint({
      battle: null,
      lastBattleSettlement: null,
      activeHero: {
        move: {
          total: 6,
          remaining: 0
        }
      },
      diagnostics: {
        connectionStatus: "connected"
      },
      predictionStatus: ""
    }),
    "下一步：当前英雄今日已无移动力，可推进到下一天。"
  );
});

test("renderRecoverySummary covers reconnect, replay fallback, explicit recovery, and steady state branches", () => {
  assert.equal(
    renderRecoverySummary({
      battle: createBattle(),
      lastBattleSettlement: null,
      diagnostics: {
        connectionStatus: "reconnecting"
      },
      predictionStatus: ""
    }),
    "恢复状态：正在重新加入已中断的 PVP 遭遇，并校正对手归属、当前回合与房间状态；结果请以恢复后的权威状态为准。"
  );

  assert.equal(
    renderRecoverySummary({
      battle: createBattle(),
      lastBattleSettlement: { kind: "pvp", aftermath: "已结算" },
      diagnostics: {
        connectionStatus: "reconnect_failed"
      },
      predictionStatus: ""
    }),
    "恢复状态：PVP 遭遇已切换到失败恢复链路；当前先展示最近缓存，并等待快照回补最终胜负与房间态。"
  );

  assert.equal(
    renderRecoverySummary({
      battle: null,
      lastBattleSettlement: null,
      diagnostics: {
        connectionStatus: "connected",
        recoverySummary: "权威房间状态已恢复，战后结果与地图状态已经重新对齐。"
      },
      predictionStatus: ""
    }),
    "恢复状态：权威房间状态已恢复，战后结果与地图状态已经重新对齐。"
  );

  assert.equal(
    renderRecoverySummary({
      battle: null,
      lastBattleSettlement: {
        kind: "pvp",
        aftermath: "已结算"
      },
      diagnostics: {
        connectionStatus: "connected"
      },
      predictionStatus: ""
    }),
    "恢复状态：最近一场 PVP 遭遇的结算与地图房间态已经重新对齐。"
  );

  assert.equal(
    renderRecoverySummary({
      battle: null,
      lastBattleSettlement: null,
      diagnostics: {
        connectionStatus: "connected"
      },
      predictionStatus: ""
    }),
    "恢复状态：当前未触发重连补救，房间同步保持稳定。"
  );
});

test("resolveRecoveryRoomStateLabel distinguishes pending, fallback, and restored authority states", () => {
  assert.equal(
    resolveRecoveryRoomStateLabel({
      diagnostics: {
        connectionStatus: "reconnecting"
      },
      predictionStatus: ""
    }),
    "恢复中（等待权威同步）"
  );

  assert.equal(
    resolveRecoveryRoomStateLabel({
      diagnostics: {
        connectionStatus: "reconnect_failed"
      },
      predictionStatus: ""
    }),
    "快照回补中"
  );

  assert.equal(
    resolveRecoveryRoomStateLabel({
      diagnostics: {
        connectionStatus: "connected"
      },
      predictionStatus: "已回放本地缓存状态，正在等待房间同步..."
    }),
    "缓存已回放，等待校正"
  );

  assert.equal(
    resolveRecoveryRoomStateLabel({
      diagnostics: {
        connectionStatus: "connected",
        recoverySummary: "权威房间状态已恢复，战后结果与地图状态已经重新对齐。"
      },
      predictionStatus: ""
    }),
    "已恢复并完成校正"
  );

  assert.equal(
    resolveRecoveryRoomStateLabel({
      diagnostics: {
        connectionStatus: "connected"
      },
      predictionStatus: ""
    }),
    null
  );
});

test("renderRoomResultSummary prioritizes reconnect guidance over stale settlement copy and surfaces restored state", () => {
  assert.equal(
    renderRoomResultSummary({
      battle: createBattle(),
      lastBattleSettlement: {
        kind: "pvp",
        roomState: "房间已回到地图探索阶段。"
      },
      diagnostics: {
        connectionStatus: "reconnecting"
      },
      predictionStatus: "",
      roomId: "room-alpha"
    }),
    "房间结果：PVP 遭遇 room-alpha/battle-1 已中断，正在恢复连接；期间请以恢复后的权威胜负、回合归属和房间阶段为准。"
  );

  assert.equal(
    renderRoomResultSummary({
      battle: createBattle(),
      lastBattleSettlement: {
        kind: "pvp",
        roomState: "房间已回到地图探索阶段。"
      },
      diagnostics: {
        connectionStatus: "reconnect_failed"
      },
      predictionStatus: "",
      roomId: "room-alpha"
    }),
    "房间结果：PVP 遭遇 room-alpha/battle-1 已转入失败恢复，正在通过最近快照回补当前胜负、回合归属和房间状态。"
  );

  assert.equal(
    renderRoomResultSummary({
      battle: createBattle(),
      lastBattleSettlement: null,
      diagnostics: {
        connectionStatus: "connected",
        recoverySummary: "权威战斗状态已恢复，当前行动顺序与房间归属重新对齐。"
      },
      predictionStatus: "",
      roomId: "room-alpha"
    }),
    "房间结果：权威战斗状态已恢复，当前行动顺序与房间归属重新对齐；当前仍由 room-alpha/battle-1 驱动本场对抗。"
  );

  assert.equal(
    renderRoomResultSummary({
      battle: null,
      lastBattleSettlement: {
        kind: "pvp",
        roomState: "房间已回到地图探索阶段。"
      },
      diagnostics: {
        connectionStatus: "connected",
        recoverySummary: "权威房间状态已恢复，战后结果与地图状态已经重新对齐。"
      },
      predictionStatus: "",
      roomId: "room-alpha"
    }),
    "房间结果：权威房间状态已恢复，战后结果与地图状态已经重新对齐；当前 PVP结算已同步回写。"
  );
});

test("resolveRoomFeedbackTone covers settlement, battle, preview, reconnect failure, and stable states", () => {
  assert.equal(
    resolveRoomFeedbackTone({
      battle: null,
      previewPlan: null,
      lastBattleSettlement: { aftermath: "已结算", tone: "victory" },
      diagnostics: { connectionStatus: "connected" }
    }),
    "victory"
  );

  assert.equal(
    resolveRoomFeedbackTone({
      battle: null,
      previewPlan: null,
      lastBattleSettlement: { aftermath: "已结算", tone: "defeat" },
      diagnostics: { connectionStatus: "connected" }
    }),
    "defeat"
  );

  assert.equal(
    resolveRoomFeedbackTone({
      battle: createBattle(),
      previewPlan: null,
      lastBattleSettlement: null,
      diagnostics: { connectionStatus: "connected" }
    }),
    "action"
  );

  assert.equal(
    resolveRoomFeedbackTone({
      battle: null,
      previewPlan: createPreviewPlan({
        endsInEncounter: true,
        encounterKind: "hero",
        encounterRefId: "hero-2"
      }),
      lastBattleSettlement: null,
      diagnostics: { connectionStatus: "connected" }
    }),
    "skill"
  );

  assert.equal(
    resolveRoomFeedbackTone({
      battle: null,
      previewPlan: null,
      lastBattleSettlement: null,
      diagnostics: { connectionStatus: "reconnect_failed" }
    }),
    "hit"
  );

  assert.equal(
    resolveRoomFeedbackTone({
      battle: null,
      previewPlan: null,
      lastBattleSettlement: null,
      diagnostics: { connectionStatus: "connected" }
    }),
    "neutral"
  );
});
