import { RedisDriver } from "@colyseus/redis-driver";
import { RedisPresence } from "@colyseus/redis-presence";
import Redis from "ioredis";

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
  hset(key: string, field: string, value: string): Promise<number>;
  incr(key: string): Promise<number>;
  lindex(key: string, index: number): Promise<string | null>;
  linsert(key: string, direction: "BEFORE" | "AFTER", pivot: string, value: string): Promise<number>;
  llen(key: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lrem(key: string, count: number, value: string): Promise<number>;
  quit?(): Promise<unknown>;
  rpush(key: string, ...values: string[]): Promise<number>;
  set(
    key: string,
    value: string,
    mode?: "PX",
    durationMs?: number,
    condition?: "NX"
  ): Promise<"OK" | null>;
}

export function readRedisUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const redisUrl = env.REDIS_URL?.trim();
  return redisUrl ? redisUrl : null;
}

export function createRedisPresence(redisUrl: string): RedisPresence {
  return new RedisPresence(redisUrl);
}

export function createRedisDriver(redisUrl: string): RedisDriver {
  return new RedisDriver(redisUrl);
}

export function createRedisClient(redisUrl: string): RedisClientLike {
  return new Redis(redisUrl) as unknown as RedisClientLike;
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
