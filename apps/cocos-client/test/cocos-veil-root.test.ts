import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { sys } from "cc";
import { VeilRoot } from "../assets/scripts/VeilRoot.ts";
import { createFallbackCocosPlayerAccountProfile } from "../assets/scripts/cocos-lobby.ts";
import type { CocosSeasonalEvent } from "../assets/scripts/cocos-lobby.ts";
import type { MatchmakingStatusResponse, SessionUpdate } from "../assets/scripts/VeilCocosSession.ts";
import { createMemoryStorage, createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";
import { createVeilRootHarness, installVeilRootRuntime, resetVeilRootRuntime } from "./helpers/veil-root-harness.ts";

afterEach(() => {
  resetVeilRootRuntime();
  (sys as unknown as { localStorage: Storage | null }).localStorage = null;
  delete (globalThis as { wx?: unknown }).wx;
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

function createBattleUpdate(): SessionUpdate {
  const update = createSessionUpdate(3, "room-recover", "account-player");
  update.battle = {
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
        initiative: 8,
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
  return update;
}

function createSeasonalEvent(overrides: Partial<CocosSeasonalEvent> = {}): CocosSeasonalEvent {
  return {
    id: "defend-the-bridge",
    name: "Defend the Bridge",
    description: "Bridge defense event",
    startsAt: "2026-04-01T00:00:00.000Z",
    endsAt: "2026-04-08T00:00:00.000Z",
    durationDays: 7,
    bannerText: "Hold the crossing.",
    remainingMs: 86_400_000,
    rewards: [],
    player: {
      points: 40,
      claimedRewardIds: [],
      claimableRewardIds: []
    },
    leaderboard: {
      size: 100,
      rewardTiers: [],
      entries: [
        {
          rank: 4,
          playerId: "account-player",
          displayName: "雾林司灯",
          points: 40,
          lastUpdatedAt: "2026-04-04T09:00:00.000Z"
        }
      ],
      topThree: []
    },
    ...overrides
  };
}

test("VeilRoot cold boot falls back to a guest lobby identity when no stored session exists", () => {
  const storage = createMemoryStorage();
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  root.readLaunchSearch = () => "";

  root.hydrateLaunchIdentity();

  assert.equal(root.showLobby, true);
  assert.equal(root.autoConnect, false);
  assert.equal(root.authMode, "guest");
  assert.equal(root.authToken, null);
  assert.equal(root.sessionSource, "none");
  assert.match(String(root.playerId), /^guest-\d{6}$/);
  assert.equal(root.displayName, root.playerId);
  assert.match(String(root.lobbyStatus), /请选择一个房间/);
});

test("VeilRoot warm boot reuses the stored account session and cached replay during reconnect recovery", async () => {
  const storage = createMemoryStorage();
  storage.setItem(
    "project-veil:auth-session",
    JSON.stringify({
      token: "recover.token",
      playerId: "account-player",
      displayName: "雾林司灯",
      authMode: "account",
      provider: "account-password",
      loginId: "veil-ranger",
      source: "remote"
    })
  );
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  root.readLaunchSearch = () => "?roomId=room-recover";

  const replayedUpdate = createSessionUpdate(2, "room-recover", "account-player");
  const liveUpdate = createSessionUpdate(3, "room-recover", "account-player");
  const recoveryOrder: string[] = [];
  let capturedOptions:
    | {
        getAuthToken?: (() => string | null) | undefined;
      }
    | undefined;

  root.applyReplayedSessionUpdate = (update) => {
    recoveryOrder.push(`replay:${update.world.meta.day}`);
    root.lastUpdate = {
      ...update,
      events: [],
      movementPlan: null
    };
  };
  root.applySessionUpdate = async (update) => {
    recoveryOrder.push(`live:${update.world.meta.day}`);
    root.lastUpdate = update;
  };

  installVeilRootRuntime({
    readStoredReplay: () => replayedUpdate,
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

  root.hydrateLaunchIdentity();
  await root.connect();

  assert.equal(root.showLobby, false);
  assert.equal(root.playerId, "account-player");
  assert.equal(root.authMode, "account");
  assert.equal(root.authToken, "recover.token");
  assert.equal(root.sessionSource, "remote");
  assert.equal(capturedOptions?.getAuthToken?.(), "recover.token");
  assert.deepEqual(recoveryOrder, ["replay:2", "live:3"]);
  assert.equal(root.lastUpdate?.world.meta.day, 3);
});

test("VeilRoot keeps forced-upgrade clients in the lobby and surfaces upgrade guidance", async () => {
  const root = createVeilRootHarness();
  let disposeCalls = 0;

  root.roomId = "room-upgrade";
  root.playerId = "player-upgrade";
  root.displayName = "雾幕旅人";
  root.showLobby = false;

  installVeilRootRuntime({
    createSession: async () =>
      ({
        async snapshot() {
          throw new Error("upgrade_required");
        },
        async dispose() {
          disposeCalls += 1;
        }
      }) as never
  });

  await root.connect();

  assert.equal(root.session, null);
  assert.equal(root.lastUpdate, null);
  assert.equal(root.showLobby, true);
  assert.equal(root.lobbyStatus, "当前客户端版本已停止支持，请升级到最新版本后再进入游戏。");
  assert.equal(root.predictionStatus, "当前客户端版本已停止支持，请升级到最新版本后再进入游戏。");
  assert.equal(disposeCalls, 1);
});

test("VeilRoot applies cosmetic push messages to lobby profile state and logs battle emotes", () => {
  const root = createVeilRootHarness();
  let renderCount = 0;
  root.renderView = () => {
    renderCount += 1;
  };
  root.playerId = "account-player";
  root.sessionEpoch = 4;
  root.lobbyAccountProfile = createFallbackCocosPlayerAccountProfile("account-player", "room-cosmetics", "雾林司灯");

  const options = (root as VeilRoot & {
    createSessionOptions(epoch: number): {
      onServerMessage(message: {
        type: "COSMETIC_APPLIED";
        playerId: string;
        cosmeticId: string;
        action: "purchased" | "equipped" | "emote";
        equippedCosmetics?: { profileBorderId?: string };
      }): void;
    };
  }).createSessionOptions(4);

  options.onServerMessage({
    type: "COSMETIC_APPLIED",
    playerId: "account-player",
    cosmeticId: "border-shadowcourt",
    action: "equipped",
    equippedCosmetics: {
      profileBorderId: "border-shadowcourt"
    }
  });
  options.onServerMessage({
    type: "COSMETIC_APPLIED",
    playerId: "player-2",
    cosmeticId: "emote-cheer-spark",
    action: "emote"
  });

  assert.equal(root.lobbyAccountProfile.equippedCosmetics?.profileBorderId, "border-shadowcourt");
  assert.equal(renderCount, 2);
  assert.match(String(root.logLines[0]), /战斗表情：player-2 使用了 emote-cheer-spark/);
  assert.match(String(root.logLines[1]), /外观同步：account-player 装备 border-shadowcourt/);
});

test("VeilRoot handles seasonal event progress push updates and refreshes local panel state", () => {
  const root = createVeilRootHarness();
  let renderCount = 0;
  root.renderView = () => {
    renderCount += 1;
  };
  root.playerId = "account-player";
  root.displayName = "雾林司灯";
  root.sessionEpoch = 4;
  root.activeSeasonalEvent = createSeasonalEvent();
  root.gameplaySeasonalEventPanelOpen = false;

  const options = (root as VeilRoot & {
    createSessionOptions(epoch: number): {
      onServerMessage(message: {
        type: "event.progress.update";
        payload: { eventId: string; points: number; delta: number; objectiveId: string };
      }): void;
    };
  }).createSessionOptions(4);

  options.onServerMessage({
    type: "event.progress.update",
    payload: {
      eventId: "defend-the-bridge",
      points: 120,
      delta: 80,
      objectiveId: "bridge-dungeon-clear"
    }
  });

  assert.equal(root.activeSeasonalEvent?.player.points, 120);
  assert.equal(root.activeSeasonalEvent?.leaderboard.entries[0]?.rank, 1);
  assert.match(String(root.seasonalEventStatus), /\+80 分/);
  assert.equal(renderCount, 1);
});

test("VeilRoot submits seasonal event progress after an owned battle resolves", async () => {
  const root = createVeilRootHarness();
  root.applySessionUpdate = VeilRoot.prototype.applySessionUpdate.bind(root);
  root.refreshGameplayAccountProfile = async () => undefined;
  root.playerId = "account-player";
  root.displayName = "雾林司灯";
  root.sessionSource = "remote";
  root.authToken = "auth.token";
  root.activeSeasonalEvent = createSeasonalEvent();

  const resolvedUpdate = createSessionUpdate(4, "room-recover", "account-player");
  resolvedUpdate.events = [
    {
      type: "battle.resolved",
      battleId: "battle-42",
      battleKind: "neutral",
      heroId: "hero-1",
      result: "attacker_victory",
      resourcesGained: { gold: 0, wood: 0, ore: 0 },
      experienceGained: 10,
      skillPointsAwarded: 0
    }
  ];

  const submissions: string[] = [];
  installVeilRootRuntime({
    submitSeasonalEventProgress: async (_remoteUrl, eventId, action) => {
      submissions.push(`${eventId}:${action.actionId}:${action.actionType}`);
      return {
        applied: true,
        event: createSeasonalEvent({
          player: {
            points: 80,
            claimedRewardIds: [],
            claimableRewardIds: []
          }
        }),
        eventProgress: {
          eventId,
          delta: 40,
          points: 80,
          objectiveId: "battle_resolved"
        }
      };
    }
  });

  await root.applySessionUpdate(resolvedUpdate);
  await flushMicrotasks();

  assert.deepEqual(submissions, ["defend-the-bridge:account-player:battle-42:battle_resolved"]);
  assert.equal(root.activeSeasonalEvent?.player.points, 80);
  assert.match(String(root.seasonalEventStatus), /\+40 分/);
});

test("VeilRoot warm boot keeps direct room resume in auto-connect mode", () => {
  const storage = createMemoryStorage();
  storage.setItem(
    "project-veil:auth-session",
    JSON.stringify({
      token: "resume.token",
      playerId: "account-player",
      displayName: "雾林司灯",
      authMode: "account",
      provider: "account-password",
      loginId: "veil-ranger",
      source: "remote"
    })
  );
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  root.autoConnect = true;
  root.readLaunchSearch = () => "?roomId=room-resume";

  root.hydrateLaunchIdentity();

  assert.equal(root.showLobby, false);
  assert.equal(root.autoConnect, true);
  assert.equal(root.roomId, "room-resume");
  assert.equal(root.playerId, "account-player");
  assert.equal(root.displayName, "雾林司灯");
  assert.equal(root.authToken, "resume.token");
  assert.equal(root.sessionSource, "remote");
});

test("VeilRoot connect promotes cached replay boot state into an authoritative live snapshot", async () => {
  const storage = createMemoryStorage();
  storage.setItem(
    "project-veil:auth-session",
    JSON.stringify({
      token: "recover.token",
      playerId: "account-player",
      displayName: "雾林司灯",
      authMode: "account",
      provider: "account-password",
      loginId: "veil-ranger",
      source: "remote"
    })
  );
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  root.readLaunchSearch = () => "?roomId=room-recover";
  root.refreshGameplayAccountProfile = async () => undefined;
  delete root.applyReplayedSessionUpdate;
  delete root.applySessionUpdate;

  const replayedUpdate = createSessionUpdate(2, "room-recover", "account-player");
  const liveUpdate = createSessionUpdate(3, "room-recover", "account-player");
  const snapshotDeferred = createDeferred<SessionUpdate>();

  installVeilRootRuntime({
    readStoredReplay: () => replayedUpdate,
    createSession: async () =>
      ({
        async snapshot() {
          return snapshotDeferred.promise;
        },
        async dispose() {}
      }) as never
  });

  root.hydrateLaunchIdentity();
  const connectPromise = root.connect();
  await flushMicrotasks();

  assert.equal(root.lastUpdate?.world.meta.day, 2);
  assert.equal(root.lastRoomUpdateSource, "replay");
  assert.equal(root.lastRoomUpdateReason, "cached_snapshot");
  assert.equal(root.diagnosticsConnectionStatus, "connecting");
  assert.equal(root.predictionStatus, "已回放缓存状态，等待房间同步...");

  snapshotDeferred.resolve(liveUpdate);
  await connectPromise;

  assert.equal(root.lastUpdate?.world.meta.day, 3);
  assert.equal(root.lastRoomUpdateSource, "session");
  assert.equal(root.lastRoomUpdateReason, "snapshot");
  assert.equal(root.diagnosticsConnectionStatus, "connected");
  assert.equal(root.predictionStatus, "");
});

test("VeilRoot connect starts a fresh session and adopts the authoritative snapshot", async () => {
  const root = createVeilRootHarness();
  root.roomId = "room-live";
  root.playerId = "account-player";
  root.seed = 2024;
  root.authMode = "account";
  root.authToken = "live.token";
  root.sessionSource = "remote";
  root.applySessionUpdate = VeilRoot.prototype.applySessionUpdate.bind(root);
  root.syncWechatShareBridge = () => ({
    available: false,
    menuEnabled: false,
    handlerRegistered: false,
    canShareDirectly: false,
    immediateShared: false,
    payload: null,
    message: "disabled"
  });

  const liveUpdate = createSessionUpdate(4, "room-live", "account-player");
  const freshSession = {
    async snapshot() {
      return liveUpdate;
    },
    async dispose() {}
  };
  const createCalls: Array<{
    roomId: string;
    playerId: string;
    seed: number;
    authToken: string | null;
  }> = [];
  let gameplayProfileRefreshes = 0;
  root.refreshGameplayAccountProfile = async () => {
    gameplayProfileRefreshes += 1;
  };

  installVeilRootRuntime({
    createSession: async (roomId, playerId, seed, options) => {
      createCalls.push({
        roomId,
        playerId,
        seed,
        authToken: options.getAuthToken?.() ?? null
      });
      return freshSession as never;
    }
  });

  await root.connect();
  await flushMicrotasks();

  assert.equal(root.session, freshSession);
  assert.equal(root.lastUpdate?.world.meta.day, 4);
  assert.equal(root.diagnosticsConnectionStatus, "connected");
  assert.equal(root.lastRoomUpdateSource, "session");
  assert.equal(root.lastRoomUpdateReason, "snapshot");
  assert.deepEqual(createCalls, [
    {
      roomId: "room-live",
      playerId: "account-player",
      seed: 2024,
      authToken: "live.token"
    }
  ]);
  assert.equal(gameplayProfileRefreshes, 1);
});

test("VeilRoot memory warnings request GC and surface the warning in HUD state", () => {
  const root = createVeilRootHarness();
  let memoryWarningHandler: ((payload?: { level?: number } | null) => void) | null = null;
  let gcRequests = 0;

  (globalThis as { wx?: unknown }).wx = {
    onMemoryWarning(callback: (payload?: { level?: number } | null) => void) {
      memoryWarningHandler = callback;
    },
    offMemoryWarning() {},
    triggerGC() {
      gcRequests += 1;
    }
  };

  root.bindRuntimeMemoryWarnings();
  memoryWarningHandler?.({ level: 2 });

  assert.equal(gcRequests, 1);
  assert.equal(root.runtimeMemoryNotice, "收到内存告警 L2，已请求 GC");
  assert.equal(root.logLines[0], "收到内存告警 L2，已请求 GC");
  assert.match(String(root.describeRuntimeMemoryHealth()), /收到内存告警 L2，已请求 GC/);
});

test("VeilRoot prediction rollback restores the last authoritative snapshot", () => {
  const root = createVeilRootHarness();
  const authoritativeUpdate = createSessionUpdate(3, "room-prediction", "player-1");
  root.lastUpdate = authoritativeUpdate;

  root.applyPrediction(
    {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 1, y: 0 }
    },
    "正在预测移动..."
  );

  assert.deepEqual(root.lastUpdate?.world.ownHeroes[0]?.position, { x: 1, y: 0 });
  assert.equal(root.predictionStatus, "正在预测移动...");
  assert.ok(root.pendingPrediction);

  root.rollbackPrediction("移动失败。");

  assert.deepEqual(root.lastUpdate?.world.ownHeroes[0]?.position, { x: 0, y: 0 });
  assert.equal(root.lastUpdate?.world.meta.roomId, authoritativeUpdate.world.meta.roomId);
  assert.equal(root.lastUpdate?.world.meta.day, authoritativeUpdate.world.meta.day);
  assert.equal(root.pendingPrediction, null);
  assert.equal(root.predictionStatus, "");
  assert.equal(root.logLines[0], "移动失败。");
});

test("VeilRoot reconnect failure updates the lobby-facing error status", () => {
  const root = createVeilRootHarness();
  root.showLobby = true;
  root.lobbyStatus = "请选择一个房间，或输入新的房间 ID 后直接开局。";

  root.handleConnectionEvent("reconnect_failed");

  assert.equal(root.diagnosticsConnectionStatus, "reconnect_failed");
  assert.equal(root.lobbyStatus, "重连失败，正在尝试恢复房间快照...");
  assert.equal(root.logLines[0], "重连失败，正在尝试恢复房间快照...");
});

test("VeilRoot builds HUD session indicators from replay and connection lifecycle state", () => {
  const root = createVeilRootHarness();

  root.diagnosticsConnectionStatus = "reconnecting";
  root.lastRoomUpdateSource = "replay";
  root.lastRoomUpdateReason = "cached_snapshot";
  let indicators = root.buildHudSessionIndicators();

  assert.deepEqual(
    indicators.map((indicator: { kind: string }) => indicator.kind),
    ["reconnecting", "replaying_cached_snapshot", "awaiting_authoritative_resync"]
  );

  root.diagnosticsConnectionStatus = "reconnect_failed";
  indicators = root.buildHudSessionIndicators();

  assert.deepEqual(
    indicators.map((indicator: { kind: string }) => indicator.kind),
    ["replaying_cached_snapshot", "awaiting_authoritative_resync", "degraded_offline_fallback"]
  );

  root.lastRoomUpdateSource = "session";
  root.lastRoomUpdateReason = "snapshot";
  root.diagnosticsConnectionStatus = "connected";

  assert.deepEqual(root.buildHudSessionIndicators(), []);
});

test("VeilRoot keeps the latest settlement summary visible through reconnect recovery", async () => {
  const root = createVeilRootHarness();
  root.applySessionUpdate = VeilRoot.prototype.applySessionUpdate.bind(root);
  root.syncWechatShareBridge = () => ({
    available: false,
    menuEnabled: false,
    handlerRegistered: false,
    canShareDirectly: false,
    immediateShared: false,
    payload: null,
    message: "disabled"
  });
  root.refreshGameplayAccountProfile = async () => undefined;
  root.lastUpdate = createBattleUpdate();

  const resolvedUpdate = createSessionUpdate(4, "room-recover", "account-player");
  resolvedUpdate.world.resources.gold = 1012;
  resolvedUpdate.events = [
    {
      type: "battle.resolved",
      battleId: "battle-1",
      battleKind: "neutral",
      heroId: "hero-1",
      result: "attacker_victory",
      resourcesGained: {
        gold: 12,
        wood: 0,
        ore: 0
      },
      experienceGained: 10,
      skillPointsAwarded: 0
    }
  ];

  await root.applySessionUpdate(resolvedUpdate);
  root.handleConnectionEvent("reconnecting");

  const recovery = root.buildBattleSettlementRecoveryState();

  assert.equal(recovery?.title, "结算恢复中");
  assert.match(recovery?.detail ?? "", /不会重复发放奖励/);
  assert.match(recovery?.summaryLines[0] ?? "", /最近结算：战斗胜利/);
  assert.match(recovery?.summaryLines.join("\n") ?? "", /战利品：金币 \+12/);
});

test("VeilRoot refreshes WeChat share metadata after a battle resolves back to world state", async () => {
  const root = createVeilRootHarness();
  delete root.applySessionUpdate;
  delete root.syncWechatShareBridge;
  root.runtimePlatform = "wechat-game";
  root.roomId = "room-recover";
  root.playerId = "account-player";
  root.displayName = "雾林司灯";
  root.lastUpdate = createBattleUpdate();
  root.refreshGameplayAccountProfile = async () => undefined;

  let shareHandler: (() => { title: string; query: string }) | null = null;

  (globalThis as { wx?: unknown }).wx = {
    showShareMenu() {},
    onShareAppMessage(handler: () => { title: string; query: string }) {
      shareHandler = handler;
    }
  };

  root.syncWechatShareBridge();
  assert.match(String(shareHandler?.().query), /shareScene=battle/);

  const resolvedUpdate = createSessionUpdate(4, "room-recover", "account-player");
  resolvedUpdate.events = [
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

  await root.applySessionUpdate(resolvedUpdate);

  const payload = shareHandler?.();
  assert.ok(payload);
  assert.match(payload.title, /第 4 天 探索房间 room-recover/);
  assert.match(payload.query, /shareScene=world/);
  assert.match(payload.query, /day=4/);
});

test("VeilRoot enters a matched room from lobby matchmaking and stops polling", async () => {
  const root = createVeilRootHarness();
  root.showLobby = true;
  root.privacyConsentAccepted = true;
  root.playerId = "player-1";
  root.displayName = "One";
  root.roomId = "room-alpha";

  let pollUpdate: ((status: MatchmakingStatusResponse) => void) | null = null;
  let pollStops = 0;
  const joinedUpdate = createSessionUpdate(1, "pvp-match-7", "player-1");

  installVeilRootRuntime({
    loginGuestAuthSession: async () => ({
      token: "guest.token",
      playerId: "player-1",
      displayName: "One",
      authMode: "guest",
      provider: "guest",
      source: "remote"
    }),
    enqueueMatchmaking: async () => ({
      status: "queued",
      position: 2,
      estimatedWaitSeconds: 18
    }),
    startMatchmakingPolling: (_remoteUrl, onUpdate) => {
      pollUpdate = onUpdate;
      return {
        stop() {
          pollStops += 1;
        }
      };
    },
    createSession: async () =>
      ({
        async snapshot() {
          return joinedUpdate;
        },
        async dispose() {}
      }) as never
  });

  await root.enterLobbyMatchmaking();
  assert.equal(root.matchmakingStatus.status, "queued");
  assert.ok(pollUpdate);

  await pollUpdate?.({
    status: "matched",
    roomId: "pvp-match-7",
    playerIds: ["player-1", "player-2"],
    seedOverride: 2007
  });
  await flushMicrotasks();

  assert.equal(pollStops, 1);
  assert.equal(root.showLobby, false);
  assert.equal(root.roomId, "pvp-match-7");
  assert.equal(root.seed, 2007);
  assert.equal(root.matchmakingStatus.status, "idle");
  assert.equal(root.lastUpdate?.world.meta.roomId, "pvp-match-7");
});

test("VeilRoot cancelLobbyMatchmaking stops polling and clears the queue state", async () => {
  const root = createVeilRootHarness();
  root.showLobby = true;
  root.playerId = "player-1";
  root.displayName = "One";
  root.authToken = "guest.token";
  root.matchmakingStatus = {
    status: "queued",
    position: 3,
    estimatedWaitSeconds: 21
  };
  root.matchmakingView = {
    statusLabel: "正在匹配…",
    queuePositionLabel: "位置 #3",
    waitEstimateLabel: "预计 21s",
    matchedLabel: "",
    canCancel: true,
    isMatched: false
  };

  let cancelCalls = 0;
  let pollStops = 0;
  root.matchmakingPollController = {
    stop() {
      pollStops += 1;
    }
  };

  installVeilRootRuntime({
    cancelMatchmaking: async () => {
      cancelCalls += 1;
      return "dequeued";
    }
  });

  await root.cancelLobbyMatchmaking();

  assert.equal(cancelCalls, 1);
  assert.equal(pollStops, 1);
  assert.deepEqual(root.matchmakingStatus, { status: "idle" });
  assert.match(String(root.lobbyStatus), /已取消当前匹配队列/);
});

test("VeilRoot persists tutorial progression through the remote account profile flow", async () => {
  const root = createVeilRootHarness();
  root.sessionSource = "remote";
  root.authMode = "account";
  root.authToken = "tutorial.token";
  root.playerId = "tutorial-player";
  root.displayName = "雾幕新兵";
  root.lobbyAccountProfile = {
    ...root.lobbyAccountProfile,
    playerId: "tutorial-player",
    displayName: "雾幕新兵",
    recentBattleReplays: [],
    source: "remote",
    tutorialStep: 1
  };

  const actions: Array<{ step: number | null; reason?: string }> = [];
  installVeilRootRuntime({
    updateTutorialProgress: async (_remoteUrl, _roomId, action) => {
      actions.push(action);
      return {
        ...root.lobbyAccountProfile,
        recentBattleReplays: [],
        source: "remote",
        tutorialStep: action.step
      };
    }
  });

  assert.ok(root.buildTutorialOverlayView());
  await root.advanceTutorialFlow();
  assert.deepEqual(actions[0], { step: 2, reason: "advance" });
  assert.equal(root.lobbyAccountProfile.tutorialStep, 2);

  await root.skipTutorialFlow();
  assert.deepEqual(actions[1], { step: null, reason: "skip" });
  assert.equal(root.lobbyAccountProfile.tutorialStep ?? null, null);
  assert.equal(root.buildTutorialOverlayView(), null);
});

test("VeilRoot onDestroy stops matchmaking polling to avoid timer leaks", () => {
  const root = createVeilRootHarness();
  let pollStops = 0;
  root.matchmakingPollController = {
    stop() {
      pollStops += 1;
    }
  };

  root.onDestroy();

  assert.equal(pollStops, 1);
  assert.equal(root.matchmakingPollController, null);
});

test("VeilRoot onDestroy disposes the active session and unregisters runtime memory warnings", () => {
  const root = createVeilRootHarness();
  let disposeCalls = 0;
  let stopMemoryWarningCalls = 0;

  root.session = {
    async dispose() {
      disposeCalls += 1;
    }
  } as never;
  root.stopRuntimeMemoryWarnings = () => {
    stopMemoryWarningCalls += 1;
  };

  root.onDestroy();

  assert.equal(root.session, null);
  assert.equal(root.stopRuntimeMemoryWarnings, null);
  assert.equal(disposeCalls, 1);
  assert.equal(stopMemoryWarningCalls, 1);
});
