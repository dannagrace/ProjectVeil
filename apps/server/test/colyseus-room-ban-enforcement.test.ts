import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ClientState, matchMaker } from "colyseus";
import type { Client } from "colyseus";
import type { ServerMessage } from "@veil/shared/protocol";
import {
  VeilColyseusRoom,
  configureRoomSnapshotStore,
  resetLobbyRoomRegistry
} from "@server/transport/colyseus-room/VeilColyseusRoom";
import { MemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";

interface FakeClient extends Client {
  sent: ServerMessage[];
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

function mockSystemTime(t: TestContext, isoTimestamp: string): { advance(ms: number): void } {
  const RealDate = Date;
  let currentTime = new RealDate(isoTimestamp).getTime();

  class MockDate extends RealDate {
    constructor(value?: string | number | Date) {
      super(value ?? currentTime);
    }

    static override now(): number {
      return currentTime;
    }
  }

  Object.setPrototypeOf(MockDate, RealDate);
  // @ts-expect-error test-only date override
  globalThis.Date = MockDate;
  t.after(() => {
    // @ts-expect-error test-only date override
    globalThis.Date = RealDate;
  });

  return {
    advance(ms: number) {
      currentTime += ms;
    }
  };
}

test("room connect re-checks persisted ban state and rejects banned players", async (t) => {
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  await store.savePlayerBan("player-banned", {
    banStatus: "temporary",
    banExpiry: "2026-05-05T00:00:00.000Z",
    banReason: "Exploit abuse"
  });
  const room = await createTestRoom(`ban-enforcement-${Date.now()}`);
  const client = createFakeClient("banned-session");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  room.clients.push(client);
  room.onJoin(client, { playerId: "player-banned" });
  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId: "connect-ban",
    roomId: room.roomId,
    playerId: "player-banned"
  });

  assert.equal(client.sent.some((message) => message.type === "error" && message.reason === "account_banned"), true);
  assert.equal(client.sent.some((message) => message.type === "session.state"), false);
});

test("room connect allows non-minors to pass through without minor protection errors", async (t) => {
  mockSystemTime(t, "2026-04-03T14:30:00.000Z");
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  await store.bindPlayerAccountWechatMiniGameIdentity("adult-player", {
    openId: "wx-adult-player",
    ageVerified: true,
    isMinor: false
  });
  const room = await createTestRoom(`adult-player-${Date.now()}`);
  const client = createFakeClient("adult-player-session");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  room.clients.push(client);
  room.onJoin(client, { playerId: "adult-player" });
  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId: "connect-adult-player",
    roomId: room.roomId,
    playerId: "adult-player"
  });

  assert.equal(
    client.sent.some(
      (message) =>
        message.type === "error" &&
        (message.reason === "minor_restricted_hours" || message.reason === "minor_daily_limit_reached")
    ),
    false
  );
  assert.equal(client.sent.some((message) => message.type === "session.state"), true);
});

test("room connect rejects minors during restricted hours", async (t) => {
  mockSystemTime(t, "2026-04-03T14:30:00.000Z");
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  await store.bindPlayerAccountWechatMiniGameIdentity("minor-player", {
    openId: "wx-minor-hours",
    ageVerified: true,
    isMinor: true
  });
  await store.savePlayerAccountProgress("minor-player", {
    dailyPlayMinutes: 10,
    lastPlayDate: "2026-04-03"
  });
  const room = await createTestRoom(`minor-hours-${Date.now()}`);
  const client = createFakeClient("minor-hours-session");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  room.clients.push(client);
  room.onJoin(client, { playerId: "minor-player" });
  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId: "connect-minor-hours",
    roomId: room.roomId,
    playerId: "minor-player"
  });

  const curfewError = client.sent.find(
    (message) => message.type === "error" && message.reason === "minor_restricted_hours"
  );
  assert.ok(curfewError);
  assert.deepEqual(curfewError.minorProtection, {
    enforced: true,
    localDate: "2026-04-03",
    normalizedDailyPlayMinutes: 10,
    dailyLimitMinutes: 90,
    restrictedHours: true,
    dailyLimitReached: false,
    wouldBlock: true,
    reason: "minor_restricted_hours",
    currentServerTime: "2026-04-03T14:30:00.000Z",
    currentLocalTime: "22:30",
    timeZone: "Asia/Shanghai",
    restrictedWindow: {
      startHour: 22,
      endHour: 8
    },
    remainingDailyMinutes: 80,
    nextAllowedAt: "2026-04-04T00:00:00.000Z",
    nextAllowedLocalTime: "08:00",
    nextAllowedCountdownSeconds: 34200
  });
  assert.equal(client.sent.some((message) => message.type === "session.state"), false);
});

test("room connect allows minors during permitted hours while under the daily limit", async (t) => {
  mockSystemTime(t, "2026-04-03T01:00:00.000Z");
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  await store.bindPlayerAccountWechatMiniGameIdentity("minor-allowed", {
    openId: "wx-minor-allowed",
    ageVerified: true,
    isMinor: true
  });
  await store.savePlayerAccountProgress("minor-allowed", {
    dailyPlayMinutes: 45,
    lastPlayDate: "2026-04-03"
  });
  const room = await createTestRoom(`minor-allowed-${Date.now()}`);
  const client = createFakeClient("minor-allowed-session");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  room.clients.push(client);
  room.onJoin(client, { playerId: "minor-allowed" });
  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId: "connect-minor-allowed",
    roomId: room.roomId,
    playerId: "minor-allowed"
  });

  assert.equal(
    client.sent.some(
      (message) =>
        message.type === "error" &&
        (message.reason === "minor_restricted_hours" || message.reason === "minor_daily_limit_reached")
    ),
    false
  );
  assert.equal(client.sent.some((message) => message.type === "session.state"), true);
});

test("room timer kicks minors after reaching the daily playtime limit and blocks rejoin", async (t) => {
  const clock = mockSystemTime(t, "2026-04-03T01:00:00.000Z");
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  await store.bindPlayerAccountWechatMiniGameIdentity("minor-limit", {
    openId: "wx-minor-limit",
    ageVerified: true,
    isMinor: true
  });
  await store.savePlayerAccountProgress("minor-limit", {
    dailyPlayMinutes: 89,
    lastPlayDate: "2026-04-03"
  });
  const room = await createTestRoom(`minor-limit-${Date.now()}`);
  const client = createFakeClient("minor-limit-session");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  room.clients.push(client);
  room.onJoin(client, { playerId: "minor-limit" });
  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId: "connect-minor-limit",
    roomId: room.roomId,
    playerId: "minor-limit"
  });

  assert.equal(client.sent.some((message) => message.type === "session.state"), true);

  clock.advance(60_000);
  room.clock.tick();
  await flushAsyncWork();

  assert.equal(client.sent.some((message) => message.type === "error" && message.reason === "minor_daily_limit_reached"), true);
  assert.equal((await store.loadPlayerAccount("minor-limit"))?.dailyPlayMinutes, 90);

  const secondClient = createFakeClient("minor-limit-session-2");
  room.clients.push(secondClient);
  room.onJoin(secondClient, { playerId: "minor-limit" });
  await emitRoomMessage(room, "connect", secondClient, {
    type: "connect",
    requestId: "connect-minor-limit-retry",
    roomId: room.roomId,
    playerId: "minor-limit"
  });

  const limitError = secondClient.sent.find(
    (message) => message.type === "error" && message.reason === "minor_daily_limit_reached"
  );
  assert.ok(limitError);
  assert.deepEqual(limitError.minorProtection, {
    enforced: true,
    localDate: "2026-04-03",
    normalizedDailyPlayMinutes: 90,
    dailyLimitMinutes: 90,
    restrictedHours: false,
    dailyLimitReached: true,
    wouldBlock: true,
    reason: "minor_daily_limit_reached",
    currentServerTime: "2026-04-03T01:01:00.000Z",
    currentLocalTime: "09:01",
    timeZone: "Asia/Shanghai",
    restrictedWindow: {
      startHour: 22,
      endHour: 8
    },
    remainingDailyMinutes: 0,
    nextAllowedAt: "2026-04-04T00:00:00.000Z",
    nextAllowedLocalTime: "08:00",
    nextAllowedCountdownSeconds: 82740
  });
  assert.equal(secondClient.sent.some((message) => message.type === "session.state"), false);
});
