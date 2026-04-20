import assert from "node:assert/strict";
import test from "node:test";
import { ClientState, matchMaker } from "colyseus";
import type { Client } from "colyseus";
import type { ServerMessage } from "@veil/shared/protocol";
import {
  VeilColyseusRoom,
  configureRoomRuntimeDependencies,
  configureRoomSnapshotStore,
  resetLobbyRoomRegistry,
  resetRoomRuntimeDependencies,
  runZombieRoomCleanup
} from "@server/transport/colyseus-room/VeilColyseusRoom";
import {
  configureErrorMonitoringRuntimeDependencies,
  resetErrorMonitoringRuntimeDependencies
} from "@server/domain/ops/error-monitoring";
import { MemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import { buildPrometheusMetricsDocument, resetRuntimeObservability } from "@server/domain/ops/observability";

interface FakeClient extends Client {
  sent: ServerMessage[];
  leaveCalls: Array<{ code?: number; reason?: string }>;
}

class InstrumentedRoomSnapshotStore extends MemoryRoomSnapshotStore {}

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

function withTestSentry() {
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const previousEnv = {
    SENTRY_DSN: process.env.SENTRY_DSN,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA
  };

  process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/42";
  process.env.NODE_ENV = "test";
  process.env.VERCEL_GIT_COMMIT_SHA = "test-background-task";
  configureErrorMonitoringRuntimeDependencies({
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return { ok: true, status: 202 };
    }
  });

  return {
    fetchCalls,
    restore() {
      resetErrorMonitoringRuntimeDependencies();
      process.env.SENTRY_DSN = previousEnv.SENTRY_DSN;
      process.env.NODE_ENV = previousEnv.NODE_ENV;
      process.env.VERCEL_GIT_COMMIT_SHA = previousEnv.VERCEL_GIT_COMMIT_SHA;
    }
  };
}

function parseSentryPayload(fetchCall: { init?: RequestInit } | undefined): {
  message?: { formatted?: string };
  tags?: Record<string, string>;
  contexts?: { project_veil?: Record<string, unknown> };
  user?: { id?: string };
} {
  return JSON.parse(String(fetchCall?.init?.body).split("\n")[2] ?? "{}") as {
    message?: { formatted?: string };
    tags?: Record<string, string>;
    contexts?: { project_veil?: Record<string, unknown> };
    user?: { id?: string };
  };
}

test("turn timer failures are reported to error monitoring and runtime metrics", async (t) => {
  resetLobbyRoomRegistry();
  resetRuntimeObservability();
  const timer = createManualRoomTimer(Date.parse("2026-04-04T00:00:00.000Z"));
  const store = new InstrumentedRoomSnapshotStore();
  const sentry = withTestSentry();
  configureRoomSnapshotStore(store);

  const room = await createTestRoom(`background-turn-timer-failure-${Date.now()}`);
  const attackerClient = createFakeClient("session-background-turn-timer-attacker");
  const defenderClient = createFakeClient("session-background-turn-timer-defender");
  const failure = new Error("turn timer exploded");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    resetRuntimeObservability();
    configureRoomSnapshotStore(null);
    resetRoomRuntimeDependencies();
    sentry.restore();
  });

  await connectPlayer(room, attackerClient, "player-1", "connect-background-turn-timer-attacker");
  await connectPlayer(room, defenderClient, "player-2", "connect-background-turn-timer-defender");

  (room as VeilColyseusRoom & {
    handleTurnTimeout(context: { mode: "world" | "battle"; playerId: string }): Promise<void>;
  }).handleTurnTimeout = async () => {
    throw failure;
  };

  timer.nowMs += 90_001;
  await timer.tick();

  assert.match(
    buildPrometheusMetricsDocument(),
    /^veil_runtime_error_events_total\{error_code="turn_timer_tick_failed",feature_area="runtime",owner_area="multiplayer",severity="error"\} 1$/m
  );
  assert.equal(sentry.fetchCalls.length, 1);
  const sentryPayload = parseSentryPayload(sentry.fetchCalls[0]);
  assert.equal(sentryPayload.message?.formatted, "Background turn timer tick failed.");
  assert.deepEqual(sentryPayload.tags, {
    error_code: "turn_timer_tick_failed",
    feature_area: "runtime",
    owner_area: "multiplayer",
    surface: "colyseus-room",
    action: "turn_timer"
  });
  assert.equal(sentryPayload.user?.id, "player-1");
  assert.equal(sentryPayload.contexts?.project_veil?.roomId, room.roomId);
  assert.equal(sentryPayload.contexts?.project_veil?.playerId, "player-1");
});

test("minor playtime failures are reported to error monitoring and runtime metrics", async (t) => {
  resetLobbyRoomRegistry();
  resetRuntimeObservability();
  const store = new InstrumentedRoomSnapshotStore();
  const sentry = withTestSentry();
  configureRoomSnapshotStore(store);

  const room = await createTestRoom(`background-minor-playtime-failure-${Date.now()}`);
  const client = createFakeClient("session-background-minor-playtime");
  const failure = new Error("minor playtime exploded");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    resetRuntimeObservability();
    configureRoomSnapshotStore(null);
    resetRoomRuntimeDependencies();
    sentry.restore();
  });

  await connectPlayer(room, client, "player-1", "connect-background-minor-playtime");

  store.loadPlayerAccounts = async () => {
    throw failure;
  };

  await (room as VeilColyseusRoom & { tickMinorPlaytime(): Promise<void> }).tickMinorPlaytime();
  await flushAsyncWork();

  assert.match(
    buildPrometheusMetricsDocument(),
    /^veil_runtime_error_events_total\{error_code="minor_playtime_tick_failed",feature_area="runtime",owner_area="multiplayer",severity="error"\} 1$/m
  );
  assert.equal(sentry.fetchCalls.length, 1);
  const sentryPayload = parseSentryPayload(sentry.fetchCalls[0]);
  assert.equal(sentryPayload.message?.formatted, "Background minor-playtime tick failed.");
  assert.deepEqual(sentryPayload.tags, {
    error_code: "minor_playtime_tick_failed",
    feature_area: "runtime",
    owner_area: "multiplayer",
    surface: "colyseus-room",
    action: "minor_playtime"
  });
  assert.equal(sentryPayload.contexts?.project_veil?.roomId, room.roomId);
});

test("zombie room cleanup tick failures are reported to error monitoring and runtime metrics", async (t) => {
  resetLobbyRoomRegistry();
  resetRuntimeObservability();
  configureRoomSnapshotStore(null);
  const sentry = withTestSentry();
  const room = await createTestRoom(`background-zombie-cleanup-failure-${Date.now()}`);
  const failure = new Error("cleanup exploded");

  t.after(() => {
    cleanupRoom(room);
    resetLobbyRoomRegistry();
    resetRuntimeObservability();
    configureRoomSnapshotStore(null);
    resetRoomRuntimeDependencies();
    sentry.restore();
  });

  (room as VeilColyseusRoom & {
    runExpiredEmptyRoomCleanup(now: number): Promise<void>;
  }).runExpiredEmptyRoomCleanup = async () => {
    throw failure;
  };

  await runZombieRoomCleanup(Date.parse("2026-04-11T00:00:00.000Z"));

  assert.match(
    buildPrometheusMetricsDocument(),
    /^veil_runtime_error_events_total\{error_code="zombie_room_cleanup_tick_failed",feature_area="runtime",owner_area="multiplayer",severity="error"\} 1$/m
  );
  assert.equal(sentry.fetchCalls.length, 1);
  const sentryPayload = parseSentryPayload(sentry.fetchCalls[0]);
  assert.equal(sentryPayload.message?.formatted, "Background zombie-room cleanup tick failed.");
  assert.deepEqual(sentryPayload.tags, {
    error_code: "zombie_room_cleanup_tick_failed",
    feature_area: "runtime",
    owner_area: "multiplayer",
    surface: "colyseus-room",
    action: "zombie_room_cleanup"
  });
  assert.equal(sentryPayload.contexts?.project_veil?.roomId, room.roomId);
});
