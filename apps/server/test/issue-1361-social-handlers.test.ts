import assert from "node:assert/strict";
import test from "node:test";
import { ClientState, matchMaker } from "colyseus";
import type { Client as ColyseusClient } from "colyseus";
import type { ServerMessage } from "../../../packages/shared/src/index";
import { buildPrometheusMetricsDocument, resetRuntimeObservability } from "../src/observability";
import {
  configureRoomSnapshotStore,
  resetLobbyRoomRegistry,
  resetRoomRuntimeDependencies,
  VeilColyseusRoom
} from "../src/colyseus-room";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";

interface FakeClient extends ColyseusClient {
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
    _events: { emit(event: string): void };
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
  requestId: string,
  displayName = playerId
): Promise<void> {
  room.clients.push(client as never);
  room.onJoin(client as never, { playerId });
  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId,
    roomId: room.roomId,
    playerId,
    displayName
  });
}

test("issue 1361: websocket social handlers return leaderboard snapshots and share payloads", async (t) => {
  resetLobbyRoomRegistry();
  resetRoomRuntimeDependencies();
  resetRuntimeObservability();

  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);

  await store.ensurePlayerAccount({ playerId: "player-social", displayName: "雾林司灯" });
  await store.savePlayerAccountProgress("player-social", { eloRating: 1450 });
  await store.ensurePlayerAccount({ playerId: "friend-1", displayName: "山岚旅人" });
  await store.savePlayerAccountProgress("friend-1", { eloRating: 1320 });
  await store.ensurePlayerAccount({ playerId: "friend-2", displayName: "霜港守望" });
  await store.savePlayerAccountProgress("friend-2", { eloRating: 1510 });

  const room = await createTestRoom("room-social");
  const client = createFakeClient("session-social");

  t.after(() => {
    cleanupRoom(room);
    configureRoomSnapshotStore(null);
    resetLobbyRoomRegistry();
    resetRoomRuntimeDependencies();
    resetRuntimeObservability();
  });

  await connectPlayer(room, client, "player-social", "connect-social", "雾林司灯");

  await emitRoomMessage(room, "FRIEND_LEADERBOARD_REQUEST", client, {
    type: "FRIEND_LEADERBOARD_REQUEST",
    requestId: "friends-1",
    friendIds: ["friend-1", "friend-2", "friend-2"]
  });

  const leaderboardReply = client.sent.find(
    (message): message is Extract<ServerMessage, { type: "FRIEND_LEADERBOARD_REQUEST" }> =>
      message.type === "FRIEND_LEADERBOARD_REQUEST" && message.requestId === "friends-1"
  );

  assert.ok(leaderboardReply);
  assert.equal(leaderboardReply.friendCount, 2);
  assert.deepEqual(
    leaderboardReply.items.map((item) => [item.rank, item.playerId, item.isSelf ?? false]),
    [
      [1, "friend-2", false],
      [2, "player-social", true],
      [3, "friend-1", false]
    ]
  );

  await emitRoomMessage(room, "SHARE_ACTIVITY", client, {
    type: "SHARE_ACTIVITY",
    requestId: "share-1",
    activity: "group_challenge",
    roomId: "room-social"
  });

  const shareReply = client.sent.find(
    (message): message is Extract<ServerMessage, { type: "SHARE_ACTIVITY" }> =>
      message.type === "SHARE_ACTIVITY" && message.requestId === "share-1"
  );

  assert.ok(shareReply);
  assert.equal(shareReply.activity, "group_challenge");
  assert.equal(shareReply.roomId, "room-social");
  assert.match(shareReply.shareUrl, /\?roomId=room-social/);
  assert.match(shareReply.shareUrl, /shareScene=lobby/);
  assert.match(shareReply.challengeToken ?? "", /\./);
  assert.equal(shareReply.challenge?.creatorPlayerId, "player-social");

  const metrics = buildPrometheusMetricsDocument();
  assert.match(metrics, /veil_social_friend_leaderboard_requests_total 1/);
  assert.match(metrics, /veil_social_share_activity_requests_total 1/);
});

test("issue 1361: websocket social handlers surface persistence failures as room errors", async (t) => {
  resetLobbyRoomRegistry();
  resetRoomRuntimeDependencies();
  resetRuntimeObservability();
  configureRoomSnapshotStore(null);

  const room = await createTestRoom("room-social-failure");
  const client = createFakeClient("session-social-failure");

  t.after(() => {
    cleanupRoom(room);
    configureRoomSnapshotStore(null);
    resetLobbyRoomRegistry();
    resetRoomRuntimeDependencies();
    resetRuntimeObservability();
  });

  await connectPlayer(room, client, "player-social", "connect-failure");

  await emitRoomMessage(room, "FRIEND_LEADERBOARD_REQUEST", client, {
    type: "FRIEND_LEADERBOARD_REQUEST",
    requestId: "friends-fail",
    friendIds: ["friend-1"]
  });
  await emitRoomMessage(room, "SHARE_ACTIVITY", client, {
    type: "SHARE_ACTIVITY",
    requestId: "share-fail",
    activity: "battle_victory",
    roomId: "room-social-failure"
  });

  const friendError = client.sent.find(
    (message): message is Extract<ServerMessage, { type: "error" }> =>
      message.type === "error" && message.requestId === "friends-fail"
  );
  const shareError = client.sent.find(
    (message): message is Extract<ServerMessage, { type: "error" }> =>
      message.type === "error" && message.requestId === "share-fail"
  );

  assert.equal(friendError?.reason, "social_persistence_unavailable");
  assert.equal(shareError?.reason, "social_persistence_unavailable");
});
