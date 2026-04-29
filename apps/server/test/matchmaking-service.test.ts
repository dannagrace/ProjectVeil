import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Redis from "ioredis-mock";
import { createDefaultHeroLoadout, createDefaultHeroProgression, type HeroState } from "@veil/shared/models";
import { createMatchmakingHeroSnapshot, type MatchmakingRequest } from "@veil/shared/social";
import { buildPrometheusMetricsDocument, resetRuntimeObservability } from "@server/domain/ops/observability";
import { MatchmakingService, RedisMatchmakingService } from "@server/domain/social/matchmaking";

test("redis matchmaking queue lifecycle does not remove players with full list scans", async () => {
  const source = await readFile(new URL("../src/domain/social/matchmaking.ts", import.meta.url), "utf8");

  assert.equal(
    /lrem\(\s*this\.queueKey\s*,\s*0\s*,/.test(source),
    false,
    "Redis matchmaking queue lifecycle should not call lrem(this.queueKey, 0, ...)"
  );
});

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
  assert.equal(service.getQueueDepth(), 3);
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
  assert.equal(service.getQueueDepth(), 1);
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
  assert.equal(await serviceA.getQueueDepth(), 0);
});

test("redis matchmaking service removes a matched result when status is consumed", async (t) => {
  const redis = new Redis();
  const keyPrefix = "test:matchmaking:consume-result";
  const serviceA = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix,
    lockRetryDelayMs: 1
  });
  const serviceB = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix,
    lockRetryDelayMs: 1
  });

  t.after(async () => {
    await serviceA.close();
  });

  await serviceA.enqueue(createQueueRequest("player-alpha", "2026-03-28T08:00:00.000Z"));
  await serviceB.enqueue(createQueueRequest("player-beta", "2026-03-28T08:00:05.000Z"));

  assert.notEqual(await redis.hget(`${keyPrefix}:results`, "player-alpha"), null);

  const consumedStatus = await serviceA.getStatus("player-alpha");

  assert.equal(consumedStatus.status, "matched");
  assert.equal(await redis.hget(`${keyPrefix}:results`, "player-alpha"), null);
  assert.notEqual(await redis.hget(`${keyPrefix}:results`, "player-beta"), null);
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
  assert.equal(await serviceA.getQueueDepth(), 1);
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
  assert.equal(await serviceB.getQueueDepth(), 1);
});

test("redis matchmaking batches queue request reads while draining multiple pairs", async (t) => {
  const redis = new Redis();
  const keyPrefix = "test:matchmaking:batch-load";
  const service = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix,
    lockRetryDelayMs: 1
  });
  const queueKey = `${keyPrefix}:queue`;
  const requestKey = `${keyPrefix}:requests`;
  const zrangeCalls: unknown[][] = [];
  const hgetCalls: unknown[][] = [];
  const hmgetCalls: unknown[][] = [];
  const originalZrange = redis.zrange.bind(redis);
  const originalHget = redis.hget.bind(redis);
  const originalHmget = redis.hmget.bind(redis);

  (redis as unknown as { zrange: (...args: unknown[]) => Promise<string[]> }).zrange = async (...args) => {
    zrangeCalls.push(args);
    return originalZrange(...(args as [string, number, number]));
  };
  (redis as unknown as { hget: (...args: unknown[]) => Promise<string | null> }).hget = async (...args) => {
    hgetCalls.push(args);
    return originalHget(...(args as [string, string]));
  };
  (redis as unknown as { hmget: (...args: unknown[]) => Promise<Array<string | null>> }).hmget = async (...args) => {
    hmgetCalls.push(args);
    return originalHmget(...(args as [string, ...string[]]));
  };

  t.after(async () => {
    await service.close();
  });

  const requests = [
    createQueueRequest("player-alpha", "2026-03-28T08:00:00.000Z"),
    createQueueRequest("player-beta", "2026-03-28T08:00:01.000Z"),
    createQueueRequest("player-gamma", "2026-03-28T08:00:02.000Z"),
    createQueueRequest("player-delta", "2026-03-28T08:00:03.000Z")
  ];

  for (const [index, request] of requests.entries()) {
    await redis.zadd(queueKey, index, request.playerId);
    await redis.hset(requestKey, request.playerId, JSON.stringify(request));
  }

  await Reflect.get(service as Record<string, unknown>, "matchQueuedPlayers").call(
    service,
    new Date("2026-03-28T08:05:00.000Z")
  );

  assert.equal(await redis.zcard(queueKey), 0);
  assert.equal(zrangeCalls.length, 1);
  assert.equal(hmgetCalls.length, 1);
  assert.equal(hgetCalls.length, 0);
});

test("redis matchmaking drains matched pairs with bounded Redis write round trips", async (t) => {
  const redis = new Redis();
  const keyPrefix = "test:matchmaking:batch-write";
  const service = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix,
    lockRetryDelayMs: 1
  });
  const queueKey = `${keyPrefix}:queue`;
  const requestKey = `${keyPrefix}:requests`;
  const resultKey = `${keyPrefix}:results`;
  const evalCalls: unknown[][] = [];
  const zremCalls: unknown[][] = [];
  const hdelCalls: unknown[][] = [];
  const hsetCalls: unknown[][] = [];
  const incrCalls: unknown[][] = [];
  const originalEval = redis.eval.bind(redis);
  const originalZrem = redis.zrem.bind(redis);
  const originalHdel = redis.hdel.bind(redis);
  const originalHset = redis.hset.bind(redis);
  const originalIncr = redis.incr.bind(redis);

  (redis as unknown as { eval: (...args: unknown[]) => Promise<unknown> }).eval = async (...args) => {
    evalCalls.push(args);
    return originalEval(...(args as [string, number, ...string[]]));
  };
  (redis as unknown as { zrem: (...args: unknown[]) => Promise<number> }).zrem = async (...args) => {
    zremCalls.push(args);
    return originalZrem(...(args as [string, ...string[]]));
  };
  (redis as unknown as { hdel: (...args: unknown[]) => Promise<number> }).hdel = async (...args) => {
    hdelCalls.push(args);
    return originalHdel(...(args as [string, ...string[]]));
  };
  (redis as unknown as { hset: (...args: unknown[]) => Promise<number> }).hset = async (...args) => {
    hsetCalls.push(args);
    return originalHset(...(args as [string, string, string]));
  };
  (redis as unknown as { incr: (...args: unknown[]) => Promise<number> }).incr = async (...args) => {
    incrCalls.push(args);
    return originalIncr(...(args as [string]));
  };

  t.after(async () => {
    await service.close();
  });

  const requests = [
    createQueueRequest("player-alpha", "2026-03-28T08:00:00.000Z"),
    createQueueRequest("player-beta", "2026-03-28T08:00:01.000Z"),
    createQueueRequest("player-gamma", "2026-03-28T08:00:02.000Z"),
    createQueueRequest("player-delta", "2026-03-28T08:00:03.000Z")
  ];

  for (const [index, request] of requests.entries()) {
    await redis.zadd(queueKey, index, request.playerId);
    await redis.hset(requestKey, request.playerId, JSON.stringify(request));
  }
  hsetCalls.length = 0;

  await Reflect.get(service as Record<string, unknown>, "matchQueuedPlayers").call(
    service,
    new Date("2026-03-28T08:05:00.000Z")
  );

  assert.equal(await redis.zcard(queueKey), 0);
  assert.equal(zremCalls.length, 0);
  assert.equal(hdelCalls.length, 0);
  assert.equal(hsetCalls.length, 0);
  assert.equal(incrCalls.length, 0);
  assert.equal(evalCalls.length, 2);

  const resultAlpha = JSON.parse((await redis.hget(resultKey, "player-alpha")) ?? "{}") as { roomId?: string };
  const resultGamma = JSON.parse((await redis.hget(resultKey, "player-gamma")) ?? "{}") as { roomId?: string };
  assert.match(resultAlpha.roomId ?? "", /-1$/);
  assert.match(resultGamma.roomId ?? "", /-2$/);
});

test("redis matchmaking lock renewal failures are caught and counted", async (t) => {
  resetRuntimeObservability();
  const redis = new Redis();
  const service = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix: "test:matchmaking:renew-failure",
    lockRetryDelayMs: 1,
    lockTimeoutMs: 200
  });
  const originalEval = redis.eval.bind(redis);
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  const originalWarn = console.warn;

  (redis as unknown as { eval: (...args: unknown[]) => Promise<unknown> }).eval = async (...args) => {
    const [script] = args;
    if (typeof script === "string" && script.includes("pexpire")) {
      throw new Error("renew failed");
    }
    return originalEval(...(args as [string, number, ...string[]]));
  };
  console.warn = () => undefined;
  process.on("unhandledRejection", onUnhandledRejection);

  t.after(async () => {
    process.off("unhandledRejection", onUnhandledRejection);
    console.warn = originalWarn;
    resetRuntimeObservability();
    await service.close();
  });

  await Reflect.get(service as Record<string, unknown>, "withLock").call(service, async () => {
    await new Promise((resolve) => setTimeout(resolve, 160));
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(unhandledRejections, []);
  assert.match(buildPrometheusMetricsDocument(), /^veil_matchmaking_lock_renew_failures_total 1$/m);
});

test("redis matchmaking lock renewal failure streak resets after successful renewals", async (t) => {
  resetRuntimeObservability();
  const redis = new Redis();
  const service = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix: "test:matchmaking:renew-recovery",
    lockRetryDelayMs: 1,
    lockTimeoutMs: 250
  });
  const originalEval = redis.eval.bind(redis);
  const originalWarn = console.warn;
  let renewAttempts = 0;

  (redis as unknown as { eval: (...args: unknown[]) => Promise<unknown> }).eval = async (...args) => {
    const [script] = args;
    if (typeof script === "string" && script.includes("pexpire")) {
      renewAttempts += 1;
      if (renewAttempts === 1 || renewAttempts === 3) {
        await originalEval(...(args as [string, number, ...string[]]));
        throw new Error("transient renew failed");
      }
    }
    return originalEval(...(args as [string, number, ...string[]]));
  };
  console.warn = () => undefined;

  t.after(async () => {
    console.warn = originalWarn;
    resetRuntimeObservability();
    await service.close();
  });

  await Reflect.get(service as Record<string, unknown>, "withLock").call(service, async () => {
    await new Promise((resolve) => setTimeout(resolve, 430));
  });

  const metrics = buildPrometheusMetricsDocument();
  assert.equal(renewAttempts >= 3, true);
  assert.match(metrics, /^veil_matchmaking_lock_renew_failures_total 2$/m);
  assert.match(metrics, /^veil_matchmaking_lock_lost_total 0$/m);
});

test("redis matchmaking stops before writing matches after repeated lock renewal failures", async (t) => {
  resetRuntimeObservability();
  const redis = new Redis();
  const service = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix: "test:matchmaking:lock-lost",
    lockRetryDelayMs: 1,
    lockTimeoutMs: 250
  });
  const originalEval = redis.eval.bind(redis);
  let zremCalls = 0;
  const originalZrem = redis.zrem.bind(redis);
  const originalWarn = console.warn;

  (redis as unknown as { eval: (...args: unknown[]) => Promise<unknown> }).eval = async (...args) => {
    const [script] = args;
    if (typeof script === "string" && script.includes("pexpire")) {
      throw new Error("renew failed");
    }
    return originalEval(...(args as [string, number, ...string[]]));
  };
  (redis as unknown as { zrem: (...args: unknown[]) => Promise<unknown> }).zrem = async (...args) => {
    zremCalls += 1;
    return originalZrem(...(args as [string, ...string[]]));
  };
  console.warn = () => undefined;

  t.after(async () => {
    console.warn = originalWarn;
    resetRuntimeObservability();
    await service.close();
  });

  await assert.rejects(
    () =>
      Reflect.get(service as Record<string, unknown>, "withLock").call(service, async () => {
        await new Promise((resolve) => setTimeout(resolve, 270));
        await Reflect.get(service as Record<string, unknown>, "matchQueuedPlayers").call(
          service,
          new Date("2026-03-29T00:00:00.000Z")
        );
      }),
    /Matchmaking lock lost/
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(zremCalls, 0);
  assert.match(buildPrometheusMetricsDocument(), /^veil_matchmaking_lock_renew_failures_total 2$/m);
  assert.match(buildPrometheusMetricsDocument(), /^veil_matchmaking_lock_lost_total 1$/m);
});

test("redis matchmaking fenced batch writes reject stale lock ownership", async (t) => {
  resetRuntimeObservability();
  const redis = new Redis();
  const keyPrefix = "test:matchmaking:fenced-write";
  const service = new RedisMatchmakingService({
    redisClient: redis as never,
    keyPrefix,
    lockRetryDelayMs: 1,
    lockTimeoutMs: 250
  });
  const originalEval = redis.eval.bind(redis);
  const lockKey = `${keyPrefix}:lock`;
  const requestKey = `${keyPrefix}:requests`;
  const queueKey = `${keyPrefix}:queue`;
  const resultKey = `${keyPrefix}:results`;
  const originalWarn = console.warn;

  t.after(async () => {
    console.warn = originalWarn;
    resetRuntimeObservability();
    await service.close();
  });

  console.warn = () => undefined;
  await redis.hset(requestKey, "player-alpha", JSON.stringify(createQueueRequest("player-alpha", "2026-03-29T00:00:00.000Z")));
  await redis.hset(requestKey, "player-beta", JSON.stringify(createQueueRequest("player-beta", "2026-03-29T00:00:01.000Z")));
  await redis.zadd(queueKey, 1, "player-alpha", 2, "player-beta");

  (redis as unknown as { eval: (...args: unknown[]) => Promise<unknown> }).eval = async (...args) => {
    const [script] = args;
    if (typeof script === "string" && script.includes("hset") && script.includes("zrem")) {
      await redis.set(lockKey, "other-token");
    }
    return originalEval(...(args as [string, number, ...string[]]));
  };

  await Reflect.get(service as Record<string, unknown>, "withLock").call(service, async (lock: unknown) => {
    await Reflect.get(service as Record<string, unknown>, "matchQueuedPlayers").call(
      service,
      new Date("2026-03-29T00:00:00.000Z"),
      lock
    );
  });

  assert.equal(await redis.hget(resultKey, "player-alpha"), null);
  assert.deepEqual(await redis.zrange(queueKey, 0, -1), ["player-alpha", "player-beta"]);
  assert.match(buildPrometheusMetricsDocument(), /^veil_matchmaking_fenced_write_rejected_total 1$/m);
});
