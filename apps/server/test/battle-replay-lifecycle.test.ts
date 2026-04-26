import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { ClientState, matchMaker } from "colyseus";
import type { Client } from "colyseus";
import { issueGuestAuthSession } from "@server/domain/account/auth";
import {
  VeilColyseusRoom,
  configureRoomSnapshotStore,
  resetLobbyRoomRegistry
} from "@server/transport/colyseus-room/VeilColyseusRoom";
import { MemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import { registerPlayerAccountRoutes } from "@server/domain/account/player-accounts";
import type { PlayerAccountProgressPatch, PlayerAccountSnapshot } from "@server/persistence";
import { createRoom } from "@server/index";
import type { BattleReplayPlaybackState, PlayerBattleReplaySummary } from "@veil/shared/battle";
import type { BattleState } from "@veil/shared/models";
import type { ServerMessage } from "@veil/shared/protocol";
import { updateVisibilityByPlayer } from "@veil/shared/world";

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
  room.onJoin(client, {}, { playerId, authSession: null } as never);
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
      requestId: `battle-replay-lifecycle-step-${steps + 1}`,
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

async function startReplayRouteServer(port: number, store: MemoryRoomSnapshotStore): Promise<Server> {
  const transport = new WebSocketTransport();
  registerPlayerAccountRoutes(transport.getExpressApp() as never, store);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

function startNeutralBattle(room: ReturnType<typeof createRoom>, playerId: string, heroId: string) {
  for (const destination of [
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 2 },
    { x: 5, y: 3 }
  ]) {
    const moveResult = room.dispatch(playerId, {
      type: "hero.move",
      heroId,
      destination
    });
    assert.equal(moveResult.ok, true);
  }

  const battleResult = room.dispatch(playerId, {
    type: "hero.move",
    heroId,
    destination: { x: 5, y: 4 }
  });
  assert.equal(battleResult.ok, true);
  assert.ok(battleResult.battle);
  return battleResult;
}

function placeHeroOnTile(
  room: VeilColyseusRoom,
  heroId: string,
  position: { x: number; y: number }
): void {
  const internalRoom = room as VeilColyseusRoom & {
    worldRoom: {
      getInternalState(): {
        map: {
          tiles: Array<{
            position: { x: number; y: number };
            occupant?: { kind: "hero"; refId: string };
          }>;
        };
        heroes: Array<{
          id: string;
          position: { x: number; y: number };
          move: { total: number; remaining: number };
        }>;
        visibilityByPlayer: Record<string, unknown>;
      };
    };
  };

  const state = internalRoom.worldRoom.getInternalState();
  const hero = state.heroes.find((entry) => entry.id === heroId);
  assert.ok(hero);

  const previousTile = state.map.tiles.find((tile) => tile.occupant?.kind === "hero" && tile.occupant.refId === heroId);
  if (previousTile) {
    previousTile.occupant = undefined;
  }

  const nextTile = state.map.tiles.find((tile) => tile.position.x === position.x && tile.position.y === position.y);
  assert.ok(nextTile);

  hero.position = { ...position };
  hero.move.remaining = hero.move.total;
  nextTile.occupant = { kind: "hero", refId: heroId };
  state.visibilityByPlayer = updateVisibilityByPlayer(state.map as never, state.heroes as never, state as never);
}

test("authoritative room captures and drains a completed neutral battle replay", () => {
  const room = createRoom("replay-capture-room", 1001);
  startNeutralBattle(room, "player-1", "hero-1");

  assert.deepEqual(room.consumeCompletedBattleReplays(), []);

  let playerSteps = 0;
  while (playerSteps < 20) {
    const battle = room.getBattleForPlayer("player-1");
    if (!battle) {
      break;
    }

    const activeUnitId = battle.activeUnitId;
    const activeUnit = activeUnitId ? battle.units[activeUnitId] : undefined;
    const target = activeUnit
      ? Object.values(battle.units).find((unit) => unit.camp !== activeUnit.camp && unit.count > 0)
      : undefined;

    assert.ok(activeUnitId);
    assert.ok(target);

    room.dispatchBattle("player-1", {
      type: "battle.attack",
      attackerId: activeUnitId,
      defenderId: target.id
    });
    playerSteps += 1;

    if (room.getBattleForPlayer("player-1")) {
      assert.deepEqual(room.consumeCompletedBattleReplays(), []);
    }
  }

  const completed = room.consumeCompletedBattleReplays();
  assert.equal(completed.length, 1);
  assert.equal(completed[0]?.roomId, "replay-capture-room");
  assert.equal(completed[0]?.battleId, "battle-neutral-1");
  assert.equal(completed[0]?.initialState.id, "battle-neutral-1");
  assert.equal(completed[0]?.attackerPlayerId, "player-1");
  assert.equal(completed[0]?.steps.filter((step) => step.source === "player").length, playerSteps);
  assert.ok(completed[0]?.steps.some((step) => step.source === "automated"));
  assert.deepEqual(room.consumeCompletedBattleReplays(), []);
});

test("authoritative room records rejected player battle actions in completed replay steps", () => {
  const room = createRoom("replay-capture-rejected-room", 1001);
  startNeutralBattle(room, "player-1", "hero-1");

  let rejectedActionRecorded = false;
  let playerSteps = 0;

  while (playerSteps < 20) {
    const battle = room.getBattleForPlayer("player-1");
    if (!battle) {
      break;
    }

    const activeUnitId = battle.activeUnitId;
    const activeUnit = activeUnitId ? battle.units[activeUnitId] : undefined;
    const target = activeUnit
      ? Object.values(battle.units).find((unit) => unit.camp !== activeUnit.camp && unit.count > 0)
      : undefined;

    assert.ok(activeUnitId);
    assert.ok(target);

    if (!rejectedActionRecorded && activeUnit.camp === "attacker") {
      const invalidResult = room.dispatchBattle("player-1", {
        type: "battle.attack",
        attackerId: target.id,
        defenderId: activeUnitId
      });
      assert.equal(invalidResult.ok, false);
      assert.equal(invalidResult.reason, "unit_not_player_controlled");
      rejectedActionRecorded = true;
    }

    room.dispatchBattle("player-1", {
      type: "battle.attack",
      attackerId: activeUnitId,
      defenderId: target.id
    });
    playerSteps += 1;
  }

  assert.equal(rejectedActionRecorded, true);
  const completed = room.consumeCompletedBattleReplays();
  assert.equal(completed.length, 1);
  assert.ok(
    completed[0]?.steps.some(
      (step) =>
        step.source === "player" &&
        step.action.type === "battle.attack" &&
        step.rejection?.reason === "unit_not_player_controlled"
    )
  );
});

test("colyseus replay lifecycle persists the settled replay once into the player account", async (t) => {
  resetLobbyRoomRegistry();
  const store = new InstrumentedRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const logicalRoomId = `replay-persist-${Date.now()}`;
  const room = await createTestRoom(logicalRoomId);
  const client = createFakeClient("session-replay-persist");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, client, "player-1", "connect-replay-persist");
  placeHeroOnTile(room, "hero-1", { x: 5, y: 3 });
  await emitRoomMessage(room, "world.action", client, {
    type: "world.action",
    requestId: "move-replay-persist",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 5, y: 4 }
    }
  });

  assert.equal((await store.loadPlayerAccount("player-1"))?.recentBattleReplays?.length ?? 0, 0);

  const playerSteps = await resolveBattleThroughRoom(room, client, "player-1");
  const account = await store.loadPlayerAccount("player-1");
  const replay = account?.recentBattleReplays?.[0];
  const replaySaves = store.progressSaves.filter(
    (entry) => entry.playerId === "player-1" && (entry.patch.recentBattleReplays?.length ?? 0) > 0
  );

  assert.ok(replay, "expected a persisted replay for player-1");
  assert.equal(account?.recentBattleReplays?.length, 1);
  assert.equal(replay.roomId, logicalRoomId);
  assert.equal(replay.battleId, "battle-neutral-1");
  assert.equal(replay.playerId, "player-1");
  assert.equal(replay.playerCamp, "attacker");
  assert.equal(replay.steps.filter((step) => step.source === "player").length, playerSteps);
  assert.ok(replay.steps.some((step) => step.source === "automated"));
  assert.equal(replaySaves.length, 1);
  assert.equal(replaySaves[0]?.patch.recentBattleReplays?.[0]?.id, replay.id);
});

test("battle replay playback route hands off a persisted live-room replay", async (t) => {
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const logicalRoomId = `replay-route-${Date.now()}`;
  const room = await createTestRoom(logicalRoomId);
  const client = createFakeClient("session-replay-route");
  const port = 43100 + Math.floor(Math.random() * 1000);
  const server = await startReplayRouteServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "player-1",
    displayName: "Replay Route Tester"
  });

  t.after(async () => {
    cleanupRoom(room);
    await server.gracefullyShutdown(false).catch(() => undefined);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, client, "player-1", "connect-replay-route");
  placeHeroOnTile(room, "hero-1", { x: 5, y: 3 });
  await emitRoomMessage(room, "world.action", client, {
    type: "world.action",
    requestId: "move-replay-route",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 5, y: 4 }
    }
  });

  const playerSteps = await resolveBattleThroughRoom(room, client, "player-1");
  const replay = (await store.loadPlayerAccount("player-1"))?.recentBattleReplays?.[0];
  assert.ok(replay, "expected a persisted replay before route handoff");

  const detailResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/${replay.id}`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const detailPayload = (await detailResponse.json()) as { replay: PlayerBattleReplaySummary };
  assert.equal(detailResponse.status, 200);
  assert.equal(detailPayload.replay.id, replay.id);
  assert.equal(detailPayload.replay.roomId, logicalRoomId);

  const playbackResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/${replay.id}/playback?action=tick&repeat=999`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const playbackPayload = (await playbackResponse.json()) as { playback: BattleReplayPlaybackState };

  assert.equal(playbackResponse.status, 200);
  assert.equal(playbackPayload.playback.replay.id, replay.id);
  assert.equal(playbackPayload.playback.replay.roomId, logicalRoomId);
  assert.equal(playbackPayload.playback.currentStepIndex, replay.steps.length);
  assert.equal(playbackPayload.playback.status, "completed");
  assert.equal(
    playbackPayload.playback.replay.steps.filter((step) => step.source === "player").length,
    playerSteps
  );
  assert.ok(playbackPayload.playback.replay.steps.some((step) => step.source === "automated"));

  const rewindResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/${replay.id}/playback` +
      `?currentStepIndex=${replay.steps.length}&action=step-back`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const rewindPayload = (await rewindResponse.json()) as { playback: BattleReplayPlaybackState };
  assert.equal(rewindResponse.status, 200);
  assert.equal(rewindPayload.playback.currentStepIndex, replay.steps.length - 1);
  assert.equal(rewindPayload.playback.status, "paused");
  assert.equal(rewindPayload.playback.currentStep?.index, replay.steps.length - 1);
  assert.equal(rewindPayload.playback.nextStep?.index, replay.steps.length);

  const restoreResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/${replay.id}/playback` +
      `?currentStepIndex=1&status=playing`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const restorePayload = (await restoreResponse.json()) as { playback: BattleReplayPlaybackState };
  assert.equal(restoreResponse.status, 200);
  assert.equal(restorePayload.playback.currentStepIndex, 1);
  assert.equal(restorePayload.playback.status, "playing");
  assert.equal(restorePayload.playback.currentStep?.index, 1);
  assert.equal(restorePayload.playback.nextStep?.index, 2);

  const resetResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/${replay.id}/playback` +
      `?currentStepIndex=1&status=playing&action=reset`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const resetPayload = (await resetResponse.json()) as { playback: BattleReplayPlaybackState };
  assert.equal(resetResponse.status, 200);
  assert.equal(resetPayload.playback.currentStepIndex, 0);
  assert.equal(resetPayload.playback.status, "paused");
  assert.equal(resetPayload.playback.currentStep, null);
  assert.equal(resetPayload.playback.nextStep?.index, 1);
});
