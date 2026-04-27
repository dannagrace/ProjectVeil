import assert from "node:assert/strict";
import test from "node:test";
import Redis from "ioredis-mock";
import {
  configureLobbyRoomSummaryStore,
  createRedisLobbyRoomSummaryStore,
  listSharedLobbyRooms,
  resetLobbyRoomRegistry,
  type LobbyRoomSummary
} from "@server/transport/colyseus-room/VeilColyseusRoom";

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
