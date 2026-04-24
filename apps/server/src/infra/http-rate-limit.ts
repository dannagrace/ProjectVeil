import type { IncomingMessage, ServerResponse } from "node:http";
import { recordHttpRateLimited } from "@server/domain/ops/observability";
import { createRedisClient, readRedisUrl, type RedisClientLike } from "@server/infra/redis";
import { resolveTrustedRequestIp } from "@server/infra/request-ip";

const DEFAULT_HTTP_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_HTTP_RATE_LIMIT_GLOBAL_MAX = 200;
const DEFAULT_HTTP_RATE_LIMIT_SHOP_MAX = 30;
const DEFAULT_HTTP_RATE_LIMIT_LEADERBOARD_MAX = 60;
const DEFAULT_HTTP_RATE_LIMIT_ADMIN_MAX = 10;
const LOCAL_COUNTER_PRUNE_INTERVAL_MS = 30_000;
const REDIS_FIXED_WINDOW_RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local current = redis.call("INCR", key)
if current == 1 then
  redis.call("PEXPIRE", key, window_ms)
end
local ttl = redis.call("PTTL", key)
if ttl < 0 then
  ttl = window_ms
end
if current > max then
  return {0, ttl}
end
return {1, ttl}
`;

type HttpRateLimitScope = "global" | "shop" | "leaderboard" | "admin";

interface HttpRateLimitPolicy {
  scope: HttpRateLimitScope;
  max: number;
}

interface HttpRateLimitConfig {
  windowMs: number;
  globalMax: number;
  shopMax: number;
  leaderboardMax: number;
  adminMax: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface RateLimitWindowConfig {
  windowMs: number;
}

export interface LocalRateLimitState {
  counters: Map<string, number[]>;
  lastPrunedAtMs: number;
}

interface RedisBackedOrLocalRateLimitOptions {
  redisClient?: RedisClientLike | null;
  localState: LocalRateLimitState;
  key: string;
  redisKey?: string;
  config: RateLimitWindowConfig;
  max: number;
  now?: () => number;
}

interface HttpRateLimitDependencies {
  createRedisClient?: typeof createRedisClient;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  redisClient?: RedisClientLike | null;
  redisUrl?: string | null;
}

function parseEnvNumber(
  value: string | undefined,
  fallback: number,
  options: { minimum?: number; integer?: boolean } = {}
): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = options.integer ? Math.floor(parsed) : parsed;
  if (options.minimum != null && normalized < options.minimum) {
    return fallback;
  }

  return normalized;
}

function readHttpRateLimitConfig(env: NodeJS.ProcessEnv = process.env): HttpRateLimitConfig {
  return {
    windowMs: parseEnvNumber(env.VEIL_RATE_LIMIT_HTTP_WINDOW_MS, DEFAULT_HTTP_RATE_LIMIT_WINDOW_MS, {
      minimum: 1,
      integer: true
    }),
    globalMax: parseEnvNumber(env.VEIL_RATE_LIMIT_HTTP_GLOBAL_MAX, DEFAULT_HTTP_RATE_LIMIT_GLOBAL_MAX, {
      minimum: 1,
      integer: true
    }),
    shopMax: parseEnvNumber(env.VEIL_RATE_LIMIT_HTTP_SHOP_MAX, DEFAULT_HTTP_RATE_LIMIT_SHOP_MAX, {
      minimum: 1,
      integer: true
    }),
    leaderboardMax: parseEnvNumber(env.VEIL_RATE_LIMIT_HTTP_LEADERBOARD_MAX, DEFAULT_HTTP_RATE_LIMIT_LEADERBOARD_MAX, {
      minimum: 1,
      integer: true
    }),
    adminMax: parseEnvNumber(env.VEIL_RATE_LIMIT_HTTP_ADMIN_MAX, DEFAULT_HTTP_RATE_LIMIT_ADMIN_MAX, {
      minimum: 1,
      integer: true
    })
  };
}

function resolveRequestIp(request: Pick<IncomingMessage, "headers" | "socket">): string {
  return resolveTrustedRequestIp(request);
}

function resolveHttpRateLimitPolicy(pathname: string, config = readHttpRateLimitConfig()): HttpRateLimitPolicy {
  if (pathname.startsWith("/api/shop")) {
    return { scope: "shop", max: config.shopMax };
  }
  if (pathname.startsWith("/api/leaderboard")) {
    return { scope: "leaderboard", max: config.leaderboardMax };
  }
  if (pathname.startsWith("/api/admin")) {
    return { scope: "admin", max: config.adminMax };
  }
  return { scope: "global", max: config.globalMax };
}

export function createLocalRateLimitState(): LocalRateLimitState {
  return {
    counters: new Map<string, number[]>(),
    lastPrunedAtMs: 0
  };
}

function pruneExpiredSlidingWindowCounters(
  state: LocalRateLimitState,
  config: RateLimitWindowConfig,
  nowMs: number
): void {
  if (nowMs - state.lastPrunedAtMs < LOCAL_COUNTER_PRUNE_INTERVAL_MS) {
    return;
  }

  const windowStart = nowMs - config.windowMs;
  for (const [key, timestamps] of state.counters.entries()) {
    const activeTimestamps = timestamps.filter((timestamp) => timestamp > windowStart);
    if (activeTimestamps.length === 0) {
      state.counters.delete(key);
      continue;
    }
    state.counters.set(key, activeTimestamps);
  }

  state.lastPrunedAtMs = nowMs;
}

function consumeSlidingWindowRateLimit(
  state: LocalRateLimitState,
  key: string,
  config: RateLimitWindowConfig,
  max: number,
  nowMs: number
): RateLimitResult {
  pruneExpiredSlidingWindowCounters(state, config, nowMs);

  const windowStart = nowMs - config.windowMs;
  const timestamps = (state.counters.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  if (timestamps.length >= max) {
    state.counters.set(key, timestamps);
    const oldestTimestamp = timestamps[0] ?? nowMs;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldestTimestamp + config.windowMs - nowMs) / 1000))
    };
  }

  timestamps.push(nowMs);
  state.counters.set(key, timestamps);
  return { allowed: true };
}

async function consumeRedisBackedRateLimit(
  redisClient: RedisClientLike,
  key: string,
  config: RateLimitWindowConfig,
  max: number
): Promise<RateLimitResult> {
  const result = (await redisClient.eval(
    REDIS_FIXED_WINDOW_RATE_LIMIT_SCRIPT,
    1,
    key,
    String(max),
    String(config.windowMs)
  )) as [number, number] | null;

  const [allowedFlag, ttlMs] = Array.isArray(result) ? result : [1, config.windowMs];
  if (allowedFlag === 1) {
    return { allowed: true };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((ttlMs ?? config.windowMs) / 1000))
  };
}

export async function consumeRedisBackedOrLocalRateLimit(
  options: RedisBackedOrLocalRateLimitOptions
): Promise<RateLimitResult> {
  const now = options.now ?? Date.now;
  if (!options.redisClient) {
    return consumeSlidingWindowRateLimit(options.localState, options.key, options.config, options.max, now());
  }

  try {
    return await consumeRedisBackedRateLimit(
      options.redisClient,
      options.redisKey ?? options.key,
      options.config,
      options.max
    );
  } catch {
    return consumeSlidingWindowRateLimit(options.localState, options.key, options.config, options.max, now());
  }
}

function sendRateLimited(response: ServerResponse, retryAfterSeconds: number): void {
  response.statusCode = 429;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Retry-After", String(retryAfterSeconds));
  response.end(
    JSON.stringify({
      error: {
        code: "rate_limited",
        message: "Too many requests, please retry later"
      }
    })
  );
}

export function registerHttpRateLimitMiddleware(app: {
  use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
}, deps: HttpRateLimitDependencies = {}): void {
  const localState = createLocalRateLimitState();
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const redisUrl = deps.redisUrl ?? readRedisUrl(env);
  const redisClient =
    deps.redisClient ?? (redisUrl ? (deps.createRedisClient ?? createRedisClient)(redisUrl) : null);

  app.use((request, response, next) => {
    if (request.method === "OPTIONS") {
      next();
      return;
    }

    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const config = readHttpRateLimitConfig(env);
      const policy = resolveHttpRateLimitPolicy(url.pathname, config);
      const ipAddress = resolveRequestIp(request);
      const rateLimitKey = `${policy.scope}:${ipAddress}`;
      const result = redisClient
        ? await consumeRedisBackedRateLimit(redisClient, `veil:http-rate-limit:${rateLimitKey}`, config, policy.max)
        : consumeSlidingWindowRateLimit(localState, rateLimitKey, config, policy.max, now());

      if (result.allowed) {
        next();
        return;
      }

      recordHttpRateLimited();
      sendRateLimited(response, result.retryAfterSeconds ?? 1);
    })().catch(() => {
      const fallbackConfig = readHttpRateLimitConfig(env);
      const fallbackPolicy = resolveHttpRateLimitPolicy(new URL(request.url ?? "/", "http://127.0.0.1").pathname, fallbackConfig);
      const fallbackIpAddress = resolveRequestIp(request);
      const fallbackResult = consumeSlidingWindowRateLimit(
        localState,
        `${fallbackPolicy.scope}:${fallbackIpAddress}`,
        fallbackConfig,
        fallbackPolicy.max,
        now()
      );

      if (fallbackResult.allowed) {
        next();
        return;
      }

      recordHttpRateLimited();
      sendRateLimited(response, fallbackResult.retryAfterSeconds ?? 1);
    });
  });
}

export const __httpRateLimitInternals = {
  consumeRedisBackedRateLimit,
  consumeSlidingWindowRateLimit,
  pruneExpiredSlidingWindowCounters,
  REDIS_FIXED_WINDOW_RATE_LIMIT_SCRIPT
};
