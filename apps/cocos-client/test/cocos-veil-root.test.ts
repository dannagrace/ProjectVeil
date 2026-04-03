import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { sys } from "cc";
import { VeilRoot } from "../assets/scripts/VeilRoot.ts";
import type { SessionUpdate } from "../assets/scripts/VeilCocosSession.ts";
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
