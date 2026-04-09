import assert from "node:assert/strict";
import test from "node:test";
import { ClientState, matchMaker } from "colyseus";
import type { Client } from "colyseus";
import { applyEloMatchResult, decodePlayerWorldView } from "../../../packages/shared/src/index";
import type { BattleState, ServerMessage, WorldEvent } from "../../../packages/shared/src/index";
import { resolveBattlePassConfig } from "../src/battle-pass";
import {
  VeilColyseusRoom,
  configureRoomRuntimeDependencies,
  configureRoomSnapshotStore,
  getActiveRoomInstances,
  listLobbyRooms,
  resetRoomRuntimeDependencies,
  resetLobbyRoomRegistry
} from "../src/colyseus-room";
import { createRoom, type RoomPersistenceSnapshot } from "../src/index";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import { buildRoomLifecycleSummaryPayload, resetRuntimeObservability } from "../src/observability";
import type { PlayerAccountEnsureInput, PlayerAccountProgressPatch, PlayerAccountSnapshot } from "../src/persistence";

interface FakeClient extends Client {
  sent: ServerMessage[];
  leaveCalls: Array<{ code?: number; reason?: string }>;
}

class InstrumentedRoomSnapshotStore extends MemoryRoomSnapshotStore {
  readonly progressSaves: Array<{ playerId: string; patch: PlayerAccountProgressPatch }> = [];

  override async savePlayerAccountProgress(
    playerId: string,
    patch: PlayerAccountProgressPatch
  ): Promise<PlayerAccountSnapshot> {
    this.progressSaves.push({
      playerId,
      patch: structuredClone(patch)
    });
    return super.savePlayerAccountProgress(playerId, patch);
  }
}

class FailingBootstrapSaveStore extends MemoryRoomSnapshotStore {
  override async save(_roomId: string, _snapshot: RoomPersistenceSnapshot): Promise<void> {
    throw new Error("bootstrap save failed");
  }
}

class FailingEnsurePlayerAccountStore extends MemoryRoomSnapshotStore {
  constructor(private readonly failure: Error) {
    super();
  }

  override async ensurePlayerAccount(_input: PlayerAccountEnsureInput): Promise<PlayerAccountSnapshot> {
    throw this.failure;
  }
}

function createFakeClient(sessionId: string): FakeClient {
  return {
    sessionId,
    state: ClientState.JOINED,
    sent: [],
    leaveCalls: [],
    ref: {
      removeAllListeners() {},
      removeListener() {},
      once() {}
    },
    send(type: string | number, payload?: unknown) {
      this.sent.push({ type, ...(payload as object) } as ServerMessage);
    },
    leave(code?: number, reason?: string) {
      this.leaveCalls.push({ code, reason });
    },
    enqueueRaw() {},
    raw() {}
  } as FakeClient;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function createManualRoomTimer(startAtMs = 0): {
  nowMs: number;
  tick(): Promise<void>;
} {
  let nowMs = startAtMs;
  let callback: (() => void | Promise<void>) | null = null;

  configureRoomRuntimeDependencies({
    setInterval: (handler) => {
      callback = handler;
      return {};
    },
    clearInterval: () => {
      callback = null;
    },
    isMySqlSnapshotStore: () => true,
    now: () => nowMs
  });

  return {
    get nowMs() {
      return nowMs;
    },
    set nowMs(value: number) {
      nowMs = value;
    },
    async tick() {
      await callback?.();
      await flushAsyncWork();
    }
  };
}

async function createTestRoom(logicalRoomId: string, seed = 1001): Promise<VeilColyseusRoom> {
  await matchMaker.setup(
    undefined,
    {
      async update() {},
      async remove() {},
      async persist() {}
    } as never,
    "http://127.0.0.1"
  );

  const room = new VeilColyseusRoom();
  const internalRoom = room as VeilColyseusRoom & {
    __init(): void;
    _listing: Record<string, unknown>;
    _internalState: number;
  };

  internalRoom.roomId = logicalRoomId;
  internalRoom.roomName = "veil";
  internalRoom._listing = {
    roomId: logicalRoomId,
    clients: 0,
    locked: false,
    private: false,
    unlisted: false,
    metadata: {}
  };

  internalRoom.__init();
  await room.onCreate({ logicalRoomId, seed });
  internalRoom._internalState = 1;
  return room;
}

function cleanupRoom(room: VeilColyseusRoom): void {
  const internalRoom = room as VeilColyseusRoom & {
    _autoDisposeTimeout?: NodeJS.Timeout;
    _events: {
      emit(event: string): void;
    };
  };

  if (internalRoom._autoDisposeTimeout) {
    clearTimeout(internalRoom._autoDisposeTimeout);
    internalRoom._autoDisposeTimeout = undefined;
  }

  internalRoom._events.emit("dispose");
  room.clock.clear();
  room.clock.stop();
}

async function emitRoomMessage(room: VeilColyseusRoom, type: string, client: FakeClient, payload: object): Promise<void> {
  const internalRoom = room as VeilColyseusRoom & {
    onMessageEvents: {
      emit(event: string, ...args: unknown[]): void;
    };
  };

  // Tests emit against the registered Colyseus handler directly so lifecycle coverage stays transport-free and CI-stable.
  internalRoom.onMessageEvents.emit(type, client, payload);
  await flushAsyncWork();
}

async function connectPlayer(
  room: VeilColyseusRoom,
  client: FakeClient,
  playerId: string,
  requestId: string
): Promise<void> {
  room.clients.push(client);
  room.onJoin(client, { playerId });
  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId,
    roomId: room.roomId,
    playerId
  });
}

function getBattleForPlayer(room: VeilColyseusRoom, playerId: string): BattleState | null {
  const internalRoom = room as VeilColyseusRoom & {
    worldRoom: {
      getBattleForPlayer(playerId: string): BattleState | null;
    };
  };

  return internalRoom.worldRoom.getBattleForPlayer(playerId);
}

async function resolveBattleThroughRoom(room: VeilColyseusRoom, client: FakeClient, playerId: string): Promise<number> {
  let steps = 0;
  while (steps < 20) {
    const battle = getBattleForPlayer(room, playerId);
    if (!battle) {
      return steps;
    }

    const activeUnitId = battle.activeUnitId;
    const activeUnit = activeUnitId ? battle.units[activeUnitId] : undefined;
    const target = activeUnit
      ? Object.values(battle.units).find((unit) => unit.camp !== activeUnit.camp && unit.count > 0)
      : undefined;

    assert.ok(activeUnitId, "expected an active unit while battle is in progress");
    assert.ok(target, "expected a valid battle target while battle is in progress");

    await emitRoomMessage(room, "battle.action", client, {
      type: "battle.action",
      requestId: `battle-step-${steps + 1}`,
      action: {
        type: "battle.attack",
        attackerId: activeUnitId,
        defenderId: target.id
      }
    });
    steps += 1;
  }

  assert.fail(`expected battle for ${playerId} to resolve within 20 player actions`);
}

async function resolvePvPBattleThroughRoom(
  room: VeilColyseusRoom,
  clientsByPlayerId: Record<string, FakeClient>
): Promise<number> {
  const internalRoom = room as VeilColyseusRoom & {
    worldRoom: {
      getInternalState(): {
        heroes: Array<{
          id: string;
          playerId: string;
        }>;
      };
    };
  };

  let steps = 0;
  while (steps < 20) {
    const attackerBattle = getBattleForPlayer(room, "player-1");
    const defenderBattle = getBattleForPlayer(room, "player-2");
    const battle = attackerBattle ?? defenderBattle;
    if (!battle) {
      return steps;
    }

    const activeUnitId = battle.activeUnitId;
    const activeUnit = activeUnitId ? battle.units[activeUnitId] : undefined;
    const target = activeUnit
      ? Object.values(battle.units).find((unit) => unit.camp !== activeUnit.camp && unit.count > 0)
      : undefined;
    const attackerHero = battle.worldHeroId
      ? internalRoom.worldRoom.getInternalState().heroes.find((hero) => hero.id === battle.worldHeroId)
      : undefined;
    const defenderHero = battle.defenderHeroId
      ? internalRoom.worldRoom.getInternalState().heroes.find((hero) => hero.id === battle.defenderHeroId)
      : undefined;
    const playerId = activeUnit?.camp === "attacker" ? attackerHero?.playerId : defenderHero?.playerId;
    const client = clientsByPlayerId[playerId];

    assert.ok(activeUnitId, "expected an active unit while battle is in progress");
    assert.ok(activeUnit, "expected an active unit while battle is in progress");
    assert.ok(target, "expected a valid battle target while battle is in progress");
    assert.ok(client, `expected a client for ${playerId}`);

    await emitRoomMessage(room, "battle.action", client, {
      type: "battle.action",
      requestId: `pvp-battle-step-${steps + 1}`,
      action: {
        type: "battle.attack",
        attackerId: activeUnitId,
        defenderId: target.id
      }
    });
    steps += 1;
  }

  assert.fail("expected PvP battle to resolve within 20 player actions");
}

function lastSessionState(client: FakeClient, delivery?: "reply" | "push"): Extract<ServerMessage, { type: "session.state" }> {
  const states = client.sent.filter(
    (message): message is Extract<ServerMessage, { type: "session.state" }> =>
      message.type === "session.state" && (delivery ? message.delivery === delivery : true)
  );
  const latest = states.at(-1);
  assert.ok(latest, "expected a session.state message");
  return latest;
}

function lastTurnTimer(client: FakeClient): Extract<ServerMessage, { type: "turn.timer" }> {
  const timers = client.sent.filter(
    (message): message is Extract<ServerMessage, { type: "turn.timer" }> => message.type === "turn.timer"
  );
  const latest = timers.at(-1);
  assert.ok(latest, "expected a turn.timer message");
  return latest;
}

test("room creation and connect reflect one connected player in room state", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-connect-${Date.now()}`);
  const client = createFakeClient("session-connect");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  room.clients.push(client);
  room.onJoin(client, { playerId: "player-1" });

  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId: "connect-1",
    roomId: room.roomId,
    playerId: "player-1"
  });

  assert.equal(listLobbyRooms().find((entry) => entry.roomId === room.roomId)?.connectedPlayers, 1);
  assert.equal(lastSessionState(client, "reply").payload.world.ownHeroes[0]?.playerId, "player-1");
});

test("room creation registers the active instance and publishes an idle lobby summary before joins", async (t) => {
  resetLobbyRoomRegistry();
  resetRuntimeObservability();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-create-registration-${Date.now()}`, 2222);

  t.after(() => {
    cleanupRoom(room);
    getActiveRoomInstances().clear();
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
    resetRuntimeObservability();
  });

  const summary = listLobbyRooms().find((entry) => entry.roomId === room.roomId);
  const lifecycle = buildRoomLifecycleSummaryPayload();

  assert.equal(getActiveRoomInstances().get(room.roomId), room);
  assert.ok(summary);
  assert.equal(summary.seed, 2222);
  assert.equal(summary.connectedPlayers, 0);
  assert.equal(summary.disconnectedPlayers, 0);
  assert.equal(summary.activeBattles, 0);
  assert.equal(summary.statusLabel, "探索中");
  assert.equal(lifecycle.summary.activeRoomCount, 1);
  assert.equal(lifecycle.summary.counters.roomCreatesTotal, 1);
  assert.equal(lifecycle.summary.recentEvents[0]?.kind, "room.created");
  assert.equal(lifecycle.summary.recentEvents[0]?.roomId, room.roomId);
});

test("session.state redacts fog-hidden enemy occupants from serialized player snapshots", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-fog-redaction-${Date.now()}`);
  const attackerClient = createFakeClient("session-fog-player-1");
  const defenderClient = createFakeClient("session-fog-player-2");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, attackerClient, "player-1", "connect-player-1");
  await connectPlayer(room, defenderClient, "player-2", "connect-player-2");

  const attackerWorld = decodePlayerWorldView(lastSessionState(attackerClient, "reply").payload.world);
  const defenderWorld = decodePlayerWorldView(lastSessionState(defenderClient, "reply").payload.world);
  const defenderPosition = defenderWorld.ownHeroes[0]?.position;

  assert.ok(defenderPosition, "expected player-2 own hero position");
  const hiddenTile = attackerWorld.map.tiles.find(
    (tile) => tile.position.x === defenderPosition.x && tile.position.y === defenderPosition.y
  );

  assert.ok(hiddenTile, "expected player-1 snapshot tile for player-2 position");
  assert.equal(hiddenTile.fog, "hidden");
  assert.equal(hiddenTile.terrain, "unknown");
  assert.equal(hiddenTile.walkable, false);
  assert.equal(hiddenTile.occupant, undefined);
  assert.equal(hiddenTile.resource, undefined);
  assert.equal(hiddenTile.building, undefined);
  assert.equal(attackerWorld.visibleHeroes.some((hero) => hero.playerId === "player-2"), false);
});

test("persisted room bootstrap rebinds the default slot to the joining player and hydrates the saved state", async (t) => {
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  const roomId = `lifecycle-bootstrap-${Date.now()}`;
  const seededRoom = createRoom(roomId, 1777);
  seededRoom.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 1 }
  });
  await store.save(roomId, seededRoom.serializePersistenceSnapshot());
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(roomId, 2444);
  const client = createFakeClient("session-bootstrap");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, client, "guest-bootstrap", "connect-bootstrap");

  const connectedState = lastSessionState(client, "reply");
  const persistedSnapshot = await store.load(roomId);
  const roomSummary = listLobbyRooms().find((entry) => entry.roomId === roomId);

  assert.deepEqual(connectedState.payload.world.ownHeroes[0]?.position, { x: 2, y: 1 });
  assert.equal(connectedState.payload.world.ownHeroes[0]?.playerId, "guest-bootstrap");
  assert.equal(persistedSnapshot?.state.heroes.find((hero) => hero.id === "hero-1")?.playerId, "guest-bootstrap");
  assert.equal(roomSummary?.seed, 1777);
  assert.equal(roomSummary?.connectedPlayers, 1);
});

test("room bootstrap save failures reject creation without publishing a lobby summary", async () => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(new FailingBootstrapSaveStore());
  const roomId = `lifecycle-bootstrap-failure-${Date.now()}`;

  await assert.rejects(createTestRoom(roomId), /bootstrap save failed/);

  assert.equal(listLobbyRooms().some((entry) => entry.roomId === roomId), false);
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
});

test("connect logs player account initialization failures instead of silently swallowing them", async (t) => {
  resetLobbyRoomRegistry();
  const failure = new Error("ensure account failed");
  configureRoomSnapshotStore(new FailingEnsurePlayerAccountStore(failure));
  const room = await createTestRoom(`lifecycle-account-init-failure-${Date.now()}`);
  const client = createFakeClient("session-account-init-failure");
  const errorCalls: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errorCalls.push(args);
  };

  t.after(() => {
    console.error = originalConsoleError;
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  room.clients.push(client);
  room.onJoin(client, { playerId: "player-1" });

  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId: "connect-account-init-failure",
    roomId: room.roomId,
    playerId: "player-1"
  });

  assert.equal(errorCalls.length, 1);
  assert.equal(errorCalls[0]?.[0], "[VeilRoom] Failed to ensure player account during connect");
  assert.deepEqual(errorCalls[0]?.[1], {
    roomId: room.roomId,
    playerId: "player-1",
    error: failure
  });
  assert.equal(lastSessionState(client, "reply").payload.world.ownHeroes[0]?.playerId, "player-1");
});

test("client reconnect within the window restores room state and records reconnectedAt", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  resetRuntimeObservability();
  const room = await createTestRoom(`lifecycle-reconnect-${Date.now()}`);
  const originalClient = createFakeClient("session-original");
  const reconnectedClient = createFakeClient("session-reconnected");
  const internalRoom = room as VeilColyseusRoom & {
    worldRoom: {
      dispatch(playerId: string, action: object): unknown;
    };
    playerIdBySessionId: Map<string, string>;
    reconnectedAtByPlayerId: Map<string, string>;
    allowReconnection(client: Client, seconds: number): Promise<Client>;
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
    resetRuntimeObservability();
  });

  room.clients.push(originalClient);
  room.onJoin(originalClient, { playerId: "player-1" });

  await emitRoomMessage(room, "connect", originalClient, {
    type: "connect",
    requestId: "connect-2",
    roomId: room.roomId,
    playerId: "player-1"
  });

  internalRoom.worldRoom.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 1 }
  });

  internalRoom.allowReconnection = async () => reconnectedClient;
  await room.onDrop(originalClient);

  assert.equal(internalRoom.playerIdBySessionId.has("session-original"), false);
  assert.equal(internalRoom.playerIdBySessionId.get("session-reconnected"), "player-1");
  assert.equal(listLobbyRooms().filter((entry) => entry.roomId === room.roomId).length, 1);
  assert.equal(listLobbyRooms().find((entry) => entry.roomId === room.roomId)?.connectedPlayers, 1);

  const reconnectState = lastSessionState(reconnectedClient, "push");
  assert.deepEqual(reconnectState.payload.world.ownHeroes[0]?.position, { x: 2, y: 1 });

  const reconnectedAt = internalRoom.reconnectedAtByPlayerId.get("player-1");
  assert.ok(reconnectedAt);
  assert.equal(new Date(reconnectedAt).toISOString(), reconnectedAt);

  const summary = buildRoomLifecycleSummaryPayload();
  assert.equal(summary.summary.counters.roomCreatesTotal, 1);
  assert.equal(summary.summary.counters.roomDisposalsTotal, 0);
  assert.equal(summary.summary.recentEvents.some((event) => event.kind === "reconnect.succeeded"), true);
  assert.equal(
    summary.summary.recentEvents.find((event) => event.kind === "reconnect.succeeded")?.playerId,
    "player-1"
  );
});

test("reconnect preserves lobby registration counts while other players stay connected", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-reconnect-multi-${Date.now()}`);
  const reconnectingClient = createFakeClient("session-reconnect-multi");
  const reconnectedClient = createFakeClient("session-reconnect-multi-resumed");
  const otherClient = createFakeClient("session-reconnect-multi-other");
  const internalRoom = room as VeilColyseusRoom & {
    playerIdBySessionId: Map<string, string>;
    allowReconnection(client: Client, seconds: number): Promise<Client>;
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, reconnectingClient, "player-reconnect-multi", "connect-reconnect-multi");
  await connectPlayer(room, otherClient, "player-other-multi", "connect-other-multi");

  assert.equal(listLobbyRooms().find((entry) => entry.roomId === room.roomId)?.connectedPlayers, 2);

  internalRoom.allowReconnection = async () => {
    room.clients.push(reconnectedClient);
    return reconnectedClient;
  };
  await room.onDrop(reconnectingClient);

  assert.equal(internalRoom.playerIdBySessionId.get(reconnectedClient.sessionId), "player-reconnect-multi");
  assert.equal(internalRoom.playerIdBySessionId.get(otherClient.sessionId), "player-other-multi");
  assert.equal(listLobbyRooms().find((entry) => entry.roomId === room.roomId)?.connectedPlayers, 2);

  const resumedState = lastSessionState(reconnectedClient, "push");
  assert.equal(resumedState.requestId, "push");
  assert.equal(resumedState.delivery, "push");
});

test("stale leave after a successful reconnect does not clear the resumed player slot", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-reconnect-leave-${Date.now()}`);
  const originalClient = createFakeClient("session-stale-original");
  const reconnectedClient = createFakeClient("session-stale-reconnected");
  const internalRoom = room as VeilColyseusRoom & {
    playerIdBySessionId: Map<string, string>;
    allowReconnection(client: Client, seconds: number): Promise<Client>;
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, originalClient, "player-1", "connect-stale-original");
  internalRoom.allowReconnection = async () => reconnectedClient;

  await room.onDrop(originalClient);
  room.onLeave(originalClient);

  assert.equal(internalRoom.playerIdBySessionId.get("session-stale-reconnected"), "player-1");
  assert.equal(listLobbyRooms().find((entry) => entry.roomId === room.roomId)?.connectedPlayers, 1);
});

test("client that misses the reconnect window is cleaned up from the player slot map", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  resetRuntimeObservability();
  const room = await createTestRoom(`lifecycle-reconnect-timeout-${Date.now()}`);
  const client = createFakeClient("session-timeout");
  const internalRoom = room as VeilColyseusRoom & {
    playerIdBySessionId: Map<string, string>;
    allowReconnection(client: Client, seconds: number): Promise<Client>;
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
    resetRuntimeObservability();
  });

  room.clients.push(client);
  room.onJoin(client, { playerId: "player-1" });

  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId: "connect-3",
    roomId: room.roomId,
    playerId: "player-1"
  });

  internalRoom.allowReconnection = async () => {
    throw new Error("reconnect window expired");
  };
  await room.onDrop(client);

  assert.equal(internalRoom.playerIdBySessionId.has("session-timeout"), false);
  assert.equal(listLobbyRooms().find((entry) => entry.roomId === room.roomId)?.connectedPlayers, 0);

  const summary = buildRoomLifecycleSummaryPayload();
  assert.equal(summary.summary.counters.roomCreatesTotal, 1);
  assert.equal(summary.summary.recentEvents.some((event) => event.kind === "reconnect.failed"), true);
  assert.equal(
    summary.summary.recentEvents.find((event) => event.kind === "reconnect.failed")?.reason,
    "reconnect_window_expired"
  );
});

test("reconnect rejects a player who becomes banned before the resumed session is restored", async (t) => {
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-reconnect-banned-${Date.now()}`);
  const originalClient = createFakeClient("session-reconnect-banned-original");
  const reconnectedClient = createFakeClient("session-reconnect-banned-resumed");
  const internalRoom = room as VeilColyseusRoom & {
    playerIdBySessionId: Map<string, string>;
    allowReconnection(client: Client, seconds: number): Promise<Client>;
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, originalClient, "player-banned-mid-reconnect", "connect-reconnect-banned");
  await store.savePlayerBan("player-banned-mid-reconnect", {
    banStatus: "temporary",
    banExpiry: "2026-04-10T00:00:00.000Z",
    banReason: "Reconnect ban"
  });

  internalRoom.allowReconnection = async () => reconnectedClient;
  await room.onDrop(originalClient);

  const summary = listLobbyRooms().find((entry) => entry.roomId === room.roomId);
  assert.equal(internalRoom.playerIdBySessionId.has(originalClient.sessionId), false);
  assert.equal(internalRoom.playerIdBySessionId.has(reconnectedClient.sessionId), false);
  assert.equal(reconnectedClient.leaveCalls.at(-1)?.reason, "account_banned");
  assert.equal(reconnectedClient.sent.some((message) => message.type === "session.state"), false);
  assert.equal(summary?.connectedPlayers, 0);
  assert.equal(summary?.disconnectedPlayers, 1);
  assert.equal(summary?.statusLabel, "等待重连");
});

test("failed reconnect cleanup removes only the expired session and preserves other connected players", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-reconnect-timeout-multi-${Date.now()}`);
  const timeoutClient = createFakeClient("session-timeout-multi");
  const steadyClient = createFakeClient("session-steady-multi");
  const internalRoom = room as VeilColyseusRoom & {
    playerIdBySessionId: Map<string, string>;
    allowReconnection(client: Client, seconds: number): Promise<Client>;
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, timeoutClient, "player-timeout", "connect-timeout-multi");
  await connectPlayer(room, steadyClient, "player-steady", "connect-steady-multi");

  internalRoom.allowReconnection = async () => {
    throw new Error("reconnect window expired");
  };
  await room.onDrop(timeoutClient);
  room.onLeave(timeoutClient);

  assert.equal(internalRoom.playerIdBySessionId.has("session-timeout-multi"), false);
  assert.equal(internalRoom.playerIdBySessionId.get("session-steady-multi"), "player-steady");
  assert.deepEqual(Array.from(internalRoom.playerIdBySessionId.values()), ["player-steady"]);
  assert.equal(listLobbyRooms().find((entry) => entry.roomId === room.roomId)?.connectedPlayers, 1);
  assert.equal(lastSessionState(steadyClient, "reply").payload.world.ownHeroes[0]?.playerId, "player-steady");
});

test("player leave keeps the disconnected timestamp for the departed player and preserves connected peers", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-leave-bookkeeping-${Date.now()}`);
  const leavingClient = createFakeClient("session-leave-bookkeeping");
  const steadyClient = createFakeClient("session-leave-steady");
  const internalRoom = room as VeilColyseusRoom & {
    playerIdBySessionId: Map<string, string>;
    disconnectedAtByPlayerId: Map<string, string>;
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, leavingClient, "player-leaving", "connect-leaving");
  await connectPlayer(room, steadyClient, "player-steady", "connect-steady");

  room.onLeave(leavingClient);

  assert.equal(internalRoom.playerIdBySessionId.has("session-leave-bookkeeping"), false);
  assert.equal(internalRoom.playerIdBySessionId.get("session-leave-steady"), "player-steady");
  assert.ok(internalRoom.disconnectedAtByPlayerId.get("player-leaving"));
  assert.equal(internalRoom.disconnectedAtByPlayerId.has("player-steady"), false);
  assert.equal(listLobbyRooms().find((entry) => entry.roomId === room.roomId)?.connectedPlayers, 1);
});

test("room disposal after the last client leaves removes it from the active room list", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  resetRuntimeObservability();
  const room = await createTestRoom(`lifecycle-dispose-${Date.now()}`);
  const client = createFakeClient("session-dispose");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
    resetRuntimeObservability();
  });

  room.clients.push(client);
  room.onJoin(client, { playerId: "player-1" });
  room.onLeave(client);
  room.onDispose();

  assert.equal(listLobbyRooms().some((entry) => entry.roomId === room.roomId), false);

  const summary = buildRoomLifecycleSummaryPayload();
  assert.equal(summary.summary.counters.roomCreatesTotal, 1);
  assert.equal(summary.summary.counters.roomDisposalsTotal, 1);
  assert.equal(summary.summary.recentEvents[0]?.kind, "room.disposed");
  assert.equal(summary.summary.recentEvents[0]?.reason, "dispose");
});

test("stale room disposal cannot unregister a replacement room with the same logical id", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const logicalRoomId = `lifecycle-multi-room-${Date.now()}`;
  const firstRoom = await createTestRoom(logicalRoomId, 3101);
  const secondRoom = await createTestRoom(logicalRoomId, 4202);

  t.after(() => {
    cleanupRoom(firstRoom);
    cleanupRoom(secondRoom);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  const summaryAfterReplacement = listLobbyRooms().find((entry) => entry.roomId === logicalRoomId);
  assert.ok(summaryAfterReplacement);
  assert.equal(summaryAfterReplacement.seed, 4202);

  firstRoom.onDispose();
  const summaryAfterStaleDispose = listLobbyRooms().find((entry) => entry.roomId === logicalRoomId);
  assert.ok(summaryAfterStaleDispose);
  assert.equal(summaryAfterStaleDispose.seed, 4202);

  secondRoom.onDispose();
  assert.equal(listLobbyRooms().some((entry) => entry.roomId === logicalRoomId), false);
});

test("active room registry keeps the replacement instance through stale disposal", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const logicalRoomId = `lifecycle-active-room-registry-${Date.now()}`;
  const firstRoom = await createTestRoom(logicalRoomId, 3101);
  const secondRoom = await createTestRoom(logicalRoomId, 4202);

  t.after(() => {
    cleanupRoom(firstRoom);
    cleanupRoom(secondRoom);
    getActiveRoomInstances().clear();
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  assert.equal(getActiveRoomInstances().get(logicalRoomId), secondRoom);

  firstRoom.onDispose();
  assert.equal(getActiveRoomInstances().get(logicalRoomId), secondRoom);

  secondRoom.onDispose();
  assert.equal(getActiveRoomInstances().has(logicalRoomId), false);
});

test("simultaneous rooms keep seeded world state isolated", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const roomA = await createTestRoom(`lifecycle-room-a-${Date.now()}`, 1001);
  const roomB = await createTestRoom(`lifecycle-room-b-${Date.now()}`, 2002);
  const clientA = createFakeClient("session-a");
  const clientB = createFakeClient("session-b");
  const internalRoomA = roomA as VeilColyseusRoom & {
    worldRoom: {
      dispatch(playerId: string, action: object): unknown;
      getInternalState(): { meta: { seed: number } };
    };
  };
  const internalRoomB = roomB as VeilColyseusRoom & {
    worldRoom: {
      getInternalState(): { meta: { seed: number } };
    };
  };

  t.after(() => {
    cleanupRoom(roomA);
    cleanupRoom(roomB);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  roomA.clients.push(clientA);
  roomA.onJoin(clientA, { playerId: "player-1" });
  roomB.clients.push(clientB);
  roomB.onJoin(clientB, { playerId: "player-1" });

  internalRoomA.worldRoom.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 1 }
  });

  await emitRoomMessage(roomA, "connect", clientA, {
    type: "connect",
    requestId: "connect-a",
    roomId: roomA.roomId,
    playerId: "player-1"
  });
  await emitRoomMessage(roomB, "connect", clientB, {
    type: "connect",
    requestId: "connect-b",
    roomId: roomB.roomId,
    playerId: "player-1"
  });

  assert.equal(internalRoomA.worldRoom.getInternalState().meta.seed, 1001);
  assert.equal(internalRoomB.worldRoom.getInternalState().meta.seed, 2002);
  assert.deepEqual(lastSessionState(clientA, "reply").payload.world.ownHeroes[0]?.position, { x: 2, y: 1 });
  assert.deepEqual(lastSessionState(clientB, "reply").payload.world.ownHeroes[0]?.position, { x: 1, y: 1 });
});

test("reconnect and disposal stay scoped to the originating room when the same player joins multiple rooms", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const roomA = await createTestRoom(`lifecycle-scope-a-${Date.now()}`, 1001);
  const roomB = await createTestRoom(`lifecycle-scope-b-${Date.now()}`, 2002);
  const originalClientA = createFakeClient("session-scope-a-original");
  const resumedClientA = createFakeClient("session-scope-a-resumed");
  const clientB = createFakeClient("session-scope-b");
  const internalRoomA = roomA as VeilColyseusRoom & {
    worldRoom: {
      dispatch(playerId: string, action: object): unknown;
    };
    allowReconnection(client: Client, seconds: number): Promise<Client>;
  };

  t.after(() => {
    cleanupRoom(roomA);
    cleanupRoom(roomB);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(roomA, originalClientA, "player-1", "connect-scope-a");
  await connectPlayer(roomB, clientB, "player-1", "connect-scope-b");

  internalRoomA.worldRoom.dispatch("player-1", {
    type: "hero.move",
    heroId: "hero-1",
    destination: { x: 2, y: 1 }
  });

  internalRoomA.allowReconnection = async () => resumedClientA;
  await roomA.onDrop(originalClientA);

  const roomSummariesAfterReconnect = listLobbyRooms();
  assert.equal(roomSummariesAfterReconnect.length, 2);
  assert.equal(roomSummariesAfterReconnect.find((entry) => entry.roomId === roomA.roomId)?.connectedPlayers, 1);
  assert.equal(roomSummariesAfterReconnect.find((entry) => entry.roomId === roomB.roomId)?.connectedPlayers, 1);
  assert.deepEqual(lastSessionState(resumedClientA, "push").payload.world.ownHeroes[0]?.position, { x: 2, y: 1 });
  assert.deepEqual(lastSessionState(clientB, "reply").payload.world.ownHeroes[0]?.position, { x: 1, y: 1 });

  roomA.onDispose();

  const remainingRooms = listLobbyRooms();
  assert.deepEqual(
    remainingRooms.map((entry) => entry.roomId),
    [roomB.roomId]
  );
  assert.equal(remainingRooms[0]?.connectedPlayers, 1);
});

test("disposing one registered room preserves the other room summary", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const roomA = await createTestRoom(`lifecycle-registry-a-${Date.now()}`, 1001);
  const roomB = await createTestRoom(`lifecycle-registry-b-${Date.now()}`, 2002);

  t.after(() => {
    cleanupRoom(roomA);
    cleanupRoom(roomB);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  assert.deepEqual(
    listLobbyRooms()
      .map((entry) => entry.roomId)
      .sort(),
    [roomA.roomId, roomB.roomId].sort()
  );

  roomA.onDispose();

  const remainingRooms = listLobbyRooms();
  assert.deepEqual(
    remainingRooms.map((entry) => entry.roomId),
    [roomB.roomId]
  );
  assert.equal(remainingRooms[0]?.seed, 2002);
});

test("stale leave and dispose from a previous room instance do not overwrite a reused logical room summary", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const logicalRoomId = `lifecycle-reuse-${Date.now()}`;
  const roomA = await createTestRoom(logicalRoomId, 1001);
  const roomB = await createTestRoom(logicalRoomId, 2002);
  const clientA = createFakeClient("session-reuse-a");
  const clientB = createFakeClient("session-reuse-b");

  t.after(() => {
    cleanupRoom(roomA);
    cleanupRoom(roomB);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(roomA, clientA, "player-1", "connect-reuse-a");
  await connectPlayer(roomB, clientB, "player-2", "connect-reuse-b");

  roomA.onLeave(clientA);
  roomA.onDispose();

  const reusedRoomSummary = listLobbyRooms().find((entry) => entry.roomId === logicalRoomId);
  assert.ok(reusedRoomSummary);
  assert.equal(reusedRoomSummary.seed, 2002);
  assert.equal(reusedRoomSummary.connectedPlayers, 1);
  assert.equal(lastSessionState(clientB, "reply").payload.world.ownHeroes[0]?.playerId, "player-2");
});

test("battle replay persistence runs once at settlement and is drained from the room buffer", async (t) => {
  resetLobbyRoomRegistry();
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-replay-${Date.now()}`);
  const client = createFakeClient("session-replay");
  const internalRoom = room as VeilColyseusRoom & {
    worldRoom: {
      consumeCompletedBattleReplays(): unknown[];
    };
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, client, "player-1", "connect-replay");
  await emitRoomMessage(room, "world.action", client, {
    type: "world.action",
    requestId: "move-replay",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 5, y: 4 }
    }
  });

  assert.equal((await store.loadPlayerAccount("player-1"))?.recentBattleReplays?.length ?? 0, 0);

  const steps = await resolveBattleThroughRoom(room, client, "player-1");
  const account = await store.loadPlayerAccount("player-1");
  const replay = account?.recentBattleReplays?.[0];
  const replaySaves = store.progressSaves.filter(
    (entry) => entry.playerId === "player-1" && (entry.patch.recentBattleReplays?.length ?? 0) > 0
  );

  assert.ok(steps > 0);
  assert.equal(account?.recentBattleReplays?.length, 1);
  assert.equal(replay?.roomId, room.roomId);
  assert.equal(replay?.steps.filter((step) => step.source === "player").length, steps);
  assert.ok((replay?.steps.length ?? 0) > steps);
  assert.ok(replay?.steps.some((step) => step.source === "automated"));
  assert.equal(replaySaves.length, 1);
  assert.equal(replaySaves[0]?.patch.recentBattleReplays?.[0]?.id, replay?.id);
  assert.deepEqual(internalRoom.worldRoom.consumeCompletedBattleReplays(), []);
});

test("battle settlement increments lifecycle completion metrics", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  resetRuntimeObservability();
  const room = await createTestRoom(`lifecycle-battle-metrics-${Date.now()}`);
  const client = createFakeClient("session-battle-metrics");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
    resetRuntimeObservability();
  });

  await connectPlayer(room, client, "player-1", "connect-battle-metrics");
  await emitRoomMessage(room, "world.action", client, {
    type: "world.action",
    requestId: "move-battle-metrics",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 5, y: 4 }
    }
  });

  const steps = await resolveBattleThroughRoom(room, client, "player-1");
  const summary = buildRoomLifecycleSummaryPayload();

  assert.ok(steps > 0);
  assert.equal(summary.summary.counters.battleCompletionsTotal, 1);
  assert.equal(summary.summary.counters.battleAbortsTotal, 0);
  assert.equal(summary.summary.recentEvents.some((event) => event.kind === "battle.completed"), true);
  assert.equal(
    summary.summary.recentEvents.find((event) => event.kind === "battle.completed")?.roomId,
    room.roomId
  );
});

test("disposing a room with an active battle records a battle abort", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  resetRuntimeObservability();
  const room = await createTestRoom(`lifecycle-battle-abort-${Date.now()}`);
  const client = createFakeClient("session-battle-abort");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
    resetRuntimeObservability();
  });

  await connectPlayer(room, client, "player-1", "connect-battle-abort");
  await emitRoomMessage(room, "world.action", client, {
    type: "world.action",
    requestId: "move-battle-abort",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 5, y: 4 }
    }
  });

  assert.ok(getBattleForPlayer(room, "player-1"));
  room.onDispose();

  const summary = buildRoomLifecycleSummaryPayload();
  assert.equal(summary.summary.counters.battleCompletionsTotal, 0);
  assert.equal(summary.summary.counters.battleAbortsTotal, 1);
  assert.equal(summary.summary.counters.roomDisposalsTotal, 1);
  assert.equal(summary.summary.recentEvents[0]?.kind, "room.disposed");
  assert.equal(summary.summary.recentEvents[1]?.kind, "battle.aborted");
  assert.equal(summary.summary.recentEvents[1]?.reason, "dispose");
});

test("invalid world actions return a structured rejection only to the originating client", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-world-rejection-${Date.now()}`);
  const sourceClient = createFakeClient("session-world-rejection-source");
  const observerClient = createFakeClient("session-world-rejection-observer");
  const internalRoom = room as VeilColyseusRoom & {
    worldRoom: {
      getInternalState(): {
        heroes: Array<{
          id: string;
          playerId: string;
          move: { total: number; remaining: number };
        }>;
      };
    };
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, sourceClient, "player-1", "connect-world-rejection-source");
  await connectPlayer(room, observerClient, "player-2", "connect-world-rejection-observer");

  const sourceHero = internalRoom.worldRoom.getInternalState().heroes.find((hero) => hero.playerId === "player-1");
  assert.ok(sourceHero);
  sourceHero.move.remaining = 1;

  const observerPushCountBefore = observerClient.sent.filter(
    (message) => message.type === "session.state" && message.delivery === "push"
  ).length;

  await emitRoomMessage(room, "world.action", sourceClient, {
    type: "world.action",
    requestId: "world-rejection",
    action: {
      type: "hero.move",
      heroId: sourceHero.id,
      destination: { x: 5, y: 4 }
    }
  });

  const reply = lastSessionState(sourceClient, "reply");
  const observerPushCountAfter = observerClient.sent.filter(
    (message) => message.type === "session.state" && message.delivery === "push"
  ).length;

  assert.equal(reply.requestId, "world-rejection");
  assert.equal(reply.payload.reason, "not_enough_move_points");
  assert.deepEqual(reply.payload.rejection, {
    scope: "world",
    actionType: "hero.move",
    reason: "not_enough_move_points"
  });
  assert.equal(reply.payload.events.length, 0);
  assert.equal(observerPushCountAfter, observerPushCountBefore);
});

test("invalid battle actions return a structured rejection only to the originating client", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-battle-rejection-${Date.now()}`);
  const sourceClient = createFakeClient("session-battle-rejection-source");
  const observerClient = createFakeClient("session-battle-rejection-observer");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, sourceClient, "player-1", "connect-battle-rejection-source");
  await connectPlayer(room, observerClient, "player-2", "connect-battle-rejection-observer");

  await emitRoomMessage(room, "world.action", sourceClient, {
    type: "world.action",
    requestId: "battle-rejection-start",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 5, y: 4 }
    }
  });

  const battle = getBattleForPlayer(room, "player-1");
  assert.ok(battle);
  const playerUnit = Object.values(battle.units).find((unit) => unit.camp === "attacker");
  const opposingUnit = Object.values(battle.units).find((unit) => unit.camp === "defender");
  assert.ok(playerUnit);
  assert.ok(opposingUnit);

  battle.activeUnitId = playerUnit.id;
  battle.turnOrder = [playerUnit.id, opposingUnit.id];
  battle.unitCooldowns[playerUnit.id] = {
    ...battle.unitCooldowns[playerUnit.id],
    power_shot: 1
  };

  const observerPushCountBefore = observerClient.sent.filter(
    (message) => message.type === "session.state" && message.delivery === "push"
  ).length;

  await emitRoomMessage(room, "battle.action", sourceClient, {
    type: "battle.action",
    requestId: "battle-rejection",
    action: {
      type: "battle.skill",
      unitId: playerUnit.id,
      skillId: "power_shot",
      targetId: opposingUnit.id
    }
  });

  const reply = lastSessionState(sourceClient, "reply");
  const observerPushCountAfter = observerClient.sent.filter(
    (message) => message.type === "session.state" && message.delivery === "push"
  ).length;

  assert.equal(reply.requestId, "battle-rejection");
  assert.equal(reply.payload.reason, "skill_on_cooldown");
  assert.deepEqual(reply.payload.rejection, {
    scope: "battle",
    actionType: "battle.skill",
    reason: "skill_on_cooldown"
  });
  assert.equal(reply.payload.events.length, 0);
  assert.equal(observerPushCountAfter, observerPushCountBefore);
});

test("battle settlement grants configured season XP to the settled player account", async (t) => {
  resetLobbyRoomRegistry();
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-battle-pass-${Date.now()}`);
  const client = createFakeClient("session-battle-pass");
  const battlePassConfig = resolveBattlePassConfig();

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, client, "player-1", "connect-battle-pass");
  await emitRoomMessage(room, "world.action", client, {
    type: "world.action",
    requestId: "move-battle-pass",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 5, y: 4 }
    }
  });

  await resolveBattleThroughRoom(room, client, "player-1");

  const account = await store.loadPlayerAccount("player-1");
  const replay = account?.recentBattleReplays?.[0];
  const expectedXp =
    replay?.playerCamp === "attacker" && replay.result === "attacker_victory"
      ? battlePassConfig.seasonXpPerWin
      : replay?.playerCamp === "defender" && replay.result === "defender_victory"
        ? battlePassConfig.seasonXpPerWin
        : battlePassConfig.seasonXpPerLoss;

  assert.ok(replay);
  assert.equal(account?.seasonXp, expectedXp);
  assert.equal(account?.seasonPassTier, 1);
});

test("battle replay patches are not re-emitted on later non-replay progress saves", async (t) => {
  resetLobbyRoomRegistry();
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-replay-single-emission-${Date.now()}`);
  const client = createFakeClient("session-replay-single-emission");
  const internalRoom = room as VeilColyseusRoom & {
    persistPlayerAccountProgress(events: WorldEvent[], completedReplays: unknown[]): Promise<void>;
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, client, "player-1", "connect-replay-single-emission");
  await emitRoomMessage(room, "world.action", client, {
    type: "world.action",
    requestId: "move-replay-single-emission-start",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 5, y: 4 }
    }
  });

  const openingMoveEvents = lastSessionState(client, "reply").payload.events;
  const steps = await resolveBattleThroughRoom(room, client, "player-1");
  const replayId = (await store.loadPlayerAccount("player-1"))?.recentBattleReplays?.[0]?.id;
  const initialReplaySaves = store.progressSaves.filter(
    (entry) => entry.playerId === "player-1" && (entry.patch.recentBattleReplays?.length ?? 0) > 0
  );

  assert.ok(steps > 0);
  assert.ok(replayId);
  assert.ok(openingMoveEvents.length > 0, "expected the opening room action to generate player-facing events");
  assert.equal(initialReplaySaves.length, 1);

  await internalRoom.persistPlayerAccountProgress(openingMoveEvents, []);

  const replaySavesAfterFollowupPersist = store.progressSaves.filter(
    (entry) => entry.playerId === "player-1" && (entry.patch.recentBattleReplays?.length ?? 0) > 0
  );
  const account = await store.loadPlayerAccount("player-1");

  assert.equal(replaySavesAfterFollowupPersist.length, 1);
  assert.equal(replaySavesAfterFollowupPersist[0]?.patch.recentBattleReplays?.[0]?.id, replayId);
  assert.equal(account?.recentBattleReplays?.length, 1);
  assert.equal(account?.recentBattleReplays?.[0]?.id, replayId);
});

test("battle replay persistence stays isolated to the room that settled the battle", async (t) => {
  resetLobbyRoomRegistry();
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const roomA = await createTestRoom(`lifecycle-replay-room-a-${Date.now()}`, 1001);
  const roomB = await createTestRoom(`lifecycle-replay-room-b-${Date.now()}`, 2002);
  const clientA = createFakeClient("session-replay-a");
  const clientB = createFakeClient("session-replay-b");

  t.after(() => {
    cleanupRoom(roomA);
    cleanupRoom(roomB);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(roomA, clientA, "player-1", "connect-replay-a");
  await connectPlayer(roomB, clientB, "player-2", "connect-replay-b");
  await emitRoomMessage(roomA, "world.action", clientA, {
    type: "world.action",
    requestId: "move-room-a",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 5, y: 4 }
    }
  });
  await resolveBattleThroughRoom(roomA, clientA, "player-1");

  const roomAAccount = await store.loadPlayerAccount("player-1");
  const roomBAccount = await store.loadPlayerAccount("player-2");

  assert.equal(roomAAccount?.recentBattleReplays?.length, 1);
  assert.equal(roomAAccount?.recentBattleReplays?.[0]?.roomId, roomA.roomId);
  assert.equal(roomBAccount?.recentBattleReplays?.length ?? 0, 0);
  assert.equal(listLobbyRooms().find((entry) => entry.roomId === roomA.roomId)?.activeBattles, 0);
  assert.equal(listLobbyRooms().find((entry) => entry.roomId === roomB.roomId)?.activeBattles, 0);
});

test("battle replay survives a reconnect mid-battle and persists once from the resumed session", async (t) => {
  resetLobbyRoomRegistry();
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-replay-reconnect-${Date.now()}`);
  const originalClient = createFakeClient("session-replay-reconnect-original");
  const reconnectedClient = createFakeClient("session-replay-reconnect-resumed");
  const internalRoom = room as VeilColyseusRoom & {
    playerIdBySessionId: Map<string, string>;
    worldRoom: {
      consumeCompletedBattleReplays(): unknown[];
    };
    allowReconnection(client: Client, seconds: number): Promise<Client>;
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, originalClient, "player-1", "connect-replay-reconnect");
  await emitRoomMessage(room, "world.action", originalClient, {
    type: "world.action",
    requestId: "move-replay-reconnect",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 5, y: 4 }
    }
  });

  await emitRoomMessage(room, "battle.action", originalClient, {
    type: "battle.action",
    requestId: "battle-replay-reconnect-before-drop",
    action: {
      type: "battle.wait",
      unitId: "hero-1-stack"
    }
  });

  internalRoom.allowReconnection = async () => {
    room.clients.push(reconnectedClient);
    return reconnectedClient;
  };
  await room.onDrop(originalClient);
  room.onLeave(originalClient);

  const resumedState = lastSessionState(reconnectedClient, "push");
  assert.ok(resumedState.payload.battle, "expected reconnect push to preserve the active battle");
  assert.equal(internalRoom.playerIdBySessionId.get(reconnectedClient.sessionId), "player-1");
  assert.equal(listLobbyRooms().find((entry) => entry.roomId === room.roomId)?.connectedPlayers, 1);
  assert.equal((await store.loadPlayerAccount("player-1"))?.recentBattleReplays?.length ?? 0, 0);

  const resumedSteps = await resolveBattleThroughRoom(room, reconnectedClient, "player-1");
  const account = await store.loadPlayerAccount("player-1");
  const replay = account?.recentBattleReplays?.[0];
  const replaySaves = store.progressSaves.filter(
    (entry) => entry.playerId === "player-1" && (entry.patch.recentBattleReplays?.length ?? 0) > 0
  );

  assert.ok(resumedSteps > 0);
  assert.equal(account?.recentBattleReplays?.length, 1);
  assert.equal(replay?.roomId, room.roomId);
  assert.equal(replay?.steps.filter((step) => step.source === "player").length, resumedSteps + 1);
  assert.ok(
    replay?.steps.some(
      (step) => step.source === "player" && step.action.type === "battle.wait" && step.action.unitId === "hero-1-stack"
    )
  );
  assert.equal(replaySaves.length, 1);
  assert.equal(replaySaves[0]?.patch.recentBattleReplays?.[0]?.id, replay?.id);
  assert.deepEqual(internalRoom.worldRoom.consumeCompletedBattleReplays(), []);
});

test("pvp replay persistence captures both attacker and defender accounts from room settlement", async (t) => {
  resetLobbyRoomRegistry();
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-replay-pvp-${Date.now()}`);
  const attackerClient = createFakeClient("session-replay-pvp-attacker");
  const defenderClient = createFakeClient("session-replay-pvp-defender");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, attackerClient, "player-1", "connect-replay-pvp-attacker");
  await connectPlayer(room, defenderClient, "player-2", "connect-replay-pvp-defender");

  await emitRoomMessage(room, "world.action", attackerClient, {
    type: "world.action",
    requestId: "move-replay-pvp-attacker",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 3, y: 4 }
    }
  });
  await emitRoomMessage(room, "world.action", defenderClient, {
    type: "world.action",
    requestId: "move-replay-pvp-defender",
    action: {
      type: "hero.move",
      heroId: "hero-2",
      destination: { x: 3, y: 4 }
    }
  });

  const steps = await resolvePvPBattleThroughRoom(room, {
    "player-1": attackerClient,
    "player-2": defenderClient
  });
  const attackerAccount = await store.loadPlayerAccount("player-1");
  const defenderAccount = await store.loadPlayerAccount("player-2");
  const attackerReplay = attackerAccount?.recentBattleReplays?.[0];
  const defenderReplay = defenderAccount?.recentBattleReplays?.[0];
  const replaySaves = store.progressSaves.filter(
    (entry) => (entry.patch.recentBattleReplays?.length ?? 0) > 0 && (entry.playerId === "player-1" || entry.playerId === "player-2")
  );

  assert.ok(steps > 0);
  assert.equal(attackerAccount?.recentBattleReplays?.length, 1);
  assert.equal(defenderAccount?.recentBattleReplays?.length, 1);
  assert.ok(attackerReplay);
  assert.ok(defenderReplay);
  assert.match(attackerReplay.battleId, /^battle-hero-[12]-vs-hero-[12]$/);
  assert.equal(defenderReplay.battleId, attackerReplay.battleId);
  assert.equal(attackerReplay.roomId, room.roomId);
  assert.equal(defenderReplay.roomId, room.roomId);
  assert.deepEqual(
    [attackerReplay.playerCamp, defenderReplay.playerCamp].sort(),
    ["attacker", "defender"]
  );
  assert.equal(attackerReplay.opponentHeroId, defenderReplay.heroId);
  assert.equal(defenderReplay.opponentHeroId, attackerReplay.heroId);
  assert.equal(attackerReplay.steps.length, steps);
  assert.equal(defenderReplay.steps.length, steps);
  assert.deepEqual(defenderReplay.steps, attackerReplay.steps);
  assert.equal(defenderReplay.result, attackerReplay.result);
  assert.deepEqual(
    replaySaves.map((entry) => entry.playerId).sort(),
    ["player-1", "player-2"]
  );
});

test("pvp room summary reports battle-active state before settlement cleanup", async (t) => {
  resetLobbyRoomRegistry();
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-pvp-room-state-${Date.now()}`);
  const attackerClient = createFakeClient("session-pvp-room-state-attacker");
  const defenderClient = createFakeClient("session-pvp-room-state-defender");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, attackerClient, "player-1", "connect-pvp-room-state-attacker");
  await connectPlayer(room, defenderClient, "player-2", "connect-pvp-room-state-defender");

  await emitRoomMessage(room, "world.action", attackerClient, {
    type: "world.action",
    requestId: "move-pvp-room-state-attacker",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 3, y: 4 }
    }
  });
  await emitRoomMessage(room, "world.action", defenderClient, {
    type: "world.action",
    requestId: "move-pvp-room-state-defender",
    action: {
      type: "hero.move",
      heroId: "hero-2",
      destination: { x: 3, y: 4 }
    }
  });

  const activeSummary = listLobbyRooms().find((entry) => entry.roomId === room.roomId);
  assert.equal(activeSummary?.activeBattles, 1);
  assert.equal(activeSummary?.disconnectedPlayers, 0);
  assert.equal(activeSummary?.statusLabel, "PVP 进行中");

});

test("pvp room summary flips to reconnect recovery while a battle participant is disconnected", async (t) => {
  resetLobbyRoomRegistry();
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-pvp-room-reconnect-${Date.now()}`);
  const attackerClient = createFakeClient("session-pvp-room-reconnect-attacker");
  const defenderClient = createFakeClient("session-pvp-room-reconnect-defender");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, attackerClient, "player-1", "connect-pvp-room-reconnect-attacker");
  await connectPlayer(room, defenderClient, "player-2", "connect-pvp-room-reconnect-defender");

  await emitRoomMessage(room, "world.action", attackerClient, {
    type: "world.action",
    requestId: "move-pvp-room-reconnect-attacker",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 3, y: 4 }
    }
  });
  await emitRoomMessage(room, "world.action", defenderClient, {
    type: "world.action",
    requestId: "move-pvp-room-reconnect-defender",
    action: {
      type: "hero.move",
      heroId: "hero-2",
      destination: { x: 3, y: 4 }
    }
  });

  room.onLeave(defenderClient);

  const reconnectSummary = listLobbyRooms().find((entry) => entry.roomId === room.roomId);
  assert.equal(reconnectSummary?.activeBattles, 1);
  assert.equal(reconnectSummary?.disconnectedPlayers, 1);
  assert.equal(reconnectSummary?.statusLabel, "恢复中");
});

test("turn timer auto-applies end day on expiry and pushes countdown state", async (t) => {
  resetLobbyRoomRegistry();
  const timer = createManualRoomTimer(Date.parse("2026-04-04T00:00:00.000Z"));
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-turn-timer-${Date.now()}`);
  const attackerClient = createFakeClient("session-turn-timer-attacker");
  const defenderClient = createFakeClient("session-turn-timer-defender");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
    resetRoomRuntimeDependencies();
  });

  await connectPlayer(room, attackerClient, "player-1", "connect-turn-timer-attacker");
  await connectPlayer(room, defenderClient, "player-2", "connect-turn-timer-defender");

  const initialTimer = lastTurnTimer(attackerClient);
  assert.equal(initialTimer.turnOwnerPlayerId, "player-1");
  assert.equal(initialTimer.remainingMs, 90_000);

  timer.nowMs += 90_001;
  await timer.tick();

  const attackerPush = lastSessionState(attackerClient, "push");
  const defenderPush = lastSessionState(defenderClient, "push");
  const timerAfterExpiry = lastTurnTimer(defenderClient);

  assert.equal(attackerPush.payload.world.meta.day, 2);
  assert.equal(defenderPush.payload.world.meta.day, 2);
  assert.deepEqual(attackerPush.payload.events.map((event) => event.type), ["turn.advanced"]);
  assert.equal(attackerPush.payload.world.turnDeadlineAt, "2026-04-04T00:03:00.001Z");
  assert.equal(timerAfterExpiry.turnOwnerPlayerId, "player-2");
  assert.equal(timerAfterExpiry.remainingMs, 90_000);
});

test("turn reminder subscribe message is skipped while the next player is still connected", async (t) => {
  resetLobbyRoomRegistry();
  const timer = createManualRoomTimer(Date.parse("2026-04-04T00:00:00.000Z"));
  const store = new InstrumentedRoomSnapshotStore();
  const subscribeCalls: Array<{ playerId: string; templateKey: string; data: Record<string, unknown> }> = [];
  configureRoomSnapshotStore(store);
  configureRoomRuntimeDependencies({
    sendWechatSubscribeMessage: async (playerId, templateKey, data) => {
      subscribeCalls.push({ playerId, templateKey, data });
      return true;
    }
  });

  const room = await createTestRoom(`lifecycle-turn-reminder-connected-${Date.now()}`);
  const attackerClient = createFakeClient("session-turn-reminder-connected-attacker");
  const defenderClient = createFakeClient("session-turn-reminder-connected-defender");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
    resetRoomRuntimeDependencies();
  });

  await connectPlayer(room, attackerClient, "player-1", "connect-turn-reminder-connected-attacker");
  await connectPlayer(room, defenderClient, "player-2", "connect-turn-reminder-connected-defender");
  await store.bindPlayerAccountWechatMiniGameIdentity("player-2", {
    openId: "wx-open-id-player-2",
    displayName: "Player Two"
  });

  await emitRoomMessage(room, "world.action", attackerClient, {
    type: "world.action",
    requestId: "turn-reminder-connected-end-day",
    action: {
      type: "turn.endDay"
    }
  });

  assert.deepEqual(subscribeCalls, []);
  assert.equal(lastSessionState(defenderClient, "push").payload.world.meta.day, 2);
  assert.equal(timer.nowMs, Date.parse("2026-04-04T00:00:00.000Z"));
});

test("turn reminder subscribe message is sent after the next player has been disconnected for over 30 seconds", async (t) => {
  resetLobbyRoomRegistry();
  const timer = createManualRoomTimer(Date.parse("2026-04-04T00:00:00.000Z"));
  const store = new InstrumentedRoomSnapshotStore();
  const subscribeCalls: Array<{ playerId: string; templateKey: string; data: Record<string, unknown> }> = [];
  configureRoomSnapshotStore(store);
  configureRoomRuntimeDependencies({
    sendWechatSubscribeMessage: async (playerId, templateKey, data) => {
      subscribeCalls.push({ playerId, templateKey, data });
      return true;
    }
  });

  const room = await createTestRoom(`lifecycle-turn-reminder-disconnected-${Date.now()}`);
  const attackerClient = createFakeClient("session-turn-reminder-disconnected-attacker");
  const defenderClient = createFakeClient("session-turn-reminder-disconnected-defender");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
    resetRoomRuntimeDependencies();
  });

  await connectPlayer(room, attackerClient, "player-1", "connect-turn-reminder-disconnected-attacker");
  await connectPlayer(room, defenderClient, "player-2", "connect-turn-reminder-disconnected-defender");
  await store.bindPlayerAccountWechatMiniGameIdentity("player-2", {
    openId: "wx-open-id-player-2",
    displayName: "Player Two"
  });

  room.onLeave(defenderClient);
  timer.nowMs += 31_000;

  await emitRoomMessage(room, "world.action", attackerClient, {
    type: "world.action",
    requestId: "turn-reminder-disconnected-end-day",
    action: {
      type: "turn.endDay"
    }
  });

  assert.deepEqual(subscribeCalls, [
    {
      playerId: "player-2",
      templateKey: "turn_reminder",
      data: {
        roomId: room.roomId,
        turnNumber: 2
      }
    }
  ]);
});

test("two consecutive AFK strikes trigger afk_forfeit and persist surrender-path ELO deltas", async (t) => {
  resetLobbyRoomRegistry();
  const timer = createManualRoomTimer(Date.parse("2026-04-04T00:00:00.000Z"));
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-afk-forfeit-${Date.now()}`);
  const attackerClient = createFakeClient("session-afk-forfeit-attacker");
  const defenderClient = createFakeClient("session-afk-forfeit-defender");
  const expectedRatings = applyEloMatchResult(1000, 1000);

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
    resetRoomRuntimeDependencies();
  });

  await connectPlayer(room, attackerClient, "player-1", "connect-afk-forfeit-attacker");
  await connectPlayer(room, defenderClient, "player-2", "connect-afk-forfeit-defender");

  timer.nowMs += 90_001;
  await timer.tick();

  await emitRoomMessage(room, "world.action", defenderClient, {
    type: "world.action",
    requestId: "manual-end-day-after-first-timeout",
    action: {
      type: "turn.endDay"
    }
  });

  timer.nowMs += 90_001;
  await timer.tick();

  const attackerPush = lastSessionState(attackerClient, "push");
  const defenderPush = lastSessionState(defenderClient, "push");
  const loserAccount = await store.loadPlayerAccount("player-1");
  const winnerAccount = await store.loadPlayerAccount("player-2");

  assert.equal(attackerPush.payload.reason, "afk_forfeit");
  assert.equal(defenderPush.payload.reason, "afk_forfeit");
  assert.equal(loserAccount?.eloRating, expectedRatings.loserRating);
  assert.equal(winnerAccount?.eloRating, expectedRatings.winnerRating);
  assert.equal(await store.load(room.roomId), null);
});

test("surrender settles the room with the surrendering player as loser and persists ELO deltas", async (t) => {
  resetLobbyRoomRegistry();
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-surrender-${Date.now()}`);
  const surrenderingClient = createFakeClient("session-surrender-loser");
  const opponentClient = createFakeClient("session-surrender-winner");
  const expectedRatings = applyEloMatchResult(1000, 1000);

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, surrenderingClient, "player-1", "connect-surrender-loser");
  await connectPlayer(room, opponentClient, "player-2", "connect-surrender-winner");

  await emitRoomMessage(room, "world.action", surrenderingClient, {
    type: "world.action",
    requestId: "surrender-room",
    action: {
      type: "world.surrender",
      heroId: "hero-1"
    }
  });

  const surrenderReply = lastSessionState(surrenderingClient, "reply");
  const winnerPush = lastSessionState(opponentClient, "push");
  const loserAccount = await store.loadPlayerAccount("player-1");
  const winnerAccount = await store.loadPlayerAccount("player-2");

  assert.equal(surrenderReply.requestId, "surrender-room");
  assert.equal(surrenderReply.payload.reason, "surrender");
  assert.equal(winnerPush.payload.reason, "surrender");
  assert.equal(loserAccount?.eloRating, expectedRatings.loserRating);
  assert.equal(winnerAccount?.eloRating, expectedRatings.winnerRating);
  assert.equal(await store.load(room.roomId), null);
});

test("pvp settlement cleanup retires the room and clears connected player session state", async (t) => {
  resetLobbyRoomRegistry();
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-pvp-settlement-cleanup-${Date.now()}`);
  const surrenderingClient = createFakeClient("session-pvp-cleanup-loser");
  const opponentClient = createFakeClient("session-pvp-cleanup-winner");
  const internalRoom = room as VeilColyseusRoom & {
    playerIdBySessionId: Map<string, string>;
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, surrenderingClient, "player-1", "connect-pvp-cleanup-loser");
  await connectPlayer(room, opponentClient, "player-2", "connect-pvp-cleanup-winner");

  await emitRoomMessage(room, "world.action", surrenderingClient, {
    type: "world.action",
    requestId: "surrender-pvp-cleanup",
    action: {
      type: "world.surrender",
      heroId: "hero-1"
    }
  });

  assert.equal(internalRoom.playerIdBySessionId.size, 0);
  assert.equal(room.clients.length, 0);
  assert.equal(listLobbyRooms().some((entry) => entry.roomId === room.roomId), false);
  assert.equal(getActiveRoomInstances().has(room.roomId), false);
  assert.equal(await store.load(room.roomId), null);
});

test("room report player flow persists one report per room target pair and rejects duplicates", async (t) => {
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-report-pvp-${Date.now()}`);
  const attackerClient = createFakeClient("session-report-attacker");
  const defenderClient = createFakeClient("session-report-defender");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, attackerClient, "player-1", "connect-report-attacker");
  await connectPlayer(room, defenderClient, "player-2", "connect-report-defender");

  await emitRoomMessage(room, "world.action", attackerClient, {
    type: "world.action",
    requestId: "move-report-attacker",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 3, y: 4 }
    }
  });
  await emitRoomMessage(room, "world.action", defenderClient, {
    type: "world.action",
    requestId: "move-report-defender",
    action: {
      type: "hero.move",
      heroId: "hero-2",
      destination: { x: 3, y: 4 }
    }
  });

  await emitRoomMessage(room, "report.player", attackerClient, {
    type: "report.player",
    requestId: "report-once",
    targetPlayerId: "player-2",
    reason: "afk",
    description: "Stopped acting during the PvP encounter."
  });

  const reports = await store.listPlayerReports({ status: "pending" });
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.reporterId, "player-1");
  assert.equal(reports[0]?.targetId, "player-2");
  assert.equal(attackerClient.sent.some((message) => message.type === "report.player" && message.targetPlayerId === "player-2"), true);

  await emitRoomMessage(room, "report.player", attackerClient, {
    type: "report.player",
    requestId: "report-twice",
    targetPlayerId: "player-2",
    reason: "cheating"
  });

  assert.equal(
    attackerClient.sent.some((message) => message.type === "error" && message.requestId === "report-twice" && message.reason === "duplicate_player_report"),
    true
  );
  assert.equal((await store.listPlayerReports({ status: "pending" })).length, 1);
});

test("room report player returns reporting_unavailable when no report store is configured", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-report-unavailable-${Date.now()}`);
  const reporterClient = createFakeClient("session-report-unavailable");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, reporterClient, "player-1", "connect-report-unavailable");
  await emitRoomMessage(room, "report.player", reporterClient, {
    type: "report.player",
    requestId: "report-unavailable",
    targetPlayerId: "player-2",
    reason: "cheating"
  });

  assert.equal(
    reporterClient.sent.some(
      (message) => message.type === "error" && message.requestId === "report-unavailable" && message.reason === "reporting_unavailable"
    ),
    true
  );
});

test("room battle emotes reply to the sender and broadcast to other participants", async (t) => {
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`lifecycle-emote-${Date.now()}`);
  const emoteClient = createFakeClient("session-emote-owner");
  const watcherClient = createFakeClient("session-emote-watcher");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, emoteClient, "player-1", "connect-emote-owner");
  await connectPlayer(room, watcherClient, "player-2", "connect-emote-watcher");
  await store.savePlayerAccountProgress("player-1", {
    cosmeticInventory: {
      ownedIds: ["emote-cheer-spark"]
    },
    equippedCosmetics: {
      battleEmoteId: "emote-cheer-spark"
    }
  });

  await emitRoomMessage(room, "USE_EMOTE", emoteClient, {
    type: "USE_EMOTE",
    requestId: "use-emote-1",
    emoteId: "emote-cheer-spark"
  });

  assert.equal(
    emoteClient.sent.some(
      (message) =>
        message.type === "COSMETIC_APPLIED" &&
        message.requestId === "use-emote-1" &&
        message.delivery === "reply" &&
        message.playerId === "player-1" &&
        message.cosmeticId === "emote-cheer-spark" &&
        message.action === "emote"
    ),
    true
  );
  assert.equal(
    watcherClient.sent.some(
      (message) =>
        message.type === "COSMETIC_APPLIED" &&
        message.requestId === "push" &&
        message.delivery === "push" &&
        message.playerId === "player-1" &&
        message.cosmeticId === "emote-cheer-spark" &&
        message.action === "emote"
    ),
    true
  );
});

test("room at maxClients capacity rejects a new join reservation", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-capacity-${Date.now()}`);
  const internalRoom = room as VeilColyseusRoom & {
    _reserveSeat(sessionId: string, joinOptions?: unknown): Promise<boolean>;
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  for (let index = 0; index < room.maxClients; index += 1) {
    room.clients.push(createFakeClient(`capacity-${index}`));
  }

  assert.equal(await internalRoom._reserveSeat("overflow-session", { playerId: "player-9" }), false);
});

test("room player reports are persisted once per target within the same room", async (t) => {
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`report-room-${Date.now()}`);
  const reporterClient = createFakeClient("reporter-session");
  const targetClient = createFakeClient("target-session");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, reporterClient, "player-1", "connect-reporter");
  await connectPlayer(room, targetClient, "player-2", "connect-target");

  await emitRoomMessage(room, "report.player", reporterClient, {
    type: "report.player",
    requestId: "report-1",
    targetPlayerId: "player-2",
    reason: "cheating"
  });

  const reports = await store.listPlayerReports({ status: "pending" });
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.reporterId, "player-1");
  assert.equal(reports[0]?.targetId, "player-2");
  assert.equal(reports[0]?.roomId, room.roomId);
  assert.equal(
    reporterClient.sent.some(
      (message) =>
        message.type === "session.state" &&
        message.requestId === "report-1" &&
        message.payload.reason === "report_submitted"
    ),
    true
  );

  await emitRoomMessage(room, "report.player", reporterClient, {
    type: "report.player",
    requestId: "report-2",
    targetPlayerId: "player-2",
    reason: "afk"
  });

  assert.equal((await store.listPlayerReports({ status: "pending" })).length, 1);
  assert.equal(
    reporterClient.sent.some(
      (message) => message.type === "error" && message.requestId === "report-2" && message.reason === "duplicate_player_report"
    ),
    true
  );
});

test("room report player rejects unavailable targets after they leave outside an active battle", async (t) => {
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const room = await createTestRoom(`report-target-unavailable-${Date.now()}`);
  const reporterClient = createFakeClient("reporter-target-unavailable");
  const targetClient = createFakeClient("target-target-unavailable");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, reporterClient, "player-1", "connect-reporter-target-unavailable");
  await connectPlayer(room, targetClient, "player-2", "connect-target-target-unavailable");
  room.onLeave(targetClient);

  await emitRoomMessage(room, "report.player", reporterClient, {
    type: "report.player",
    requestId: "report-target-unavailable",
    targetPlayerId: "player-2",
    reason: "afk"
  });

  assert.equal(
    reporterClient.sent.some(
      (message) =>
        message.type === "error" &&
        message.requestId === "report-target-unavailable" &&
        message.reason === "report_target_unavailable"
    ),
    true
  );
  assert.equal((await store.listPlayerReports({ status: "pending" })).length, 0);
});
