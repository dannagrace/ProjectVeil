import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { sys } from "cc";
import { createCocosAccountReviewState, transitionCocosAccountReviewState } from "../assets/scripts/cocos-account-review.ts";
import { createMemoryStorage, createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";
import { createVeilRootHarness, installVeilRootRuntime, resetVeilRootRuntime } from "./helpers/veil-root-harness.ts";
import type { BattleAction, BattleState, SessionUpdate, VeilCocosSessionOptions } from "../assets/scripts/VeilCocosSession.ts";

afterEach(() => {
  resetVeilRootRuntime();
  (sys as unknown as { localStorage: Storage | null }).localStorage = null;
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
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

test("VeilRoot account lifecycle flow switches panels and surfaces validation feedback", async () => {
  const root = createVeilRootHarness();

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

test("VeilRoot gameplay achievement panel loads achievement progress from the account endpoint", async () => {
  const root = createVeilRootHarness();
  root.playerId = "player-1";
  root.roomId = "room-alpha";
  root.remoteUrl = "http://127.0.0.1:2567";

  let loadCalls = 0;
  installVeilRootRuntime({
    loadAchievementProgress: async () => {
      loadCalls += 1;
      return [
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
      ];
    }
  });

  await (root as VeilRoot & Record<string, unknown>).toggleGameplayAchievementPanel(true);

  assert.equal(loadCalls, 1);
  assert.equal(root.gameplayAchievementPanelOpen, true);
  assert.equal((root.gameplayAchievementItems as Array<{ id: string }>)[0]?.id, "first_battle");
  assert.match(String(root.gameplayAchievementPanelStatus), /已同步 1 条成就进度/);
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

  installVeilRootRuntime({
    syncAuthSession: async () => null
  });

  await root.enterLobbyRoom();

  assert.equal(root.showLobby, true);
  assert.equal(root.session, null);
  assert.equal(root.authToken, null);
  assert.equal(root.authMode, "guest");
  assert.equal(root.authProvider, "guest");
  assert.equal(root.sessionSource, "none");
  assert.equal(root.lobbyStatus, "账号会话已失效，请重新登录后再进入房间。");
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
