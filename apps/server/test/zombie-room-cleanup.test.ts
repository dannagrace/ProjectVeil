import assert from "node:assert/strict";
import test from "node:test";
import { matchMaker } from "colyseus";
import {
  VeilColyseusRoom,
  configureRoomRuntimeDependencies,
  configureRoomSnapshotStore,
  getActiveRoomInstances,
  listLobbyRooms,
  resetLobbyRoomRegistry,
  resetRoomRuntimeDependencies,
  runZombieRoomCleanup
} from "../src/colyseus-room";
import {
  buildPrometheusMetricsDocument,
  buildRoomLifecycleSummaryPayload,
  resetRuntimeObservability
} from "../src/observability";

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

test("room creation starts the zombie-room cleanup interval", async (t) => {
  resetLobbyRoomRegistry();
  resetRuntimeObservability();
  configureRoomSnapshotStore(null);
  const intervalDelays: number[] = [];
  configureRoomRuntimeDependencies({
    setInterval: (_handler, delayMs) => {
      intervalDelays.push(delayMs);
      return {
        unref() {}
      };
    },
    clearInterval: () => undefined,
    isMySqlSnapshotStore: () => false
  });
  const room = await createTestRoom(`zombie-cleanup-interval-${Date.now()}`);

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    resetRuntimeObservability();
    configureRoomSnapshotStore(null);
    resetRoomRuntimeDependencies();
  });

  assert.equal(intervalDelays.includes(5 * 60 * 1_000), true);
});

test("background cleanup retires rooms that stay empty past the ttl", async (t) => {
  resetLobbyRoomRegistry();
  resetRuntimeObservability();
  configureRoomSnapshotStore(null);
  let now = Date.parse("2026-04-11T00:00:00.000Z");
  configureRoomRuntimeDependencies({
    setInterval: () => ({}),
    clearInterval: () => undefined,
    isMySqlSnapshotStore: () => false,
    now: () => now
  });
  const room = await createTestRoom(`zombie-cleanup-room-${Date.now()}`);
  const beforeDisposals = buildRoomLifecycleSummaryPayload().summary.counters.roomDisposalsTotal;

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    resetRuntimeObservability();
    configureRoomSnapshotStore(null);
    resetRoomRuntimeDependencies();
  });

  now += 10 * 60 * 1_000 + 1;
  await runZombieRoomCleanup(now);

  assert.equal(getActiveRoomInstances().has(room.roomId), false);
  assert.equal(listLobbyRooms().some((entry) => entry.roomId === room.roomId), false);
  const afterSummary = buildRoomLifecycleSummaryPayload();
  assert.equal(afterSummary.summary.counters.roomDisposalsTotal, beforeDisposals + 1);
  assert.equal(afterSummary.summary.recentEvents[0]?.reason, "dispose");
});

test("retireRoom failures still release room registry state and emit a runtime error metric", async (t) => {
  resetLobbyRoomRegistry();
  resetRuntimeObservability();
  configureRoomSnapshotStore(null);
  const room = await createTestRoom(`zombie-retire-failure-${Date.now()}`);
  const internalRoom = room as VeilColyseusRoom & {
    worldRoom: {
      getActiveBattles(): never;
    };
  };

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    resetRuntimeObservability();
    configureRoomSnapshotStore(null);
    resetRoomRuntimeDependencies();
  });

  internalRoom.worldRoom.getActiveBattles = () => {
    throw new Error("synthetic retire failure");
  };

  room.onDispose();

  assert.equal(getActiveRoomInstances().has(room.roomId), false);
  assert.equal(listLobbyRooms().some((entry) => entry.roomId === room.roomId), false);
  assert.match(
    buildPrometheusMetricsDocument(),
    /^veil_runtime_error_events_total\{error_code="room_retire_failed",feature_area="runtime",owner_area="multiplayer",severity="error"\} 1$/m
  );
});
