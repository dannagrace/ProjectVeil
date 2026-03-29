import assert from "node:assert/strict";
import test from "node:test";
import { ClientState, matchMaker } from "colyseus";
import type { Client } from "colyseus";
import type { BattleState, ServerMessage } from "../../../packages/shared/src/index";
import { VeilColyseusRoom, configureRoomSnapshotStore, listLobbyRooms, resetLobbyRoomRegistry } from "../src/colyseus-room";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import type { PlayerAccountProgressPatch, PlayerAccountSnapshot } from "../src/persistence";

interface FakeClient extends Client {
  sent: ServerMessage[];
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

function createFakeClient(sessionId: string): FakeClient {
  return {
    sessionId,
    state: ClientState.JOINED,
    sent: [],
    ref: {
      removeAllListeners() {},
      removeListener() {},
      once() {}
    },
    send(type: string | number, payload?: unknown) {
      this.sent.push({ type, ...(payload as object) } as ServerMessage);
    },
    leave() {},
    enqueueRaw() {},
    raw() {}
  } as FakeClient;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
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

function lastSessionState(client: FakeClient, delivery?: "reply" | "push"): Extract<ServerMessage, { type: "session.state" }> {
  const states = client.sent.filter(
    (message): message is Extract<ServerMessage, { type: "session.state" }> =>
      message.type === "session.state" && (delivery ? message.delivery === delivery : true)
  );
  const latest = states.at(-1);
  assert.ok(latest, "expected a session.state message");
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

test("client reconnect within the window restores room state and records reconnectedAt", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
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
});

test("room disposal after the last client leaves removes it from the active room list", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`lifecycle-dispose-${Date.now()}`);
  const client = createFakeClient("session-dispose");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  room.clients.push(client);
  room.onJoin(client, { playerId: "player-1" });
  room.onLeave(client);
  room.onDispose();

  assert.equal(listLobbyRooms().some((entry) => entry.roomId === room.roomId), false);
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
