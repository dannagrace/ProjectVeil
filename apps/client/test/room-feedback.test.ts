import assert from "node:assert/strict";
import test from "node:test";
import type { BattleState, MovementPlan, PlayerWorldView } from "../../../packages/shared/src/index";
import type { SessionUpdate } from "../src/local-session";
import { renderEncounterSourceDetail, renderRoomActionHint, resolveRoomFeedbackTone } from "../src/room-feedback";

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
    }
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
    opponentHeroId: "hero-2",
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
    "遭遇来源：我方主动接触敌方英雄并进入房间内对抗。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      battle: activeBattle,
      lastEncounterStarted: createEncounterStartedEvent({
        heroId: "hero-2",
        opponentHeroId: "hero-1"
      })
    }),
    "遭遇来源：敌方英雄先手接触我方并拉入对抗。"
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
    "遭遇来源：中立守军主动拦截，房间已切换到战斗结算链路。"
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
    "遭遇来源：我方接触了中立守军，房间已切换到战斗结算链路。"
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
    "遭遇提示：确认移动后会立即切入英雄对抗。"
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
    "遭遇提示：确认移动后会立即切入中立战斗。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      lastBattleSettlement: {
        aftermath: "已结算"
      }
    }),
    "战后反馈：房间权威状态已回写到地图，可直接继续联调后续房间动作。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      diagnostics: {
        connectionStatus: "reconnecting"
      }
    }),
    "连接反馈：房间连接中断，正在尝试恢复当前多人状态。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      diagnostics: {
        connectionStatus: "reconnect_failed"
      }
    }),
    "连接反馈：旧连接恢复失败，正在通过最近快照恢复房间。"
  );

  assert.equal(
    renderEncounterSourceDetail({
      ...createEncounterSourceInput(),
      predictionStatus: "已回放本地缓存状态，等待服务端确认。"
    }),
    "连接反馈：已回放本地缓存状态，等待服务端确认。"
  );
});

test("renderRoomActionHint covers battle active and missing hero states", () => {
  assert.equal(
    renderRoomActionHint({
      battle: createBattle(),
      lastBattleSettlement: null,
      activeHero: {
        move: {
          total: 6,
          remaining: 4
        }
      }
    }),
    "下一步：继续完成当前回合内操作，等待本场对抗结算。"
  );

  assert.equal(
    renderRoomActionHint({
      battle: null,
      lastBattleSettlement: null,
      activeHero: null
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
      }
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
      }
    }),
    "下一步：当前英雄移动力已耗尽，可推进到下一天或等待其他玩家。"
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
      }
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
      }
    }),
    "下一步：当前英雄今日已无移动力，可推进到下一天。"
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
