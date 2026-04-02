import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Label, Node, sys } from "cc";
import {
  type BattleState,
  type SessionUpdate,
  resetVeilCocosSessionRuntimeForTests,
  setVeilCocosSessionRuntimeForTests,
  VeilCocosSession
} from "../assets/scripts/VeilCocosSession.ts";
import { createFallbackCocosPlayerAccountProfile } from "../assets/scripts/cocos-lobby.ts";
import { resetPixelSpriteRuntimeForTests } from "../assets/scripts/cocos-pixel-sprites.ts";
import { buildCocosRuntimeDiagnosticsSnapshot } from "../assets/scripts/cocos-runtime-diagnostics.ts";
import { writeStoredCocosAuthSession } from "../assets/scripts/cocos-session-launch.ts";
import { resetVeilRootRuntimeForTests, setVeilRootRuntimeForTests, VeilRoot } from "../assets/scripts/VeilRoot.ts";
import { createMemoryStorage, createSessionUpdate, createSdkLoader, FakeColyseusRoom } from "./helpers/cocos-session-fixtures.ts";
import { findNode, pressNode } from "./helpers/cocos-panel-harness.ts";

type RootState = VeilRoot & Record<string, any>;

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function waitFor(assertion: () => boolean, onTimeout: () => unknown, attempts = 30): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) {
      return;
    }
    await flushMicrotasks();
  }

  assert.fail(JSON.stringify(onTimeout(), null, 2));
}

function createRootHarness() {
  const sceneNode = new Node("PrimaryJourneyScene");
  const rootNode = new Node("VeilRootJourney");
  rootNode.parent = sceneNode;
  const root = rootNode.addComponent(VeilRoot) as RootState;
  root.renderView = () => undefined;
  root.ensureViewNodes = () => undefined;
  root.ensureUiCameraVisibility = () => undefined;
  root.ensureHudActionBinding = () => undefined;
  root.syncBrowserRoomQuery = () => undefined;
  root.syncWechatShareBridge = () => ({
    available: false,
    menuEnabled: false,
    handlerRegistered: false,
    canShareDirectly: false,
    immediateShared: false,
    payload: null,
    message: "disabled"
  });
  return { root, rootNode };
}

function readNodeLabel(node: Node | null | undefined): string | null {
  return node?.getComponent(Label)?.string ?? null;
}

function captureJourneyUiState(rootNode: Node) {
  const hudNode = rootNode.getChildByName("ProjectVeilHud");
  const actionsNode = hudNode?.getChildByName("HudActions");
  const battleNode = rootNode.getChildByName("ProjectVeilBattlePanel");
  return {
    hud: {
      active: hudNode?.active ?? false,
      actionButtons:
        actionsNode?.children.map((child) => ({
          name: child.name,
          label: readNodeLabel(child.getChildByName("Label"))
        })) ?? []
    },
    battle: {
      active: battleNode?.active ?? false,
      title: readNodeLabel(battleNode?.getChildByName("BattleTitle")),
      actionHeader: readNodeLabel(battleNode?.getChildByName("BattleActionHeader")),
      actions:
        battleNode?.children
          .filter((child) => child.name.startsWith("BattleAction-") && child.active)
          .map((child) => ({
            name: child.name,
            title: readNodeLabel(child.getChildByName(`${child.name}-title`)),
            meta: readNodeLabel(child.getChildByName(`${child.name}-meta`))
          })) ?? [],
      targets:
        battleNode?.children
          .filter((child) => child.name.startsWith("BattleTarget-") && child.active)
          .map((child) => ({
            name: child.name,
            title: readNodeLabel(child.getChildByName(`${child.name}-title`)),
            meta: readNodeLabel(child.getChildByName(`${child.name}-meta`))
          })) ?? []
    }
  };
}

function createNeutralEncounterBattle(): BattleState {
  return {
    id: "battle-neutral-journey",
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
    encounterPosition: { x: 1, y: 1 }
  };
}

function createJourneyBootstrapUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createSessionUpdate(4, roomId, playerId);
  update.world.map.tiles[1] = {
    ...update.world.map.tiles[1],
    fog: "visible",
    resource: {
      kind: "wood",
      amount: 5
    }
  };
  update.world.map.tiles[2] = {
    ...update.world.map.tiles[2],
    fog: "visible"
  };
  update.world.map.tiles[3] = {
    ...update.world.map.tiles[3],
    fog: "visible",
    occupant: {
      kind: "neutral",
      refId: "neutral-1"
    }
  };
  update.reachableTiles = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  return update;
}

function createJourneyExploreUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneyBootstrapUpdate(roomId, playerId);
  update.world.ownHeroes[0]!.position = { x: 1, y: 0 };
  update.world.ownHeroes[0]!.move.remaining = 5;
  update.world.resources.wood = 15;
  update.world.map.tiles[1] = {
    ...update.world.map.tiles[1],
    resource: undefined
  };
  update.events = [
    {
      type: "hero.moved",
      heroId: "hero-1",
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      moveCost: 1
    },
    {
      type: "hero.collected",
      heroId: "hero-1",
      resource: {
        kind: "wood",
        amount: 5
      }
    }
  ];
  update.reachableTiles = [{ x: 1, y: 0 }, { x: 1, y: 1 }];
  update.reason = "journey.world.explore";
  return update;
}

function createJourneyBattleUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneyExploreUpdate(roomId, playerId);
  update.world.ownHeroes[0]!.position = { x: 1, y: 1 };
  update.world.ownHeroes[0]!.move.remaining = 4;
  update.battle = createNeutralEncounterBattle();
  update.events = [
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      initiator: "hero",
      battleId: "battle-neutral-journey",
      path: [{ x: 1, y: 0 }, { x: 1, y: 1 }],
      moveCost: 1
    }
  ];
  update.reachableTiles = [];
  update.reason = "journey.battle.started";
  return update;
}

function createJourneySettlementUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneyExploreUpdate(roomId, playerId);
  update.world.ownHeroes[0]!.position = { x: 1, y: 1 };
  update.world.ownHeroes[0]!.move.remaining = 4;
  update.world.ownHeroes[0]!.progression = {
    ...update.world.ownHeroes[0]!.progression,
    experience: 25,
    battlesWon: 1,
    neutralBattlesWon: 1
  };
  update.world.resources.gold = 1012;
  update.world.map.tiles[3] = {
    ...update.world.map.tiles[3],
    occupant: undefined
  };
  update.events = [
    {
      type: "battle.resolved",
      battleId: "battle-neutral-journey",
      battleKind: "neutral",
      heroId: "hero-1",
      result: "attacker_victory",
      resourcesGained: {
        gold: 12,
        wood: 0,
        ore: 0
      },
      experienceGained: 25,
      skillPointsAwarded: 0
    }
  ];
  update.reason = "journey.battle.settlement";
  return update;
}

function createJourneyLootSettlementUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneySettlementUpdate(roomId, playerId);
  update.world.ownHeroes[0]!.loadout.inventory = ["scout_compass"];
  update.events = [
    ...update.events,
    {
      type: "hero.equipmentFound",
      heroId: "hero-1",
      battleId: "battle-neutral-journey",
      battleKind: "neutral",
      equipmentId: "scout_compass",
      equipmentName: "斥候罗盘",
      rarity: "common"
    }
  ];
  update.reason = "journey.battle.loot-settlement";
  return update;
}

function createJourneyEquipUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneySettlementUpdate(roomId, playerId);
  update.world.ownHeroes[0]!.loadout.equipment.accessoryId = "scout_compass";
  update.world.ownHeroes[0]!.loadout.inventory = [];
  update.events = [
    {
      type: "hero.equipmentChanged",
      heroId: "hero-1",
      slot: "accessory",
      equippedItemId: "scout_compass",
      unequippedItemId: undefined
    }
  ];
  update.reason = "journey.equipment.equipped";
  return update;
}

function createJourneyReconnectRecoveryUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneySettlementUpdate(roomId, playerId);
  update.world.meta.day = 5;
  update.world.ownHeroes[0]!.move.remaining = 8;
  update.events = [];
  update.reason = "journey.reconnect.restore";
  return update;
}

function createJourneyReconnectLootRecoveryUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneyLootSettlementUpdate(roomId, playerId);
  update.world.meta.day = 5;
  update.world.ownHeroes[0]!.move.remaining = 8;
  update.events = [];
  update.reason = "journey.reconnect.restore";
  return update;
}

function createJourneyRecoveredEquipUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneyReconnectLootRecoveryUpdate(roomId, playerId);
  update.world.ownHeroes[0]!.loadout.equipment.accessoryId = "scout_compass";
  update.world.ownHeroes[0]!.loadout.inventory = [];
  update.events = [
    {
      type: "hero.equipmentChanged",
      heroId: "hero-1",
      slot: "accessory",
      equippedItemId: "scout_compass",
      unequippedItemId: undefined
    }
  ];
  update.reason = "journey.equipment.equipped";
  return update;
}

function captureJourneyArtifact(options: {
  root: RootState;
  phase: string;
  joinedOptions?: Array<{ logicalRoomId: string; playerId: string; seed: number }>;
  room?: FakeColyseusRoom;
}) {
  const { root } = options;
  const update = root.lastUpdate ?? null;
  return {
    phase: options.phase,
    identity: {
      roomId: root.roomId,
      playerId: root.playerId,
      displayName: root.displayName,
      authMode: root.authMode,
      loginId: root.loginId,
      sessionSource: root.sessionSource,
      authTokenPresent: Boolean(root.authToken)
    },
    lobby: {
      showLobby: root.showLobby,
      status: root.lobbyStatus,
      loading: root.lobbyLoading,
      entering: root.lobbyEntering,
      rooms: root.lobbyRooms?.map((room: Record<string, unknown>) => ({
        roomId: room.roomId,
        day: room.day,
        connectedPlayers: room.connectedPlayers
      })) ?? []
    },
    room: {
      diagnosticsConnectionStatus: root.diagnosticsConnectionStatus,
      lastUpdateDay: update?.world.meta.day ?? null,
      lastUpdateReason: root.lastRoomUpdateReason,
      lastUpdateSource: root.lastRoomUpdateSource,
      logTail: root.logLines?.slice(0, 8) ?? [],
      timelineTail: root.timelineEntries?.slice(0, 6) ?? [],
      sentMessages: options.room?.sentMessages ?? [],
      joinedOptions: options.joinedOptions ?? []
    },
    diagnostics: buildCocosRuntimeDiagnosticsSnapshot({
      devOnly: true,
      mode: update?.battle ? "battle" : "world",
      roomId: root.roomId,
      playerId: root.playerId,
      authMode: root.authMode,
      loginId: root.loginId,
      connectionStatus: root.diagnosticsConnectionStatus,
      lastUpdateSource: root.lastRoomUpdateSource,
      lastUpdateReason: root.lastRoomUpdateReason,
      lastUpdateAt: root.lastRoomUpdateAtMs,
      update,
      account: root.lobbyAccountProfile ?? createFallbackCocosPlayerAccountProfile(root.playerId, root.roomId, root.displayName),
      timelineEntries: root.timelineEntries ?? [],
      logLines: root.logLines ?? [],
      predictionStatus: root.predictionStatus ?? "",
      recoverySummary:
        typeof root.predictionStatus === "string" && root.predictionStatus.includes("回放缓存状态")
          ? root.predictionStatus
          : null,
      primaryClientTelemetry: root.primaryClientTelemetry ?? []
    })
  };
}

afterEach(() => {
  resetVeilRootRuntimeForTests();
  resetVeilCocosSessionRuntimeForTests();
  resetPixelSpriteRuntimeForTests();
  (sys as unknown as { localStorage: Storage | null }).localStorage = null;
  delete (globalThis as { history?: History }).history;
  delete (globalThis as { location?: Location }).location;
});

test("primary cocos client journey reuses an account session from lobby bootstrap and joins the selected room", async () => {
  const storage = createMemoryStorage();
  const roomUpdate = createSessionUpdate(4, "room-journey", "player-account");
  const room = new FakeColyseusRoom([roomUpdate], "journey-reconnect-token");
  const joinedOptions: Array<{ logicalRoomId: string; playerId: string; seed: number }> = [];
  const syncedAuthSession = {
    token: "account.session.token",
    playerId: "player-account",
    displayName: "暮潮守望",
    authMode: "account" as const,
    provider: "account-password" as const,
    loginId: "veil-ranger",
    source: "remote" as const
  };

  writeStoredCocosAuthSession(storage, syncedAuthSession);
  (sys as unknown as { localStorage: Storage }).localStorage = storage;
  (globalThis as { location?: Pick<Location, "search" | "href"> }).location = {
    search: "",
    href: "http://127.0.0.1:4173/"
  };
  (globalThis as { history?: Pick<History, "replaceState"> }).history = {
    replaceState() {}
  };

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room],
      joinedOptions
    })
  });
  setVeilRootRuntimeForTests({
    createSession: (...args) => VeilCocosSession.create(...args),
    readStoredReplay: (...args) => VeilCocosSession.readStoredReplay(...args),
    syncAuthSession: async () => syncedAuthSession,
    loadLobbyRooms: async () => [
      {
        roomId: "room-journey",
        seed: 1001,
        day: 4,
        connectedPlayers: 1,
        heroCount: 1,
        activeBattles: 0,
        updatedAt: "2026-03-31T08:22:00.000Z"
      }
    ],
    loadAccountProfile: async () =>
      createFallbackCocosPlayerAccountProfile("player-account", "room-journey", "暮潮守望", {
        source: "remote",
        authMode: "account",
        loginId: "veil-ranger"
      })
  });

  const { root } = createRootHarness();
  root.onLoad();
  root.start();

  await waitFor(
    () => root.showLobby === true && root.lobbyRooms.length === 1 && root.sessionSource === "remote",
    () => captureJourneyArtifact({ root, phase: "lobby-bootstrap", joinedOptions, room })
  );

  assert.equal(root.authMode, "account");
  assert.equal(root.loginId, "veil-ranger");
  assert.equal(root.lobbyRooms[0]?.roomId, "room-journey");
  await root.enterLobbyRoom("room-journey");

  await waitFor(
    () => root.showLobby === false && root.lastUpdate?.world.meta.roomId === "room-journey",
    () => captureJourneyArtifact({ root, phase: "room-join", joinedOptions, room })
  );

  assert.equal(root.authMode, "account");
  assert.equal(root.loginId, "veil-ranger");
  assert.equal(root.sessionSource, "remote");
  assert.equal(root.lastUpdate?.world.meta.day, 4);
  assert.deepEqual(joinedOptions, [
    {
      logicalRoomId: "room-journey",
      playerId: "player-account",
      seed: 1001
    }
  ]);
  assert.deepEqual(room.sentMessages, [
    {
      type: "connect",
      payload: {
        type: "connect",
        requestId: "cocos-req-1",
        roomId: "room-journey",
        playerId: "player-account",
        displayName: "暮潮守望",
        authToken: "account.session.token"
      }
    }
  ]);

  root.onDestroy();
  await flushMicrotasks();
});

test("primary cocos client journey gates lobby entry, world exploration, battle settlement, and reconnect recovery", async () => {
  const storage = createMemoryStorage();
  const roomId = "room-primary-journey";
  const playerId = "player-account";
  const joinedOptions: Array<{ logicalRoomId: string; playerId: string; seed: number }> = [];
  const syncedAuthSession = {
    token: "account.session.token",
    playerId,
    displayName: "暮潮守望",
    authMode: "account" as const,
    provider: "account-password" as const,
    loginId: "veil-ranger",
    source: "remote" as const
  };
  const initialRoom = new FakeColyseusRoom(
    [createJourneyBootstrapUpdate(roomId, playerId)],
    "journey-initial-token",
    {
      "world.action": [createJourneyExploreUpdate(roomId, playerId), createJourneyBattleUpdate(roomId, playerId)],
      "battle.action": [createJourneySettlementUpdate(roomId, playerId)]
    }
  );
  const recoveredRoom = new FakeColyseusRoom([createJourneyReconnectRecoveryUpdate(roomId, playerId)], "journey-recovered-token");

  writeStoredCocosAuthSession(storage, syncedAuthSession);
  (sys as unknown as { localStorage: Storage }).localStorage = storage;
  (globalThis as { location?: Pick<Location, "search" | "href"> }).location = {
    search: "",
    href: "http://127.0.0.1:4173/"
  };
  (globalThis as { history?: Pick<History, "replaceState"> }).history = {
    replaceState() {}
  };

  setVeilCocosSessionRuntimeForTests({
    storage,
    wait: async () => undefined,
    loadSdk: createSdkLoader({
      joinRooms: [initialRoom, recoveredRoom],
      joinedOptions
    })
  });
  setVeilRootRuntimeForTests({
    createSession: (...args) => VeilCocosSession.create(...args),
    readStoredReplay: (...args) => VeilCocosSession.readStoredReplay(...args),
    syncAuthSession: async () => syncedAuthSession,
    loadLobbyRooms: async () => [
      {
        roomId,
        seed: 1001,
        day: 4,
        connectedPlayers: 1,
        heroCount: 1,
        activeBattles: 0,
        updatedAt: "2026-04-02T09:00:00.000Z"
      }
    ],
    loadAccountProfile: async () =>
      createFallbackCocosPlayerAccountProfile(playerId, roomId, "暮潮守望", {
        source: "remote",
        authMode: "account",
        loginId: "veil-ranger"
      })
  });

  const { root } = createRootHarness();
  root.onLoad();
  root.start();

  await waitFor(
    () => root.showLobby === true && root.lobbyRooms.length === 1 && root.sessionSource === "remote",
    () => captureJourneyArtifact({ root, phase: "lobby-bootstrap", joinedOptions, room: initialRoom })
  );

  await root.enterLobbyRoom(roomId);

  await waitFor(
    () => root.showLobby === false && root.lastUpdate?.world.meta.roomId === roomId,
    () => captureJourneyArtifact({ root, phase: "room-join", joinedOptions, room: initialRoom })
  );

  await root.moveHeroToTile(root.lastUpdate.world.map.tiles[1]);

  await waitFor(
    () => root.lastUpdate?.reason === "journey.world.explore" && root.lastUpdate.world.ownHeroes[0]?.position.x === 1,
    () => captureJourneyArtifact({ root, phase: "world-explore", joinedOptions, room: initialRoom })
  );

  await root.moveHeroToTile(root.lastUpdate.world.map.tiles[3]);

  await waitFor(
    () => root.lastUpdate?.battle?.id === "battle-neutral-journey",
    () => captureJourneyArtifact({ root, phase: "battle-start", joinedOptions, room: initialRoom })
  );

  await root.actInBattle({
    type: "battle.attack",
    attackerId: "hero-1-stack",
    defenderId: "neutral-1-stack"
  });

  await waitFor(
    () => root.lastUpdate?.reason === "journey.battle.settlement" && root.lastUpdate.battle === null,
    () => captureJourneyArtifact({ root, phase: "battle-settlement", joinedOptions, room: initialRoom })
  );

  initialRoom.emitLeave(4002);

  await waitFor(
    () => root.lastUpdate?.reason === "journey.reconnect.restore" && root.lastUpdate.world.meta.day === 5,
    () => captureJourneyArtifact({ root, phase: "reconnect-restore", joinedOptions, room: recoveredRoom })
  );

  assert.equal(root.authMode, "account");
  assert.equal(root.loginId, "veil-ranger");
  assert.equal(root.sessionSource, "remote");
  assert.equal(root.lastUpdate?.world.resources.wood, 15);
  assert.equal(root.lastUpdate?.world.resources.gold, 1012);
  assert.equal(root.lastUpdate?.world.ownHeroes[0]?.progression.neutralBattlesWon, 1);
  assert.equal(root.lastUpdate?.world.ownHeroes[0]?.position.x, 1);
  assert.equal(root.lastUpdate?.world.ownHeroes[0]?.position.y, 1);
  assert.equal(root.diagnosticsConnectionStatus, "connected");
  assert.ok(root.logLines.some((line: string) => line.includes("重连失败")));
  assert.ok(root.logLines.some((line: string) => line.includes("连接已恢复")));
  assert.deepEqual(joinedOptions, [
    {
      logicalRoomId: roomId,
      playerId,
      seed: 1001
    },
    {
      logicalRoomId: roomId,
      playerId,
      seed: 1001
    }
  ]);
  assert.deepEqual(initialRoom.sentMessages, [
    {
      type: "connect",
      payload: {
        type: "connect",
        requestId: "cocos-req-1",
        roomId,
        playerId,
        displayName: "暮潮守望",
        authToken: "account.session.token"
      }
    },
    {
      type: "world.action",
      payload: {
        type: "world.action",
        requestId: "cocos-req-2",
        action: {
          type: "hero.move",
          heroId: "hero-1",
          destination: { x: 1, y: 0 }
        }
      }
    },
    {
      type: "world.action",
      payload: {
        type: "world.action",
        requestId: "cocos-req-3",
        action: {
          type: "hero.move",
          heroId: "hero-1",
          destination: { x: 1, y: 1 }
        }
      }
    },
    {
      type: "battle.action",
      payload: {
        type: "battle.action",
        requestId: "cocos-req-4",
        action: {
          type: "battle.attack",
          attackerId: "hero-1-stack",
          defenderId: "neutral-1-stack"
        }
      }
    }
  ]);
  assert.deepEqual(recoveredRoom.sentMessages, [
    {
      type: "connect",
      payload: {
        type: "connect",
        requestId: "cocos-req-1",
        roomId,
        playerId,
        displayName: "暮潮守望",
        authToken: "account.session.token"
      }
    }
  ]);
  assert.equal(
    storage.getItem(`project-veil:cocos:reconnection:${roomId}:${playerId}`),
    "journey-recovered-token"
  );

  root.onDestroy();
  await flushMicrotasks();
});

test("primary cocos client journey surfaces stale stored account sessions before room entry and clears auth state", async () => {
  const storage = createMemoryStorage();

  writeStoredCocosAuthSession(storage, {
    token: "expired.account.token",
    playerId: "player-expired",
    displayName: "失效旅人",
    authMode: "account",
    provider: "account-password",
    loginId: "expired-ranger",
    source: "remote"
  });
  (sys as unknown as { localStorage: Storage }).localStorage = storage;
  (globalThis as { location?: Pick<Location, "search" | "href"> }).location = {
    search: "",
    href: "http://127.0.0.1:4173/"
  };
  (globalThis as { history?: Pick<History, "replaceState"> }).history = {
    replaceState() {}
  };

  setVeilRootRuntimeForTests({
    syncAuthSession: async () => null
  });

  const { root } = createRootHarness();
  root.onLoad();

  await root.enterLobbyRoom("room-expired");

  const storedSession = storage.getItem("project-veil:auth-session");
  assert.equal(root.showLobby, true, JSON.stringify(captureJourneyArtifact({ root, phase: "stale-session" }), null, 2));
  assert.equal(root.authMode, "guest");
  assert.equal(root.authToken, null);
  assert.equal(root.sessionSource, "none");
  assert.equal(root.loginId, "");
  assert.equal(storedSession, null);
  assert.equal(root.lobbyStatus, "账号会话已失效，请重新登录后再进入房间。");

  root.onDestroy();
  await flushMicrotasks();
});

test("primary cocos client journey renders actionable HUD and battle-panel controls through the first encounter", async () => {
  const storage = createMemoryStorage();
  const roomId = "room-render-journey";
  const playerId = "player-render";
  const syncedAuthSession = {
    token: "account.session.token",
    playerId,
    displayName: "暮潮守望",
    authMode: "account" as const,
    provider: "account-password" as const,
    loginId: "veil-ranger",
    source: "remote" as const
  };
  const room = new FakeColyseusRoom([createJourneyBootstrapUpdate(roomId, playerId)], "render-reconnect-token");

  writeStoredCocosAuthSession(storage, syncedAuthSession);
  (sys as unknown as { localStorage: Storage }).localStorage = storage;
  (globalThis as { location?: Pick<Location, "search" | "href"> }).location = {
    search: "",
    href: "http://127.0.0.1:4173/"
  };
  (globalThis as { history?: Pick<History, "replaceState"> }).history = {
    replaceState() {}
  };

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room]
    })
  });
  setVeilRootRuntimeForTests({
    createSession: (...args) => VeilCocosSession.create(...args),
    readStoredReplay: (...args) => VeilCocosSession.readStoredReplay(...args),
    syncAuthSession: async () => syncedAuthSession,
    loadLobbyRooms: async () => [
      {
        roomId,
        seed: 1001,
        day: 4,
        connectedPlayers: 1,
        heroCount: 1,
        activeBattles: 0,
        updatedAt: "2026-04-02T09:30:00.000Z"
      }
    ],
    loadAccountProfile: async () =>
      createFallbackCocosPlayerAccountProfile(playerId, roomId, "暮潮守望", {
        source: "remote",
        authMode: "account",
        loginId: "veil-ranger"
      })
  });

  const { root, rootNode } = createRootHarness();
  root.onLoad();
  root.start();

  await waitFor(
    () => root.showLobby === true && root.lobbyRooms.length === 1,
    () => ({
      phase: "lobby-bootstrap",
      ...captureJourneyUiState(rootNode)
    })
  );

  await root.enterLobbyRoom(roomId);

  await waitFor(
    () => root.showLobby === false && root.lastUpdate?.world.meta.roomId === roomId,
    () => ({
      phase: "room-join",
      ...captureJourneyUiState(rootNode)
    })
  );

  root.ensureUiCameraVisibility = VeilRoot.prototype.ensureUiCameraVisibility.bind(root);
  root.ensureViewNodes = VeilRoot.prototype.ensureViewNodes.bind(root);
  root.renderView = VeilRoot.prototype.renderView.bind(root);
  root.ensureUiCameraVisibility();
  root.ensureViewNodes();
  root.renderView();

  const hudActionsNode = rootNode.getChildByName("ProjectVeilHud")?.getChildByName("HudActions");
  assert.ok(hudActionsNode, JSON.stringify(captureJourneyUiState(rootNode), null, 2));
  assert.equal(
    readNodeLabel(hudActionsNode?.getChildByName("HudReturnLobby")?.getChildByName("Label")),
    "返回大厅"
  );
  assert.equal(
    readNodeLabel(hudActionsNode?.getChildByName("HudInventory")?.getChildByName("Label")),
    "装备背包"
  );

  room.emitPush(createJourneyBattleUpdate(roomId, playerId));

  await waitFor(
    () => root.lastUpdate?.battle?.id === "battle-neutral-journey",
    () => ({
      phase: "battle-render",
      ...captureJourneyUiState(rootNode)
    })
  );

  const battleNode = rootNode.getChildByName("ProjectVeilBattlePanel");
  assert.equal(readNodeLabel(battleNode?.getChildByName("BattleActionHeader")), "战斗指令");
  assert.equal(
    readNodeLabel(battleNode?.getChildByName("BattleTarget-neutral-1-stack")?.getChildByName("BattleTarget-neutral-1-stack-title")),
    "Orc x8"
  );
  assert.equal(
    readNodeLabel(battleNode?.getChildByName("BattleAction-attack")?.getChildByName("BattleAction-attack-title")),
    "攻击 Orc"
  );
  assert.equal(
    readNodeLabel(battleNode?.getChildByName("BattleAction-wait")?.getChildByName("BattleAction-wait-title")),
    "等待"
  );

  root.onDestroy();
  await flushMicrotasks();
});

test("primary cocos client journey closes the loot, inventory, and equip loop after battle settlement", async () => {
  const storage = createMemoryStorage();
  const roomId = "room-loot-loop";
  const playerId = "player-loot";
  let root!: RootState;
  let rootNode!: Node;
  const syncedAuthSession = {
    token: "account.session.token",
    playerId,
    displayName: "暮潮守望",
    authMode: "account" as const,
    provider: "account-password" as const,
    loginId: "veil-ranger",
    source: "remote" as const
  };
  const room = new FakeColyseusRoom([createJourneyBootstrapUpdate(roomId, playerId)], "loot-reconnect-token", {
    "world.action": [createJourneyEquipUpdate(roomId, playerId)]
  });

  writeStoredCocosAuthSession(storage, syncedAuthSession);
  (sys as unknown as { localStorage: Storage }).localStorage = storage;
  (globalThis as { location?: Pick<Location, "search" | "href"> }).location = {
    search: "",
    href: "http://127.0.0.1:4173/"
  };
  (globalThis as { history?: Pick<History, "replaceState"> }).history = {
    replaceState() {}
  };

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room]
    })
  });
  setVeilRootRuntimeForTests({
    createSession: (...args) => VeilCocosSession.create(...args),
    readStoredReplay: (...args) => VeilCocosSession.readStoredReplay(...args),
    syncAuthSession: async () => syncedAuthSession,
    loadLobbyRooms: async () => [
      {
        roomId,
        seed: 1001,
        day: 4,
        connectedPlayers: 1,
        heroCount: 1,
        activeBattles: 0,
        updatedAt: "2026-04-03T08:30:00.000Z"
      }
    ],
    loadAccountProfile: async () => root.lobbyAccountProfile
  });

  ({ root, rootNode } = createRootHarness());
  root.onLoad();
  root.start();

  await waitFor(
    () => root.showLobby === true && root.lobbyRooms.length === 1,
    () => ({
      phase: "lobby-bootstrap",
      ...captureJourneyUiState(rootNode)
    })
  );

  await root.enterLobbyRoom(roomId);

  await waitFor(
    () => root.showLobby === false && root.lastUpdate?.world.meta.roomId === roomId,
    () => ({
      phase: "room-join",
      ...captureJourneyUiState(rootNode)
    })
  );

  root.ensureUiCameraVisibility = VeilRoot.prototype.ensureUiCameraVisibility.bind(root);
  root.ensureViewNodes = VeilRoot.prototype.ensureViewNodes.bind(root);
  root.renderView = VeilRoot.prototype.renderView.bind(root);
  root.ensureUiCameraVisibility();
  root.ensureViewNodes();
  root.renderView();

  room.emitPush(createJourneyLootSettlementUpdate(roomId, playerId));

  await waitFor(
    () => root.lastUpdate?.events.some((event) => event.type === "hero.equipmentFound") === true,
    () => ({
      phase: "loot-settlement",
      ...captureJourneyUiState(rootNode)
    })
  );

  (root as RootState).toggleGameplayEquipmentPanel();
  root.renderView();

  const inventoryTextBeforeEquip = readNodeLabel(findNode(rootNode, "EquipmentPanelInventory")?.getChildByName("Label"));
  const lootTextBeforeEquip = readNodeLabel(findNode(rootNode, "EquipmentPanelLoot")?.getChildByName("Label"));
  assert.match(String(inventoryTextBeforeEquip), /斥候罗盘/);
  assert.match(String(lootTextBeforeEquip), /斥候罗盘/);

  pressNode(findNode(rootNode, "EquipmentPanelAction-accessory-scout_compass"));

  await waitFor(
    () =>
      root.lastUpdate?.world.ownHeroes[0]?.loadout.equipment.accessoryId === "scout_compass" &&
      root.gameplayAccountRefreshInFlight === false,
    () => ({
      phase: "equip-reconcile",
      ...captureJourneyUiState(rootNode)
    })
  );

  const inventoryTextAfterEquip = readNodeLabel(findNode(rootNode, "EquipmentPanelInventory")?.getChildByName("Label"));
  const loadoutTextAfterEquip = readNodeLabel(findNode(rootNode, "EquipmentPanelLoadout")?.getChildByName("Label"));
  const heroTextAfterEquip = readNodeLabel(findNode(rootNode, "HudHero"));

  assert.match(String(inventoryTextAfterEquip), /暂无可装备物品/);
  assert.match(String(loadoutTextAfterEquip), /饰品 斥候罗盘/);
  assert.match(String(heroTextAfterEquip), /知 2/);
  assert.equal(room.sentMessages.at(-1)?.type, "world.action");
  assert.equal((room.sentMessages.at(-1)?.payload as { action?: { type?: string } }).action?.type, "hero.equip");

  root.onDestroy();
  await flushMicrotasks();
});

test("primary cocos client journey resumes interrupted loot settlement and converges equipment state after reconnect", async () => {
  const storage = createMemoryStorage();
  const roomId = "room-loot-recovery";
  const playerId = "player-loot-recovery";
  let root!: RootState;
  let rootNode!: Node;
  const syncedAuthSession = {
    token: "account.session.token",
    playerId,
    displayName: "暮潮守望",
    authMode: "account" as const,
    provider: "account-password" as const,
    loginId: "veil-ranger",
    source: "remote" as const
  };
  const initialRoom = new FakeColyseusRoom(
    [createJourneyBootstrapUpdate(roomId, playerId)],
    "loot-recovery-initial-token",
    {
      "world.action": [createJourneyExploreUpdate(roomId, playerId), createJourneyBattleUpdate(roomId, playerId)],
      "battle.action": [createJourneySettlementUpdate(roomId, playerId)]
    }
  );
  const recoveredRoom = new FakeColyseusRoom(
    [createJourneyReconnectLootRecoveryUpdate(roomId, playerId)],
    "loot-recovery-final-token",
    {
      "world.action": [createJourneyRecoveredEquipUpdate(roomId, playerId)]
    }
  );

  writeStoredCocosAuthSession(storage, syncedAuthSession);
  (sys as unknown as { localStorage: Storage }).localStorage = storage;
  (globalThis as { location?: Pick<Location, "search" | "href"> }).location = {
    search: "",
    href: "http://127.0.0.1:4173/"
  };
  (globalThis as { history?: Pick<History, "replaceState"> }).history = {
    replaceState() {}
  };

  setVeilCocosSessionRuntimeForTests({
    storage,
    wait: async () => undefined,
    loadSdk: createSdkLoader({
      joinRooms: [initialRoom, recoveredRoom]
    })
  });
  setVeilRootRuntimeForTests({
    createSession: (...args) => VeilCocosSession.create(...args),
    readStoredReplay: (...args) => VeilCocosSession.readStoredReplay(...args),
    syncAuthSession: async () => syncedAuthSession,
    loadLobbyRooms: async () => [
      {
        roomId,
        seed: 1001,
        day: 4,
        connectedPlayers: 1,
        heroCount: 1,
        activeBattles: 0,
        updatedAt: "2026-04-03T08:30:00.000Z"
      }
    ],
    loadAccountProfile: async () => root.lobbyAccountProfile
  });

  ({ root, rootNode } = createRootHarness());
  root.onLoad();
  root.start();

  await waitFor(
    () => root.showLobby === true && root.lobbyRooms.length === 1,
    () => ({
      phase: "lobby-bootstrap",
      ...captureJourneyUiState(rootNode)
    })
  );

  await root.enterLobbyRoom(roomId);

  await waitFor(
    () => root.showLobby === false && root.lastUpdate?.world.meta.roomId === roomId,
    () => ({
      phase: "room-join",
      ...captureJourneyUiState(rootNode)
    })
  );

  root.ensureUiCameraVisibility = VeilRoot.prototype.ensureUiCameraVisibility.bind(root);
  root.ensureViewNodes = VeilRoot.prototype.ensureViewNodes.bind(root);
  root.renderView = VeilRoot.prototype.renderView.bind(root);
  root.ensureUiCameraVisibility();
  root.ensureViewNodes();
  root.renderView();

  await root.moveHeroToTile(root.lastUpdate.world.map.tiles[1]);
  await waitFor(
    () => root.lastUpdate?.reason === "journey.world.explore",
    () => ({
      phase: "world-explore",
      ...captureJourneyUiState(rootNode)
    })
  );

  await root.moveHeroToTile(root.lastUpdate.world.map.tiles[3]);
  await waitFor(
    () => root.lastUpdate?.battle?.id === "battle-neutral-journey",
    () => ({
      phase: "battle-start",
      ...captureJourneyUiState(rootNode)
    })
  );

  await root.actInBattle({
    type: "battle.attack",
    attackerId: "hero-1-stack",
    defenderId: "neutral-1-stack"
  });
  await waitFor(
    () => root.lastUpdate?.reason === "journey.battle.settlement" && root.lastUpdate?.battle === null,
    () => ({
      phase: "battle-settlement",
      ...captureJourneyUiState(rootNode)
    })
  );

  initialRoom.emitPush(createJourneyLootSettlementUpdate(roomId, playerId));
  await waitFor(
    () => root.lastUpdate?.world.ownHeroes[0]?.loadout.inventory.includes("scout_compass") === true,
    () => ({
      phase: "loot-settlement",
      ...captureJourneyUiState(rootNode)
    })
  );

  initialRoom.emitLeave(4002);
  await waitFor(
    () => root.lastUpdate?.reason === "journey.reconnect.restore" && root.lastUpdate?.world.meta.day === 5,
    () => ({
      phase: "reconnect-restore",
      ...captureJourneyUiState(rootNode)
    })
  );

  const battleNode = rootNode.getChildByName("ProjectVeilBattlePanel");
  assert.match(String(readNodeLabel(battleNode?.getChildByName("BattleTitle")) ?? ""), /结算恢复/);
  assert.match(String(readNodeLabel(battleNode?.getChildByName("BattleFeedback")) ?? ""), /结算已恢复/);
  assert.equal(root.lastUpdate?.world.resources.gold, 1012);
  assert.deepEqual(root.lastUpdate?.world.ownHeroes[0]?.loadout.inventory, ["scout_compass"]);
  assert.equal(root.lastUpdate?.world.ownHeroes[0]?.loadout.equipment.accessoryId, undefined);

  (root as RootState).toggleGameplayEquipmentPanel();
  root.renderView();
  pressNode(findNode(rootNode, "EquipmentPanelAction-accessory-scout_compass"));

  await waitFor(
    () => root.lastUpdate?.world.ownHeroes[0]?.loadout.equipment.accessoryId === "scout_compass",
    () => ({
      phase: "equip-after-reconnect",
      ...captureJourneyUiState(rootNode)
    })
  );

  assert.equal(root.lastUpdate?.world.resources.gold, 1012);
  assert.deepEqual(root.lastUpdate?.world.ownHeroes[0]?.loadout.inventory, []);
  assert.equal(root.lastUpdate?.world.ownHeroes[0]?.loadout.equipment.accessoryId, "scout_compass");
  assert.equal(recoveredRoom.sentMessages.at(-1)?.type, "world.action");
  assert.equal((recoveredRoom.sentMessages.at(-1)?.payload as { action?: { type?: string } }).action?.type, "hero.equip");
  assert.equal(
    storage.getItem(`project-veil:cocos:reconnection:${roomId}:${playerId}`),
    "loot-recovery-final-token"
  );

  root.onDestroy();
  await flushMicrotasks();
});
