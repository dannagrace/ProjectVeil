import assert from "node:assert/strict";
import test from "node:test";
import { ClientState, matchMaker } from "colyseus";
import type { Client } from "colyseus";
import {
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  decodePlayerWorldView,
  type HeroState,
  type ServerMessage,
  type TileState,
  type WorldState
} from "../../../packages/shared/src/index";
import { VeilColyseusRoom, configureRoomSnapshotStore, resetLobbyRoomRegistry } from "../src/colyseus-room";
import { createRoom } from "../src/index";

interface FakeClient extends Client {
  sent: ServerMessage[];
  leaveCalls: Array<{ code?: number; reason?: string }>;
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

function lastMessage<T extends ServerMessage["type"]>(
  client: FakeClient,
  type: T
): Extract<ServerMessage, { type: T }> {
  const message = client.sent.findLast((entry): entry is Extract<ServerMessage, { type: T }> => entry.type === type);
  assert.ok(message, `expected a ${type} message`);
  return message;
}

function createHero(overrides: Partial<HeroState> & Pick<HeroState, "id" | "playerId" | "name">): HeroState {
  return {
    id: overrides.id,
    playerId: overrides.playerId,
    name: overrides.name,
    position: overrides.position ?? { x: 0, y: 0 },
    vision: overrides.vision ?? 1,
    move: overrides.move ?? { total: 2, remaining: 2 },
    stats: overrides.stats ?? {
      attack: 2,
      defense: 2,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    progression: overrides.progression ?? createDefaultHeroProgression(),
    loadout: overrides.loadout ?? createDefaultHeroLoadout(),
    armyTemplateId: overrides.armyTemplateId ?? "hero_guard_basic",
    armyCount: overrides.armyCount ?? 12,
    learnedSkills: overrides.learnedSkills ?? []
  };
}

function createTile(x: number, y: number, options?: Partial<TileState>): TileState {
  return {
    position: { x, y },
    terrain: options?.terrain ?? "grass",
    walkable: options?.walkable ?? true,
    resource: options?.resource,
    occupant: options?.occupant,
    building: options?.building
  };
}

function createFogWorldState(roomId: string): WorldState {
  const heroOne = createHero({
    id: "hero-1",
    playerId: "player-1",
    name: "Scout",
    position: { x: 0, y: 0 },
    move: { total: 2, remaining: 2 }
  });
  const heroTwo = createHero({
    id: "hero-2",
    playerId: "player-2",
    name: "Raider",
    position: { x: 2, y: 0 },
    move: { total: 2, remaining: 2 }
  });

  return {
    meta: {
      roomId,
      seed: 1001,
      day: 1
    },
    map: {
      width: 3,
      height: 1,
      tiles: [
        createTile(0, 0, { occupant: { kind: "hero", refId: "hero-1" } }),
        createTile(1, 0),
        createTile(2, 0, { occupant: { kind: "hero", refId: "hero-2" } })
      ]
    },
    heroes: [heroOne, heroTwo],
    neutralArmies: {},
    buildings: {},
    resources: {
      "player-1": { gold: 0, wood: 0, ore: 0 },
      "player-2": { gold: 0, wood: 0, ore: 0 }
    },
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "hidden"],
      "player-2": ["hidden", "visible", "visible"]
    }
  };
}

test("server culls fog-hidden state from session snapshots and movement helpers", async (t) => {
  resetLobbyRoomRegistry();
  configureRoomSnapshotStore(null);
  const roomId = `fog-culling-${Date.now()}`;
  const room = await createTestRoom(roomId);
  const client = createFakeClient("session-fog-player-1");
  const internalRoom = room as VeilColyseusRoom & {
    worldRoom: ReturnType<typeof createRoom>;
  };

  internalRoom.worldRoom = createRoom(roomId, 1001, {
    state: createFogWorldState(roomId),
    battles: []
  });

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, client, "player-1", "connect-player-1");

  const sessionState = lastMessage(client, "session.state");
  const world = decodePlayerWorldView(sessionState.payload.world);
  const hiddenTile = world.map.tiles.find((tile) => tile.position.x === 2 && tile.position.y === 0);

  assert.ok(hiddenTile, "expected a hidden tile at the enemy hero position");
  assert.equal(hiddenTile.fog, "hidden");
  assert.equal(hiddenTile.terrain, "unknown");
  assert.equal(hiddenTile.walkable, false);
  assert.equal(hiddenTile.occupant, undefined);
  assert.deepEqual(sessionState.payload.reachableTiles, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);

  await emitRoomMessage(room, "world.preview", client, {
    type: "world.preview",
    requestId: "preview-hidden-tile",
    heroId: "hero-1",
    destination: { x: 2, y: 0 }
  });
  assert.equal(lastMessage(client, "world.preview").movementPlan, null);

  await emitRoomMessage(room, "world.reachable", client, {
    type: "world.reachable",
    requestId: "reachable-own-hero",
    heroId: "hero-1"
  });
  assert.deepEqual(lastMessage(client, "world.reachable").reachableTiles, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);

  await emitRoomMessage(room, "world.reachable", client, {
    type: "world.reachable",
    requestId: "reachable-enemy-hero",
    heroId: "hero-2"
  });
  assert.deepEqual(lastMessage(client, "world.reachable").reachableTiles, []);

  await emitRoomMessage(room, "world.action", client, {
    type: "world.action",
    requestId: "move-hidden-tile",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 2, y: 0 }
    }
  });

  const rejectedMove = lastMessage(client, "session.state");
  assert.equal(rejectedMove.requestId, "move-hidden-tile");
  assert.equal(rejectedMove.payload.reason, "destination_blocked");
  assert.deepEqual(rejectedMove.payload.world.ownHeroes[0]?.position, { x: 0, y: 0 });
});
