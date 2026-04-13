import type { IncomingMessage, ServerResponse } from "node:http";
import { recordHttpRateLimited } from "./observability";

const DEFAULT_HTTP_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_HTTP_RATE_LIMIT_GLOBAL_MAX = 200;
const DEFAULT_HTTP_RATE_LIMIT_SHOP_MAX = 30;
const DEFAULT_HTTP_RATE_LIMIT_LEADERBOARD_MAX = 60;
const DEFAULT_HTTP_RATE_LIMIT_ADMIN_MAX = 10;

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

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
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

function readHeaderValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0]?.trim() || null : value?.trim() || null;
}

function readHeaderCsvValue(value: string | string[] | undefined): string | null {
  const headerValue = readHeaderValue(value);
  return headerValue?.split(",")[0]?.trim() || null;
}

function resolveRequestIp(request: Pick<IncomingMessage, "headers" | "socket">): string {
  const forwardedFor = readHeaderCsvValue(request.headers["x-forwarded-for"]);
  const rawIp = forwardedFor || request.socket.remoteAddress?.trim() || "unknown";
  return rawIp.startsWith("::ffff:") ? rawIp.slice("::ffff:".length) : rawIp;
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

function consumeSlidingWindowRateLimit(
  counters: Map<string, number[]>,
  key: string,
  config: Pick<HttpRateLimitConfig, "windowMs">,
  max: number
): RateLimitResult {
  const currentTime = Date.now();
  const windowStart = currentTime - config.windowMs;
  const timestamps = (counters.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  if (timestamps.length >= max) {
    counters.set(key, timestamps);
    const oldestTimestamp = timestamps[0] ?? currentTime;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldestTimestamp + config.windowMs - currentTime) / 1000))
    };
  }

  timestamps.push(currentTime);
  counters.set(key, timestamps);
  return { allowed: true };
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
}): void {
  const counters = new Map<string, number[]>();

  app.use((request, response, next) => {
    if (request.method === "OPTIONS") {
      next();
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const config = readHttpRateLimitConfig();
    const policy = resolveHttpRateLimitPolicy(url.pathname, config);
    const ipAddress = resolveRequestIp(request);
    const result = consumeSlidingWindowRateLimit(counters, `${policy.scope}:${ipAddress}`, config, policy.max);

    if (result.allowed) {
      next();
      return;
    }

    recordHttpRateLimited();
    sendRateLimited(response, result.retryAfterSeconds ?? 1);
  });
}
