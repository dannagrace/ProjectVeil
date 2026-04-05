import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { sys } from "cc";
import {
  buildCocosAccountReviewPage,
  createCocosAccountReviewState,
  transitionCocosAccountReviewState
} from "../assets/scripts/cocos-account-review.ts";
import { createCocosAudioRuntime } from "../assets/scripts/cocos-audio-runtime.ts";
import { cocosPresentationConfig } from "../assets/scripts/cocos-presentation-config.ts";
import {
  configureClientAnalyticsRuntimeDependencies,
  flushClientAnalyticsEventsForTest,
  resetClientAnalyticsRuntimeDependencies
} from "../assets/scripts/cocos-primary-client-telemetry.ts";
import { VeilRoot } from "../assets/scripts/VeilRoot.ts";
import { createMemoryStorage, createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";
import { createVeilRootHarness, installVeilRootRuntime, resetVeilRootRuntime } from "./helpers/veil-root-harness.ts";
import type { BattleAction, BattleState, SessionUpdate, VeilCocosSessionOptions } from "../assets/scripts/VeilCocosSession.ts";

afterEach(() => {
  resetVeilRootRuntime();
  resetClientAnalyticsRuntimeDependencies();
  (sys as unknown as { localStorage: Storage | null }).localStorage = null;
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createFirstBattleState(): BattleState {
  return {
    id: "battle-1",
    round: 1,
    lanes: 1,
    activeUnitId: "hero-1-stack",
    turnOrder: ["hero-1-stack", "neutral-1-stack"],
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
      },
      "neutral-1-stack": {
        id: "neutral-1-stack",
        templateId: "orc_warrior",
        camp: "defender",
        lane: 0,
        stackName: "Orc",
        initiative: 5,
        attack: 3,
        defense: 3,
        minDamage: 1,
        maxDamage: 3,
        count: 8,
        currentHp: 9,
        maxHp: 9,
        hasRetaliated: false,
        defending: false,
        skills: [],
        statusEffects: []
      }
    },
    environment: [],
    log: ["战斗开始"],
    rng: {
      seed: 1001,
      cursor: 0
    },
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1",
    encounterPosition: { x: 1, y: 0 }
  };
}

function createFirstBattleUpdate(): SessionUpdate {
  const update = createSessionUpdate(1);
  update.battle = createFirstBattleState();
  update.events = [
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      initiator: "hero",
      battleId: "battle-1",
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      moveCost: 1
    }
  ];
  update.world.ownHeroes[0]!.position = { x: 1, y: 0 };
  update.reachableTiles = [];
  return update;
}

function createReturnToWorldUpdate(): SessionUpdate {
  const update = createSessionUpdate(1);
  update.world.ownHeroes[0]!.position = { x: 1, y: 0 };
  update.world.ownHeroes[0]!.progression = {
    ...update.world.ownHeroes[0]!.progression,
    battlesWon: 1,
    neutralBattlesWon: 1,
    experience: 10
  };
  update.events = [
    {
      type: "battle.resolved",
      battleId: "battle-1",
      battleKind: "neutral",
      heroId: "hero-1",
      result: "attacker_victory",
      resourcesGained: {
        gold: 0,
        wood: 0,
        ore: 0
      },
      experienceGained: 10,
      skillPointsAwarded: 0
    }
  ];
  return update;
}

test("VeilRoot boots into lobby mode and triggers lobby bootstrap when no roomId is provided", async () => {
  const storage = createMemoryStorage();
  storage.setItem(
    "project-veil:auth-session",
    JSON.stringify({
      token: "account.token",
      playerId: "account-player",
      displayName: "暮潮守望",
      authMode: "account",
      provider: "account-password",
      loginId: "veil-ranger",
      source: "remote"
    })
  );
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  let bootstrapCalls = 0;
  root.syncLobbyBootstrap = async () => {
    bootstrapCalls += 1;
  };
  root.readLaunchSearch = () => "";

  root.hydrateLaunchIdentity();
  root.start();

  assert.equal(root.showLobby, true);
  assert.equal(root.autoConnect, false);
  assert.equal(root.playerId, "account-player");
  assert.equal(root.sessionSource, "remote");
  assert.match(String(root.lobbyStatus), /已恢复云端正式账号会话/);
  assert.equal(bootstrapCalls, 1);
});

test("VeilRoot wires the equipment loot loop through equip and unequip session updates", async () => {
  const root = createVeilRootHarness();
  const baseUpdate = createSessionUpdate(1, "room-equipment", "player-1");
  baseUpdate.world.ownHeroes[0]!.loadout.inventory = ["militia_pike"];
  const equippedUpdate = createSessionUpdate(1, "room-equipment", "player-1");
  equippedUpdate.world.ownHeroes[0]!.loadout.equipment.weaponId = "militia_pike";
  equippedUpdate.world.ownHeroes[0]!.loadout.inventory = [];
  const unequippedUpdate = createSessionUpdate(1, "room-equipment", "player-1");
  unequippedUpdate.world.ownHeroes[0]!.loadout.inventory = ["militia_pike"];

  const calls: Array<{ kind: "equip" | "unequip"; slot: string; equipmentId?: string }> = [];
  root.lastUpdate = baseUpdate;
  root.session = {
    async equipHeroItem(heroId, slot, equipmentId) {
      calls.push({ kind: "equip", slot, equipmentId });
      assert.equal(heroId, "hero-1");
      return equippedUpdate;
    },
    async unequipHeroItem(heroId, slot) {
      calls.push({ kind: "unequip", slot });
      assert.equal(heroId, "hero-1");
      return unequippedUpdate;
    }
  } as never;

  await root.equipHeroItem("weapon", "militia_pike");
  assert.equal(root.lastUpdate?.world.ownHeroes[0]?.loadout.equipment.weaponId, "militia_pike");
  assert.deepEqual(root.lastUpdate?.world.ownHeroes[0]?.loadout.inventory, []);

  await root.unequipHeroItem("weapon");
  assert.equal(root.lastUpdate?.world.ownHeroes[0]?.loadout.equipment.weaponId, undefined);
  assert.deepEqual(root.lastUpdate?.world.ownHeroes[0]?.loadout.inventory, ["militia_pike"]);
  assert.deepEqual(calls, [
    {
      kind: "equip",
      slot: "weapon",
      equipmentId: "militia_pike"
    },
    {
      kind: "unequip",
      slot: "weapon"
    }
  ]);
});

test("VeilRoot toggles a dedicated gameplay equipment panel from the HUD flow", () => {
  const root = createVeilRootHarness();

  assert.equal(root.gameplayEquipmentPanelOpen, false);
  root.toggleGameplayEquipmentPanel();
  assert.equal(root.gameplayEquipmentPanelOpen, true);
  root.toggleGameplayEquipmentPanel(false);
  assert.equal(root.gameplayEquipmentPanelOpen, false);
});

test("VeilRoot loads campaign state and advances the manual campaign dialogue/start/complete slice", async () => {
  const root = createVeilRootHarness();
  root.remoteUrl = "http://127.0.0.1:2567";
  root.playerId = "campaign-player";
  root.displayName = "余烬守望";
  root.authMode = "account";
  root.authProvider = "account-password";
  root.authToken = "signed.token";

  let campaign = {
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
        description: "夺回哨站。",
        recommendedHeroLevel: 3,
        enemyArmyTemplateId: "orc_warrior",
        enemyArmyCount: 2,
        enemyStatMultiplier: 1,
        objectives: [
          {
            id: "hold-gate",
            description: "守住大门",
            kind: "hold",
            gate: "start"
          }
        ],
        reward: {
          gems: 20
        },
        introDialogue: [
          {
            id: "intro-1",
            speakerId: "captain",
            speakerName: "守望队长",
            text: "守住火线。"
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

  let loadCalls = 0;
  installVeilRootRuntime({
    loadCampaignSummary: async () => {
      loadCalls += 1;
      return structuredClone(campaign);
    },
    startCampaignMission: async () => ({
      started: true,
      mission: structuredClone(campaign.missions[0]!)
    }),
    completeCampaignMission: async () => {
      campaign = {
        completedCount: 1,
        totalMissions: 2,
        nextMissionId: "chapter1-thornwall-road",
        completionPercent: 50,
        missions: [
          {
            ...structuredClone(campaign.missions[0]!),
            status: "completed",
            attempts: 1,
            completedAt: "2026-04-05T08:00:00.000Z"
          },
          {
            ...structuredClone(campaign.missions[1]!),
            status: "available",
            unlockRequirements: [
              {
                type: "mission_complete",
                description: "Complete 余烬哨站.",
                missionId: "chapter1-ember-watch",
                chapterId: "chapter1",
                satisfied: true
              }
            ]
          }
        ]
      };
      return {
        completed: true,
        mission: structuredClone(campaign.missions[0]!),
        reward: {
          gems: 20
        },
        campaign: structuredClone(campaign)
      };
    }
  });

  await root.toggleGameplayCampaignPanel(true);
  await flushMicrotasks();

  assert.equal(root.gameplayCampaignPanelOpen, true);
  assert.equal(root.gameplayCampaignSelectedMissionId, "chapter1-ember-watch");
  assert.equal(loadCalls, 1);

  await root.startGameplayCampaignMission();
  assert.equal(root.gameplayCampaignActiveMissionId, "chapter1-ember-watch");
  assert.deepEqual(root.gameplayCampaignDialogue, {
    missionId: "chapter1-ember-watch",
    sequence: "intro",
    lineIndex: 0
  });

  root.advanceGameplayCampaignDialogue();
  assert.equal(root.gameplayCampaignDialogue, null);
  assert.equal(root.gameplayCampaignPanelOpen, false);
  assert.match(String(root.gameplayCampaignStatus), /执行阶段|已开始/);

  await root.completeGameplayCampaignMission();
  assert.deepEqual(root.gameplayCampaignDialogue, {
    missionId: "chapter1-ember-watch",
    sequence: "outro",
    lineIndex: 0
  });
  assert.equal(root.gameplayCampaign?.nextMissionId, "chapter1-thornwall-road");

  root.advanceGameplayCampaignDialogue();
  assert.equal(root.gameplayCampaignActiveMissionId, null);
  assert.equal(root.gameplayCampaignSelectedMissionId, "chapter1-thornwall-road");
});

test("VeilRoot completes an active campaign mission from the owned battle result and reopens the panel", async () => {
  const root = createVeilRootHarness();
  root.remoteUrl = "http://127.0.0.1:2567";
  root.playerId = "campaign-player";
  root.displayName = "余烬守望";
  root.authMode = "account";
  root.authProvider = "account-password";
  root.authToken = "signed.token";
  delete root.applySessionUpdate;

  let campaign = {
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
        description: "夺回哨站。",
        recommendedHeroLevel: 3,
        enemyArmyTemplateId: "orc_warrior",
        enemyArmyCount: 2,
        enemyStatMultiplier: 1,
        objectives: [
          {
            id: "hold-gate",
            description: "守住大门",
            kind: "hold",
            gate: "start"
          }
        ],
        reward: {
          gems: 20
        },
        introDialogue: [
          {
            id: "intro-1",
            speakerId: "captain",
            speakerName: "守望队长",
            text: "守住火线。"
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

  let completionCalls = 0;
  installVeilRootRuntime({
    loadCampaignSummary: async () => structuredClone(campaign),
    startCampaignMission: async () => ({
      started: true,
      mission: structuredClone(campaign.missions[0]!)
    }),
    completeCampaignMission: async () => {
      completionCalls += 1;
      campaign = {
        completedCount: 1,
        totalMissions: 2,
        nextMissionId: "chapter1-thornwall-road",
        completionPercent: 50,
        missions: [
          {
            ...structuredClone(campaign.missions[0]!),
            status: "completed",
            attempts: 1,
            completedAt: "2026-04-05T08:00:00.000Z"
          },
          {
            ...structuredClone(campaign.missions[1]!),
            status: "available",
            unlockRequirements: [
              {
                type: "mission_complete",
                description: "Complete 余烬哨站.",
                missionId: "chapter1-ember-watch",
                chapterId: "chapter1",
                satisfied: true
              }
            ]
          }
        ]
      };
      return {
        completed: true,
        mission: structuredClone(campaign.missions[0]!),
        reward: {
          gems: 20
        },
        campaign: structuredClone(campaign)
      };
    }
  });

  await root.toggleGameplayCampaignPanel(true);
  await root.startGameplayCampaignMission();
  root.advanceGameplayCampaignDialogue();
  assert.equal(root.gameplayCampaignPanelOpen, false);

  await root.applySessionUpdate(createReturnToWorldUpdate());
  await flushMicrotasks();

  assert.equal(completionCalls, 1);
  assert.equal(root.gameplayCampaignPanelOpen, true);
  assert.equal(root.gameplayCampaign?.nextMissionId, "chapter1-thornwall-road");
  assert.deepEqual(root.gameplayCampaignDialogue, {
    missionId: "chapter1-ember-watch",
    sequence: "outro",
    lineIndex: 0
  });
});

test("VeilRoot settings logout routes through the auth revoke path", async () => {
  const storage = createMemoryStorage();
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  root.remoteUrl = "http://127.0.0.1:2567";
  root.playerId = "player-settings";
  root.displayName = "雾港旅人";
  root.authToken = "signed.token";
  root.authMode = "account";
  root.loginId = "veil-ranger";
  root.settingsView = {
    ...root.settingsView,
    open: true
  };

  const logoutCalls: Array<{ remoteUrl: string; hasStorage: boolean }> = [];
  installVeilRootRuntime({
    logoutAuthSession: async (remoteUrl, options) => {
      logoutCalls.push({
        remoteUrl,
        hasStorage: Boolean(options?.storage)
      });
    }
  });

  await root.handleSettingsLogout();

  assert.deepEqual(logoutCalls, [
    {
      remoteUrl: "http://127.0.0.1:2567",
      hasStorage: true
    }
  ]);
  assert.equal(root.authToken, null);
  assert.equal(root.authMode, "guest");
});

test("VeilRoot emits primary-client telemetry for progression, inventory, and combat checkpoints", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-telemetry";
  root.playerId = "player-1";
  root.displayName = "暮潮守望";
  delete root.applySessionUpdate;

  const baseUpdate = createSessionUpdate(2, "room-telemetry", "player-1");
  root.lastUpdate = {
    ...baseUpdate,
    battle: createFirstBattleState()
  };
  root.session = {} as never;

  await root.equipHeroItem("weapon", "militia_pike");

  installVeilRootRuntime({
    loadProgressionSnapshot: async () => ({
      summary: {
        totalAchievements: 3,
        unlockedAchievements: 1,
        inProgressAchievements: 2,
        recentEventCount: 1,
        latestEventAt: "2026-04-01T08:00:00.000Z"
      },
      achievements: [],
      recentEventLog: [
        {
          id: "event-1",
          timestamp: "2026-04-01T08:00:00.000Z",
          roomId: "room-telemetry",
          playerId: "player-1",
          category: "combat",
          description: "战斗开始。",
          rewards: []
        }
      ]
    })
  });

  await root.refreshProgressionReview();

  const update = createSessionUpdate(2, "room-telemetry", "player-1");
  update.events = [
    {
      type: "battle.started",
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      battleId: "battle-telemetry",
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      moveCost: 1
    },
    {
      type: "hero.progressed",
      heroId: "hero-1",
      battleId: "battle-telemetry",
      battleKind: "neutral",
      experienceGained: 25,
      totalExperience: 125,
      level: 2,
      levelsGained: 1,
      skillPointsAwarded: 1,
      availableSkillPoints: 1
    },
    {
      type: "hero.equipmentFound",
      heroId: "hero-1",
      battleId: "battle-telemetry",
      battleKind: "neutral",
      equipmentId: "militia_pike",
      equipmentName: "Militia Pike",
      rarity: "common",
      overflowed: true
    },
    {
      type: "battle.resolved",
      heroId: "hero-1",
      attackerPlayerId: "player-1",
      battleId: "battle-telemetry",
      result: "attacker_victory"
    }
  ];
  update.world.ownHeroes[0]!.loadout.inventory = ["travel_boots", "militia_pike"];

  await root.applySessionUpdate(update);

  assert.deepEqual(
    root.primaryClientTelemetry.map((entry: Record<string, unknown>) => entry.checkpoint).slice(0, 6),
    [
      "encounter.resolved",
      "loot.overflowed",
      "hero.progressed",
      "encounter.started",
      "review.loaded",
      "equipment.equip.rejected"
    ]
  );
  assert.equal(root.primaryClientTelemetry[0]?.result, "attacker_victory");
  assert.equal(root.primaryClientTelemetry[1]?.reason, undefined);
  assert.equal(root.primaryClientTelemetry[1]?.status, "blocked");
  assert.equal(root.primaryClientTelemetry[1]?.itemCount, 2);
  assert.equal(root.primaryClientTelemetry[4]?.status, "success");
  assert.equal(root.primaryClientTelemetry[5]?.reason, "in_battle");
});

test("VeilRoot batches client analytics across session and battle lifecycle hooks", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-analytics";
  root.playerId = "player-1";
  root.displayName = "暮潮守望";
  root.remoteUrl = "http://127.0.0.1:2567";
  root.authMode = "account";
  root.lastUpdate = createSessionUpdate(1, "room-analytics", "player-1");
  root.applySessionUpdate = VeilRoot.prototype["applySessionUpdate"].bind(root);

  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  configureClientAnalyticsRuntimeDependencies({
    getNodeEnv: () => "production",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return {
        ok: true,
        status: 202
      };
    }
  });

  installVeilRootRuntime({
    createSession: async () =>
      ({
        async snapshot() {
          return createSessionUpdate(2, "room-analytics", "player-1");
        },
        async dispose() {}
      }) as never
  });

  await root.connect();
  await root.applySessionUpdate(createFirstBattleUpdate());
  await root.applySessionUpdate(createReturnToWorldUpdate());
  await flushClientAnalyticsEventsForTest();

  assert.equal(fetchCalls.length, 1);
  const body = String(fetchCalls[0]?.init?.body);
  assert.match(body, /"name":"session_start"/);
  assert.match(body, /"name":"battle_start"/);
  assert.match(body, /"name":"battle_end"/);
  assert.match(body, /"platform":"wechat"/);
  assert.match(body, /"sessionId":"cocos-session-/);
});

test("VeilRoot emits shop, tutorial, quest, and experiment analytics once per session", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-analytics";
  root.playerId = "player-1";
  root.displayName = "暮潮守望";
  root.remoteUrl = "http://127.0.0.1:2567";
  root.authToken = "account.token";
  root.authMode = "account";
  root.showLobby = true;
  root.lobbyShopProducts = [
    {
      productId: "gem-pack-small",
      name: "Gem Pack Small",
      type: "gem_pack",
      price: 60,
      enabled: true,
      grant: {
        gems: 60
      }
    }
  ];

  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  configureClientAnalyticsRuntimeDependencies({
    getNodeEnv: () => "production",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return {
        ok: true,
        status: 202
      };
    }
  });

  installVeilRootRuntime({
    purchaseShopProduct: async () => ({
      purchaseId: "purchase-1",
      productId: "gem-pack-small",
      quantity: 1,
      unitPrice: 60,
      totalPrice: 60,
      granted: {
        gems: 60,
        resources: { gold: 0, wood: 0, ore: 0 },
        equipmentIds: [],
        cosmeticIds: []
      },
      gemsBalance: 120,
      processedAt: "2026-04-05T00:00:00.000Z"
    }),
    updateTutorialProgress: async () => ({
      ...root.lobbyAccountProfile,
      playerId: "player-1",
      displayName: "暮潮守望",
      source: "remote",
      tutorialStep: 2,
      recentBattleReplays: []
    })
  });

  root.maybeEmitShopOpenAnalytics();
  await root.purchaseLobbyShopProduct("gem-pack-small");
  root.commitAccountProfile(
    {
      ...root.lobbyAccountProfile,
      playerId: "player-1",
      displayName: "暮潮守望",
      lastRoomId: "room-analytics",
      dailyQuestBoard: {
        enabled: true,
        availableClaims: 1,
        pendingRewards: { gems: 10, gold: 50 },
        quests: [
          {
            id: "daily_explore_frontier",
            title: "Explore",
            description: "Explore frontier",
            current: 1,
            target: 1,
            completed: true,
            claimed: false,
            reward: { gems: 10, gold: 50 }
          }
        ]
      },
      experiments: [
        {
          experimentKey: "account_portal_copy",
          experimentName: "Account Portal Upgrade Copy",
          owner: "growth",
          bucket: 42,
          variant: "upgrade",
          fallbackVariant: "control",
          assigned: true,
          reason: "bucket"
        }
      ]
    },
    false
  );
  root.commitAccountProfile(
    {
      ...root.lobbyAccountProfile,
      playerId: "player-1",
      displayName: "暮潮守望",
      lastRoomId: "room-analytics",
      dailyQuestBoard: {
        enabled: true,
        availableClaims: 0,
        pendingRewards: { gems: 0, gold: 0 },
        quests: [
          {
            id: "daily_explore_frontier",
            title: "Explore",
            description: "Explore frontier",
            current: 1,
            target: 1,
            completed: true,
            claimed: true,
            reward: { gems: 10, gold: 50 }
          }
        ]
      },
      experiments: [
        {
          experimentKey: "account_portal_copy",
          experimentName: "Account Portal Upgrade Copy",
          owner: "growth",
          bucket: 42,
          variant: "upgrade",
          fallbackVariant: "control",
          assigned: true,
          reason: "bucket"
        }
      ]
    },
    false
  );
  root.lobbyAccountProfile = {
    ...root.lobbyAccountProfile,
    playerId: "player-1",
    displayName: "暮潮守望",
    source: "remote",
    tutorialStep: 1
  };
  await root.advanceTutorialFlow();
  await flushClientAnalyticsEventsForTest();

  const body = fetchCalls.map((call) => String(call.init?.body)).join("\n");
  assert.match(body, /"name":"shop_open"/);
  assert.match(body, /"name":"purchase_initiated"/);
  assert.match(body, /"name":"experiment_exposure"/);
  assert.match(body, /"name":"quest_complete"/);
  assert.match(body, /"name":"tutorial_step"/);
  assert.equal((body.match(/"name":"experiment_exposure"/g) ?? []).length, 1);
});

test("VeilRoot gameplay account refresh uses the injected loader for remote equipment and loot updates", async () => {
  const storage = createMemoryStorage();
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  root.remoteUrl = "http://127.0.0.1:2567";
  root.roomId = "room-equipment";
  root.playerId = "player-1";
  root.displayName = "暮潮守望";
  root.authMode = "account";
  root.authToken = "account.token";
  root.loginId = "veil-ranger";
  root.sessionSource = "remote";

  const calls: Array<{
    remoteUrl: string;
    playerId: string;
    roomId: string;
    authSession: { token: string; playerId: string; displayName: string; authMode: string; loginId?: string; source: string } | null;
  }> = [];
  installVeilRootRuntime({
    loadAccountProfile: async (remoteUrl, playerId, roomId, options) => {
      calls.push({
        remoteUrl,
        playerId,
        roomId,
        authSession: options?.authSession ?? null
      });
      return {
        ...root.lobbyAccountProfile,
        playerId,
        roomId,
        displayName: "暮潮守望",
        source: "remote",
        authMode: "account",
        loginId: "veil-ranger",
        recentEventLog: [
          {
            id: "loot-1",
            timestamp: "2026-04-01T12:00:00.000Z",
            roomId,
            playerId,
            category: "combat",
            description: "暮潮守望在战斗后获得了稀有装备 先锋战刃。",
            heroId: "hero-1",
            worldEventType: "hero.equipmentFound",
            rewards: []
          }
        ]
      };
    }
  });

  await root.refreshGameplayAccountProfile();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    remoteUrl: "http://127.0.0.1:2567",
    playerId: "player-1",
    roomId: "room-equipment",
    authSession: {
      token: "account.token",
      playerId: "player-1",
      displayName: "暮潮守望",
      authMode: "account",
      loginId: "veil-ranger",
      source: "remote"
    }
  });
  assert.equal(root.lobbyAccountProfile.recentEventLog[0]?.worldEventType, "hero.equipmentFound");
  assert.match(String(root.lobbyAccountProfile.recentEventLog[0]?.description), /先锋战刃/);
});

test("VeilRoot gameplay account refresh skips remote profile loads for local sessions", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-local";
  root.playerId = "player-local";
  root.displayName = "本地旅人";
  root.sessionSource = "local";

  let calls = 0;
  installVeilRootRuntime({
    loadAccountProfile: async () => {
      calls += 1;
      return root.lobbyAccountProfile;
    }
  });

  await root.refreshGameplayAccountProfile();

  assert.equal(calls, 0);
});

test("VeilRoot account lifecycle flow switches panels and surfaces validation feedback", async () => {
  const root = createVeilRootHarness();
  root.privacyConsentAccepted = true;

  await root.registerLobbyAccount();
  assert.equal(root.activeAccountFlow, "registration");
  assert.match(String(root.lobbyStatus), /已打开正式注册面板/);

  root.loginId = "A";
  await root.requestActiveAccountFlow();
  assert.equal(root.lobbyEntering, false);
  assert.equal(root.activeAccountFlow, "registration");
  assert.equal(root.lobbyStatus, "登录 ID 需为 3-40 位小写字母、数字、下划线或连字符。");

  root.loginId = "veil-ranger";
  root.registrationToken = "dev-registration-token";
  root.registrationPassword = "123";
  await root.confirmActiveAccountFlow();
  assert.equal(root.lobbyEntering, false);
  assert.equal(root.lobbyStatus, "注册口令至少 6 位。");

  root.closeLobbyAccountFlow();
  assert.equal(root.activeAccountFlow, null);
  assert.match(String(root.lobbyStatus), /已收起账号生命周期面板/);

  await root.recoverLobbyAccountPassword();
  assert.equal(root.activeAccountFlow, "recovery");
  root.loginId = "veil-ranger";
  root.recoveryToken = "";
  root.recoveryPassword = "hunter3";
  await root.confirmActiveAccountFlow();
  assert.equal(root.lobbyStatus, "请先申请并填写找回令牌。");
});

test("VeilRoot connect replays cached session state before applying the live snapshot", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-alpha";
  root.playerId = "player-1";
  root.remoteUrl = "http://127.0.0.1:2567";
  const replayedUpdate = createSessionUpdate(2);
  const liveUpdate = createSessionUpdate(3);
  const order: string[] = [];
  const fakeSession = {
    async snapshot() {
      return liveUpdate;
    },
    async dispose() {}
  };

  root.applyReplayedSessionUpdate = (update) => {
    order.push(`replay:${update.world.meta.day}`);
    root.lastUpdate = {
      ...update,
      events: [],
      movementPlan: null
    };
  };
  root.applySessionUpdate = async (update) => {
    order.push(`live:${update.world.meta.day}`);
    root.lastUpdate = update;
  };

  installVeilRootRuntime({
    readStoredReplay: () => replayedUpdate,
    createSession: async () => fakeSession as never
  });

  await root.connect();

  assert.deepEqual(order, ["replay:2", "live:3"]);
  assert.equal(root.session, fakeSession);
  assert.equal(root.lastUpdate?.world.meta.day, 3);
});

test("VeilRoot reconnects cleanly after tearing down the previous session", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-alpha";
  root.playerId = "player-1";
  const lifecycle: string[] = [];

  const firstUpdate = createSessionUpdate(2, "room-alpha", "player-1");
  const secondUpdate = createSessionUpdate(5, "room-alpha", "player-1");
  const firstSession = {
    async snapshot() {
      lifecycle.push("snapshot:first");
      return firstUpdate;
    },
    async dispose() {
      lifecycle.push("dispose:first");
    }
  };
  const secondSession = {
    async snapshot() {
      lifecycle.push("snapshot:second");
      return secondUpdate;
    },
    async dispose() {
      lifecycle.push("dispose:second");
    }
  };

  root.applySessionUpdate = async (update) => {
    lifecycle.push(`apply:${update.world.meta.day}`);
    root.lastUpdate = update;
  };

  installVeilRootRuntime({
    createSession: async () => firstSession as never
  });

  await root.connect();
  assert.equal(root.session, firstSession);
  assert.equal(root.lastUpdate?.world.meta.day, 2);

  await root.disposeCurrentSession();
  assert.equal(root.session, null);

  installVeilRootRuntime({
    createSession: async () => secondSession as never
  });

  await root.connect();

  assert.equal(root.session, secondSession);
  assert.equal(root.lastUpdate?.world.meta.day, 5);
  assert.deepEqual(lifecycle, ["snapshot:first", "apply:2", "dispose:first", "snapshot:second", "apply:5"]);
});

test("VeilRoot replays cached state before reconnect recovery converges on the authoritative snapshot", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-alpha";
  root.playerId = "player-1";
  root.remoteUrl = "http://127.0.0.1:2567";

  const replayedUpdate = createSessionUpdate(2);
  replayedUpdate.events = [
    {
      type: "battle.resolved",
      battleId: "battle-1",
      battleKind: "neutral",
      heroId: "hero-1",
      result: "attacker_victory",
      resourcesGained: {
        gold: 0,
        wood: 0,
        ore: 0
      },
      experienceGained: 10,
      skillPointsAwarded: 0
    }
  ];
  const liveUpdate = createSessionUpdate(3);
  const recoveredUpdate = createSessionUpdate(4);
  recoveredUpdate.events = [
    {
      type: "battle.resolved",
      battleId: "battle-1",
      battleKind: "neutral",
      heroId: "hero-1",
      result: "attacker_victory",
      resourcesGained: {
        gold: 0,
        wood: 0,
        ore: 0
      },
      experienceGained: 10,
      skillPointsAwarded: 0
    }
  ];

  const order: string[] = [];
  let capturedOptions:
    | {
        onPushUpdate?: ((update: SessionUpdate) => void) | undefined;
        onConnectionEvent?: ((event: "reconnecting" | "reconnected" | "reconnect_failed") => void) | undefined;
      }
    | undefined;

  const fakeSession = {
    async snapshot() {
      return liveUpdate;
    },
    async dispose() {}
  };

  root.applyReplayedSessionUpdate = (update) => {
    order.push(`replay:${update.world.meta.day}:events=${update.events.length}`);
    root.lastUpdate = {
      ...update,
      events: [],
      movementPlan: null
    };
  };
  root.applySessionUpdate = async (update) => {
    order.push(`live:${update.world.meta.day}:events=${update.events.length}`);
    root.lastUpdate = update;
  };

  installVeilRootRuntime({
    readStoredReplay: () => replayedUpdate,
    createSession: async (_roomId, _playerId, _seed, options) => {
      capturedOptions = options;
      return fakeSession as never;
    }
  });

  await root.connect();

  capturedOptions?.onConnectionEvent?.("reconnect_failed");
  capturedOptions?.onPushUpdate?.(recoveredUpdate);
  capturedOptions?.onConnectionEvent?.("reconnected");
  await flushMicrotasks();

  assert.deepEqual(order, ["replay:2:events=1", "live:3:events=0", "live:4:events=1"]);
  assert.equal(root.lastUpdate?.world.meta.day, 4);
  assert.deepEqual(root.lastUpdate?.events, recoveredUpdate.events);
  assert.equal(root.diagnosticsConnectionStatus, "connected");
  assert.equal(root.logLines[0], "连接已恢复。");
  assert.match(String(root.logLines[1]), /已收到房间推送更新。/);
});

test("VeilRoot ignores stale reconnect callbacks after session teardown", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-alpha";
  root.playerId = "player-1";
  root.lastUpdate = createSessionUpdate(1, "room-alpha", "player-1");

  const deferredSnapshot = createDeferred<SessionUpdate>();
  let capturedOptions:
    | {
        onPushUpdate?: ((update: SessionUpdate) => void) | undefined;
        onConnectionEvent?: ((event: "reconnecting" | "reconnected" | "reconnect_failed") => void) | undefined;
      }
    | undefined;
  let disposeCalls = 0;

  installVeilRootRuntime({
    createSession: async (_roomId, _playerId, _seed, options) => {
      capturedOptions = options;
      return {
        async snapshot() {
          return deferredSnapshot.promise;
        },
        async dispose() {
          disposeCalls += 1;
        }
      } as never;
    }
  });

  const connectPromise = root.connect();
  await flushMicrotasks();

  await root.disposeCurrentSession();
  const updateAfterTeardown = root.lastUpdate;
  const statusAfterTeardown = root.diagnosticsConnectionStatus;
  const logsAfterTeardown = [...root.logLines];

  capturedOptions?.onConnectionEvent?.("reconnect_failed");
  capturedOptions?.onPushUpdate?.(createSessionUpdate(9, "room-alpha", "player-1"));

  assert.equal(root.lastUpdate, updateAfterTeardown);
  assert.equal(root.diagnosticsConnectionStatus, statusAfterTeardown);
  assert.deepEqual(root.logLines, logsAfterTeardown);

  deferredSnapshot.resolve(createSessionUpdate(10, "room-alpha", "player-1"));
  await connectPromise;

  assert.equal(root.session, null);
  assert.ok(disposeCalls >= 1);
  assert.deepEqual(root.logLines, logsAfterTeardown);
});

test("VeilRoot surfaces broken room snapshots with a stable runtime error message", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-alpha";
  root.playerId = "player-1";
  root.remoteUrl = "http://127.0.0.1:2567";

  installVeilRootRuntime({
    createSession: async () =>
      ({
        async snapshot() {
          throw new Error("missing_player_world_view_base");
        },
        async dispose() {}
      }) as never
  });

  await root.connect();

  assert.equal(root.session, null);
  assert.equal(root.predictionStatus, "房间状态损坏，请重建房间或检查服务端同步。");
  assert.equal(root.logLines[0], "房间状态损坏，请重建房间或检查服务端同步。");
});

test("VeilRoot gameplay account review panel loads progression snapshot from the account endpoint", async () => {
  const root = createVeilRootHarness();
  root.playerId = "player-1";
  root.roomId = "room-alpha";
  root.remoteUrl = "http://127.0.0.1:2567";

  let loadCalls = 0;
  installVeilRootRuntime({
    loadProgressionSnapshot: async () => {
      loadCalls += 1;
      return {
        summary: {
          totalAchievements: 5,
          unlockedAchievements: 1,
          inProgressAchievements: 1,
          recentEventCount: 2,
          latestEventAt: "2026-03-29T01:03:00.000Z"
        },
        achievements: [
          {
            id: "first_battle",
            title: "初次交锋",
            description: "首次进入战斗。",
            metric: "battles_started",
            current: 1,
            target: 1,
            unlocked: true,
            unlockedAt: "2026-03-29T01:00:00.000Z"
          }
        ],
        recentEventLog: [
          {
            id: "event-1",
            timestamp: "2026-03-29T01:03:00.000Z",
            roomId: "room-alpha",
            playerId: "player-1",
            category: "achievement",
            description: "解锁成就：初次交锋",
            achievementId: "first_battle",
            rewards: []
          }
        ]
      };
    }
  });

  await (root as VeilRoot & Record<string, unknown>).toggleGameplayAccountReviewPanel(true);

  assert.equal(loadCalls, 1);
  assert.equal(root.gameplayAccountReviewPanelOpen, true);
  assert.equal(root.lobbyAccountReviewState.progression.status, "ready");
  assert.equal(root.lobbyAccountReviewState.progression.snapshot.summary.unlockedAchievements, 1);
  assert.equal(root.lobbyAccountReviewState.progression.snapshot.recentEventLog[0]?.id, "event-1");
});

test("VeilRoot hands control to a fresh session when starting a new run", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-alpha";
  root.playerId = "player-1";
  root.seed = 1001;
  const handoffOrder: string[] = [];
  const previousSession = {
    async dispose() {
      handoffOrder.push("dispose:previous");
    }
  };
  const freshUpdate = createSessionUpdate(6, "run-fr4nch");
  const freshSession = {
    async snapshot() {
      handoffOrder.push("snapshot:fresh");
      return freshUpdate;
    },
    async dispose() {
      handoffOrder.push("dispose:fresh");
    }
  };
  root.session = previousSession;
  root.applySessionUpdate = async (update) => {
    handoffOrder.push(`apply:${update.world.meta.roomId}`);
    root.lastUpdate = update;
  };
  root.syncBrowserRoomQuery = (roomId: string | null) => {
    handoffOrder.push(`query:${roomId}`);
  };

  const originalDateNow = Date.now;
  installVeilRootRuntime({
    createSession: async () => freshSession as never
  });
  Date.now = () => 1234567890123;

  try {
    await root.startNewRun();
  } finally {
    Date.now = originalDateNow;
  }

  assert.equal(root.session, freshSession);
  assert.equal(root.roomId, "run-5hugnf");
  assert.equal(root.seed, 1002);
  assert.deepEqual(handoffOrder, [
    "snapshot:fresh",
    "query:run-5hugnf",
    "apply:run-fr4nch",
    "dispose:previous"
  ]);
});

test("VeilRoot lobby handoff enters a room with the authenticated session and live snapshot", async () => {
  const storage = createMemoryStorage();
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  root.showLobby = true;
  root.roomId = "room-bravo";
  root.playerId = "guest-7";
  root.displayName = "Guest 7";
  root.privacyConsentAccepted = true;

  const liveUpdate = createSessionUpdate(4, "room-bravo", "guest-7");
  const fakeSession = {
    async snapshot() {
      return liveUpdate;
    },
    async dispose() {}
  };
  const queryUpdates: Array<string | null> = [];
  root.syncBrowserRoomQuery = (roomId: string | null) => {
    queryUpdates.push(roomId);
  };

  installVeilRootRuntime({
    loginGuestAuthSession: async () => ({
      token: "guest.token",
      playerId: "guest-7",
      displayName: "Guest 7",
      authMode: "guest",
      provider: "guest",
      source: "remote"
    }),
    createSession: async () => fakeSession as never
  });

  await root.enterLobbyRoom();

  assert.equal(root.showLobby, false);
  assert.equal(root.session, fakeSession);
  assert.equal(root.playerId, "guest-7");
  assert.equal(root.authToken, "guest.token");
  assert.equal(root.sessionSource, "remote");
  assert.equal(root.lastUpdate?.world.meta.day, 4);
  assert.deepEqual(queryUpdates, ["room-bravo"]);
});

test("VeilRoot keeps the lobby visible and explains when an account session has expired", async () => {
  const storage = createMemoryStorage();
  storage.setItem(
    "project-veil:auth-session",
    JSON.stringify({
      token: "expired.token",
      playerId: "account-player",
      displayName: "暮潮守望",
      authMode: "account",
      provider: "account-password",
      loginId: "veil-ranger",
      source: "remote"
    })
  );
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  root.showLobby = true;
  root.roomId = "room-charlie";
  root.playerId = "account-player";
  root.displayName = "暮潮守望";
  root.authMode = "account";
  root.authToken = "expired.token";
  root.authProvider = "account-password";
  root.loginId = "veil-ranger";
  root.sessionSource = "remote";
  root.privacyConsentAccepted = true;

  installVeilRootRuntime({
    syncAuthSession: async () => null
  });

  await root.enterLobbyRoom();

  assert.equal(root.showLobby, true);
  assert.equal(root.session, null);
  assert.equal(root.authToken, null);
  assert.equal(root.authMode, "guest");
  assert.equal(root.authProvider, "guest");
  assert.equal(root.loginId, "");
  assert.equal(root.sessionSource, "none");
  assert.equal(root.lobbyStatus, "账号会话已失效，请重新登录后再进入房间。");
  assert.equal(storage.getItem("project-veil:auth-session"), null);
});

test("VeilRoot forwards session connection events into runtime diagnostics and logs", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-alpha";
  root.playerId = "player-1";
  root.displayName = "暮潮守望";
  root.authToken = "account.token";

  const liveUpdate = createSessionUpdate(7);
  let capturedOptions:
    | {
        onConnectionEvent?: ((event: "reconnecting" | "reconnected" | "reconnect_failed") => void) | undefined;
        getDisplayName?: (() => string) | undefined;
        getAuthToken?: (() => string | null) | undefined;
      }
    | undefined;

  installVeilRootRuntime({
    createSession: async (_roomId, _playerId, _seed, options) => {
      capturedOptions = options;
      return {
        async snapshot() {
          return liveUpdate;
        },
        async dispose() {}
      } as never;
    }
  });

  await root.connect();

  assert.equal(capturedOptions?.getDisplayName?.(), "暮潮守望");
  assert.equal(capturedOptions?.getAuthToken?.(), "account.token");

  capturedOptions?.onConnectionEvent?.("reconnecting");
  assert.equal(root.diagnosticsConnectionStatus, "reconnecting");
  assert.equal(root.logLines[0], "连接已中断，正在尝试重连...");

  capturedOptions?.onConnectionEvent?.("reconnected");
  assert.equal(root.diagnosticsConnectionStatus, "connected");
  assert.equal(root.logLines[0], "连接已恢复。");

  capturedOptions?.onConnectionEvent?.("reconnect_failed");
  assert.equal(root.diagnosticsConnectionStatus, "reconnect_failed");
  assert.equal(root.logLines[0], "重连失败，正在尝试恢复房间快照...");
});

test("VeilRoot runtime harness carries the first battle back to world state", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-alpha";
  root.playerId = "player-1";
  delete root.applySessionUpdate;
  root.refreshGameplayAccountProfile = async () => undefined;

  const worldUpdate = createSessionUpdate(1);
  const battleUpdate = createFirstBattleUpdate();
  const returnToWorldUpdate = createReturnToWorldUpdate();
  const battleActions: BattleAction[] = [];
  const transitionCalls: string[] = [];
  let capturedOptions: VeilCocosSessionOptions | undefined;

  const fakeSession = {
    async snapshot() {
      return worldUpdate;
    },
    async actInBattle(action: BattleAction) {
      battleActions.push(action);
      return returnToWorldUpdate;
    },
    async dispose() {}
  };

  installVeilRootRuntime({
    createSession: async (_roomId, _playerId, _seed, options) => {
      capturedOptions = options;
      return fakeSession as never;
    }
  });

  Object.assign(root, {
    battleTransition: {
      async playEnter(copy: { title: string }) {
        transitionCalls.push(`enter:${copy.title}`);
      },
      async playExit(copy: { title: string }) {
        transitionCalls.push(`exit:${copy.title}`);
      }
    }
  });

  await root.connect();
  capturedOptions?.onPushUpdate?.(battleUpdate);
  await flushMicrotasks();

  assert.equal(root.lastUpdate?.battle?.id, "battle-1");
  assert.equal(root.selectedBattleTargetId, "neutral-1-stack");
  assert.deepEqual(transitionCalls, ["enter:遭遇中立守军"]);

  await root.actInBattle({
    type: "battle.attack",
    attackerId: "hero-1-stack",
    defenderId: "neutral-1-stack"
  });

  assert.deepEqual(battleActions, [
    {
      type: "battle.attack",
      attackerId: "hero-1-stack",
      defenderId: "neutral-1-stack"
    }
  ]);
  assert.equal(root.lastUpdate?.battle, null);
  assert.equal(root.selectedBattleTargetId, null);
  assert.equal(root.lastUpdate?.world.ownHeroes[0]?.progression.battlesWon, 1);
  assert.deepEqual(transitionCalls, ["enter:遭遇中立守军", "exit:战斗胜利"]);
  assert.equal(root.battlePresentation.getState().phase, "resolution");
  assert.equal(root.battlePresentation.getState().result, "victory");
});

test("VeilRoot battle flow switches transition state and fallback audio scenes through enter and resolution", async () => {
  const root = createVeilRootHarness();
  const transitionCalls: string[] = [];
  const animationCalls: string[] = [];

  root.showLobby = false;
  root.playerId = "player-1";
  root.lastUpdate = createSessionUpdate(1);
  root.mapBoard = {
    playHeroAnimation(animation: string) {
      animationCalls.push(animation);
    },
    showTileFeedback() {},
    pulseObject() {}
  } as never;
  root.battleTransition = {
    async playEnter(copy: { title: string }) {
      transitionCalls.push(`enter:${copy.title}`);
    },
    async playExit(copy: { title: string }) {
      transitionCalls.push(`exit:${copy.title}`);
    }
  } as never;
  root.audioRuntime = createCocosAudioRuntime(cocosPresentationConfig.audio, {
    setTimeout: (() => ({ id: 1 } as ReturnType<typeof setTimeout>)) as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout
  }) as never;
  root.renderView = (() => {
    (VeilRoot.prototype as VeilRoot & Record<string, unknown>).syncMusicScene.call(root);
  }) as typeof root.renderView;
  root.syncWechatShareBridge = () => undefined;
  root.refreshGameplayAccountProfile = async () => undefined;
  delete root.applySessionUpdate;

  await root.applySessionUpdate(createFirstBattleUpdate());

  assert.deepEqual(transitionCalls, ["enter:遭遇中立守军"]);
  assert.deepEqual(animationCalls, ["attack"]);
  assert.deepEqual(root.audioRuntime.getState(), {
    supported: false,
    assetBacked: false,
    unlocked: false,
    currentScene: "battle",
    lastCue: null,
    cueCount: 0,
    musicMode: "synth",
    cueMode: "idle",
    bgmVolume: 100,
    sfxVolume: 100
  });
  assert.equal(root.battlePresentation.getState().phase, "enter");

  await root.applySessionUpdate(createReturnToWorldUpdate());

  assert.deepEqual(transitionCalls, ["enter:遭遇中立守军", "exit:战斗胜利"]);
  assert.deepEqual(animationCalls, ["attack", "victory"]);
  assert.deepEqual(root.audioRuntime.getState(), {
    supported: false,
    assetBacked: false,
    unlocked: false,
    currentScene: "explore",
    lastCue: "victory",
    cueCount: 1,
    musicMode: "synth",
    cueMode: "idle",
    bgmVolume: 100,
    sfxVolume: 100
  });
  assert.equal(root.battlePresentation.getState().phase, "resolution");
  root.audioRuntime.dispose();
});

test("VeilRoot refreshAccountReviewPage loads paged event history into the lobby review state", async () => {
  const root = createVeilRootHarness();
  root.playerId = "player-1";
  root.displayName = "雾林司灯";
  root.lobbyAccountProfile = {
    playerId: "player-1",
    displayName: "雾林司灯",
    globalResources: { gold: 0, wood: 0, ore: 0 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [],
    source: "remote"
  };
  root.lobbyAccountReviewState = createCocosAccountReviewState(root.lobbyAccountProfile);
  root.lobbyAccountReviewState = transitionCocosAccountReviewState(root.lobbyAccountReviewState, {
    type: "section.selected",
    section: "event-history"
  });

  installVeilRootRuntime({
    loadEventHistory: async () => ({
      items: [
        {
          id: "event-page-2",
          timestamp: "2026-03-29T12:08:00.000Z",
          roomId: "room-alpha",
          playerId: "player-1",
          category: "combat",
          description: "翻到第二页",
          rewards: []
        }
      ],
      total: 4,
      offset: 3,
      limit: 3,
      hasMore: false
    })
  });

  await root.refreshAccountReviewPage("event-history", 1);

  assert.equal(root.lobbyAccountReviewState.eventHistory.status, "ready");
  assert.equal(root.lobbyAccountReviewState.eventHistory.page, 1);
  assert.equal(root.lobbyAccountReviewState.eventHistory.total, 4);
  assert.equal(root.lobbyAccountReviewState.eventHistory.items[0]?.id, "event-page-2");
});

test("VeilRoot review refresh keeps empty event history as a ready empty state", async () => {
  const root = createVeilRootHarness();
  root.playerId = "player-1";
  root.lobbyAccountReviewState = transitionCocosAccountReviewState(
    createCocosAccountReviewState(root.lobbyAccountProfile),
    {
      type: "section.selected",
      section: "event-history"
    }
  );

  installVeilRootRuntime({
    loadEventHistory: async () => ({
      items: [],
      total: 0,
      offset: 0,
      limit: 3,
      hasMore: false
    })
  });

  await root.refreshActiveAccountReviewSection();

  assert.equal(root.lobbyAccountReviewState.eventHistory.status, "ready");
  assert.deepEqual(root.lobbyAccountReviewState.eventHistory.items, []);
  assert.equal(root.lobbyAccountReviewState.eventHistory.total, 0);
  assert.equal(buildCocosAccountReviewPage(root.lobbyAccountReviewState).subtitle, "最近还没有事件历史。");
});

test("VeilRoot review refresh exposes transport failures as an error state", async () => {
  const root = createVeilRootHarness();
  root.playerId = "player-1";
  root.lobbyAccountReviewState = transitionCocosAccountReviewState(
    createCocosAccountReviewState(root.lobbyAccountProfile),
    {
      type: "section.selected",
      section: "achievements"
    }
  );

  installVeilRootRuntime({
    loadAchievementProgress: async () => {
      throw new Error("cocos_request_failed:503:history_unavailable");
    }
  });

  await root.refreshActiveAccountReviewSection();

  assert.equal(root.lobbyAccountReviewState.achievements.status, "error");
  const review = buildCocosAccountReviewPage(root.lobbyAccountReviewState);
  assert.equal(review.banner?.title, "成就目录同步失败");
  assert.equal(review.showRetry, true);
});
