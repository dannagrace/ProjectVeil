import assert from "node:assert/strict";
import test from "node:test";
import { ClientState, matchMaker } from "colyseus";
import type { Client as ColyseusClient } from "colyseus";
import type { ServerMessage } from "@veil/shared/protocol";
import { configureAnalyticsRuntimeDependencies, flushAnalyticsEventsForTest, resetAnalyticsRuntimeDependencies } from "@server/domain/ops/analytics";
import { issueAccountAuthSession } from "@server/domain/account/auth";
import {
  configureRoomSnapshotStore,
  resetLobbyRoomRegistry,
  resetRoomRuntimeDependencies,
  VeilColyseusRoom
} from "@server/transport/colyseus-room/VeilColyseusRoom";
import { MemoryRoomSnapshotStore } from "@server/infra/memory-room-snapshot-store";
import { registerPlayerAccountRoutes } from "@server/domain/account/player-accounts";

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
  requestId: string
): Promise<void> {
  room.clients.push(client as never);
  room.onJoin(client as never, { playerId });
  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId,
    roomId: room.roomId,
    playerId
  });
}

function createRouteRegistryApp(): {
  use(handler: (request: any, response: any, next: () => void) => void): void;
  get(path: string, handler: (request: any, response: any) => Promise<void> | void): void;
  post(path: string, handler: (request: any, response: any) => Promise<void> | void): void;
  put(path: string, handler: (request: any, response: any) => Promise<void> | void): void;
  delete(path: string, handler: (request: any, response: any) => Promise<void> | void): void;
  middleware: Array<(request: any, response: any, next: () => void) => void>;
  routes: Map<string, (request: any, response: any) => Promise<void> | void>;
} {
  const routes = new Map<string, (request: any, response: any) => Promise<void> | void>();
  const middleware: Array<(request: any, response: any, next: () => void) => void> = [];

  return {
    use(handler) {
      middleware.push(handler);
    },
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
    put(path, handler) {
      routes.set(`PUT ${path}`, handler);
    },
    delete(path, handler) {
      routes.set(`DELETE ${path}`, handler);
    },
    middleware,
    routes
  };
}

async function invokeRoute(
  app: ReturnType<typeof createRouteRegistryApp>,
  key: string,
  request: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  }
): Promise<{ statusCode: number; body: unknown }> {
  const handler = app.routes.get(key);
  if (!handler) {
    throw new Error(`route_not_found:${key}`);
  }

  let bodyText = "";
  const response = {
    statusCode: 200,
    setHeader() {},
    end(chunk?: string) {
      bodyText = chunk ?? "";
    }
  };

  for (const middleware of app.middleware) {
    let nextCalled = false;
    middleware(request, response, () => {
      nextCalled = true;
    });
    if (!nextCalled || bodyText) {
      break;
    }
  }
  if (bodyText) {
    return {
      statusCode: response.statusCode,
      body: bodyText ? JSON.parse(bodyText) : null
    };
  }

  await handler(request, response);
  return {
    statusCode: response.statusCode,
    body: bodyText ? JSON.parse(bodyText) : null
  };
}

test("issue 1373: mission detail route reflects acknowledged dialogue lines", async (t) => {
  const store = new MemoryRoomSnapshotStore();
  const app = createRouteRegistryApp();
  registerPlayerAccountRoutes(app as never, store);
  await store.ensurePlayerAccount({
    playerId: "campaign-dialogue-player",
    displayName: "Dialogue Scout"
  });
  await store.savePlayerAccountProgress("campaign-dialogue-player", {
    campaignProgress: {
      missions: [
        {
          missionId: "chapter1-ember-watch",
          attempts: 0,
          acknowledgedDialogueLineIds: ["c1m1-intro-1"]
        }
      ]
    }
  });
  const session = issueAccountAuthSession({
    playerId: "campaign-dialogue-player",
    displayName: "Dialogue Scout",
    loginId: "campaign-dialogue-player"
  });

  t.after(() => {
    resetLobbyRoomRegistry();
  });

  const response = await invokeRoute(app, "GET /api/campaigns/missions/:id", {
    method: "GET",
    url: "/api/campaigns/missions/chapter1-ember-watch",
    headers: {
      authorization: `Bearer ${session.token}`
    },
    params: {
      id: "chapter1-ember-watch"
    }
  });
  const payload = response.body as {
    mission: {
      id: string;
      acknowledgedDialogueLineIds?: string[];
    };
  };

  assert.equal(response.statusCode, 200);
  assert.equal(payload.mission.id, "chapter1-ember-watch");
  assert.deepEqual(payload.mission.acknowledgedDialogueLineIds, ["c1m1-intro-1"]);
});

test("issue 1373: websocket handlers persist dialogue acks idempotently and tutorial progress in order", async (t) => {
  resetLobbyRoomRegistry();
  resetAnalyticsRuntimeDependencies();
  const analyticsLogs: string[] = [];
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  configureAnalyticsRuntimeDependencies({
    log: (message) => {
      analyticsLogs.push(message);
    }
  });

  const room = await createTestRoom(`issue-1373-${Date.now()}`);
  const client = createFakeClient("issue-1373-session");

  t.after(() => {
    cleanupRoom(room);
    resetAnalyticsRuntimeDependencies();
    resetRoomRuntimeDependencies();
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, client, "player-1", "connect-issue-1373");
  client.sent.length = 0;

  await emitRoomMessage(room, "campaign.dialogue.ack", client, {
    type: "campaign.dialogue.ack",
    requestId: "ack-1",
    action: {
      missionId: "chapter1-ember-watch",
      sequence: "intro",
      dialogueLineId: "c1m1-intro-1"
    }
  });
  await emitRoomMessage(room, "campaign.dialogue.ack", client, {
    type: "campaign.dialogue.ack",
    requestId: "ack-2",
    action: {
      missionId: "chapter1-ember-watch",
      sequence: "intro",
      dialogueLineId: "c1m1-intro-1"
    }
  });

  const acknowledgedMission = (await store.loadPlayerAccount("player-1"))?.campaignProgress?.missions.find(
    (mission) => mission.missionId === "chapter1-ember-watch"
  );
  assert.deepEqual(acknowledgedMission?.acknowledgedDialogueLineIds, ["c1m1-intro-1"]);

  await emitRoomMessage(room, "tutorial.progress", client, {
    type: "tutorial.progress",
    requestId: "tutorial-out-of-order",
    action: {
      step: 3,
      reason: "advance"
    }
  });
  assert.equal(client.sent.findLast((message) => message.type === "error")?.reason, "tutorial_progress_out_of_order");

  await emitRoomMessage(room, "tutorial.progress", client, {
    type: "tutorial.progress",
    requestId: "tutorial-step-2",
    action: {
      step: 2,
      reason: "advance"
    }
  });
  await emitRoomMessage(room, "tutorial.progress", client, {
    type: "tutorial.progress",
    requestId: "tutorial-step-3",
    action: {
      step: 3,
      reason: "advance"
    }
  });
  await emitRoomMessage(room, "tutorial.progress", client, {
    type: "tutorial.progress",
    requestId: "tutorial-complete",
    action: {
      step: null,
      reason: "complete"
    }
  });
  await flushAnalyticsEventsForTest({ ANALYTICS_SINK: "stdout" });

  const account = await store.loadPlayerAccount("player-1");
  assert.equal(account?.tutorialStep ?? null, null);

  const tutorialEvents = analyticsLogs
    .filter((entry) => entry.startsWith("[Analytics] {"))
    .map((entry) => JSON.parse(entry.slice("[Analytics] ".length)) as {
      events: Array<{ name: string; payload: { stepId?: string; reason?: string } }>;
    })
    .flatMap((entry) => entry.events)
    .filter((event) => event.name === "tutorial_step");

  assert.deepEqual(
    tutorialEvents.map((event) => event.payload.stepId),
    ["step_2", "step_3", "tutorial_completed"]
  );
  assert.deepEqual(
    tutorialEvents.map((event) => event.payload.reason),
    ["advance", "advance", "complete"]
  );
});
