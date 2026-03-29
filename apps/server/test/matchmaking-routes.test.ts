import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import {
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  createMatchmakingHeroSnapshot,
  type HeroState,
  type MatchmakingRequest,
  type WorldState
} from "../../../packages/shared/src/index";
import { issueGuestAuthSession, resetGuestAuthSessions } from "../src/auth";
import { MatchmakingService, registerMatchmakingRoutes, resetMatchmakingService } from "../src/matchmaking";
import { createMemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import type { RoomSnapshotStore } from "../src/persistence";

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
  resetGuestAuthSessions();
  resetMatchmakingService();
  const transport = new WebSocketTransport();
  registerMatchmakingRoutes(transport.getExpressApp() as never, {
    store,
    service: options?.service,
    queueTtlSeconds: options?.queueTtlSeconds
  });
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

function seedQueue(service: MatchmakingService, requests: MatchmakingRequest[]): void {
  const queue = Reflect.get(service as Record<string, unknown>, "queueByPlayerId") as Map<
    string,
    MatchmakingRequest
  >;
  const results = Reflect.get(service as Record<string, unknown>, "resultsByPlayerId") as Map<string, unknown>;
  queue.clear();
  results?.clear();
  for (const request of requests) {
    queue.set(request.playerId, request);
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

  const dequeueTwo = await fetch(`http://127.0.0.1:${port}/api/matchmaking/dequeue`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${sessionTwo.token}`
    }
  });
  const dequeueTwoPayload = (await dequeueTwo.json()) as { status: string };
  assert.equal(dequeueTwoPayload.status, "idle");

  const dequeueOne = await fetch(`http://127.0.0.1:${port}/api/matchmaking/dequeue`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${sessionOne.token}`
    }
  });
  const dequeueOnePayload = (await dequeueOne.json()) as { status: string };
  assert.equal(dequeueOnePayload.status, "idle");
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
