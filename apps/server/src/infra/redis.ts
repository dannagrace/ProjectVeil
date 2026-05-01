import { randomUUID } from "node:crypto";
import { RedisDriver } from "@colyseus/redis-driver";
import { RedisPresence } from "@colyseus/redis-presence";
import Redis from "ioredis";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";
import { recordRuntimeErrorEvent } from "@server/domain/ops/observability";

export interface ClosableRedisResource {
  shutdown?(): Promise<void> | void;
  quit?(): Promise<void>;
  disconnect?(): void;
}

export interface RedisClientLike {
  del(...keys: string[]): Promise<number>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hmget?(key: string, ...fields: string[]): Promise<Array<string | null>>;
  hset(key: string, field: string, value: string): Promise<number>;
  incr(key: string): Promise<number>;
  lindex(key: string, index: number): Promise<string | null>;
  linsert(key: string, direction: "BEFORE" | "AFTER", pivot: string, value: string): Promise<number>;
  llen(key: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lrem(key: string, count: number, value: string): Promise<number>;
  quit?(): Promise<unknown>;
  rpush(key: string, ...values: string[]): Promise<number>;
  scan?(cursor: string, ...args: string[]): Promise<[string, string[]]>;
  set(
    key: string,
    value: string,
    mode?: "PX" | "EX",
    durationMs?: number,
    condition?: "NX"
  ): Promise<"OK" | null>;
  zadd(key: string, score: number | string, member: string): Promise<number>;
  zcard(key: string): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrank(key: string, member: string): Promise<number | null>;
  zrem(key: string, ...members: string[]): Promise<number>;
}

interface RedisEventableClient {
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "reconnecting", listener: (delayMs: number) => void): unknown;
}

interface RedisConstructorLike {
  new (
    url: string,
    options: {
      maxRetriesPerRequest: number;
      enableReadyCheck: boolean;
      connectTimeout: number;
      commandTimeout: number;
      retryStrategy: (attempt: number) => number;
    }
  ): RedisClientLike & RedisEventableClient;
}

export interface CreateRedisClientDependencies {
  RedisCtor?: RedisConstructorLike;
  logger?: Pick<Console, "warn">;
  recordRuntimeErrorEvent?: typeof recordRuntimeErrorEvent;
}

export function readRedisUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    return null;
  }

  const redisPassword = readRuntimeSecret("REDIS_PASSWORD", env);
  if (!redisPassword) {
    return redisUrl;
  }

  try {
    const url = new URL(redisUrl);
    if (url.password) {
      return redisUrl;
    }
    url.username = url.username || "default";
    url.password = redisPassword;
    return url.toString();
  } catch {
    return redisUrl;
  }
}

export function createRedisPresence(redisUrl: string): RedisPresence {
  return new RedisPresence(redisUrl);
}

export function createRedisDriver(redisUrl: string): RedisDriver {
  return new RedisDriver(redisUrl);
}

function redactRedisUrl(redisUrl: string): string {
  try {
    const url = new URL(redisUrl);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "[invalid-redis-url]";
  }
}

export function createRedisClient(redisUrl: string, deps: CreateRedisClientDependencies = {}): RedisClientLike {
  const RedisCtor = deps.RedisCtor ?? (Redis as unknown as RedisConstructorLike);
  const logger = deps.logger ?? console;
  const captureRuntimeError = deps.recordRuntimeErrorEvent ?? recordRuntimeErrorEvent;
  const redactedRedisUrl = redactRedisUrl(redisUrl);
  const client = new RedisCtor(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 5_000,
    commandTimeout: 3_000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000)
  });

  client.on("error", (error) => {
    captureRuntimeError({
      id: randomUUID(),
      recordedAt: new Date().toISOString(),
      source: "server",
      surface: "redis-client",
      candidateRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "workspace",
      featureArea: "runtime",
      ownerArea: "infra",
      severity: "error",
      errorCode: "redis_client_error",
      message: error.message || "Redis client emitted an error event",
      context: {
        roomId: null,
        playerId: null,
        requestId: null,
        route: null,
        action: "redis.connect",
        statusCode: null,
        crash: false,
        detail: redactedRedisUrl
      }
    });
  });

  client.on("reconnecting", (delayMs) => {
    logger.warn(`Redis client reconnect scheduled in ${delayMs}ms.`);
  });

  return client as RedisClientLike;
}

export async function closeRedisResource(resource: ClosableRedisResource | null | undefined): Promise<void> {
  if (!resource) {
    return;
  }

  if (typeof resource.shutdown === "function") {
    await resource.shutdown();
    return;
  }

  if (typeof resource.quit === "function") {
    await resource.quit();
    return;
  }

  resource.disconnect?.();
}
