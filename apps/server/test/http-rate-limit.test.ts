import assert from "node:assert/strict";
import test from "node:test";
import { __httpRateLimitInternals } from "@server/infra/http-rate-limit";
import { startDevServer } from "@server/infra/dev-server";
import { resetRuntimeObservability } from "@server/domain/ops/observability";

const OBSERVABILITY_ADMIN_TOKEN = "http-rate-limit-admin-token";

function withEnvOverrides(
  overrides: Record<string, string>,
  cleanup: Array<() => void>
): void {
  for (const [key, value] of Object.entries(overrides)) {
    const originalValue = process.env[key];
    process.env[key] = value;
    cleanup.push(() => {
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    });
  }
}

function withHeaders(ipAddress: string, extraHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    "x-forwarded-for": ipAddress,
    ...extraHeaders
  };
}

test("HTTP rate limiting returns 429 with Retry-After and increments Prometheus metrics for scoped routes", { concurrency: false }, async (t) => {
  resetRuntimeObservability();
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      ADMIN_SECRET: "test-admin-secret",
      VEIL_ADMIN_TOKEN: OBSERVABILITY_ADMIN_TOKEN,
      VEIL_TRUSTED_PROXIES: "127.0.0.1",
      VEIL_RATE_LIMIT_HTTP_WINDOW_MS: "60000",
      VEIL_RATE_LIMIT_HTTP_GLOBAL_MAX: "2",
      VEIL_RATE_LIMIT_HTTP_SHOP_MAX: "1",
      VEIL_RATE_LIMIT_HTTP_LEADERBOARD_MAX: "1",
      VEIL_RATE_LIMIT_HTTP_ADMIN_MAX: "1"
    },
    cleanup
  );

  const port = 46000 + Math.floor(Math.random() * 1000);
  const runtime = await startDevServer(port, "127.0.0.1");

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetRuntimeObservability();
    await runtime.gracefullyShutdown(false).catch(() => undefined);
  });

  const shopIp = "203.0.113.10";
  const leaderboardIp = "203.0.113.11";
  const adminIp = "203.0.113.12";
  const globalIp = "203.0.113.13";
  const metricsIp = "203.0.113.99";

  const firstShopResponse = await fetch(`http://127.0.0.1:${port}/api/shop/products`, {
    headers: withHeaders(shopIp)
  });
  assert.equal(firstShopResponse.status, 200);

  const limitedShopResponse = await fetch(`http://127.0.0.1:${port}/api/shop/products`, {
    headers: withHeaders(shopIp)
  });
  assert.equal(limitedShopResponse.status, 429);
  assert.equal(limitedShopResponse.headers.get("Retry-After"), "60");
  assert.equal(((await limitedShopResponse.json()) as { error: { code: string } }).error.code, "rate_limited");

  const firstLeaderboardResponse = await fetch(`http://127.0.0.1:${port}/api/leaderboard`, {
    headers: withHeaders(leaderboardIp)
  });
  assert.equal(firstLeaderboardResponse.status, 200);

  const limitedLeaderboardResponse = await fetch(`http://127.0.0.1:${port}/api/leaderboard`, {
    headers: withHeaders(leaderboardIp)
  });
  assert.equal(limitedLeaderboardResponse.status, 429);
  assert.equal(limitedLeaderboardResponse.headers.get("Retry-After"), "60");

  const firstAdminResponse = await fetch(`http://127.0.0.1:${port}/api/admin/overview`, {
    headers: withHeaders(adminIp, { "x-veil-admin-secret": "test-admin-secret" })
  });
  assert.equal(firstAdminResponse.status, 200);

  const limitedAdminResponse = await fetch(`http://127.0.0.1:${port}/api/admin/overview`, {
    headers: withHeaders(adminIp, { "x-veil-admin-secret": "test-admin-secret" })
  });
  assert.equal(limitedAdminResponse.status, 429);
  assert.equal(limitedAdminResponse.headers.get("Retry-After"), "60");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/lobby/rooms`, {
      headers: withHeaders(globalIp)
    });
    assert.equal(response.status, 200);
  }

  const limitedGlobalResponse = await fetch(`http://127.0.0.1:${port}/api/lobby/rooms`, {
    headers: withHeaders(globalIp)
  });
  assert.equal(limitedGlobalResponse.status, 429);
  assert.equal(limitedGlobalResponse.headers.get("Retry-After"), "60");

  const metricsResponse = await fetch(`http://127.0.0.1:${port}/metrics`, {
    headers: withHeaders(metricsIp, {
      "x-veil-admin-token": OBSERVABILITY_ADMIN_TOKEN
    })
  });
  const metricsText = await metricsResponse.text();

  assert.equal(metricsResponse.status, 200);
  assert.match(metricsText, /^veil_http_rate_limited_total 4$/m);
});

test("HTTP rate limiting ignores spoofed forwarded headers from untrusted sockets", { concurrency: false }, async (t) => {
  resetRuntimeObservability();
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      ADMIN_SECRET: "test-admin-secret",
      VEIL_RATE_LIMIT_HTTP_WINDOW_MS: "60000",
      VEIL_RATE_LIMIT_HTTP_GLOBAL_MAX: "1"
    },
    cleanup
  );

  const port = 47000 + Math.floor(Math.random() * 1000);
  const runtime = await startDevServer(port, "127.0.0.1");

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetRuntimeObservability();
    await runtime.gracefullyShutdown(false).catch(() => undefined);
  });

  const firstResponse = await fetch(`http://127.0.0.1:${port}/api/lobby/rooms`, {
    headers: withHeaders("198.51.100.20")
  });
  assert.equal(firstResponse.status, 200);

  const spoofedFollowup = await fetch(`http://127.0.0.1:${port}/api/lobby/rooms`, {
    headers: withHeaders("203.0.113.200")
  });
  assert.equal(spoofedFollowup.status, 429);
  assert.equal(spoofedFollowup.headers.get("Retry-After"), "60");
});

test("HTTP rate limiting uses a Redis-backed shared fixed window when REDIS_URL is available", async () => {
  const counters = new Map<string, { value: number; expiresAt: number }>();
  const fakeRedis = {
    async eval(_script: string, _numKeys: number, key: string, max: string, windowMs: string) {
      const currentTime = Date.now();
      const existing = counters.get(key);
      if (!existing || existing.expiresAt <= currentTime) {
        counters.set(key, {
          value: 1,
          expiresAt: currentTime + Number(windowMs)
        });
        return [1, Number(windowMs)];
      }

      existing.value += 1;
      counters.set(key, existing);
      if (existing.value > Number(max)) {
        return [0, existing.expiresAt - currentTime];
      }

      return [1, existing.expiresAt - currentTime];
    }
  };

  const allowed = await __httpRateLimitInternals.consumeRedisBackedRateLimit(
    fakeRedis as never,
    "veil:http-rate-limit:global:203.0.113.20",
    { windowMs: 60_000 },
    1
  );
  assert.equal(allowed.allowed, true);

  const limited = await __httpRateLimitInternals.consumeRedisBackedRateLimit(
    fakeRedis as never,
    "veil:http-rate-limit:global:203.0.113.20",
    { windowMs: 60_000 },
    1
  );
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterSeconds, 60);
});

test("HTTP rate limiting prunes stale local counters during fallback cleanup", () => {
  const state = {
    counters: new Map<string, number[]>([
      ["stale", [1_000]],
      ["active", [55_000]]
    ]),
    lastPrunedAtMs: 0
  };

  __httpRateLimitInternals.pruneExpiredSlidingWindowCounters(state, { windowMs: 10_000 }, 60_000);

  assert.equal(state.counters.has("stale"), false);
  assert.deepEqual(state.counters.get("active"), [55_000]);
});
