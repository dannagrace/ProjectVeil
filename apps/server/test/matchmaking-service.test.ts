import assert from "node:assert/strict";
import test from "node:test";
import Redis from "ioredis-mock";
import {
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  createMatchmakingHeroSnapshot,
  type HeroState,
  type MatchmakingRequest
} from "../../../packages/shared/src/index";
import { MatchmakingService, RedisMatchmakingService } from "../src/matchmaking";

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

function createQueueRequest(playerId: string, enqueuedAt: string): MatchmakingRequest {
  return {
    playerId,
    heroSnapshot: createMatchmakingHeroSnapshot(createHero(playerId, `${playerId}-hero`)),
    rating: 1000,
    enqueuedAt
  };
}

function createCustomQueueRequest(
  playerId: string,
  enqueuedAt: string,
  overrides: Partial<MatchmakingRequest> = {}
): MatchmakingRequest {
  return {
    ...createQueueRequest(playerId, enqueuedAt),
    ...overrides
  };
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

  queue.clear();
  queueOrder.length = 0;
  queuePositionByPlayerId.clear();

  const sortedRequests = [...requests].sort(
    (left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.playerId.localeCompare(right.playerId)
  );
  for (const [index, request] of sortedRequests.entries()) {
    queue.set(request.playerId, request);
    queueOrder.push(request.playerId);
    queuePositionByPlayerId.set(request.playerId, index + 1);
  }
}

test("matchmaking service reports queued positions from maintained queue state", () => {
  const service = new MatchmakingService();

  seedQueue(service, [
    createQueueRequest("player-alpha", "2026-03-28T08:00:05.000Z"),
    createQueueRequest("player-beta", "2026-03-28T08:00:10.000Z"),
    createQueueRequest("player-earlier", "2026-03-28T08:00:01.000Z")
  ]);

  assert.deepEqual(service.getStatus("player-earlier"), {
    status: "queued",
    position: 1,
    estimatedWaitSeconds: 0
  });
  assert.deepEqual(service.getStatus("player-alpha"), {
    status: "queued",
    position: 2,
    estimatedWaitSeconds: 15
  });
  assert.deepEqual(service.getStatus("player-beta"), {
    status: "queued",
    position: 3,
    estimatedWaitSeconds: 30
  });
});

test("matchmaking service updates maintained positions after dequeue and prune", () => {
  const service = new MatchmakingService();

  seedQueue(service, [
    createQueueRequest("player-alpha", "2026-03-28T08:00:05.000Z"),
    createQueueRequest("player-beta", "2026-03-28T08:00:10.000Z"),
    createQueueRequest("player-earlier", "2026-03-28T08:00:01.000Z")
  ]);

  assert.equal(service.dequeue("player-alpha"), true);
  assert.deepEqual(service.getStatus("player-earlier"), {
    status: "queued",
    position: 1,
    estimatedWaitSeconds: 0
  });
  assert.deepEqual(service.getStatus("player-beta"), {
    status: "queued",
    position: 2,
    estimatedWaitSeconds: 15
  });

  const removed = service.pruneStaleEntries(5_000, new Date("2026-03-28T08:00:07.000Z"));
  assert.equal(removed, 1);
  assert.equal(service.getStatus("player-earlier").status, "idle");
  assert.deepEqual(service.getStatus("player-beta"), {
    status: "queued",
    position: 1,
    estimatedWaitSeconds: 0
  });
});

test("redis matchmaking service shares queue state and match results across service instances", async (t) => {
  const redis = new Redis();
  const serviceA = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix: "test:matchmaking:shared",
    lockRetryDelayMs: 1
  });
  const serviceB = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix: "test:matchmaking:shared",
    lockRetryDelayMs: 1
  });

  t.after(async () => {
    await serviceA.close();
  });

  const firstQueued = await serviceA.enqueue(createQueueRequest("player-alpha", "2026-03-28T08:00:00.000Z"));
  const secondQueued = await serviceB.enqueue(createQueueRequest("player-beta", "2026-03-28T08:00:05.000Z"));

  assert.deepEqual(firstQueued, {
    status: "queued",
    position: 1,
    estimatedWaitSeconds: 0
  });
  assert.deepEqual(secondQueued, {
    status: "queued",
    position: 2,
    estimatedWaitSeconds: 15
  });

  const statusA = await serviceA.getStatus("player-alpha");
  const statusB = await serviceB.getStatus("player-beta");

  assert.equal(statusA.status, "matched");
  assert.equal(statusB.status, "matched");
  assert.equal(statusA.roomId, statusB.roomId);
  assert.deepEqual(statusA.playerIds, ["player-alpha", "player-beta"]);
});

test("redis matchmaking service prunes stale queue entries across shared instances", async (t) => {
  const redis = new Redis();
  const serviceA = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix: "test:matchmaking:prune",
    lockRetryDelayMs: 1
  });
  const serviceB = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix: "test:matchmaking:prune",
    lockRetryDelayMs: 1
  });

  t.after(async () => {
    await serviceA.close();
  });

  await serviceA.enqueue(createQueueRequest("player-expired", "2026-03-28T08:00:00.000Z"));

  const removed = await serviceB.pruneStaleEntries(2 * 60 * 1000, new Date("2026-03-28T08:05:00.000Z"));
  assert.equal(removed, 1);
  assert.equal((await serviceA.getStatus("player-expired")).status, "idle");

  const freshQueued = await serviceB.enqueue(createQueueRequest("player-fresh", "2026-03-28T08:04:30.000Z"));
  assert.deepEqual(freshQueued, {
    status: "queued",
    position: 1,
    estimatedWaitSeconds: 0
  });
  assert.deepEqual(await serviceB.getStatus("player-fresh"), {
    status: "queued",
    position: 1,
    estimatedWaitSeconds: 0
  });
});

test("redis matchmaking service shares queued positions and dequeue updates across service instances", async (t) => {
  const redis = new Redis();
  const serviceA = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix: "test:matchmaking:positions",
    lockRetryDelayMs: 1
  });
  const serviceB = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix: "test:matchmaking:positions",
    lockRetryDelayMs: 1
  });

  t.after(async () => {
    await serviceA.close();
  });

  await serviceA.enqueue(
    createCustomQueueRequest("player-rookie", "2026-03-28T08:00:00.000Z", {
      protectedPvpMatchesRemaining: 5
    })
  );
  await serviceB.enqueue(
    createCustomQueueRequest("player-veteran", "2026-03-28T08:00:05.000Z", {
      rating: 1600
    })
  );

  assert.deepEqual(await serviceA.getStatus("player-rookie"), {
    status: "queued",
    position: 1,
    estimatedWaitSeconds: 0
  });
  assert.deepEqual(await serviceB.getStatus("player-veteran"), {
    status: "queued",
    position: 2,
    estimatedWaitSeconds: 15
  });

  assert.equal(await serviceA.dequeue("player-rookie"), true);
  assert.deepEqual(await serviceB.getStatus("player-veteran"), {
    status: "queued",
    position: 1,
    estimatedWaitSeconds: 0
  });
  assert.equal((await serviceA.getStatus("player-rookie")).status, "idle");
});
