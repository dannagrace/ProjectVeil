import assert from "node:assert/strict";
import test from "node:test";
import Redis from "ioredis-mock";
import {
  configureLobbyRoomSummaryStore,
  createRedisLobbyRoomSummaryStore,
  deleteSharedLobbyRoomSummary,
  listSharedLobbyRooms,
  publishSharedLobbyRoomSummary,
  resetLobbyRoomRegistry,
  type LobbyRoomSummary
} from "@server/transport/colyseus-room/VeilColyseusRoom";
import {
  buildPrometheusMetricsDocument,
  resetRuntimeObservability
} from "@server/domain/ops/observability";

function makeSummary(roomId: string, connectedPlayers: number, updatedAt: string): LobbyRoomSummary {
  return {
    roomId,
    seed: 1001,
    day: 3,
    connectedPlayers,
    disconnectedPlayers: 0,
    heroCount: connectedPlayers,
    activeBattles: 0,
    statusLabel: "探索中",
    updatedAt
  };
}

function captureConsoleError(): { calls: unknown[][]; restore: () => void } {
  const originalConsoleError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.error = originalConsoleError;
    }
  };
}

test("lobby room summaries are shared through Redis across route instances", async (t) => {
  const redis = new Redis();
  const keyPrefix = "test:veil:lobby-room-summary:";
  const firstPodStore = createRedisLobbyRoomSummaryStore(redis as never, { keyPrefix });
  const secondPodStore = createRedisLobbyRoomSummaryStore(redis as never, { keyPrefix });
  configureLobbyRoomSummaryStore(secondPodStore);

  t.after(async () => {
    configureLobbyRoomSummaryStore(null);
    resetLobbyRoomRegistry();
    await redis.quit();
  });

  await firstPodStore.upsert(makeSummary("room-shared-a", 2, "2026-04-27T05:00:00.000Z"));
  await secondPodStore.upsert(makeSummary("room-shared-b", 1, "2026-04-27T05:01:00.000Z"));

  const rooms = await listSharedLobbyRooms();

  assert.deepEqual(
    rooms.map((room) => [room.roomId, room.connectedPlayers]),
    [
      ["room-shared-b", 1],
      ["room-shared-a", 2]
    ]
  );

  await firstPodStore.delete("room-shared-a");
  const afterDelete = await listSharedLobbyRooms();

  assert.deepEqual(afterDelete.map((room) => room.roomId), ["room-shared-b"]);
});

test("redis lobby room summaries list through the explicit index without scanning keyspace", async (t) => {
  const redis = new Redis();
  const keyPrefix = "test:veil:lobby-room-summary-indexed:";
  let scanCalls = 0;
  redis.scan = async () => {
    scanCalls += 1;
    throw new Error("Redis keyspace scan should not be used for lobby room summary listing");
  };
  const store = createRedisLobbyRoomSummaryStore(redis as never, { keyPrefix });

  t.after(async () => {
    await redis.quit();
  });

  await store.upsert(makeSummary("room-indexed-a", 1, "2026-04-27T05:02:00.000Z"));
  await store.upsert(makeSummary("room-indexed-b", 3, "2026-04-27T05:03:00.000Z"));

  const rooms = await store.list();

  assert.equal(scanCalls, 0);
  assert.deepEqual(
    rooms.map((room) => [room.roomId, room.connectedPlayers]),
    [
      ["room-indexed-b", 3],
      ["room-indexed-a", 1]
    ]
  );
});

test("redis lobby room summary index removes expired and malformed entries", async (t) => {
  const redis = new Redis();
  const keyPrefix = "test:veil:lobby-room-summary-cleanup:";
  const store = createRedisLobbyRoomSummaryStore(redis as never, { keyPrefix, ttlSeconds: 60 });

  t.after(async () => {
    await redis.quit();
  });

  await store.upsert(makeSummary("room-valid", 1, "2026-04-27T05:04:00.000Z"));

  const indexedKeys = await redis.keys(`${keyPrefix}*`);
  let summaryHashKey: string | null = null;
  for (const key of indexedKeys) {
    const type = await redis.type(key);
    if (type === "hash") {
      summaryHashKey = key;
    }
  }
  assert.ok(summaryHashKey, "summary hash key should be created");

  await redis.hset(summaryHashKey, "room-malformed", "{not json");
  await redis.hset(
    summaryHashKey,
    "room-expired",
    JSON.stringify({
      expiresAtMs: Date.now() - 1_000,
      summary: makeSummary("room-expired", 1, "2026-04-27T05:01:00.000Z")
    })
  );

  const rooms = await store.list();

  assert.deepEqual(rooms.map((room) => room.roomId), ["room-valid"]);
  assert.equal(await redis.hget(summaryHashKey, "room-malformed"), null);
  assert.equal(await redis.hget(summaryHashKey, "room-expired"), null);
});

test("shared lobby room listing logs and counts Redis read failures before local fallback", async (t) => {
  const consoleError = captureConsoleError();
  configureLobbyRoomSummaryStore({
    async upsert() {
      throw new Error("unexpected upsert");
    },
    async delete() {
      throw new Error("unexpected delete");
    },
    async list() {
      throw new Error("redis hgetall failed");
    }
  });
  resetRuntimeObservability();

  t.after(() => {
    consoleError.restore();
    configureLobbyRoomSummaryStore(null);
    resetLobbyRoomRegistry();
    resetRuntimeObservability();
  });

  const rooms = await listSharedLobbyRooms();

  assert.deepEqual(rooms, []);
  assert.equal(consoleError.calls.length, 1);
  assert.match(String(consoleError.calls[0]?.[0]), /Shared lobby room summary list failed/);
  assert.match(buildPrometheusMetricsDocument(), /veil_lobby_room_summary_redis_read_failures_total 1/);
});

test("shared lobby room publish and delete log and count Redis write/delete failures", async (t) => {
  const consoleError = captureConsoleError();
  configureLobbyRoomSummaryStore({
    async upsert() {
      throw new Error("redis hset failed");
    },
    async delete() {
      throw new Error("redis hdel failed");
    },
    async list() {
      return [];
    }
  });
  resetRuntimeObservability();

  t.after(() => {
    consoleError.restore();
    configureLobbyRoomSummaryStore(null);
    resetLobbyRoomRegistry();
    resetRuntimeObservability();
  });

  await publishSharedLobbyRoomSummary(makeSummary("room-write-failure", 1, "2026-04-27T05:05:00.000Z"));
  await deleteSharedLobbyRoomSummary("room-write-failure");

  assert.equal(consoleError.calls.length, 2);
  assert.match(String(consoleError.calls[0]?.[0]), /Shared lobby room summary publish failed/);
  assert.match(String(consoleError.calls[1]?.[0]), /Shared lobby room summary delete failed/);
  const metrics = buildPrometheusMetricsDocument();
  assert.match(metrics, /veil_lobby_room_summary_redis_write_failures_total 1/);
  assert.match(metrics, /veil_lobby_room_summary_redis_delete_failures_total 1/);
});
