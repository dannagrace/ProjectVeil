import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import {
  applyEloMatchResult,
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  createMatchmakingHeroSnapshot,
  type ClientMessage,
  type HeroState,
  type MatchmakingRequest,
  type ServerMessage,
  type WorldState
} from "../../../packages/shared/src/index";
import { issueGuestAuthSession, resetGuestAuthSessions } from "../src/auth";
import { configureRoomSnapshotStore, VeilColyseusRoom } from "../src/colyseus-room";
import {
  MatchmakingService,
  configureMatchmakingRuntimeDependencies,
  registerMatchmakingRoutes,
  resetMatchmakingRuntimeDependencies,
  resetMatchmakingService
} from "../src/matchmaking";
import { createMemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import { resetRuntimeObservability } from "../src/observability";
import type { RoomSnapshotStore } from "../src/persistence";

function withEnvOverrides(overrides: Record<string, string | undefined>, cleanup: Array<() => void>): void {
  for (const [key, value] of Object.entries(overrides)) {
    const previousValue = process.env[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    cleanup.push(() => {
      if (previousValue == null) {
        delete process.env[key];
        return;
      }
      process.env[key] = previousValue;
    });
  }
}

function createHero(playerId: string, heroId: string): HeroState {
  return {
    id: heroId,
    playerId,
    name: `Hero ${playerId}`,
    position: { x: 0, y: 0 },
    vision: 2,
    move: { total: 6, remaining: 6 },
    stats: {
      attack: 2,
      defense: 2,
      power: 1,
      knowledge: 1,
      hp: 30,
      maxHp: 30
    },
    progression: createDefaultHeroProgression(),
    loadout: createDefaultHeroLoadout(),
    armyTemplateId: "hero_guard_basic",
    armyCount: 12,
    learnedSkills: []
  };
}

function createSnapshot(roomId: string, heroes: HeroState[]): { state: WorldState; battles: [] } {
  return {
    state: {
      meta: {
        roomId,
        seed: 1001,
        day: 1
      },
      map: {
        width: 1,
        height: 1,
        tiles: [
          {
            position: { x: 0, y: 0 },
            terrain: "grass",
            walkable: true
          }
        ]
      },
      heroes,
      neutralArmies: {},
      buildings: {},
      resources: Object.fromEntries(heroes.map((hero) => [hero.playerId, { gold: 0, wood: 0, ore: 0 }])),
      visibilityByPlayer: {}
    },
    battles: []
  };
}

async function startMatchmakingServer(
  store: RoomSnapshotStore,
  port: number,
  options?: { service?: MatchmakingService; queueTtlSeconds?: number }
): Promise<Server> {
  configureRoomSnapshotStore(store);
  resetGuestAuthSessions();
  resetMatchmakingService();
  resetRuntimeObservability();
  const transport = new WebSocketTransport();
  registerMatchmakingRoutes(transport.getExpressApp() as never, {
    store,
    service: options?.service,
    queueTtlSeconds: options?.queueTtlSeconds
  });
  const server = new Server({ transport });
  server.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await server.listen(port, "127.0.0.1");
  return server;
}

function seedQueue(service: MatchmakingService, requests: MatchmakingRequest[]): void {
  const queue = Reflect.get(service as Record<string, unknown>, "queueByPlayerId") as Map<
    string,
    MatchmakingRequest
  >;
  const queueOrder = Reflect.get(service as Record<string, unknown>, "queueOrder") as string[];
  const queuePositionByPlayerId = Reflect.get(service as Record<string, unknown>, "queuePositionByPlayerId") as Map<
    string,
    number
  >;
  const results = Reflect.get(service as Record<string, unknown>, "resultsByPlayerId") as Map<string, unknown>;
  queue.clear();
  queueOrder.length = 0;
  queuePositionByPlayerId.clear();
  results?.clear();
  const sortedRequests = [...requests].sort(
    (left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.playerId.localeCompare(right.playerId)
  );
  for (const [index, request] of sortedRequests.entries()) {
    queue.set(request.playerId, request);
    queueOrder.push(request.playerId);
    queuePositionByPlayerId.set(request.playerId, index + 1);
  }
}

function createQueueRequest(playerId: string, enqueuedAt: string): MatchmakingRequest {
  return {
    playerId,
    heroSnapshot: createMatchmakingHeroSnapshot(createHero(playerId, `${playerId}-hero`)),
    rating: 1000,
    enqueuedAt
  };
}

async function joinRoom(port: number, logicalRoomId: string, playerId: string): Promise<ColyseusRoom> {
  const client = new Client(`http://127.0.0.1:${port}`);
  return client.joinOrCreate("veil", {
    logicalRoomId,
    playerId,
    seed: 1001
  });
}

async function sendRoomRequest<T extends ServerMessage["type"]>(
  room: ColyseusRoom,
  message: ClientMessage,
  expectedType: T
): Promise<Extract<ServerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${expectedType}`));
    }, 5_000);

    const unsubscribe = room.onMessage("*", (type, payload) => {
      if (typeof type !== "string") {
        return;
      }

      const response = { type, ...(payload as object) } as ServerMessage;
      if ("requestId" in response && response.requestId !== message.requestId) {
        return;
      }
      if (response.type !== expectedType) {
        return;
      }

      clearTimeout(timeout);
      unsubscribe();
      resolve(response as Extract<ServerMessage, { type: T }>);
    });

    room.send(message.type, message);
  });
}

async function connectRoom(room: ColyseusRoom, roomId: string, playerId: string, authToken?: string): Promise<void> {
  await sendRoomRequest(
    room,
    {
      type: "connect",
      requestId: `connect-${playerId}-${Date.now()}`,
      roomId,
      playerId,
      ...(authToken ? { authToken } : {})
    },
    "session.state"
  );
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startTime = Date.now();
  while (!condition()) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("matchmaking routes enqueue, match, report status, and dequeue cleanly", async (t) => {
  const store = createMemoryRoomSnapshotStore();
  await store.save(
    "room-alpha",
    createSnapshot("room-alpha", [createHero("player-1", "hero-1"), createHero("player-2", "hero-2")])
  );
  await store.ensurePlayerAccount({ playerId: "player-1", displayName: "One", lastRoomId: "room-alpha" });
  await store.ensurePlayerAccount({ playerId: "player-2", displayName: "Two", lastRoomId: "room-alpha" });

  const port = 43000 + Math.floor(Math.random() * 1000);
  const server = await startMatchmakingServer(store, port);
  const sessionOne = issueGuestAuthSession({ playerId: "player-1", displayName: "One" });
  const sessionTwo = issueGuestAuthSession({ playerId: "player-2", displayName: "Two" });

  t.after(async () => {
    resetGuestAuthSessions();
    resetMatchmakingService();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const enqueueOne = await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionOne.token}`
    }
  });
  const enqueueOnePayload = (await enqueueOne.json()) as {
    status: string;
    position: number;
    estimatedWaitSeconds: number;
  };
  assert.equal(enqueueOne.status, 200);
  assert.equal(enqueueOnePayload.status, "queued");
  assert.equal(enqueueOnePayload.position, 1);

  const enqueueTwo = await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionTwo.token}`
    }
  });
  const enqueueTwoPayload = (await enqueueTwo.json()) as {
    status: string;
    position: number;
  };
  assert.equal(enqueueTwo.status, 200);
  assert.equal(enqueueTwoPayload.status, "queued");

  const statusOne = await fetch(`http://127.0.0.1:${port}/api/matchmaking/status`, {
    headers: {
      Authorization: `Bearer ${sessionOne.token}`
    }
  });
  const statusOnePayload = (await statusOne.json()) as {
    status: string;
    roomId: string;
    playerIds: [string, string];
  };
  assert.equal(statusOnePayload.status, "matched");
  assert.match(statusOnePayload.roomId, /^pvp-match-/);
  assert.deepEqual(statusOnePayload.playerIds, ["player-1", "player-2"]);

  const statusTwo = await fetch(`http://127.0.0.1:${port}/api/matchmaking/status`, {
    headers: {
      Authorization: `Bearer ${sessionTwo.token}`
    }
  });
  const statusTwoPayload = (await statusTwo.json()) as {
    status: string;
    roomId: string;
  };
  assert.equal(statusTwoPayload.status, "matched");
  assert.equal(statusTwoPayload.roomId, statusOnePayload.roomId);

  const dequeueTwo = await fetch(`http://127.0.0.1:${port}/api/matchmaking/cancel`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${sessionTwo.token}`
    }
  });
  const dequeueTwoPayload = (await dequeueTwo.json()) as { status: string };
  assert.equal(dequeueTwoPayload.status, "idle");

  const dequeueOne = await fetch(`http://127.0.0.1:${port}/api/matchmaking/cancel`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${sessionOne.token}`
    }
  });
  const dequeueOnePayload = (await dequeueOne.json()) as { status: string };
  assert.equal(dequeueOnePayload.status, "idle");
});

test("matchmaking routes send WeChat subscribe notifications when a match is created", async (t) => {
  const store = createMemoryRoomSnapshotStore();
  await store.save(
    "room-frontier_basin",
    createSnapshot("room-frontier_basin", [createHero("player-1", "hero-1"), createHero("player-2", "hero-2")])
  );
  await store.ensurePlayerAccount({ playerId: "player-1", displayName: "One", lastRoomId: "room-frontier_basin" });
  await store.ensurePlayerAccount({ playerId: "player-2", displayName: "Two", lastRoomId: "room-frontier_basin" });
  await store.bindPlayerAccountWechatMiniGameIdentity("player-1", {
    openId: "wx-open-id-player-1",
    displayName: "One"
  });
  await store.bindPlayerAccountWechatMiniGameIdentity("player-2", {
    openId: "wx-open-id-player-2",
    displayName: "Two"
  });

  const subscribeCalls: Array<{ playerId: string; templateKey: string; data: Record<string, unknown> }> = [];
  configureMatchmakingRuntimeDependencies({
    sendWechatSubscribeMessage: async (playerId, templateKey, data) => {
      subscribeCalls.push({ playerId, templateKey, data });
      return true;
    }
  });

  const port = 43000 + Math.floor(Math.random() * 1000);
  const server = await startMatchmakingServer(store, port);
  const sessionOne = issueGuestAuthSession({ playerId: "player-1", displayName: "One" });
  const sessionTwo = issueGuestAuthSession({ playerId: "player-2", displayName: "Two" });

  t.after(async () => {
    resetGuestAuthSessions();
    resetMatchmakingRuntimeDependencies();
    resetMatchmakingService();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionOne.token}`
    }
  });
  await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionTwo.token}`
    }
  });

  await waitFor(() => subscribeCalls.length === 2);
  assert.deepEqual(
    subscribeCalls.sort((left, right) => left.playerId.localeCompare(right.playerId)),
    [
      {
        playerId: "player-1",
        templateKey: "match_found",
        data: {
          mapName: "Phase1",
          opponentName: "Two"
        }
      },
      {
        playerId: "player-2",
        templateKey: "match_found",
        data: {
          mapName: "Phase1",
          opponentName: "One"
        }
      }
    ]
  );
});

test("matchmaking routes log WeChat subscribe failures without breaking match creation", async (t) => {
  const store = createMemoryRoomSnapshotStore();
  await store.save(
    "room-frontier_basin",
    createSnapshot("room-frontier_basin", [createHero("player-1", "hero-1"), createHero("player-2", "hero-2")])
  );
  await store.ensurePlayerAccount({ playerId: "player-1", displayName: "One", lastRoomId: "room-frontier_basin" });
  await store.ensurePlayerAccount({ playerId: "player-2", displayName: "Two", lastRoomId: "room-frontier_basin" });
  await store.bindPlayerAccountWechatMiniGameIdentity("player-1", {
    openId: "wx-open-id-player-1",
    displayName: "One"
  });
  await store.bindPlayerAccountWechatMiniGameIdentity("player-2", {
    openId: "wx-open-id-player-2",
    displayName: "Two"
  });

  const notificationFailure = new Error("match-found send exploded");
  const errorCalls: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errorCalls.push(args);
  };

  configureMatchmakingRuntimeDependencies({
    sendWechatSubscribeMessage: async (playerId) => {
      if (playerId === "player-2") {
        throw notificationFailure;
      }
      return true;
    }
  });

  const port = 43000 + Math.floor(Math.random() * 1000);
  const server = await startMatchmakingServer(store, port);
  const sessionOne = issueGuestAuthSession({ playerId: "player-1", displayName: "One" });
  const sessionTwo = issueGuestAuthSession({ playerId: "player-2", displayName: "Two" });

  t.after(async () => {
    console.error = originalConsoleError;
    resetGuestAuthSessions();
    resetMatchmakingRuntimeDependencies();
    resetMatchmakingService();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionOne.token}`
    }
  });
  await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionTwo.token}`
    }
  });

  await waitFor(() => errorCalls.length === 1);
  assert.equal(errorCalls[0]?.[0], "[matchmaking] Failed to send WeChat match-found notification");
  const loggedDetails = errorCalls[0]?.[1] as {
    roomId?: string;
    playerId?: string;
    opponentId?: string;
    error?: unknown;
  };
  assert.match(loggedDetails.roomId ?? "", /^pvp-match-/);
  assert.equal(loggedDetails.playerId, "player-2");
  assert.equal(loggedDetails.opponentId, "player-1");
  assert.equal(loggedDetails.error, notificationFailure);

  const statusOne = await fetch(`http://127.0.0.1:${port}/api/matchmaking/status`, {
    headers: {
      Authorization: `Bearer ${sessionOne.token}`
    }
  });
  const statusTwo = await fetch(`http://127.0.0.1:${port}/api/matchmaking/status`, {
    headers: {
      Authorization: `Bearer ${sessionTwo.token}`
    }
  });
  const statusOnePayload = (await statusOne.json()) as { status: string };
  const statusTwoPayload = (await statusTwo.json()) as { status: string };
  assert.equal(statusOnePayload.status, "matched");
  assert.equal(statusTwoPayload.status, "matched");
});

test("matchmaking routes can carry matched players through room join and surrender-based elo settlement", async (t) => {
  const store = createMemoryRoomSnapshotStore();
  const port = 43000 + Math.floor(Math.random() * 1000);
  const server = await startMatchmakingServer(store, port);
  const sessionOne = issueGuestAuthSession({ playerId: "player-1", displayName: "One" });
  const sessionTwo = issueGuestAuthSession({ playerId: "player-2", displayName: "Two" });
  const expectedRatings = applyEloMatchResult(1000, 1000);
  const seedRoomOne = `seed-room-one-${Date.now()}`;
  const seedRoomTwo = `seed-room-two-${Date.now()}`;

  t.after(async () => {
    resetGuestAuthSessions();
    resetMatchmakingService();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const seedRoomOneConnection = await joinRoom(port, seedRoomOne, "player-1");
  const seedRoomTwoConnection = await joinRoom(port, seedRoomTwo, "player-2");
  await Promise.all([
    connectRoom(seedRoomOneConnection, seedRoomOne, "player-1", sessionOne.token),
    connectRoom(seedRoomTwoConnection, seedRoomTwo, "player-2", sessionTwo.token)
  ]);

  t.after(() => {
    seedRoomOneConnection.leave();
    seedRoomTwoConnection.leave();
  });

  const accountAfterSeedOne = await store.loadPlayerAccount("player-1");
  const accountAfterSeedTwo = await store.loadPlayerAccount("player-2");
  assert.equal(accountAfterSeedOne?.lastRoomId, seedRoomOne);
  assert.equal(accountAfterSeedTwo?.lastRoomId, seedRoomTwo);

  await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionOne.token}`
    }
  });
  await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionTwo.token}`
    }
  });

  const statusOne = await fetch(`http://127.0.0.1:${port}/api/matchmaking/status`, {
    headers: {
      Authorization: `Bearer ${sessionOne.token}`
    }
  });
  const statusOnePayload = (await statusOne.json()) as {
    status: string;
    roomId: string;
    playerIds: [string, string];
  };
  assert.equal(statusOnePayload.status, "matched");
  assert.match(statusOnePayload.roomId, /^pvp-match-/);
  assert.deepEqual(statusOnePayload.playerIds, ["player-1", "player-2"]);

  const matchedRoomOne = await joinRoom(port, statusOnePayload.roomId, "player-1");
  const matchedRoomTwo = await joinRoom(port, statusOnePayload.roomId, "player-2");
  await Promise.all([
    connectRoom(matchedRoomOne, statusOnePayload.roomId, "player-1", sessionOne.token),
    connectRoom(matchedRoomTwo, statusOnePayload.roomId, "player-2", sessionTwo.token)
  ]);

  t.after(() => {
    matchedRoomOne.leave();
    matchedRoomTwo.leave();
  });

  await sendRoomRequest(
    matchedRoomOne,
    {
      type: "world.action",
      requestId: `surrender-player-1-${Date.now()}`,
      action: {
        type: "world.surrender",
        heroId: "hero-1"
      }
    },
    "session.state"
  );

  const playerOneAccount = await store.loadPlayerAccount("player-1");
  const playerTwoAccount = await store.loadPlayerAccount("player-2");
  assert.equal(playerOneAccount?.lastRoomId, statusOnePayload.roomId);
  assert.equal(playerTwoAccount?.lastRoomId, statusOnePayload.roomId);
  assert.equal(playerOneAccount?.eloRating, expectedRatings.loserRating);
  assert.equal(playerTwoAccount?.eloRating, expectedRatings.winnerRating);
});

test("matchmaking keeps protected new players out of top-tier opponents", async (t) => {
  const store = createMemoryRoomSnapshotStore();
  await store.save(
    "room-alpha",
    createSnapshot("room-alpha", [createHero("player-1", "hero-1"), createHero("player-2", "hero-2")])
  );
  await store.savePlayerAccountProgress("player-1", {
    lastRoomId: "room-alpha",
    recentBattleReplays: []
  });
  await store.savePlayerAccountProgress("player-2", {
    lastRoomId: "room-alpha",
    eloRating: 1600,
    recentBattleReplays: [
      {
        id: "pvp-1",
        roomId: "room-alpha",
        playerId: "player-2",
        battleId: "battle-1",
        battleKind: "hero",
        playerCamp: "attacker",
        heroId: "hero-2",
        opponentHeroId: "hero-1",
        startedAt: "2026-03-28T08:00:00.000Z",
        completedAt: "2026-03-28T08:05:00.000Z",
        initialState: {
          id: "battle-1",
          round: 1,
          lanes: 1,
          activeUnitId: "u-1",
          turnOrder: ["u-1"],
          units: {},
          environment: [],
          log: [],
          rng: { seed: 1, cursor: 0 }
        },
        steps: [],
        result: "attacker_victory"
      }
    ]
  });

  const port = 43100 + Math.floor(Math.random() * 1000);
  const server = await startMatchmakingServer(store, port);
  const protectedSession = issueGuestAuthSession({ playerId: "player-1", displayName: "One" });
  const topTierSession = issueGuestAuthSession({ playerId: "player-2", displayName: "Two" });

  t.after(async () => {
    resetGuestAuthSessions();
    resetMatchmakingService();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: { Authorization: `Bearer ${protectedSession.token}` }
  });
  await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: { Authorization: `Bearer ${topTierSession.token}` }
  });

  const statusResponse = await fetch(`http://127.0.0.1:${port}/api/matchmaking/status`, {
    headers: { Authorization: `Bearer ${protectedSession.token}` }
  });
  const statusPayload = (await statusResponse.json()) as { status: string };

  assert.equal(statusResponse.status, 200);
  assert.equal(statusPayload.status, "queued");
});

test("matchmaking enqueue prunes stale queue entries before adding new players", async (t) => {
  const store = createMemoryRoomSnapshotStore();
  await store.save(
    "room-prune",
    createSnapshot("room-prune", [createHero("player-stale", "hero-stale"), createHero("player-new", "hero-new")])
  );
  await store.ensurePlayerAccount({ playerId: "player-stale", displayName: "Ghost", lastRoomId: "room-prune" });
  await store.ensurePlayerAccount({ playerId: "player-new", displayName: "New", lastRoomId: "room-prune" });

  const service = new MatchmakingService();
  service.enqueue({
    playerId: "player-stale",
    heroSnapshot: createMatchmakingHeroSnapshot(createHero("player-stale", "hero-stale")),
    rating: 950,
    enqueuedAt: "2026-03-24T00:00:00.000Z"
  });

  const port = 43000 + Math.floor(Math.random() * 1000);
  const server = await startMatchmakingServer(store, port, { service, queueTtlSeconds: 60 });
  const session = issueGuestAuthSession({ playerId: "player-new", displayName: "New" });

  t.after(async () => {
    resetGuestAuthSessions();
    resetMatchmakingService();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const enqueueResponse = await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  assert.equal(enqueueResponse.status, 200);
  assert.equal(service.getStatus("player-stale").status, "idle");
});

test("matchmaking routes return 429 with Retry-After after the per-IP rate limit is exceeded", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_RATE_LIMIT_MATCHMAKING_WINDOW_MS: "60000",
      VEIL_RATE_LIMIT_MATCHMAKING_MAX: "2"
    },
    cleanup
  );

  const store = createMemoryRoomSnapshotStore();
  await store.save(
    "room-rate-limit",
    createSnapshot("room-rate-limit", [createHero("player-1", "hero-1"), createHero("player-2", "hero-2")])
  );
  await store.ensurePlayerAccount({ playerId: "player-1", displayName: "One", lastRoomId: "room-rate-limit" });
  await store.ensurePlayerAccount({ playerId: "player-2", displayName: "Two", lastRoomId: "room-rate-limit" });

  const port = 43000 + Math.floor(Math.random() * 1000);
  const server = await startMatchmakingServer(store, port);
  const sessionOne = issueGuestAuthSession({ playerId: "player-1", displayName: "One" });
  const sessionTwo = issueGuestAuthSession({ playerId: "player-2", displayName: "Two" });

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    resetMatchmakingService();
    resetRuntimeObservability();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  for (const session of [sessionOne, sessionTwo]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/matchmaking/status`, {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    });
    assert.equal(response.status, 200);
  }

  const limitedStatusResponse = await fetch(`http://127.0.0.1:${port}/api/matchmaking/status`, {
    headers: {
      Authorization: `Bearer ${sessionOne.token}`
    }
  });
  const limitedStatusPayload = (await limitedStatusResponse.json()) as { error: { code: string } };

  assert.equal(limitedStatusResponse.status, 429);
  assert.equal(limitedStatusPayload.error.code, "rate_limited");
  assert.equal(limitedStatusResponse.headers.get("Retry-After"), "60");

  for (const session of [sessionOne, sessionTwo]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/matchmaking/cancel`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    });
    assert.equal(response.status, 200);
  }

  const limitedCancelResponse = await fetch(`http://127.0.0.1:${port}/api/matchmaking/cancel`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${sessionOne.token}`
    }
  });
  const limitedCancelPayload = (await limitedCancelResponse.json()) as { error: { code: string } };

  assert.equal(limitedCancelResponse.status, 429);
  assert.equal(limitedCancelPayload.error.code, "rate_limited");
  assert.equal(limitedCancelResponse.headers.get("Retry-After"), "60");
});

test("matchmaking enqueue returns 429 with Retry-After after the per-IP rate limit is exceeded", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_RATE_LIMIT_MATCHMAKING_WINDOW_MS: "60000",
      VEIL_RATE_LIMIT_MATCHMAKING_MAX: "2"
    },
    cleanup
  );

  const store = createMemoryRoomSnapshotStore();
  await store.save("room-enqueue-limit", createSnapshot("room-enqueue-limit", [createHero("player-1", "hero-1")]));
  await store.ensurePlayerAccount({ playerId: "player-1", displayName: "One", lastRoomId: "room-enqueue-limit" });

  const port = 43000 + Math.floor(Math.random() * 1000);
  const server = await startMatchmakingServer(store, port);
  const session = issueGuestAuthSession({ playerId: "player-1", displayName: "One" });

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    resetMatchmakingService();
    resetRuntimeObservability();
    await store.close();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    });
    assert.equal(response.status, 200);
  }

  const limitedResponse = await fetch(`http://127.0.0.1:${port}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const limitedPayload = (await limitedResponse.json()) as { error: { code: string } };

  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedPayload.error.code, "rate_limited");
  assert.equal(limitedResponse.headers.get("Retry-After"), "60");
});

test("pruneStaleEntries retains entries newer than TTL", () => {
  const service = new MatchmakingService();
  seedQueue(service, [
    createQueueRequest("player-fresh", "2026-03-28T08:04:30.000Z"),
    createQueueRequest("player-other", "2026-03-28T08:04:40.000Z")
  ]);

  const removed = service.pruneStaleEntries(60 * 1000, new Date("2026-03-28T08:05:00.000Z"));
  assert.equal(removed, 0);
  assert.equal(service.getStatus("player-fresh").status, "queued");
  assert.equal(service.getStatus("player-other").status, "queued");
});

test("pruneStaleEntries reports number of expired entries and keeps fresh ones", () => {
  const service = new MatchmakingService();
  seedQueue(service, [
    createQueueRequest("player-expired-1", "2026-03-28T08:00:00.000Z"),
    createQueueRequest("player-expired-2", "2026-03-28T08:01:00.000Z"),
    createQueueRequest("player-fresh", "2026-03-28T08:04:30.000Z")
  ]);

  const removed = service.pruneStaleEntries(2 * 60 * 1000, new Date("2026-03-28T08:05:00.000Z"));
  assert.equal(removed, 2);
  assert.equal(service.getStatus("player-expired-1").status, "idle");
  assert.equal(service.getStatus("player-expired-2").status, "idle");
  assert.equal(service.getStatus("player-fresh").status, "queued");
});

test("pruneStaleEntries keeps entries at the TTL boundary and expires only older ones", () => {
  const service = new MatchmakingService();
  seedQueue(service, [
    createQueueRequest("player-expired", "2026-03-28T08:02:59.999Z"),
    createQueueRequest("player-boundary", "2026-03-28T08:03:00.000Z")
  ]);

  const removed = service.pruneStaleEntries(2 * 60 * 1000, new Date("2026-03-28T08:05:00.000Z"));
  assert.equal(removed, 1);
  assert.equal(service.getStatus("player-expired").status, "idle");
  assert.equal(service.getStatus("player-boundary").status, "queued");
});
